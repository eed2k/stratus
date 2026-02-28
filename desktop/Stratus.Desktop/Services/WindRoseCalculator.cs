using System;
using System.Collections.Generic;
using System.Linq;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Calculates wind rose sector data from wind observations.
/// Supports 24-hour, daylight-only, nighttime-only, and seasonal breakdowns.
/// 
/// <para>
/// Wind directions are binned into angular sectors and speeds are categorised
/// using the <see cref="WindSpeedCategories"/> breaks (matching the openair R package).
/// Results are expressed as percentages of total records per sector per speed bin.
/// </para>
/// <para>
/// <b>Hemisphere:</b> Season classification uses Southern Hemisphere convention
/// (Summer = Dec-Feb). Daylight classification uses <see cref="DaylightCalculator"/>.
/// </para>
/// </summary>
public static class WindRoseCalculator
{
    /// <summary>
    /// Valid sector angles that evenly divide 360 degrees.
    /// </summary>
    private static readonly HashSet<int> ValidSectorAngles = new() { 5, 6, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 40, 45, 60 };

    /// <summary>
    /// Convert Stratus <see cref="WeatherRecord"/> objects to <see cref="WindDataPoint"/> objects
    /// for wind rose analysis. Wind speed is converted from km/h to m/s.
    /// Records with missing or invalid wind data are excluded.
    /// </summary>
    /// <param name="records">Weather records from station data. Must not be null.</param>
    /// <param name="latitude">Station latitude in decimal degrees for daylight classification.</param>
    /// <returns>List of wind data points with speed in m/s and daylight/season classified.</returns>
    /// <exception cref="ArgumentNullException">Thrown if <paramref name="records"/> is null.</exception>
    public static List<WindDataPoint> ConvertFromWeatherRecords(
        List<WeatherRecord> records, double latitude = -33.0)
    {
        ArgumentNullException.ThrowIfNull(records);

        var points = new List<WindDataPoint>(records.Count);
        foreach (var r in records)
        {
            if (r.WindSpeed == null || r.WindDirection == null) continue;
            if (r.WindDirection < 0 || r.WindDirection > 360) continue;
            if (r.WindSpeed < 0) continue;

            // Wind speed is already in m/s (canonical unit)
            var point = new WindDataPoint
            {
                Date = r.Timestamp,
                WindDirection = r.WindDirection.Value % 360.0, // Normalise 360 -> 0
                WindSpeed = r.WindSpeed.Value,
                Daylight = DaylightCalculator.IsDaylight(r.Timestamp, latitude)
                    ? DaylightType.Daylight
                    : DaylightType.Nighttime,
                Season = ClassifySeason(r.Timestamp.Month)
            };

            points.Add(point);
        }
        return points;
    }

    /// <summary>
    /// Classify month to Southern Hemisphere season.
    /// </summary>
    internal static WindSeason ClassifySeason(int month) => month switch
    {
        12 or 1 or 2 => WindSeason.Summer,
        3 or 4 or 5 => WindSeason.Autumn,
        6 or 7 or 8 => WindSeason.Winter,
        9 or 10 or 11 => WindSeason.Spring,
        _ => WindSeason.Spring
    };

    /// <summary>
    /// Calculate a 24-hour wind rose from all records.
    /// All speeds are converted from m/s to km/h using WMO Simplified Beaufort classes.
    /// </summary>
    /// <param name="records">Wind data points (speed in m/s).</param>
    /// <param name="sectorAngle">Sector angle in degrees. Must evenly divide 360.</param>
    /// <param name="title">Display title for the result.</param>
    /// <returns>Computed wind rose result.</returns>
    public static WindRoseResult Calculate(List<WindDataPoint> records, double sectorAngle,
        string title = "Wind Rose - 24h")
    {
        return ComputeWindRose(records, sectorAngle, title);
    }

    /// <summary>
    /// Calculate a wind rose using only daytime records.
    /// </summary>
    public static WindRoseResult CalculateDaylight(List<WindDataPoint> records, double sectorAngle)
    {
        var filtered = records.Where(r => r.Daylight == DaylightType.Daylight).ToList();
        return ComputeWindRose(filtered, sectorAngle, "Wind Rose - Daylight");
    }

