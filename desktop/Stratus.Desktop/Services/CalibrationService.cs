using System.IO;
using System.Text.Json;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Manages sensor calibration profiles — correction coefficients, calibration dates,
/// and certificate references. Persists to %APPDATA%\Stratus\calibrations.json.
/// </summary>
public class CalibrationService
{
    private readonly string _filePath;
    private List<CalibrationProfile> _profiles = new();
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    public IReadOnlyList<CalibrationProfile> Profiles => _profiles.AsReadOnly();

    public event EventHandler? ProfilesChanged;

    public CalibrationService(string appDataPath)
    {
        _filePath = Path.Combine(appDataPath, "calibrations.json");
        Load();
    }

    public void Load()
    {
        try
        {
            if (File.Exists(_filePath))
            {
                var json = File.ReadAllText(_filePath);
                _profiles = JsonSerializer.Deserialize<List<CalibrationProfile>>(json) ?? new();
                Log.Information("Loaded {Count} calibration profiles", _profiles.Count);
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load calibration profiles");
            _profiles = new();
        }
    }

    public void Save()
    {
        try
        {
            var json = JsonSerializer.Serialize(_profiles, JsonOpts);
            File.WriteAllText(_filePath, json);
            Log.Information("Saved {Count} calibration profiles", _profiles.Count);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save calibration profiles");
        }
    }

    public void AddOrUpdate(CalibrationProfile profile)
    {
        var existing = _profiles.FindIndex(p => p.Id == profile.Id);
        if (existing >= 0)
            _profiles[existing] = profile;
        else
            _profiles.Add(profile);
        Save();
        ProfilesChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Remove(string profileId)
    {
        _profiles.RemoveAll(p => p.Id == profileId);
        Save();
        ProfilesChanged?.Invoke(this, EventArgs.Empty);
    }

    public CalibrationProfile? GetProfile(int stationId, string sensorField)
        => _profiles.FirstOrDefault(p => p.StationId == stationId && p.SensorField == sensorField && p.IsEnabled);

    public IEnumerable<CalibrationProfile> GetStationProfiles(int stationId)
        => _profiles.Where(p => p.StationId == stationId);

    public IEnumerable<CalibrationProfile> GetOverdueCalibrations()
        => _profiles.Where(p => p.IsOverdue);

    /// <summary>
    /// Applies calibration corrections to a weather record in-place.
    /// </summary>
    public void ApplyCorrections(WeatherRecord record)
    {
        foreach (var profile in _profiles.Where(p => p.StationId == record.StationId && p.IsEnabled))
        {
            var prop = typeof(WeatherRecord).GetProperty(profile.SensorField);
            if (prop?.GetValue(record) is double rawValue)
            {
                prop.SetValue(record, profile.Apply(rawValue));
            }
        }
    }

    /// <summary>
    /// Returns well-known sensor fields for calibration configuration.
    /// </summary>
    public static IReadOnlyList<(string Field, string Display, string Unit)> GetAvailableSensorFields() => new[]
    {
        ("Temperature", "Temperature", "°C"),
        ("Humidity", "Relative Humidity", "%"),
        ("Pressure", "Barometric Pressure", "hPa"),
        ("WindSpeed", "Wind Speed", "m/s"),
        ("WindDirection", "Wind Direction", "°"),
        ("Rainfall", "Rainfall", "mm"),
        ("SolarRadiation", "Solar Radiation", "W/m²"),
        ("UvIndex", "UV Index", ""),
        ("SoilTemperature", "Soil Temperature", "°C"),
        ("SoilMoisture", "Soil Moisture", "%"),
        ("BatteryVoltage", "Battery Voltage", "V"),
        ("Pm25", "PM2.5", "µg/m³"),
        ("Pm10", "PM10", "µg/m³"),
        ("Co2", "CO₂", "ppm"),
    };
}
