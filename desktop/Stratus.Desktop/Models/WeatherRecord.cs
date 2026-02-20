using System.Text.Json.Serialization;

namespace Stratus.Desktop.Models;

/// <summary>
/// Represents a weather data record from a station.
/// Maps to the weather_data table in PostgreSQL.
/// </summary>
public class WeatherRecord
{
    public long Id { get; set; }
    
    [JsonPropertyName("stationId")]
    public int StationId { get; set; }
    
    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; }

    // Atmospheric
    [JsonPropertyName("temperature")]
    public double? Temperature { get; set; }
    
    [JsonPropertyName("humidity")]
    public double? Humidity { get; set; }
    
    [JsonPropertyName("pressure")]
    public double? Pressure { get; set; }
    
    [JsonPropertyName("dewPoint")]
    public double? DewPoint { get; set; }

    // Wind
    [JsonPropertyName("windSpeed")]
    public double? WindSpeed { get; set; }
    
    [JsonPropertyName("windDirection")]
    public double? WindDirection { get; set; }
    
    [JsonPropertyName("windGust")]
    public double? WindGust { get; set; }

    // Precipitation
    [JsonPropertyName("rainfall")]
    public double? Rainfall { get; set; }

    // Solar
    [JsonPropertyName("solarRadiation")]
    public double? SolarRadiation { get; set; }
    
    [JsonPropertyName("uvIndex")]
    public double? UvIndex { get; set; }

    // Soil
    [JsonPropertyName("soilTemperature")]
    public double? SoilTemperature { get; set; }
    
    [JsonPropertyName("soilMoisture")]
    public double? SoilMoisture { get; set; }

    // Air Quality
    [JsonPropertyName("pm25")]
    public double? Pm25 { get; set; }
    
    [JsonPropertyName("pm10")]
    public double? Pm10 { get; set; }

    // Battery / Power
    [JsonPropertyName("batteryVoltage")]
    public double? BatteryVoltage { get; set; }

    // MPPT Solar Charger
    [JsonPropertyName("mpptSolarVoltage")]
    public double? MpptSolarVoltage { get; set; }
    
    [JsonPropertyName("mpptSolarCurrent")]
    public double? MpptSolarCurrent { get; set; }
    
    [JsonPropertyName("mpptSolarPower")]
    public double? MpptSolarPower { get; set; }
    
    [JsonPropertyName("mpptBatteryVoltage")]
    public double? MpptBatteryVoltage { get; set; }
    
    [JsonPropertyName("mpptBatteryCurrent")]
    public double? MpptBatteryCurrent { get; set; }
    
    [JsonPropertyName("mpptLoadCurrent")]
    public double? MpptLoadCurrent { get; set; }
    
    [JsonPropertyName("mpptBoardTemp")]
    public double? MpptBoardTemp { get; set; }

    // Computed fields
    [JsonPropertyName("airDensity")]
    public double? AirDensity { get; set; }
    
    [JsonPropertyName("eto")]
    public double? Eto { get; set; }

    /// <summary>
    /// Raw JSON data blob (for fields not explicitly mapped).
    /// </summary>
    [JsonPropertyName("data")]
    public string? RawData { get; set; }
}

/// <summary>
/// Summary statistics for a time period.
/// </summary>
public class DataSummary
{
    public string Field { get; set; } = string.Empty;
    public double? Min { get; set; }
    public double? Max { get; set; }
    public double? Average { get; set; }
    public int Count { get; set; }
    public string Unit { get; set; } = string.Empty;
}
