using Microsoft.Extensions.Configuration;
using Npgsql;
using Serilog;
using Stratus.Desktop.Models;
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
    /// </summary>
    public bool Connect(string connectionString)
    {
        try
        {
            Disconnect();

            // Ensure SSL mode is set for cloud databases (Neon, Supabase, etc.)
            var csb = new NpgsqlConnectionStringBuilder(connectionString);
            if (csb.SslMode == SslMode.Disable || csb.SslMode == SslMode.Allow)
            {
                // If host contains common cloud domains, default to Require
                var host = csb.Host ?? "";
                if (host.Contains("neon.tech", StringComparison.OrdinalIgnoreCase) ||
                    host.Contains("supabase", StringComparison.OrdinalIgnoreCase) ||
                    host.Contains("railway", StringComparison.OrdinalIgnoreCase) ||
                    host.Contains("render", StringComparison.OrdinalIgnoreCase))
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
            Log.Information("Connected to PostgreSQL database");

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
            "api_endpoint, is_active, last_connected, site_description " +
            "FROM stations ORDER BY id");

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            stations.Add(new WeatherStation
            {
                Id = reader.GetInt32(0),
                Name = reader.GetString(1),
                Location = reader.IsDBNull(2) ? null : reader.GetString(2),
                Latitude = reader.IsDBNull(3) ? null : reader.GetDouble(3),
                Longitude = reader.IsDBNull(4) ? null : reader.GetDouble(4),
                Elevation = reader.IsDBNull(5) ? null : reader.GetDouble(5),
                StationType = reader.IsDBNull(6) ? null : reader.GetString(6),
                Endpoint = reader.IsDBNull(7) ? null : reader.GetString(7),
                IsActive = !reader.IsDBNull(8) && reader.GetBoolean(8),
                LastConnected = reader.IsDBNull(9) ? null : reader.GetDateTime(9),
                Description = reader.IsDBNull(10) ? null : reader.GetString(10),
            });
        }

        return stations;
    }

    /// <summary>
    /// Fetch weather data for a station within a time range.
    /// Uses column-name-based reading for robustness against schema changes.
    /// </summary>
    public async Task<List<WeatherRecord>> GetDataAsync(
        int stationId, DateTime? startTime = null, DateTime? endTime = null, int limit = 2000)
    {
        if (_dataSource == null) return new List<WeatherRecord>();

        // Select all columns the model supports — the query is tolerant of missing
        // columns because we read by name and default to null.
        var sql = @"SELECT id, station_id, timestamp,
                    temperature, temperature_min, temperature_max,
                    humidity, pressure, pressure_sea_level,
                    dew_point, air_density,
                    wind_speed, wind_direction, wind_gust, wind_gust_10min, wind_power,
                    wind_dir_std_dev, sdi12_wind_vector,
                    rainfall, rainfall_10min, rainfall_24h,
                    solar_radiation, solar_radiation_max, uv_index,
                    sun_elevation, sun_azimuth,
                    eto, eto_24h,
                    soil_temperature, soil_moisture, leaf_wetness,
                    pm25, pm10, pm1, co2, tvoc,
                    battery_voltage, panel_temperature, charger_voltage,
                    water_level, temperature_switch, level_switch,
                    temperature_switch_outlet, level_switch_status, lightning,
                    pump_select_well, pump_select_bore, port_status_c1, port_status_c2,
                    mppt_solar_voltage, mppt_solar_current, mppt_solar_power,
                    mppt_load_voltage, mppt_load_current,
                    mppt_battery_voltage, mppt_battery_current,
                    mppt_charger_state, mppt_absi_avg, mppt_board_temp, mppt_mode,
                    mppt2_solar_voltage, mppt2_solar_current, mppt2_solar_power,
                    mppt2_load_voltage, mppt2_load_current,
                    mppt2_battery_voltage, mppt2_charger_state, mppt2_board_temp, mppt2_mode
                    FROM weather_data WHERE station_id = @stationId";

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
        while (await reader.ReadAsync())
        {
            records.Add(new WeatherRecord
            {
                Id = reader.GetInt64(reader.GetOrdinal("id")),
                StationId = reader.GetInt32(reader.GetOrdinal("station_id")),
                Timestamp = reader.GetDateTime(reader.GetOrdinal("timestamp")),
                // Atmospheric
                Temperature = GetNullableDouble(reader, "temperature"),
                TemperatureMin = GetNullableDouble(reader, "temperature_min"),
                TemperatureMax = GetNullableDouble(reader, "temperature_max"),
                Humidity = GetNullableDouble(reader, "humidity"),
                Pressure = GetNullableDouble(reader, "pressure"),
                PressureSeaLevel = GetNullableDouble(reader, "pressure_sea_level"),
                DewPoint = GetNullableDouble(reader, "dew_point"),
                AirDensity = GetNullableDouble(reader, "air_density"),
                // Wind
                WindSpeed = GetNullableDouble(reader, "wind_speed"),
                WindDirection = GetNullableDouble(reader, "wind_direction"),
                WindGust = GetNullableDouble(reader, "wind_gust"),
                WindGust10min = GetNullableDouble(reader, "wind_gust_10min"),
                WindPower = GetNullableDouble(reader, "wind_power"),
                WindDirStdDev = GetNullableDouble(reader, "wind_dir_std_dev"),
                Sdi12WindVector = GetNullableDouble(reader, "sdi12_wind_vector"),
                // Precipitation
                Rainfall = GetNullableDouble(reader, "rainfall"),
                Rainfall10min = GetNullableDouble(reader, "rainfall_10min"),
                Rainfall24h = GetNullableDouble(reader, "rainfall_24h"),
                // Solar
                SolarRadiation = GetNullableDouble(reader, "solar_radiation"),
                SolarRadiationMax = GetNullableDouble(reader, "solar_radiation_max"),
                UvIndex = GetNullableDouble(reader, "uv_index"),
                SunElevation = GetNullableDouble(reader, "sun_elevation"),
                SunAzimuth = GetNullableDouble(reader, "sun_azimuth"),
                // Evapotranspiration
                Eto = GetNullableDouble(reader, "eto"),
                Eto24h = GetNullableDouble(reader, "eto_24h"),
                // Soil
                SoilTemperature = GetNullableDouble(reader, "soil_temperature"),
                SoilMoisture = GetNullableDouble(reader, "soil_moisture"),
                LeafWetness = GetNullableDouble(reader, "leaf_wetness"),
                // Air Quality
                Pm25 = GetNullableDouble(reader, "pm25"),
                Pm10 = GetNullableDouble(reader, "pm10"),
                Pm1 = GetNullableDouble(reader, "pm1"),
                Co2 = GetNullableDouble(reader, "co2"),
                Tvoc = GetNullableDouble(reader, "tvoc"),
                // Battery / Power
                BatteryVoltage = GetNullableDouble(reader, "battery_voltage"),
                PanelTemperature = GetNullableDouble(reader, "panel_temperature"),
                ChargerVoltage = GetNullableDouble(reader, "charger_voltage"),
                // Water & Sensors
                WaterLevel = GetNullableDouble(reader, "water_level"),
                TemperatureSwitch = GetNullableDouble(reader, "temperature_switch"),
                LevelSwitch = GetNullableDouble(reader, "level_switch"),
                TemperatureSwitchOutlet = GetNullableDouble(reader, "temperature_switch_outlet"),
                LevelSwitchStatus = GetNullableDouble(reader, "level_switch_status"),
                Lightning = GetNullableDouble(reader, "lightning"),
                // Pump & Port
                PumpSelectWell = GetNullableDouble(reader, "pump_select_well"),
                PumpSelectBore = GetNullableDouble(reader, "pump_select_bore"),
                PortStatusC1 = GetNullableDouble(reader, "port_status_c1"),
                PortStatusC2 = GetNullableDouble(reader, "port_status_c2"),
                // MPPT 1
                MpptSolarVoltage = GetNullableDouble(reader, "mppt_solar_voltage"),
                MpptSolarCurrent = GetNullableDouble(reader, "mppt_solar_current"),
                MpptSolarPower = GetNullableDouble(reader, "mppt_solar_power"),
                MpptLoadVoltage = GetNullableDouble(reader, "mppt_load_voltage"),
                MpptLoadCurrent = GetNullableDouble(reader, "mppt_load_current"),
                MpptBatteryVoltage = GetNullableDouble(reader, "mppt_battery_voltage"),
                MpptBatteryCurrent = GetNullableDouble(reader, "mppt_battery_current"),
                MpptChargerState = GetNullableDouble(reader, "mppt_charger_state"),
                MpptAbsiAvg = GetNullableDouble(reader, "mppt_absi_avg"),
                MpptBoardTemp = GetNullableDouble(reader, "mppt_board_temp"),
                MpptMode = GetNullableDouble(reader, "mppt_mode"),
                // MPPT 2
                Mppt2SolarVoltage = GetNullableDouble(reader, "mppt2_solar_voltage"),
                Mppt2SolarCurrent = GetNullableDouble(reader, "mppt2_solar_current"),
                Mppt2SolarPower = GetNullableDouble(reader, "mppt2_solar_power"),
                Mppt2LoadVoltage = GetNullableDouble(reader, "mppt2_load_voltage"),
                Mppt2LoadCurrent = GetNullableDouble(reader, "mppt2_load_current"),
                Mppt2BatteryVoltage = GetNullableDouble(reader, "mppt2_battery_voltage"),
                Mppt2ChargerState = GetNullableDouble(reader, "mppt2_charger_state"),
                Mppt2BoardTemp = GetNullableDouble(reader, "mppt2_board_temp"),
                Mppt2Mode = GetNullableDouble(reader, "mppt2_mode"),
            });
        }

        return records;
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
    /// </summary>
    public static async Task<(bool success, string message)> TestConnectionAsync(string connectionString)
    {
        try
        {
            // Auto-apply SSL for cloud databases
            var csb = new NpgsqlConnectionStringBuilder(connectionString);
            var host = csb.Host ?? "";
            if ((csb.SslMode == SslMode.Disable || csb.SslMode == SslMode.Allow) &&
                (host.Contains("neon.tech", StringComparison.OrdinalIgnoreCase) ||
                 host.Contains("supabase", StringComparison.OrdinalIgnoreCase) ||
                 host.Contains("railway", StringComparison.OrdinalIgnoreCase) ||
                 host.Contains("render", StringComparison.OrdinalIgnoreCase)))
            {
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
    /// Returns null if the column value is DBNull.
    /// </summary>
    private static double? GetNullableDouble(NpgsqlDataReader reader, string column)
    {
        var ordinal = reader.GetOrdinal(column);
        return reader.IsDBNull(ordinal) ? null : reader.GetDouble(ordinal);
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

    public void Dispose()
    {
        Disconnect();
    }
}
