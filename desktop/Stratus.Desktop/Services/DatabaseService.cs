using Microsoft.Extensions.Configuration;
using Npgsql;
using Serilog;
using Stratus.Desktop.Models;
using System;
using System.IO;
using System.Text.Json;

namespace Stratus.Desktop.Services;

/// <summary>
/// Direct PostgreSQL database access service for Stratus.
/// Supports both Neon cloud DB and local PostgreSQL connections.
/// </summary>
public class DatabaseService : IDisposable
{
    private NpgsqlDataSource? _dataSource;
    private string? _connectionString;
    private bool _isConnected;

    /// <summary>Path to the persisted DB connection file.</summary>
    private static readonly string DbSettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Stratus", "db_connection.json");

    public bool IsConnected => _isConnected;
    public event EventHandler<bool>? ConnectionChanged;

    public DatabaseService(IConfiguration config)
    {
        _connectionString = config["Database:ConnectionString"];
        var useDirect = bool.TryParse(config["Database:UseDirect"], out var d) && d;

        // Try to restore a previously-saved connection string
        if (string.IsNullOrEmpty(_connectionString))
        {
            _connectionString = LoadSavedConnectionString();
            if (!string.IsNullOrEmpty(_connectionString))
            {
                useDirect = true;
                Log.Information("Restored saved database connection string");
            }
        }

        if (useDirect && !string.IsNullOrEmpty(_connectionString))
        {
            Connect(_connectionString);
        }
    }

    /// <summary>
    /// Connect to a PostgreSQL database.
    /// Handles both key-value and URI-style (postgresql://...) connection strings.
    /// </summary>
    public bool Connect(string connectionString)
    {
        try
        {
            Disconnect();

            // Normalize: convert postgresql:// URI format to key-value format
            var normalizedCs = NormalizeConnectionString(connectionString);
            var csb = new NpgsqlConnectionStringBuilder(normalizedCs);

            // Ensure SSL mode is set for cloud databases (Neon, Supabase, etc.)
            var host = csb.Host ?? "";
            bool isCloud = host.Contains("neon.tech", StringComparison.OrdinalIgnoreCase) ||
                           host.Contains("supabase", StringComparison.OrdinalIgnoreCase) ||
                           host.Contains("railway", StringComparison.OrdinalIgnoreCase) ||
                           host.Contains("render", StringComparison.OrdinalIgnoreCase);

            if (isCloud)
            {
                if (csb.SslMode == SslMode.Disable || csb.SslMode == SslMode.Allow || csb.SslMode == SslMode.Prefer)
                {
                    csb.SslMode = SslMode.Require;
                    Log.Information("Auto-enabled SSL for cloud database host: {Host}", host);
                }
            }

            // Set reasonable timeouts
            if (csb.Timeout == 0 || csb.Timeout == 15)
                csb.Timeout = 30;
            if (csb.CommandTimeout == 0 || csb.CommandTimeout == 30)
                csb.CommandTimeout = 60;

            var builder = new NpgsqlDataSourceBuilder(csb.ToString());
            _dataSource = builder.Build();
            _connectionString = csb.ToString();

            // Test connection
            using var cmd = _dataSource.CreateCommand("SELECT 1");
            cmd.ExecuteScalar();

            _isConnected = true;
            ConnectionChanged?.Invoke(this, true);
            Log.Information("Connected to PostgreSQL database at {Host}", host);

            // Persist connection string for next session
            SaveConnectionString(_connectionString);

            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to connect to database");
            _isConnected = false;
            ConnectionChanged?.Invoke(this, false);
            return false;
        }
    }

    public void Disconnect()
    {
        _dataSource?.Dispose();
        _dataSource = null;
        _isConnected = false;
        ConnectionChanged?.Invoke(this, false);
    }