    /// <summary>
    /// Calculate a wind rose using only nighttime records.
    /// </summary>
    public static WindRoseResult CalculateNighttime(List<WindDataPoint> records, double sectorAngle)
    {
        var filtered = records.Where(r => r.Daylight == DaylightType.Nighttime).ToList();
        return ComputeWindRose(filtered, sectorAngle, "Wind Rose - Nighttime");
    }

    /// <summary>
    /// Calculate wind roses for each season. Only seasons with data are included.
    /// </summary>
    /// <returns>Dictionary keyed by <see cref="WindSeason"/> containing each seasonal wind rose.</returns>
    public static Dictionary<WindSeason, WindRoseResult> CalculateSeasonal(List<WindDataPoint> records, double sectorAngle)
    {
        var result = new Dictionary<WindSeason, WindRoseResult>();
        foreach (WindSeason season in Enum.GetValues<WindSeason>())
        {
            var filtered = records.Where(r => r.Season == season).ToList();
            if (filtered.Count > 0)
                result[season] = ComputeWindRose(filtered, sectorAngle, $"Wind Rose - {season}");
        }
        return result;
    }

    /// <summary>
    /// Core wind rose computation. Bins wind records into angular sectors and speed categories,
    /// computing percentages of total records. Speeds are converted from m/s to km/h.
    /// Uses WMO Simplified Beaufort classes matching the Stratus web application.
    /// </summary>
    private static WindRoseResult ComputeWindRose(List<WindDataPoint> records, double sectorAngle, string title)
    {
        ArgumentNullException.ThrowIfNull(records);

        if (records.Count == 0)
            return new WindRoseResult { Title = title, TotalRecords = 0 };

        // Validate sector angle
        int angleInt = (int)sectorAngle;
        if (sectorAngle <= 0 || sectorAngle != angleInt || 360 % angleInt != 0)
        {
            // Fall back to nearest valid angle
            angleInt = ValidSectorAngles.OrderBy(a => Math.Abs(a - sectorAngle)).First();
            sectorAngle = angleInt;
        }

        int numSectors = 360 / angleInt;
        var categories = WindSpeedCategories.Categories;
        int numCategories = categories.Length;

        int[,] bins = new int[numSectors, numCategories];
        int totalCount = records.Count;

        foreach (var record in records)
        {
            double dir = record.WindDirection % 360.0;
            double adjusted = (dir + sectorAngle / 2.0) % 360.0;
            int sectorIndex = (int)(adjusted / sectorAngle) % numSectors;

            // Convert wind speed from m/s to km/h for binning
            double speed = record.WindSpeed * 3.6;

            int catIndex = numCategories - 1; // Default to highest bin
            for (int c = 0; c < numCategories; c++)
            {
                if (speed >= categories[c].Min && speed < categories[c].Max)
                {
                    catIndex = c;
                    break;
                }
            }

            bins[sectorIndex, catIndex]++;
        }

        var sectors = new List<WindRoseSector>(numSectors);
        double maxPercentage = 0;

        for (int s = 0; s < numSectors; s++)
        {
            var sector = new WindRoseSector
            {
                StartAngle = s * sectorAngle - sectorAngle / 2.0,
                EndAngle = s * sectorAngle + sectorAngle / 2.0,
                SpeedBinPercentages = new double[numCategories]
            };

            double sectorTotal = 0;
            for (int c = 0; c < numCategories; c++)
            {
                double pct = (double)bins[s, c] / totalCount * 100.0;
                sector.SpeedBinPercentages[c] = pct;
                sectorTotal += pct;
                sector.TotalCount += bins[s, c];
            }

            if (sectorTotal > maxPercentage)
                maxPercentage = sectorTotal;

            sectors.Add(sector);
        }

        // Calm threshold: first bin upper boundary in km/h, convert back to m/s for comparison
        double calmThresholdMs = categories[0].Max / 3.6;
        int calmCount = records.Count(r => r.WindSpeed < calmThresholdMs);
        double calmPct = (double)calmCount / totalCount * 100.0;

        return new WindRoseResult
        {
            Title = title,
            Sectors = sectors,
            MaxPercentage = maxPercentage,
            TotalRecords = totalCount,
            CalmPercentage = calmPct,
            Unit = WindSpeedUnit.KilometresPerHour
        };
    }
}
