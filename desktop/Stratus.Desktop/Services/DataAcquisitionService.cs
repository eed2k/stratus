using System.Globalization;
using System.IO;
using System.Text;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Data acquisition service that polls stations for new data
/// and manages data collection, buffering, and export.
/// Inspired by Campbell Scientific LoggerNet data collection model.
/// </summary>
public class DataAcquisitionService
{
    private readonly ApiService _apiService;
    private readonly DatabaseService _dbService;
    private CancellationTokenSource? _pollCts;
    private Task? _pollTask;
    private int _pollIntervalMs = 60000;
    private bool _isCollecting;

    public bool IsCollecting => _isCollecting;
    public int PollIntervalSeconds
    {
        get => _pollIntervalMs / 1000;
        set => _pollIntervalMs = value * 1000;
    }

    public event EventHandler<DataCollectionEventArgs>? DataReceived;
    public event EventHandler<string>? StatusChanged;
    public event EventHandler<string>? ErrorOccurred;

    public DataAcquisitionService(ApiService apiService, DatabaseService dbService)
    {
        _apiService = apiService;
        _dbService = dbService;
    }

    /// <summary>
    /// Start automatic data collection for all stations.
    /// </summary>
    public void StartCollection(int pollIntervalSeconds = 60)
    {
        if (_isCollecting) return;

        _pollIntervalMs = pollIntervalSeconds * 1000;
        _pollCts = new CancellationTokenSource();
        _isCollecting = true;

        _pollTask = Task.Run(async () =>
        {
            Log.Information("Data collection started, interval: {Interval}s", pollIntervalSeconds);
            StatusChanged?.Invoke(this, "Collecting...");

            while (!_pollCts.Token.IsCancellationRequested)
            {
                try
                {
                    await PollAllStationsAsync();
                    await Task.Delay(_pollIntervalMs, _pollCts.Token);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Log.Error(ex, "Error during data collection cycle");
                    ErrorOccurred?.Invoke(this, ex.Message);
                    await Task.Delay(5000, _pollCts.Token);
                }
            }
        }, _pollCts.Token);

        StatusChanged?.Invoke(this, "Collection active");
    }

    /// <summary>
    /// Stop automatic data collection.
    /// </summary>
    public void StopCollection()
    {
        if (!_isCollecting) return;

        _pollCts?.Cancel();
        _isCollecting = false;
        StatusChanged?.Invoke(this, "Collection stopped");
        Log.Information("Data collection stopped");
    }

