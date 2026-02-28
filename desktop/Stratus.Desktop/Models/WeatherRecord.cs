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

    // ── Atmospheric ──
    [JsonPropertyName("temperature")]
    public double? Temperature { get; set; }

    [JsonPropertyName("temperatureMin")]
    public double? TemperatureMin { get; set; }

    [JsonPropertyName("temperatureMax")]
    public double? TemperatureMax { get; set; }

    [JsonPropertyName("humidity")]
    public double? Humidity { get; set; }
    
    [JsonPropertyName("pressure")]
    public double? Pressure { get; set; }

    [JsonPropertyName("pressureSeaLevel")]
    public double? PressureSeaLevel { get; set; }
    
    [JsonPropertyName("dewPoint")]
    public double? DewPoint { get; set; }

    [JsonPropertyName("airDensity")]
    public double? AirDensity { get; set; }

    // ── Wind ──
    [JsonPropertyName("windSpeed")]
    public double? WindSpeed { get; set; }
    
    [JsonPropertyName("windDirection")]
    public double? WindDirection { get; set; }
    
    [JsonPropertyName("windGust")]
    public double? WindGust { get; set; }

    [JsonPropertyName("windGust10min")]
    public double? WindGust10min { get; set; }

    [JsonPropertyName("windPower")]
    public double? WindPower { get; set; }

    [JsonPropertyName("windDirStdDev")]
    public double? WindDirStdDev { get; set; }

    [JsonPropertyName("sdi12WindVector")]
    public double? Sdi12WindVector { get; set; }

    // ── Precipitation ──
    [JsonPropertyName("rainfall")]
    public double? Rainfall { get; set; }

    [JsonPropertyName("rainfall10min")]
    public double? Rainfall10min { get; set; }

    [JsonPropertyName("rainfall24h")]
    public double? Rainfall24h { get; set; }

    // ── Solar ──
    [JsonPropertyName("solarRadiation")]
    public double? SolarRadiation { get; set; }

    [JsonPropertyName("solarRadiationMax")]
    public double? SolarRadiationMax { get; set; }
    
    [JsonPropertyName("uvIndex")]
    public double? UvIndex { get; set; }

    [JsonPropertyName("sunElevation")]
    public double? SunElevation { get; set; }

    [JsonPropertyName("sunAzimuth")]
    public double? SunAzimuth { get; set; }

    // ── Evapotranspiration ──
    [JsonPropertyName("eto")]
    public double? Eto { get; set; }

    [JsonPropertyName("eto24h")]
    public double? Eto24h { get; set; }

    // ── Soil ──
    [JsonPropertyName("soilTemperature")]
    public double? SoilTemperature { get; set; }
    
    [JsonPropertyName("soilMoisture")]
    public double? SoilMoisture { get; set; }

    [JsonPropertyName("leafWetness")]
    public double? LeafWetness { get; set; }

    // ── Air Quality ──
    [JsonPropertyName("pm25")]
    public double? Pm25 { get; set; }
    
    [JsonPropertyName("pm10")]
    public double? Pm10 { get; set; }

    [JsonPropertyName("pm1")]
    public double? Pm1 { get; set; }

    [JsonPropertyName("co2")]
    public double? Co2 { get; set; }

    [JsonPropertyName("tvoc")]
    public double? Tvoc { get; set; }

    // ── Battery / Power ──
    [JsonPropertyName("batteryVoltage")]
    public double? BatteryVoltage { get; set; }

    [JsonPropertyName("panelTemperature")]
    public double? PanelTemperature { get; set; }

    [JsonPropertyName("chargerVoltage")]
    public double? ChargerVoltage { get; set; }

    // ── Water & Sensors ──
    [JsonPropertyName("waterLevel")]
    public double? WaterLevel { get; set; }
    
    [JsonPropertyName("temperatureSwitch")]
    public double? TemperatureSwitch { get; set; }
    
    [JsonPropertyName("levelSwitch")]
    public double? LevelSwitch { get; set; }
    
    [JsonPropertyName("temperatureSwitchOutlet")]
    public double? TemperatureSwitchOutlet { get; set; }

    [JsonPropertyName("levelSwitchStatus")]
    public double? LevelSwitchStatus { get; set; }

    [JsonPropertyName("lightning")]
    public double? Lightning { get; set; }

    // ── Pump & Port ──
    [JsonPropertyName("pumpSelectWell")]
    public double? PumpSelectWell { get; set; }

    [JsonPropertyName("pumpSelectBore")]
    public double? PumpSelectBore { get; set; }

    [JsonPropertyName("portStatusC1")]
    public double? PortStatusC1 { get; set; }

    [JsonPropertyName("portStatusC2")]
    public double? PortStatusC2 { get; set; }

    // ── MPPT Solar Charger 1 ──
    [JsonPropertyName("mpptSolarVoltage")]
    public double? MpptSolarVoltage { get; set; }
    
    [JsonPropertyName("mpptSolarCurrent")]
    public double? MpptSolarCurrent { get; set; }
    
    [JsonPropertyName("mpptSolarPower")]
    public double? MpptSolarPower { get; set; }

    [JsonPropertyName("mpptLoadVoltage")]
    public double? MpptLoadVoltage { get; set; }

    [JsonPropertyName("mpptLoadCurrent")]
    public double? MpptLoadCurrent { get; set; }
    
    [JsonPropertyName("mpptBatteryVoltage")]
    public double? MpptBatteryVoltage { get; set; }
    
    [JsonPropertyName("mpptBatteryCurrent")]
    public double? MpptBatteryCurrent { get; set; }

    [JsonPropertyName("mpptChargerState")]
    public double? MpptChargerState { get; set; }

    [JsonPropertyName("mpptAbsiAvg")]
    public double? MpptAbsiAvg { get; set; }
    
    [JsonPropertyName("mpptBoardTemp")]
    public double? MpptBoardTemp { get; set; }

    [JsonPropertyName("mpptMode")]
    public double? MpptMode { get; set; }

    // ── MPPT Solar Charger 2 ──
    [JsonPropertyName("mppt2SolarVoltage")]
    public double? Mppt2SolarVoltage { get; set; }

    [JsonPropertyName("mppt2SolarCurrent")]
    public double? Mppt2SolarCurrent { get; set; }

    [JsonPropertyName("mppt2SolarPower")]
    public double? Mppt2SolarPower { get; set; }

    [JsonPropertyName("mppt2LoadVoltage")]
    public double? Mppt2LoadVoltage { get; set; }

    [JsonPropertyName("mppt2LoadCurrent")]
    public double? Mppt2LoadCurrent { get; set; }

    [JsonPropertyName("mppt2BatteryVoltage")]
    public double? Mppt2BatteryVoltage { get; set; }

    [JsonPropertyName("mppt2ChargerState")]
    public double? Mppt2ChargerState { get; set; }

    [JsonPropertyName("mppt2BoardTemp")]
    public double? Mppt2BoardTemp { get; set; }

    [JsonPropertyName("mppt2Mode")]
    public double? Mppt2Mode { get; set; }

    /// <summary>
    /// Raw JSON data blob (for fields not explicitly mapped).
    /// </summary>
    [JsonPropertyName("data")]
    public string? RawData { get; set; }

    // ── QC Flag Properties (non-persisted, set by QualityFlagService) ──

    /// <summary>Overall quality flag (0=Good, 1=Suspect, 2=Bad, 3=Missing).</summary>
    [JsonIgnore]
    public int QcFlag { get; set; } = -1;

    /// <summary>Unicode symbol for the QC flag.</summary>
    [JsonIgnore]
    public string QcFlagText => QcFlag switch
    {
        0 => "✓",
        1 => "⚠",
        2 => "✗",
        3 => "–",
        _ => ""
    };

    /// <summary>Tooltip with comma-delimited issue descriptions.</summary>
    [JsonIgnore]
    public string QcSummary { get; set; } = "";

    // ── Derived Parameters (computed locally, not from DB) ──

    /// <summary>Vapour Pressure Deficit (kPa). Computed from T + RH.</summary>
    [JsonIgnore]
    public double? VPD { get; set; }

    /// <summary>Heat Index (°C). Valid when T ≥ 27°C.</summary>
    [JsonIgnore]
    public double? HeatIndex { get; set; }

    /// <summary>Wind Chill (°C). Valid when T ≤ 10°C and wind ≥ 4.8 km/h.</summary>
    [JsonIgnore]
    public double? WindChillTemp { get; set; }

    /// <summary>Wet Bulb Temperature (°C). Stull (2011) approximation.</summary>
    [JsonIgnore]
    public double? WetBulb { get; set; }

    /// <summary>Cumulative rainfall since start of dataset (mm).</summary>
    [JsonIgnore]
    public double CumulativeRainfall { get; set; }
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
