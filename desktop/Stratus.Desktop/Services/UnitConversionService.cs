namespace Stratus.Desktop.Services;

/// <summary>
/// Converts weather measurement values between metric (SI) and imperial units.
/// All internal storage is metric; conversions applied at display time.
/// </summary>
public static class UnitConversionService
{
    // ── Temperature ──
    public static double CtoF(double celsius) => celsius * 9.0 / 5.0 + 32.0;
    public static double FtoC(double fahrenheit) => (fahrenheit - 32.0) * 5.0 / 9.0;

    // ── Wind Speed ──
    public static double KmhToMph(double kmh) => kmh * 0.621371;
    public static double KmhToKnots(double kmh) => kmh * 0.539957;
    public static double KmhToMs(double kmh) => kmh / 3.6;

    // ── Pressure ──
    public static double HpaToInHg(double hpa) => hpa * 0.02953;
    public static double HpaToMmHg(double hpa) => hpa * 0.750062;

    // ── Rainfall / ETo ──
    public static double MmToInches(double mm) => mm * 0.0393701;

    // ── Distance / Water Level ──
    public static double MmToFeet(double mm) => mm * 0.00328084;

    // ── Solar Radiation (no conversion, W/m² universal) ──

    /// <summary>
    /// Converts a metric value to imperial for the given parameter.
    /// Returns (converted value, unit string).
    /// </summary>
    public static (double Value, string Unit) ToImperial(double metricValue, string parameter)
    {
        return parameter.ToLowerInvariant() switch
        {
            "temperature" or "dewpoint" or "soiltemperature" or "paneltemperature" => 
                (CtoF(metricValue), "°F"),
            "windspeed" or "windgust" => 
                (KmhToMph(metricValue), "mph"),
            "pressure" or "pressuresealevel" => 
                (HpaToInHg(metricValue), "inHg"),
            "rainfall" or "rainfall24h" or "eto" or "eto24h" => 
                (MmToInches(metricValue), "in"),
            "waterlevel" => 
                (MmToFeet(metricValue), "ft"),
            _ => (metricValue, "") // No conversion needed
        };
    }

    /// <summary>
    /// Returns the metric unit string for a parameter.
    /// </summary>
    public static string MetricUnit(string parameter)
    {
        return parameter.ToLowerInvariant() switch
        {
            "temperature" or "dewpoint" or "soiltemperature" or "paneltemperature" => "°C",
            "windspeed" or "windgust" => "m/s",
            "pressure" or "pressuresealevel" => "hPa",
            "rainfall" or "rainfall24h" => "mm",
            "eto" or "eto24h" => "mm/day",
            "waterlevel" => "mm",
            "humidity" or "soilmoisture" => "%",
            "solarradiation" => "W/m²",
            "uvindex" => "",
            "batteryvoltage" or "chargervoltage" => "V",
            _ => ""
        };
    }

    /// <summary>
    /// Returns the imperial unit string for a parameter.
    /// </summary>
    public static string ImperialUnit(string parameter)
    {
        return parameter.ToLowerInvariant() switch
        {
            "temperature" or "dewpoint" or "soiltemperature" or "paneltemperature" => "°F",
            "windspeed" or "windgust" => "mph",
            "pressure" or "pressuresealevel" => "inHg",
            "rainfall" or "rainfall24h" => "in",
            "eto" or "eto24h" => "in/day",
            "waterlevel" => "ft",
            "humidity" or "soilmoisture" => "%",
            "solarradiation" => "W/m²",
            "uvindex" => "",
            "batteryvoltage" or "chargervoltage" => "V",
            _ => ""
        };
    }
}