    /// <summary>
    /// Poll all stations once for latest data.
    /// </summary>
    public async Task PollAllStationsAsync()
    {
        var stations = await _apiService.GetStationsAsync();
        if (stations == null) return;

        foreach (var station in stations)
        {
            try
            {
                var latest = await _apiService.GetLatestDataAsync(station.Id);
                if (latest != null)
                {
                    DataReceived?.Invoke(this, new DataCollectionEventArgs
                    {
                        StationId = station.Id,
                        StationName = station.Name,
                        Record = latest,
                        Timestamp = DateTime.UtcNow
                    });
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to poll station {Id} ({Name})", station.Id, station.Name);
            }
        }
    }

    /// <summary>
    /// Export data to CSV file (TOA5-compatible format).
    /// </summary>
    public async Task<string> ExportToCsvAsync(
        int stationId, DateTime startTime, DateTime endTime, string outputPath,
        string format = "TOA5")
    {
        StatusChanged?.Invoke(this, $"Exporting station {stationId}...");

        List<WeatherRecord> records;

        if (_dbService.IsConnected)
        {
            records = await _dbService.GetDataAsync(stationId, startTime, endTime, 100000);
        }
        else
        {
            records = await _apiService.GetStationDataAsync(stationId, startTime, endTime, 10000);
        }

        if (records.Count == 0)
        {
            StatusChanged?.Invoke(this, "No data to export");
            return string.Empty;
        }

        var sb = new StringBuilder();

        if (format == "TOA5")
        {
            // TOA5 header format (Campbell Scientific compatible)
            sb.AppendLine("\"TOA5\",\"Stratus\",\"CR1000\",\"Stratus-Export\",\"Stratus.Desktop\",\"1.1\",\"StationData\",\"\"");
            sb.AppendLine("\"TIMESTAMP\",\"RECORD\",\"AirTC_Avg\",\"RH_Avg\",\"BP_mbar_Avg\",\"WS_ms_Avg\",\"WindDir_D1_WVT\",\"WS_ms_Max\",\"Rain_mm_Tot\",\"SlrW_Avg\",\"SoilT_Avg\",\"SoilM_Avg\",\"BattV_Min\"");
            sb.AppendLine("\"TS\",\"RN\",\"Deg C\",\"%\",\"mbar\",\"m/s\",\"degrees\",\"m/s\",\"mm\",\"W/m2\",\"Deg C\",\"%\",\"V\"");
            sb.AppendLine("\"\",\"\",\"Avg\",\"Avg\",\"Avg\",\"Avg\",\"WVT\",\"Max\",\"Tot\",\"Avg\",\"Avg\",\"Avg\",\"Min\"");

            long recordNum = 1;
            foreach (var r in records.OrderBy(r => r.Timestamp))
            {
                // Wind values stored in m/s internally — output directly
                sb.AppendLine(string.Join(",",
                    $"\"{r.Timestamp:yyyy-MM-dd HH:mm:ss}\"",
                    recordNum++,
                    FormatVal(r.Temperature),
                    FormatVal(r.Humidity),
                    FormatVal(r.Pressure),
                    FormatVal(r.WindSpeed),
                    FormatVal(r.WindDirection),
                    FormatVal(r.WindGust),
                    FormatVal(r.Rainfall),
                    FormatVal(r.SolarRadiation),
                    FormatVal(r.SoilTemperature),
                    FormatVal(r.SoilMoisture),
                    FormatVal(r.BatteryVoltage)));
            }
        }
        else // Standard CSV
        {
            sb.AppendLine("Timestamp,Temperature,Humidity,Pressure,DewPoint,WindSpeed,WindDirection,WindGust,Rainfall,SolarRadiation,UvIndex,SoilTemp,SoilMoisture,PM2.5,PM10,BatteryV");
            foreach (var r in records.OrderBy(r => r.Timestamp))
            {
                sb.AppendLine(string.Join(",",
                    r.Timestamp.ToString("yyyy-MM-dd HH:mm:ss"),
                    FormatVal(r.Temperature),
                    FormatVal(r.Humidity),
                    FormatVal(r.Pressure),
                    FormatVal(r.DewPoint),
                    FormatVal(r.WindSpeed),
                    FormatVal(r.WindDirection),
                    FormatVal(r.WindGust),
                    FormatVal(r.Rainfall),
                    FormatVal(r.SolarRadiation),
                    FormatVal(r.UvIndex),
                    FormatVal(r.SoilTemperature),
                    FormatVal(r.SoilMoisture),
                    FormatVal(r.Pm25),
                    FormatVal(r.Pm10),
                    FormatVal(r.BatteryVoltage)));
            }
        }

        await File.WriteAllTextAsync(outputPath, sb.ToString());
        StatusChanged?.Invoke(this, $"Exported {records.Count} records to {Path.GetFileName(outputPath)}");
        Log.Information("Exported {Count} records for station {Id} to {Path}", records.Count, stationId, outputPath);

        return outputPath;
    }

    private static string FormatVal(double? value)
    {
        return value.HasValue ? value.Value.ToString("F2", CultureInfo.InvariantCulture) : "NAN";
    }
}

public class DataCollectionEventArgs : EventArgs
{
    public int StationId { get; set; }
    public string StationName { get; set; } = string.Empty;
    public WeatherRecord Record { get; set; } = null!;
    public DateTime Timestamp { get; set; }
}