    /// <summary>
    /// Fetch all stations from the database.
    /// </summary>
    public async Task<List<WeatherStation>> GetStationsAsync()
    {
        if (_dataSource == null) return new List<WeatherStation>();

        var stations = new List<WeatherStation>();
        await using var cmd = _dataSource.CreateCommand(
            "SELECT id, name, location, latitude, longitude, altitude, station_type, " +
            "connection_config, is_active, last_connected, site_description, " +
            "protocol, station_image, ingest_id, notes, " +
            "datalogger_model, datalogger_serial_number, program_name, " +
            "modem_model, modem_serial_number " +
            "FROM stations ORDER BY id");

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            // Parse connection_config JSONB to extract apiEndpoint
            string? apiEndpoint = null;
            string? connConfigRaw = reader.IsDBNull(7) ? null : reader.GetString(7);
            if (!string.IsNullOrEmpty(connConfigRaw))
            {
                try
                {
                    using var doc = JsonDocument.Parse(connConfigRaw);
                    if (doc.RootElement.TryGetProperty("apiEndpoint", out var ep))
                        apiEndpoint = ep.GetString();
                }
                catch { /* ignore parse errors */ }
            }

            stations.Add(new WeatherStation
            {
                Id = reader.GetInt32(0),
                Name = reader.GetString(1),
                Location = reader.IsDBNull(2) ? null : reader.GetString(2),
                Latitude = reader.IsDBNull(3) ? null : reader.GetDouble(3),
                Longitude = reader.IsDBNull(4) ? null : reader.GetDouble(4),
                Elevation = reader.IsDBNull(5) ? null : reader.GetDouble(5),
                StationType = reader.IsDBNull(6) ? null : reader.GetString(6),
                Endpoint = apiEndpoint,
                IsActive = !reader.IsDBNull(8) && reader.GetBoolean(8),
                LastConnected = reader.IsDBNull(9) ? null : reader.GetDateTime(9),
                Description = reader.IsDBNull(10) ? null : reader.GetString(10),
                Protocol = reader.IsDBNull(11) ? null : reader.GetString(11),
                ImageUrl = reader.IsDBNull(12) ? null : reader.GetString(12),
                IngestId = reader.IsDBNull(13) ? null : reader.GetString(13),
                Notes = reader.IsDBNull(14) ? null : reader.GetString(14),
                DataloggerModel = reader.IsDBNull(15) ? null : reader.GetString(15),
                DataloggerProgramName = reader.IsDBNull(17) ? null : reader.GetString(17),
                ModemModel = reader.IsDBNull(18) ? null : reader.GetString(18),
                ModemSerialNumber = reader.IsDBNull(19) ? null : reader.GetString(19),
            });
        }

