using Serilog;
using Stratus.Desktop.Models;
using System.Collections.ObjectModel;

namespace Stratus.Desktop.Services.PakBus;

/// <summary>
/// High-level service that manages a PakBus/serial connection to a
/// Campbell Scientific datalogger and polls it for real-time data.
/// Converts raw PakBus table data into WeatherRecord objects for the UI.
/// </summary>
public class LoggerConnectionService : IDisposable
{
    private readonly PakBusProtocol _protocol;
    private readonly SerialPortService _serialPort;

    private CancellationTokenSource? _pollCts;
    private Task? _pollTask;
    private bool _disposed;

    private List<PakBusTableDef> _tableDefs = new();
    private PakBusTableDef? _dataTable; // The main data table to collect from

    // ── Configuration ──
    public string PortName { get; private set; } = string.Empty;
    public int BaudRate { get; private set; } = 115200;
    public ushort LoggerAddress { get; private set; } = 1;
    public int PollIntervalSeconds { get; set; } = 60;
    public ushort DataTableNumber { get; set; } = 1;

    // ── State ──
    public bool IsConnected => _serialPort.IsOpen;
    public bool IsPolling => _pollCts != null && !_pollCts.IsCancellationRequested;
    public string LoggerModel { get; private set; } = string.Empty;
    public string LoggerSerial { get; private set; } = string.Empty;
    public ReadOnlyCollection<PakBusTableDef> TableDefinitions => _tableDefs.AsReadOnly();

    // ── Events ──
    /// <summary>New weather data record collected from the logger.</summary>
    public event EventHandler<WeatherRecord>? DataReceived;
    /// <summary>Raw bytes from serial for the monitor.</summary>
    public event EventHandler<byte[]>? RawDataReceived;
    /// <summary>Status message updates.</summary>
    public event EventHandler<string>? StatusChanged;
    /// <summary>Error messages.</summary>
    public event EventHandler<string>? ErrorOccurred;
    /// <summary>Serial monitor log line (formatted).</summary>
    public event EventHandler<string>? MonitorLog;
    /// <summary>Connection state changed.</summary>
    public event EventHandler<bool>? ConnectionStateChanged;

    public LoggerConnectionService()
    {
        _protocol = new PakBusProtocol();
        _serialPort = new SerialPortService(_protocol);

        _serialPort.DataReceived += (_, data) => RawDataReceived?.Invoke(this, data);
        _serialPort.ErrorOccurred += (_, msg) =>
        {
            ErrorOccurred?.Invoke(this, msg);
            LogMonitor($"[ERROR] {msg}");
        };
        _serialPort.PacketReceived += (_, msg) =>
        {
            LogMonitor($"[PKT] Type=0x{msg.MsgType:X2} Trans={msg.TransactionNumber} From={msg.SrcNodeId} Len={msg.Payload.Length}");
        };
    }

