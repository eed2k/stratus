using Microsoft.Extensions.Configuration;
using Npgsql;
using Serilog;
using Stratus.Desktop.Models;

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

    public bool IsConnected => _isConnected;
    public event EventHandler<bool>? ConnectionChanged;

    public DatabaseService(IConfiguration config)
    {
        _connectionString = config["Database:ConnectionString"];
        var useDirect = bool.TryParse(config["Database:UseDirect"], out var d) && d;
        
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
            
            var builder = new NpgsqlDataSourceBuilder(connectionString);
            _dataSource = builder.Build();
            _connectionString = connectionString;

            // Test connection
            using var cmd = _dataSource.CreateCommand("SELECT 1");
            cmd.ExecuteScalar();

            _isConnected = true;
            ConnectionChanged?.Invoke(this, true);
            Log.Information("Connected to PostgreSQL database");
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
    /// </summary>
    public async Task<List<WeatherRecord>> GetDataAsync(
        int stationId, DateTime? startTime = null, DateTime? endTime = null, int limit = 2000)
    {
        if (_dataSource == null) return new List<WeatherRecord>();

        var sql = @"SELECT id, station_id, timestamp, temperature, humidity, pressure, 
                    dew_point, wind_speed, wind_direction, wind_gust, rainfall, 
                    solar_radiation, uv_index, soil_temperature, soil_moisture,
                    pm25, pm10, battery_voltage, air_density, eto,
                    mppt_solar_voltage, mppt_solar_current, mppt_solar_power,
                    mppt_battery_voltage, mppt_battery_current, mppt_load_current, mppt_board_temp
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
                Id = reader.GetInt64(0),
                StationId = reader.GetInt32(1),
                Timestamp = reader.GetDateTime(2),
                Temperature = reader.IsDBNull(3) ? null : reader.GetDouble(3),
                Humidity = reader.IsDBNull(4) ? null : reader.GetDouble(4),
                Pressure = reader.IsDBNull(5) ? null : reader.GetDouble(5),
                DewPoint = reader.IsDBNull(6) ? null : reader.GetDouble(6),
                WindSpeed = reader.IsDBNull(7) ? null : reader.GetDouble(7),
                WindDirection = reader.IsDBNull(8) ? null : reader.GetDouble(8),
                WindGust = reader.IsDBNull(9) ? null : reader.GetDouble(9),
                Rainfall = reader.IsDBNull(10) ? null : reader.GetDouble(10),
                SolarRadiation = reader.IsDBNull(11) ? null : reader.GetDouble(11),
                UvIndex = reader.IsDBNull(12) ? null : reader.GetDouble(12),
                SoilTemperature = reader.IsDBNull(13) ? null : reader.GetDouble(13),
                SoilMoisture = reader.IsDBNull(14) ? null : reader.GetDouble(14),
                Pm25 = reader.IsDBNull(15) ? null : reader.GetDouble(15),
                Pm10 = reader.IsDBNull(16) ? null : reader.GetDouble(16),
                BatteryVoltage = reader.IsDBNull(17) ? null : reader.GetDouble(17),
                AirDensity = reader.IsDBNull(18) ? null : reader.GetDouble(18),
                Eto = reader.IsDBNull(19) ? null : reader.GetDouble(19),
                MpptSolarVoltage = reader.IsDBNull(20) ? null : reader.GetDouble(20),
                MpptSolarCurrent = reader.IsDBNull(21) ? null : reader.GetDouble(21),
                MpptSolarPower = reader.IsDBNull(22) ? null : reader.GetDouble(22),
                MpptBatteryVoltage = reader.IsDBNull(23) ? null : reader.GetDouble(23),
                MpptBatteryCurrent = reader.IsDBNull(24) ? null : reader.GetDouble(24),
                MpptLoadCurrent = reader.IsDBNull(25) ? null : reader.GetDouble(25),
                MpptBoardTemp = reader.IsDBNull(26) ? null : reader.GetDouble(26),
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
            var builder = new NpgsqlDataSourceBuilder(connectionString);
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

    public void Dispose()
    {
        Disconnect();
    }
}