        return stations;
    }

    /// <summary>
    /// Fetch weather data for a station within a time range.
    /// The weather_data table stores measurements in a JSONB 'data' column.
    /// This method parses the JSONB and maps Campbell Scientific field name variants
    /// to the WeatherRecord model (replicating the server's mapPgWeatherData logic).
    /// </summary>
    public async Task<List<WeatherRecord>> GetDataAsync(
        int stationId, DateTime? startTime = null, DateTime? endTime = null, int limit = 2000)
    {
        if (_dataSource == null) return new List<WeatherRecord>();

        var sql = "SELECT id, station_id, timestamp, data, " +
                  "mppt_solar_voltage, mppt_solar_current, mppt_solar_power, " +
                  "mppt_load_voltage, mppt_load_current, mppt_battery_voltage, " +
                  "mppt_charger_state, mppt_absi_avg, mppt_board_temp " +
                  "FROM weather_data WHERE station_id = @stationId";

        if (startTime.HasValue)
            sql += " AND timestamp >= @startTime";
        if (endTime.HasValue)
            sql += " AND timestamp <= @endTime";

        sql += " ORDER BY timestamp DESC LIMIT @limit";

        var records = new List<WeatherRecord>();
        await using var cmd = _dataSource.CreateCommand(sql);
        cmd.Parameters.AddWithValue("stationId", stationId);
        cmd.Parameters.AddWithValue("limit", limit);
        if (startTime.HasValue)
            cmd.Parameters.AddWithValue("startTime", startTime.Value);
        if (endTime.HasValue)
            cmd.Parameters.AddWithValue("endTime", endTime.Value);

        await using var reader = await cmd.ExecuteReaderAsync();

        // Build column lookup for the MPPT dedicated columns
        var cols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < reader.FieldCount; i++)
            cols.Add(reader.GetName(i));

        while (await reader.ReadAsync())
        {
            // Parse the JSONB 'data' column
            var dataOrd = reader.GetOrdinal("data");
            string jsonStr = reader.IsDBNull(dataOrd) ? "{}" : reader.GetString(dataOrd);
            Dictionary<string, JsonElement> d;
            try
            {
                d = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(jsonStr) 
                    ?? new Dictionary<string, JsonElement>();
            }
            catch
            {
                d = new Dictionary<string, JsonElement>();
            }

            records.Add(new WeatherRecord
            {
                Id = reader.GetInt64(reader.GetOrdinal("id")),
                StationId = reader.GetInt32(reader.GetOrdinal("station_id")),
                Timestamp = reader.GetDateTime(reader.GetOrdinal("timestamp")),
                RawData = jsonStr,
                // Atmospheric
                Temperature = J(d, "temperature", "AirTC_Avg", "AirTemp", "Temp_Avg", "AirTemp_Avg", "AirTC", "Temp_C", "Temperature"),
                TemperatureMin = J(d, "temperatureMin", "AirTC_Min", "Temp_Min"),
                TemperatureMax = J(d, "temperatureMax", "AirTC_Max", "Temp_Max"),
                Humidity = J(d, "humidity", "RH_Avg", "RH", "RelHumidity_Avg", "RelHumidity", "Humidity"),
                Pressure = J(d, "pressure", "BP_mbar", "Pressure", "Pressure_Avg", "BaroPressure_Avg", "BP_Avg", "BaroPres", "BP_mbar_Avg", "BPress_Avg", "BPress"),
                PressureSeaLevel = J(d, "pressureSeaLevel", "BP_SeaLevel", "PressureSeaLevel"),
                DewPoint = J(d, "dewPoint", "DewPoint_Avg", "DewPt", "DewPoint", "Dew_C", "DewPointTemp_Avg", "DewPointTemp"),
                AirDensity = J(d, "airDensity", "AirDensity_Avg", "AirDensity"),
                // Wind
                WindSpeed = J(d, "windSpeed", "WS_ms_Avg", "WindSpeed", "Wind_Spd_S_WVT", "WindSpeed_Avg", "WS_ms", "WS_Avg", "WS_ms_S_WVT", "WSpd_1_Avg", "WSpd_Avg", "WSpd_1_S_WVT"),
                WindDirection = J(d, "windDirection", "WindDir", "WindDir_D1_WVT", "Wind_Dir_D1_WVT", "WindDir_Avg", "WD_Deg", "WD_Avg", "WDir_1_Avg", "WDir_Avg", "WDir_1_D1_WVT"),
                WindGust = J(d, "windGust", "WS_ms_Max", "Wind_Spd_Max", "WindSpeed_Max", "WS_Max", "Wind_Gust", "WSpd_1_Max", "WSpd_Max"),
                WindGust10min = J(d, "windGust10min"),
                WindPower = J(d, "windPower", "WindPower_Avg"),
                WindDirStdDev = J(d, "windDirStdDev", "Wind_Dir_SD1_WVT", "WindDir_SD1_WVT"),
                Sdi12WindVector = J(d, "sdi12WindVector", "SDI12_WVc", "SDI12_WV"),
                // Precipitation
                Rainfall = J(d, "rainfall", "Rain_mm_Tot", "Rain", "Rain_Tot", "Precip", "Precip_Tot", "Rain_1_Tot", "Rain_Tot_1"),
                Rainfall10min = J(d, "rainfall10min"),
                Rainfall24h = J(d, "rainfall24h"),
                // Solar
                SolarRadiation = SanitizeSolar(J(d, "solarRadiation", "SlrW", "Solar", "Solar_Rad_Avg", "SolarRad_Avg", "SlrW_Avg", "SR_Avg")),
                SolarRadiationMax = J(d, "solarRadiationMax", "SlrW_Max", "Solar_Rad_Max"),
                UvIndex = J(d, "uvIndex", "UV_Index_Avg", "UV_Index"),
                SunElevation = J(d, "sunElevation"),
                SunAzimuth = J(d, "sunAzimuth"),
                // Evapotranspiration
                Eto = J(d, "eto", "ETo_Avg", "ETo"),
                Eto24h = J(d, "eto24h"),
                // Soil
                SoilTemperature = J(d, "soilTemperature", "SoilTemp_Avg", "SoilTC", "Soil_Temp"),
                SoilMoisture = J(d, "soilMoisture", "SoilMoist_Avg", "VWC", "VWC_Avg", "Soil_VWC"),
                LeafWetness = J(d, "leafWetness", "LeafWet_Avg", "LeafWetness"),
                // Air Quality
                Pm25 = J(d, "pm25", "pm2_5", "PM2_5_Avg", "PM2_5"),
                Pm10 = J(d, "pm10", "PM10_Avg", "PM10"),
                Pm1 = J(d, "pm1", "PM1_Avg", "PM1"),
                Co2 = J(d, "co2", "CO2_Avg", "CO2"),
                Tvoc = J(d, "tvoc", "TVOC_Avg", "TVOC"),
                // Battery / Power
                BatteryVoltage = J(d, "batteryVoltage", "BattV", "BattV_Min", "Batt_volt_Min", "BattV_Avg", "Batt_V", "LoggerBattery_Avg", "LoggerBattery"),
                PanelTemperature = J(d, "panelTemperature", "PTemp_Avg", "PTemp", "PTemp_C", "PTemp_C_Avg", "LoggerTemp_Avg", "LoggerTemp"),
                ChargerVoltage = SanitizeCharger(J(d, "chargerVoltage", "DC_Chg_Volts", "ChgV_Avg", "Charger_V", "SolarCharger_V")),
                // Water & Sensors
                WaterLevel = J(d, "waterLevel", "Water_Level_Avg", "WaterLevel", "Water_Level"),
                TemperatureSwitch = J(d, "temperatureSwitch", "Temp_Switch_Avg", "TempSwitch", "Temp_Switch"),
                LevelSwitch = J(d, "levelSwitch", "Level_Switch", "LevelSwitch", "Level_Switch_Avg"),
                TemperatureSwitchOutlet = J(d, "temperatureSwitchOutlet", "Temp_Switch_Outlet", "TempSwitchOutlet"),
                LevelSwitchStatus = J(d, "levelSwitchStatus", "Level_Switch_Status", "LevelSwitchStatus"),
                Lightning = J(d, "lightning", "Lightning_Tot", "Lightning_Count", "Lightning"),
                // Pump & Port
                PumpSelectWell = J(d, "pumpSelectWell", "Pump_Select_Well"),
                PumpSelectBore = J(d, "pumpSelectBore", "Pump_Select_Bore"),
                PortStatusC1 = J(d, "portStatusC1", "Port_Status_C1"),
                PortStatusC2 = J(d, "portStatusC2", "Port_Status_C2"),
                // MPPT 1 (dedicated columns + JSONB fallback)
                MpptSolarVoltage = GetNullableDouble(reader, "mppt_solar_voltage", cols) ?? J(d, "mpptSolarVoltage", "SolarCharger_PanelVoltage_1_Avg"),
                MpptSolarCurrent = GetNullableDouble(reader, "mppt_solar_current", cols) ?? J(d, "mpptSolarCurrent", "SolarCharger_PanelCurrent_1_Avg"),
                MpptSolarPower = GetNullableDouble(reader, "mppt_solar_power", cols) ?? J(d, "mpptSolarPower", "SolarCharger_PanelPower_1_Avg"),
                MpptLoadVoltage = GetNullableDouble(reader, "mppt_load_voltage", cols) ?? J(d, "mpptLoadVoltage", "SolarCharger_LoadVoltage_1_Avg"),
                MpptLoadCurrent = GetNullableDouble(reader, "mppt_load_current", cols) ?? J(d, "mpptLoadCurrent", "SolarCharger_LoadCurrent_1_Avg"),
                MpptBatteryVoltage = GetNullableDouble(reader, "mppt_battery_voltage", cols) ?? J(d, "mpptBatteryVoltage", "SolarCharger_BatteryVoltage_1_Avg"),
                MpptBatteryCurrent = J(d, "mpptBatteryCurrent"),
                MpptChargerState = GetNullableDouble(reader, "mppt_charger_state", cols) ?? J(d, "mpptChargerState", "SolarCharger_State_1"),
                MpptAbsiAvg = GetNullableDouble(reader, "mppt_absi_avg", cols) ?? J(d, "mpptAbsiAvg"),
                MpptBoardTemp = GetNullableDouble(reader, "mppt_board_temp", cols) ?? J(d, "mpptBoardTemp", "SolarCharger_BoardTemp_1_Avg"),
                MpptMode = J(d, "mpptMode", "SolarCharger_Mode_1"),
                // MPPT 2
                Mppt2SolarVoltage = J(d, "mppt2SolarVoltage", "SolarCharger_PanelVoltage_2_Avg"),
                Mppt2SolarCurrent = J(d, "mppt2SolarCurrent", "SolarCharger_PanelCurrent_2_Avg"),
                Mppt2SolarPower = J(d, "mppt2SolarPower", "SolarCharger_PanelPower_2_Avg"),
                Mppt2LoadVoltage = J(d, "mppt2LoadVoltage", "SolarCharger_LoadVoltage_2_Avg"),
                Mppt2LoadCurrent = J(d, "mppt2LoadCurrent", "SolarCharger_LoadCurrent_2_Avg"),
                Mppt2BatteryVoltage = J(d, "mppt2BatteryVoltage", "SolarCharger_BatteryVoltage_2_Avg"),
                Mppt2ChargerState = J(d, "mppt2ChargerState", "SolarCharger_State_2"),
                Mppt2BoardTemp = J(d, "mppt2BoardTemp", "SolarCharger_BoardTemp_2_Avg"),
                Mppt2Mode = J(d, "mppt2Mode", "SolarCharger_Mode_2"),
            });
        }

        return records;
    }

    /// <summary>
    /// Extract a numeric value from a JSONB dictionary, trying multiple Campbell Scientific field name variants.
    /// </summary>
    private static double? J(Dictionary<string, JsonElement> d, params string[] keys)
    {
        foreach (var key in keys)
        {
            if (d.TryGetValue(key, out var el))
            {
                if (el.ValueKind == JsonValueKind.Number)
                    return el.GetDouble();
                if (el.ValueKind == JsonValueKind.String && double.TryParse(el.GetString(), out var v))
                    return v;
            }
        }
        return null;
    }

    /// <summary>Charger voltage sanity — values > 100V are likely in mV.</summary>
    private static double? SanitizeCharger(double? v) => v is > 100 ? v / 100 : v;

    /// <summary>Solar radiation cap — values > 2000 W/m² are unrealistic.</summary>
    private static double? SanitizeSolar(double? v) => v is > 2000 ? null : v;

    /// <summary>
    /// Inserts a single weather record into the database.
    /// Used by the offline buffer service for syncing buffered records.
    /// </summary>
    public async Task<bool> InsertWeatherRecordAsync(WeatherRecord record)
    {
        if (_dataSource == null) return false;

        try
        {
            await using var cmd = _dataSource.CreateCommand(@"
                INSERT INTO weather_data (station_id, timestamp, temperature, humidity, pressure, 
                    dew_point, wind_speed, wind_direction, wind_gust, rainfall, solar_radiation, 
                    uv_index, soil_temperature, soil_moisture, battery_voltage, pm25, pm10, co2)
                VALUES (@sid, @ts, @temp, @hum, @pres, @dew, @ws, @wd, @wg, @rain, @sol, 
                    @uv, @st, @sm, @bv, @pm25, @pm10, @co2)
                ON CONFLICT (station_id, timestamp) DO NOTHING");

            cmd.Parameters.AddWithValue("sid", record.StationId);
            cmd.Parameters.AddWithValue("ts", record.Timestamp);
            AddNullableParam(cmd, "temp", record.Temperature);
            AddNullableParam(cmd, "hum", record.Humidity);
            AddNullableParam(cmd, "pres", record.Pressure);
            AddNullableParam(cmd, "dew", record.DewPoint);
            AddNullableParam(cmd, "ws", record.WindSpeed);
            AddNullableParam(cmd, "wd", record.WindDirection);
            AddNullableParam(cmd, "wg", record.WindGust);
            AddNullableParam(cmd, "rain", record.Rainfall);
            AddNullableParam(cmd, "sol", record.SolarRadiation);
            AddNullableParam(cmd, "uv", record.UvIndex);
            AddNullableParam(cmd, "st", record.SoilTemperature);
            AddNullableParam(cmd, "sm", record.SoilMoisture);
            AddNullableParam(cmd, "bv", record.BatteryVoltage);
            AddNullableParam(cmd, "pm25", record.Pm25);
            AddNullableParam(cmd, "pm10", record.Pm10);
            AddNullableParam(cmd, "co2", record.Co2);

            await cmd.ExecuteNonQueryAsync();
            return true;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to insert weather record for station {Id}", record.StationId);
            return false;
        }
    }

    private static void AddNullableParam(NpgsqlCommand cmd, string name, double? value)
    {
        cmd.Parameters.AddWithValue(name, (object?)value ?? DBNull.Value);
    }

    /// <summary>
    /// Get the record count for a station.
    /// </summary>
    public async Task<long> GetRecordCountAsync(int stationId)
    {
        if (_dataSource == null) return 0;

        await using var cmd = _dataSource.CreateCommand(
            "SELECT COUNT(*) FROM weather_data WHERE station_id = @stationId");
        cmd.Parameters.AddWithValue("stationId", stationId);

        var result = await cmd.ExecuteScalarAsync();
        return Convert.ToInt64(result);
    }

    /// <summary>
    /// Test a database connection string.
    /// Handles both key-value and URI-style (postgresql://...) connection strings.
    /// </summary>
    public static async Task<(bool success, string message)> TestConnectionAsync(string connectionString)
    {
        try
        {
            // Normalize: convert postgresql:// URI format to key-value format
            var normalizedCs = NormalizeConnectionString(connectionString);
            var csb = new NpgsqlConnectionStringBuilder(normalizedCs);

            var host = csb.Host ?? "";
            bool isCloud = host.Contains("neon.tech", StringComparison.OrdinalIgnoreCase) ||
                           host.Contains("supabase", StringComparison.OrdinalIgnoreCase) ||
                           host.Contains("railway", StringComparison.OrdinalIgnoreCase) ||
                           host.Contains("render", StringComparison.OrdinalIgnoreCase);

            if (isCloud)
            {
                if (csb.SslMode == SslMode.Disable || csb.SslMode == SslMode.Allow || csb.SslMode == SslMode.Prefer)
                    csb.SslMode = SslMode.Require;
            }

            var builder = new NpgsqlDataSourceBuilder(csb.ToString());
            await using var ds = builder.Build();
            await using var cmd = ds.CreateCommand("SELECT version()");
            var version = await cmd.ExecuteScalarAsync();
            return (true, $"Connected: {version}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    // ── Helpers ──

    /// <summary>
    /// Safely reads a nullable double by column name.
    /// Returns null if the column does not exist in the result set or the value is DBNull.
    /// Handles type mismatches (int, float, decimal) by converting to double.
    /// </summary>
    private static double? GetNullableDouble(NpgsqlDataReader reader, string column, HashSet<string> availableColumns)
    {
        if (!availableColumns.Contains(column)) return null;
        try
        {
            var ordinal = reader.GetOrdinal(column);
            if (reader.IsDBNull(ordinal)) return null;
            var value = reader.GetValue(ordinal);
            return Convert.ToDouble(value);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Save connection string to local app data for next session.
    /// </summary>
    private static void SaveConnectionString(string connectionString)
    {
        try
        {
            var dir = Path.GetDirectoryName(DbSettingsPath)!;
            Directory.CreateDirectory(dir);
            var data = new { ConnectionString = connectionString };
            var json = JsonSerializer.Serialize(data, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(DbSettingsPath, json);
            Log.Information("Database connection saved for next session");
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to save DB connection string");
        }
    }

    /// <summary>
    /// Load a previously-saved connection string.
    /// </summary>
    private static string? LoadSavedConnectionString()
    {
        try
        {
            if (!File.Exists(DbSettingsPath)) return null;
            var json = File.ReadAllText(DbSettingsPath);
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.TryGetProperty("ConnectionString", out var prop)
                ? prop.GetString()
                : null;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load saved DB connection string");
            return null;
        }
    }

    /// <summary>
    /// Converts a PostgreSQL URI (postgresql://user:pass@host:port/db?sslmode=require)
    /// to Npgsql key-value format (Host=...;Port=...;Database=...;Username=...;Password=...).
    /// If the input is already in key-value format, returns it unchanged.
    /// </summary>
    private static string NormalizeConnectionString(string connectionString)
    {
        var cs = connectionString.Trim();
        if (!cs.StartsWith("postgresql://", StringComparison.OrdinalIgnoreCase) &&
            !cs.StartsWith("postgres://", StringComparison.OrdinalIgnoreCase))
        {
            return cs; // Already key-value format
        }

        try
        {
            var uri = new Uri(cs);
            var csb = new NpgsqlConnectionStringBuilder();

            csb.Host = uri.Host;
            if (uri.Port > 0)
                csb.Port = uri.Port;

            // Parse user:password from URI
            if (!string.IsNullOrEmpty(uri.UserInfo))
            {
                var parts = uri.UserInfo.Split(':', 2);
                csb.Username = Uri.UnescapeDataString(parts[0]);
                if (parts.Length > 1)
                    csb.Password = Uri.UnescapeDataString(parts[1]);
            }

            // Database name from path
            if (uri.AbsolutePath.Length > 1)
                csb.Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));

            // Parse query string parameters (sslmode, etc.)
            if (!string.IsNullOrEmpty(uri.Query))
            {
                foreach (var param in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
                {
                    var kv = param.Split('=', 2);
                    if (kv.Length != 2) continue;

                    var key = Uri.UnescapeDataString(kv[0]).ToLowerInvariant();
                    var val = Uri.UnescapeDataString(kv[1]);

                    switch (key)
                    {
                        case "sslmode":
                            if (Enum.TryParse<SslMode>(val.Replace("-", ""), true, out var mode))
                                csb.SslMode = mode;
                            break;
                        case "connect_timeout":
                            if (int.TryParse(val, out var to))
                                csb.Timeout = to;
                            break;
                        case "application_name":
                            csb.ApplicationName = val;
                            break;
                    }
                }
            }

            var result = csb.ToString();
            Log.Information("Converted PostgreSQL URI to connection string (host={Host})", csb.Host);
            return result;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to parse PostgreSQL URI, using as-is");
            return cs;
        }
    }

    public void Dispose()
    {
        Disconnect();
    }
}
