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
    /// Uses SELECT * and column-existence checks for maximum robustness
    /// against schema variations across different database deployments.
    /// </summary>
    public async Task<List<WeatherRecord>> GetDataAsync(
        int stationId, DateTime? startTime = null, DateTime? endTime = null, int limit = 2000)
    {
        if (_dataSource == null) return new List<WeatherRecord>();

        var sql = "SELECT * FROM weather_data WHERE station_id = @stationId";

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

        // Build a lookup of available column names for safe reading
        var cols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < reader.FieldCount; i++)
            cols.Add(reader.GetName(i));

        while (await reader.ReadAsync())
        {
            records.Add(new WeatherRecord
            {
                Id = cols.Contains("id") ? reader.GetInt64(reader.GetOrdinal("id")) : 0,
                StationId = reader.GetInt32(reader.GetOrdinal("station_id")),
                Timestamp = reader.GetDateTime(reader.GetOrdinal("timestamp")),
                // Atmospheric
                Temperature = GetNullableDouble(reader, "temperature", cols),
                TemperatureMin = GetNullableDouble(reader, "temperature_min", cols),
                TemperatureMax = GetNullableDouble(reader, "temperature_max", cols),
                Humidity = GetNullableDouble(reader, "humidity", cols),
                Pressure = GetNullableDouble(reader, "pressure", cols),
                PressureSeaLevel = GetNullableDouble(reader, "pressure_sea_level", cols),
                DewPoint = GetNullableDouble(reader, "dew_point", cols),
                AirDensity = GetNullableDouble(reader, "air_density", cols),
                // Wind
                WindSpeed = GetNullableDouble(reader, "wind_speed", cols),
                WindDirection = GetNullableDouble(reader, "wind_direction", cols),
                WindGust = GetNullableDouble(reader, "wind_gust", cols),
                WindGust10min = GetNullableDouble(reader, "wind_gust_10min", cols),
                WindPower = GetNullableDouble(reader, "wind_power", cols),
                WindDirStdDev = GetNullableDouble(reader, "wind_dir_std_dev", cols),
                Sdi12WindVector = GetNullableDouble(reader, "sdi12_wind_vector", cols),
                // Precipitation
                Rainfall = GetNullableDouble(reader, "rainfall", cols),
                Rainfall10min = GetNullableDouble(reader, "rainfall_10min", cols),
                Rainfall24h = GetNullableDouble(reader, "rainfall_24h", cols),
                // Solar
                SolarRadiation = GetNullableDouble(reader, "solar_radiation", cols),
                SolarRadiationMax = GetNullableDouble(reader, "solar_radiation_max", cols),
                UvIndex = GetNullableDouble(reader, "uv_index", cols),
                SunElevation = GetNullableDouble(reader, "sun_elevation", cols),
                SunAzimuth = GetNullableDouble(reader, "sun_azimuth", cols),
                // Evapotranspiration
                Eto = GetNullableDouble(reader, "eto", cols),
                Eto24h = GetNullableDouble(reader, "eto_24h", cols),
                // Soil
                SoilTemperature = GetNullableDouble(reader, "soil_temperature", cols),
                SoilMoisture = GetNullableDouble(reader, "soil_moisture", cols),
                LeafWetness = GetNullableDouble(reader, "leaf_wetness", cols),
                // Air Quality
                Pm25 = GetNullableDouble(reader, "pm25", cols),
                Pm10 = GetNullableDouble(reader, "pm10", cols),
                Pm1 = GetNullableDouble(reader, "pm1", cols),
                Co2 = GetNullableDouble(reader, "co2", cols),
                Tvoc = GetNullableDouble(reader, "tvoc", cols),
                // Battery / Power
                BatteryVoltage = GetNullableDouble(reader, "battery_voltage", cols),
                PanelTemperature = GetNullableDouble(reader, "panel_temperature", cols),
                ChargerVoltage = GetNullableDouble(reader, "charger_voltage", cols),
                // Water & Sensors
                WaterLevel = GetNullableDouble(reader, "water_level", cols),
                TemperatureSwitch = GetNullableDouble(reader, "temperature_switch", cols),
                LevelSwitch = GetNullableDouble(reader, "level_switch", cols),
                TemperatureSwitchOutlet = GetNullableDouble(reader, "temperature_switch_outlet", cols),
                LevelSwitchStatus = GetNullableDouble(reader, "level_switch_status", cols),
                Lightning = GetNullableDouble(reader, "lightning", cols),
                // Pump & Port
                PumpSelectWell = GetNullableDouble(reader, "pump_select_well", cols),
                PumpSelectBore = GetNullableDouble(reader, "pump_select_bore", cols),
                PortStatusC1 = GetNullableDouble(reader, "port_status_c1", cols),
                PortStatusC2 = GetNullableDouble(reader, "port_status_c2", cols),
                // MPPT 1
                MpptSolarVoltage = GetNullableDouble(reader, "mppt_solar_voltage", cols),
                MpptSolarCurrent = GetNullableDouble(reader, "mppt_solar_current", cols),
                MpptSolarPower = GetNullableDouble(reader, "mppt_solar_power", cols),
                MpptLoadVoltage = GetNullableDouble(reader, "mppt_load_voltage", cols),
                MpptLoadCurrent = GetNullableDouble(reader, "mppt_load_current", cols),
                MpptBatteryVoltage = GetNullableDouble(reader, "mppt_battery_voltage", cols),
                MpptBatteryCurrent = GetNullableDouble(reader, "mppt_battery_current", cols),
                MpptChargerState = GetNullableDouble(reader, "mppt_charger_state", cols),
                MpptAbsiAvg = GetNullableDouble(reader, "mppt_absi_avg", cols),
                MpptBoardTemp = GetNullableDouble(reader, "mppt_board_temp", cols),
                MpptMode = GetNullableDouble(reader, "mppt_mode", cols),
                // MPPT 2
                Mppt2SolarVoltage = GetNullableDouble(reader, "mppt2_solar_voltage", cols),
                Mppt2SolarCurrent = GetNullableDouble(reader, "mppt2_solar_current", cols),
                Mppt2SolarPower = GetNullableDouble(reader, "mppt2_solar_power", cols),
                Mppt2LoadVoltage = GetNullableDouble(reader, "mppt2_load_voltage", cols),
                Mppt2LoadCurrent = GetNullableDouble(reader, "mppt2_load_current", cols),
                Mppt2BatteryVoltage = GetNullableDouble(reader, "mppt2_battery_voltage", cols),
                Mppt2ChargerState = GetNullableDouble(reader, "mppt2_charger_state", cols),
                Mppt2BoardTemp = GetNullableDouble(reader, "mppt2_board_temp", cols),
                Mppt2Mode = GetNullableDouble(reader, "mppt2_mode", cols),
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
