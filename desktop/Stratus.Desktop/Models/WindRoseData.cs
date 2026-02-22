using System;
using System.Collections.Generic;

namespace Stratus.Desktop.Models;

/// <summary>
/// Wind speed categories for wind rose analysis, matching the openair R package breaks.
/// Speed values are in metres per second (m/s).
/// Color scheme follows a diverging blue-to-red palette for clear visual separation.
/// </summary>
public static class WindSpeedCategories
{
    /// <summary>
    /// Speed bin definitions: (Min m/s, Max m/s, Label, Hex Color).
    /// Bins are contiguous and cover the full range 0 to 35 m/s.
    /// </summary>
    public static readonly (double Min, double Max, string Label, string Color)[] Categories =
    {
        (0.0,  0.3, "0 - 0.3 m/s",    "#4575B4"),  // Calm - Dark blue
        (0.3,  1.5, "0.3 - 1.5 m/s",   "#91BFDB"),  // Light air - Light blue
        (1.5,  3.4, "1.5 - 3.4 m/s",   "#E0F3F8"),  // Light breeze - Pale blue
        (3.4,  5.4, "3.4 - 5.4 m/s",   "#FEE090"),  // Gentle breeze - Yellow
        (5.4,  7.9, "5.4 - 7.9 m/s",   "#FC8D59"),  // Moderate breeze - Orange
        (7.9, 35.0, "7.9 - 35 m/s",    "#D73027"),  // Fresh+ breeze - Red
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