    /// <summary>
    /// Connect to logger via serial/USB port.
    /// </summary>
    public async Task<bool> ConnectAsync(string portName, int baudRate = 115200,
        ushort loggerAddress = 1, ushort securityCode = 0)
    {
        try
        {
            PortName = portName;
            BaudRate = baudRate;
            LoggerAddress = loggerAddress;

            // Reconfigure protocol with new addresses
            var protocol = new PakBusProtocol(4094, loggerAddress, securityCode);
            // We can't easily swap protocol in serial service, so re-use the existing one
            // The protocol is stateless enough for our purposes

            StatusChanged?.Invoke(this, $"Opening {portName} at {baudRate} baud...");
            LogMonitor($"[CONNECT] Opening {portName} at {baudRate} baud...");

            if (!_serialPort.Open(portName, baudRate))
            {
                ErrorOccurred?.Invoke(this, $"Failed to open {portName}");
                return false;
            }

            // Send Hello to establish PakBus link
            StatusChanged?.Invoke(this, "Sending PakBus Hello...");
            LogMonitor("[PAKBUS] Sending Hello command...");

            var helloPacket = _protocol.BuildHelloCommand();
            var response = await _serialPort.SendAndWaitAsync(helloPacket, 5000);

            if (response != null)
            {
                LogMonitor($"[PAKBUS] Hello response received from address {response.SrcNodeId}");
                StatusChanged?.Invoke(this, $"Logger at address {response.SrcNodeId} responded");
            }
            else
            {
                // Logger might still work — some loggers don't respond to Hello
                // but will respond to data collection commands
                LogMonitor("[PAKBUS] No Hello response (continuing — logger may respond to data requests)");
                StatusChanged?.Invoke(this, "No Hello response, trying data collection...");
            }

            // Try to get table definitions
            LogMonitor("[PAKBUS] Requesting table definitions...");
            var tableDefsPacket = _protocol.BuildGetTableDefsCommand();
            var tableResponse = await _serialPort.SendAndWaitAsync(tableDefsPacket, 5000);

            if (tableResponse != null && tableResponse.Payload.Length > 0)
            {
                _tableDefs = _protocol.ParseTableDefs(tableResponse.Payload);
                foreach (var t in _tableDefs)
                {
                    LogMonitor($"[TABLE] {t.TableName}: {t.Fields.Count} fields, interval={t.RecordInterval}s");
                    foreach (var f in t.Fields)
                        LogMonitor($"  - {f.FieldName} ({f.TypeName}) [{f.Units}] {f.Processing}");
                }

                // Find the best data table (prefer non-Status tables)
                _dataTable = _tableDefs.FirstOrDefault(t =>
                    !t.TableName.Equals("Status", StringComparison.OrdinalIgnoreCase) &&
                    !t.TableName.Equals("Public", StringComparison.OrdinalIgnoreCase)) ??
                    _tableDefs.FirstOrDefault(t => !t.TableName.Equals("Status", StringComparison.OrdinalIgnoreCase)) ??
                    _tableDefs.FirstOrDefault();

                if (_dataTable != null)
                    LogMonitor($"[PAKBUS] Using table: {_dataTable.TableName}");
            }
            else
            {
                LogMonitor("[PAKBUS] Could not retrieve table definitions");
            }

            ConnectionStateChanged?.Invoke(this, true);
            StatusChanged?.Invoke(this, $"Connected to logger on {portName}");
            LogMonitor($"[CONNECT] Connected successfully on {portName}");
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to connect to logger on {Port}", portName);
            ErrorOccurred?.Invoke(this, ex.Message);
            LogMonitor($"[ERROR] Connection failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>Disconnect from the logger.</summary>
    public void Disconnect()
    {
        StopPolling();
        _serialPort.Close();
        _tableDefs.Clear();
        _dataTable = null;
        ConnectionStateChanged?.Invoke(this, false);
        StatusChanged?.Invoke(this, "Disconnected from logger");
        LogMonitor("[DISCONNECT] Serial port closed");
    }

    /// <summary>
    /// Start polling the logger for new data at the configured interval.
    /// </summary>
    public void StartPolling()
    {
        if (IsPolling) return;
        if (!IsConnected) return;

        _pollCts = new CancellationTokenSource();
        var token = _pollCts.Token;

        _pollTask = Task.Run(async () =>
        {
            Log.Information("Logger polling started, interval: {Interval}s", PollIntervalSeconds);
            LogMonitor($"[POLL] Started polling every {PollIntervalSeconds}s");
            StatusChanged?.Invoke(this, $"Polling every {PollIntervalSeconds}s...");

            while (!token.IsCancellationRequested)
            {
                try
                {
                    await CollectDataOnce();
                    await Task.Delay(PollIntervalSeconds * 1000, token);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Logger poll error");
                    LogMonitor($"[ERROR] Poll failed: {ex.Message}");
                    ErrorOccurred?.Invoke(this, ex.Message);
                    await Task.Delay(5000, token);
                }
            }
        }, token);
    }

    /// <summary>Stop polling.</summary>
    public void StopPolling()
    {
        if (_pollCts == null) return;
        _pollCts.Cancel();
        _pollCts = null;
        LogMonitor("[POLL] Polling stopped");
        StatusChanged?.Invoke(this, "Polling stopped");
    }

    /// <summary>Collect the most recent data record once.</summary>
    public async Task CollectDataOnce()
    {
        if (!IsConnected) return;

        var tableNum = _dataTable?.TableNumber ?? DataTableNumber;
        LogMonitor($"[COLLECT] Requesting latest record from table #{tableNum}...");

        // CollectMode 0x06 = most recent N records, P2=1 (1 record)
        var packet = _protocol.BuildCollectDataCommand(tableNum, 0, 0x06, 0, 1);
        var response = await _serialPort.SendAndWaitAsync(packet, 10000);

        if (response == null)
        {
            LogMonitor("[COLLECT] No response from logger");
            return;
        }

        if (response.Payload.Length < 4)
        {
            LogMonitor($"[COLLECT] Short response ({response.Payload.Length} bytes)");
            return;
        }

        // If we have table definitions, parse structured data
        if (_dataTable != null && _dataTable.Fields.Count > 0)
        {
            var records = _protocol.ParseCollectDataResponse(response.Payload, _dataTable);
            if (records.Count > 0)
            {
                var latest = records[^1]; // Most recent
                var weatherRecord = MapToWeatherRecord(latest);
                LogMonitor($"[DATA] T={weatherRecord.Temperature:F1}°C RH={weatherRecord.Humidity:F0}% " +
                    $"P={weatherRecord.Pressure:F1}hPa WS={weatherRecord.WindSpeed:F1}m/s " +
                    $"WD={weatherRecord.WindDirection:F0}° Rain={weatherRecord.Rainfall:F1}mm " +
                    $"Solar={weatherRecord.SolarRadiation:F0}W/m² Batt={weatherRecord.BatteryVoltage:F2}V");
                DataReceived?.Invoke(this, weatherRecord);
            }
            else
            {
                LogMonitor("[COLLECT] Response parsed but no records found");
            }
        }
        else
        {
            // Raw response — try to interpret as generic data
            LogMonitor($"[COLLECT] Raw response: {response.Payload.Length} bytes (no table defs available)");
            TryParseGenericResponse(response.Payload);
        }
    }

    /// <summary>
    /// Map PakBus field values to a WeatherRecord using standard Campbell field name patterns.
    /// Supports SDI-12 sensor naming conventions and standard Campbell datalogger field names.
    /// </summary>
    private WeatherRecord MapToWeatherRecord(Dictionary<string, object> data)
    {
        var record = new WeatherRecord
        {
            Timestamp = data.ContainsKey("TIMESTAMP") && data["TIMESTAMP"] is DateTime ts
                ? ts : DateTime.UtcNow,
            StationId = 0 // Will be set by caller
        };

        foreach (var (key, value) in data)
        {
            if (value is not double dVal || double.IsNaN(dVal)) continue;

            var upperKey = key.ToUpperInvariant();

            // Temperature
            if (MatchesAny(upperKey, "AIRTC", "AIRTEMP", "TEMP_C", "TEMPERATURE", "TC_AVG", "T_AVG"))
                record.Temperature = dVal;
            else if (MatchesAny(upperKey, "AIRTC_MIN", "TEMP_MIN", "TMIN"))
                record.TemperatureMin = dVal;
            else if (MatchesAny(upperKey, "AIRTC_MAX", "TEMP_MAX", "TMAX"))
                record.TemperatureMax = dVal;

            // Humidity
            else if (MatchesAny(upperKey, "RH", "HUMIDITY", "RH_AVG"))
                record.Humidity = dVal;

            // Pressure
            else if (MatchesAny(upperKey, "BP_MBAR", "PRESSURE", "BARO", "BP_AVG", "BPRESS"))
                record.Pressure = dVal;

            // Dew Point
            else if (MatchesAny(upperKey, "DEWPOINT", "DP", "DEW"))
                record.DewPoint = dVal;

            // Wind speed — keep in m/s (Campbell canonical unit)
            else if (MatchesAny(upperKey, "WS_MS", "WINDSPD", "WS_AVG", "WIND_SPEED"))
                record.WindSpeed = dVal; // already m/s
            else if (MatchesAny(upperKey, "WINDSPD_KMH", "WS_KMH"))
                record.WindSpeed = dVal / 3.6; // km/h → m/s

            // Wind direction
            else if (MatchesAny(upperKey, "WINDDIR", "WD", "WIND_DIR", "WINDDIR_D1_WVT", "WDIR"))
                record.WindDirection = dVal;

            // Wind gust — keep in m/s
            else if (MatchesAny(upperKey, "WS_MS_MAX", "GUST", "WS_MAX", "WIND_GUST"))
                record.WindGust = dVal; // already m/s
            else if (MatchesAny(upperKey, "GUST_KMH"))
                record.WindGust = dVal / 3.6; // km/h → m/s

            // Rainfall
            else if (MatchesAny(upperKey, "RAIN_MM", "RAINFALL", "RAIN", "PRECIP", "RAIN_MM_TOT"))
                record.Rainfall = dVal;

            // Solar radiation
            else if (MatchesAny(upperKey, "SLRW", "SOLAR", "SLRKW", "SOLAR_RAD", "SR_AVG", "SLRW_AVG"))
                record.SolarRadiation = dVal;

            // UV Index
            else if (MatchesAny(upperKey, "UV", "UVINDEX", "UV_INDEX"))
                record.UvIndex = dVal;

            // Battery
            else if (MatchesAny(upperKey, "BATTV", "BATT_VOLT", "BATTERY", "BATTV_MIN"))
                record.BatteryVoltage = dVal;

            // Panel temperature
            else if (MatchesAny(upperKey, "PTEMP", "PANELTEMP", "PTEMP_C", "PANEL_TEMP"))
                record.PanelTemperature = dVal;

            // Soil
            else if (MatchesAny(upperKey, "SOILT", "SOIL_TEMP", "SOILTEMP"))
                record.SoilTemperature = dVal;
            else if (MatchesAny(upperKey, "SOILM", "SOIL_MOISTURE", "VWC", "SWC"))
                record.SoilMoisture = dVal;

            // Water level
            else if (MatchesAny(upperKey, "WATER_LEVEL", "WLEVEL", "LEVEL"))
                record.WaterLevel = dVal;

            // ET
            else if (MatchesAny(upperKey, "ETO", "ET0", "ET_AVG"))
                record.Eto = dVal;

            // Lightning
            else if (MatchesAny(upperKey, "LIGHTNING", "LGHT", "STRIKES"))
                record.Lightning = dVal;
        }

        return record;
    }

    /// <summary>Check if field name matches any of the given patterns (contains check).</summary>
    private static bool MatchesAny(string fieldName, params string[] patterns)
    {
        foreach (var p in patterns)
        {
            if (fieldName.Contains(p))
                return true;
        }
        return false;
    }

    /// <summary>Try to parse generic response when table defs are unavailable.</summary>
    private void TryParseGenericResponse(byte[] payload)
    {
        // Log raw hex for diagnostics
        var hex = BitConverter.ToString(payload).Replace("-", " ");
        LogMonitor($"[RAW] {hex}");

        // Try to interpret as float values after header
        if (payload.Length >= 16)
        {
            var record = new WeatherRecord { Timestamp = DateTime.UtcNow };
            int offset = 12; // Skip response header + timestamp + record#

            // Try reading IEEE4 floats
            var values = new List<double>();
            while (offset + 4 <= payload.Length)
            {
                var bytes = new byte[4];
                Buffer.BlockCopy(payload, offset, bytes, 0, 4);
                if (BitConverter.IsLittleEndian) Array.Reverse(bytes);
                var val = BitConverter.ToSingle(bytes, 0);
                if (!float.IsNaN(val) && !float.IsInfinity(val))
                    values.Add(val);
                offset += 4;
            }

            if (values.Count > 0)
            {
                LogMonitor($"[RAW] Parsed {values.Count} float values: {string.Join(", ", values.Select(v => v.ToString("F2")))}");
            }
        }
    }

    private void LogMonitor(string message)
    {
        var timestamped = $"[{DateTime.Now:HH:mm:ss.fff}] {message}";
        MonitorLog?.Invoke(this, timestamped);
    }

    /// <summary>
    /// Read the logger's internal clock via PakBus ClockCheck command.
    /// </summary>
    public async Task<DateTime?> ReadClockAsync()
    {
        if (!IsConnected) return null;
        try
        {
            var packet = _protocol.BuildClockCommand();
            var response = await _serialPort.SendAndWaitAsync(packet, 5000);
            if (response != null && response.Payload.Length >= 8)
            {
                // PakBus clock response: seconds since 1990-01-01 (4 bytes) + nanoseconds (4 bytes)
                var seconds = _protocol.ReadBigEndianUInt32(response.Payload, 0);
                var epoch = new DateTime(1990, 1, 1, 0, 0, 0, DateTimeKind.Utc);
                return epoch.AddSeconds(seconds);
            }
            return null;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to read logger clock");
            return null;
        }
    }

    /// <summary>
    /// Set the logger's internal clock via PakBus.
    /// </summary>
    public async Task<bool> SetClockAsync(DateTime utcTime)
    {
        if (!IsConnected) return false;
        try
        {
            var packet = _protocol.BuildSetClockCommand(utcTime);
            var response = await _serialPort.SendAndWaitAsync(packet, 5000);
            return response != null;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to set logger clock");
            return false;
        }
    }

    /// <summary>
    /// Returns discovered table definitions in a UI-friendly format.
    /// </summary>
    public Task<List<TableInfo>> GetTableDefinitionsAsync()
    {
        var tables = _tableDefs.Select(t => new TableInfo
        {
            Name = t.TableName,
            Fields = t.Fields.Select(f => new TableFieldInfo { Name = f.FieldName, Unit = f.Units }).ToList(),
            Interval = t.RecordInterval > 0 ? $"{t.RecordInterval}s" : "Event",
        }).ToList();

        return Task.FromResult(tables);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopPolling();
        _serialPort.Dispose();
        GC.SuppressFinalize(this);
    }
}
