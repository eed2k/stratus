using System;
using System.Collections.Generic;
using System.Linq;

namespace Stratus.Desktop.Models;

/// <summary>
/// Wind speed unit for wind rose analysis.
/// </summary>
public enum WindSpeedUnit
{
    /// <summary>Kilometres per hour (default for Stratus stations).</summary>
    KilometresPerHour,
    /// <summary>Metres per second (SI).</summary>
    MetresPerSecond,
    /// <summary>Knots (nautical).</summary>
    Knots
}

/// <summary>
/// WMO Simplified Beaufort wind speed categories for wind rose analysis.
/// Matches the Stratus web application's wind rose display (6 categories, km/h).
/// Based on WMO-No. 8 Beaufort Scale converted from knots to km/h.
/// Color scheme follows a thermal gradient: blues → greens → yellows → reds.
/// </summary>
public static class WindSpeedCategories
{
    /// <summary>
    /// Speed bin definitions in km/h matching WMO Simplified Beaufort classes.
    /// (Min, Max, Label, Hex Color)
    /// </summary>
    public static readonly (double Min, double Max, string Label, string Color)[] Categories =
    {
        (0.0,    6.0, "Calm / Light (0–6 km/h)",          "#E2E8F0"),  // Beaufort 0-1
        (6.0,   20.0, "Light / Gentle (6–20 km/h)",        "#F1F5F9"),  // Beaufort 2-3
        (20.0,  39.0, "Moderate / Fresh (20–39 km/h)",     "#1D4ED8"),  // Beaufort 4-5
        (39.0,  62.0, "Strong / Near Gale (39–62 km/h)",   "#1E40AF"),  // Beaufort 6-7
        (62.0,  89.0, "Gale / Strong Gale (62–89 km/h)",   "#1E293B"),  // Beaufort 8-9
        (89.0, 999.0, "Storm+ (>89 km/h)",                  "#000000"),  // Beaufort 10+
    };
}

/// <summary>
/// Holds computed data for a single wind rose sector (angular bin).
/// </summary>
public class WindRoseSector
{
    /// <summary>Start angle of the sector in degrees (meteorological, 0 = North).</summary>
    public double StartAngle { get; set; }

    /// <summary>End angle of the sector in degrees (meteorological, 0 = North).</summary>
    public double EndAngle { get; set; }

    /// <summary>
    /// Percentage of total records in each speed bin.
    /// Array length matches <see cref="WindSpeedCategories.Categories"/>.
    /// </summary>
    public double[] SpeedBinPercentages { get; set; } = new double[WindSpeedCategories.Categories.Length];

    /// <summary>Total number of records in this sector across all speed bins.</summary>
    public int TotalCount { get; set; }
}

/// <summary>
/// Complete wind rose result containing all sector data ready for rendering.
/// </summary>
public class WindRoseResult
{
    /// <summary>Display title for the wind rose chart.</summary>
    public string Title { get; set; } = "";

    /// <summary>List of sectors with their speed bin percentages.</summary>
    public List<WindRoseSector> Sectors { get; set; } = new();

    /// <summary>Maximum cumulative percentage across all sectors (for scaling the radial axis).</summary>
    public double MaxPercentage { get; set; }

    /// <summary>Total number of wind records used in the computation.</summary>
    public int TotalRecords { get; set; }

    /// <summary>Percentage of records classified as calm (wind speed &lt; 0.3 m/s).</summary>
    public double CalmPercentage { get; set; }

    /// <summary>Wind speed unit used for the category bins.</summary>
    public WindSpeedUnit Unit { get; set; } = WindSpeedUnit.MetresPerSecond;
}

/// <summary>
/// Single wind data point for wind rose calculation.
/// Wind speed must be in metres per second (m/s) and direction in degrees (0-360, meteorological).
/// </summary>
public class WindDataPoint
{
    /// <summary>Timestamp of the measurement.</summary>
    public DateTime Date { get; set; }

    /// <summary>Wind direction in degrees (0-360, 0 = North, 90 = East). 360 is normalised to 0.</summary>
    public double WindDirection { get; set; }

    /// <summary>Wind speed in metres per second (m/s).</summary>
    public double WindSpeed { get; set; }

    /// <summary>Whether the measurement was taken during daylight or nighttime.</summary>
    public DaylightType Daylight { get; set; }

    /// <summary>Southern Hemisphere season classification.</summary>
    public WindSeason Season { get; set; }
}

/// <summary>
/// Daylight classification for wind data points.
/// </summary>
public enum DaylightType
{
    /// <summary>Record taken between sunrise and sunset.</summary>
    Daylight,

    /// <summary>Record taken between sunset and sunrise.</summary>
    Nighttime
}

/// <summary>
/// Seasonal classification using Southern Hemisphere convention.
/// Matches the climate seasons for South Africa and other Southern Hemisphere locations.
/// </summary>
public enum WindSeason
{
    /// <summary>September, October, November (Southern Hemisphere spring).</summary>
    Spring,

    /// <summary>December, January, February (Southern Hemisphere summer).</summary>
    Summer,

    /// <summary>March, April, May (Southern Hemisphere autumn).</summary>
    Autumn,

    /// <summary>June, July, August (Southern Hemisphere winter).</summary>
    Winter
}
