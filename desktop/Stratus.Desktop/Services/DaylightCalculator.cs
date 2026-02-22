using System;

namespace Stratus.Desktop.Services;

/// <summary>
/// Simplified daylight calculator using solar declination and hour angle.
/// Provides sunrise/sunset estimates based on latitude for classifying wind records
/// as daylight or nighttime measurements.
/// 
/// <para>
/// <b>Limitations (documented for research transparency):</b>
/// <list type="bullet">
///   <item>Longitude is not considered; times are approximate solar noon-centred values.</item>
///   <item>Declination uses the simplified Spencer formula (accuracy ~1°, ~4 min sunrise/sunset).</item>
///   <item>Atmospheric refraction and elevation corrections are not applied.</item>
///   <item>Timestamps are assumed to be in local solar time. If data is in UTC, the classification
///         may be offset by the timezone difference (e.g., ~2 hours for South Africa UTC+2).</item>
/// </list>
/// For most wind resource assessment applications, the daylight/nighttime split is used for
/// broad classification and these approximations are acceptable.
/// </para>
/// </summary>
public static class DaylightCalculator
{
    /// <summary>Default latitude in degrees (negative = Southern Hemisphere). Set for South Africa.</summary>
    private const double DefaultLatitude = -33.0;

    /// <summary>
    /// Determines whether the given timestamp falls during daylight hours.
    /// </summary>
    /// <param name="dateTime">Timestamp of the measurement.</param>
    /// <param name="latitude">Station latitude in decimal degrees (negative for Southern Hemisphere).</param>
    /// <returns><c>true</c> if the time is between sunrise and sunset; <c>false</c> otherwise.</returns>
    public static bool IsDaylight(DateTime dateTime, double latitude = DefaultLatitude)
    {
        var (sunrise, sunset) = GetSunriseSunset(dateTime, latitude);
        double hour = dateTime.Hour + dateTime.Minute / 60.0 + dateTime.Second / 3600.0;
        return hour >= sunrise && hour < sunset;
    }

    /// <summary>
    /// Calculates approximate sunrise and sunset times in decimal hours (solar time).
    /// Uses simplified solar declination and hour angle formula.
    /// </summary>
    /// <param name="date">Date for the calculation.</param>
    /// <param name="latitude">Station latitude in decimal degrees.</param>
    /// <returns>
    /// Tuple of (Sunrise, Sunset) in decimal hours (e.g., 6.5 = 06:30).
    /// For polar night conditions, returns (12.0, 12.0) — always dark.
    /// For midnight sun conditions, returns (0.0, 24.0) — always light.
    /// </returns>
    public static (double Sunrise, double Sunset) GetSunriseSunset(DateTime date, double latitude = DefaultLatitude)
    {
        int dayOfYear = date.DayOfYear;
        double daysInYear = DateTime.IsLeapYear(date.Year) ? 366.0 : 365.0;
        double declination = 23.45 * Math.Sin(2.0 * Math.PI * (284 + dayOfYear) / daysInYear);

        double latRad = latitude * Math.PI / 180.0;
        double decRad = declination * Math.PI / 180.0;

        double cosHourAngle = -Math.Tan(latRad) * Math.Tan(decRad);

        if (cosHourAngle > 1.0)
            return (12.0, 12.0); // Polar night: sun never rises
        if (cosHourAngle < -1.0)
            return (0.0, 24.0);  // Midnight sun: sun never sets

        double hourAngle = Math.Acos(cosHourAngle) * 180.0 / Math.PI;
        double sunrise = 12.0 - hourAngle / 15.0;
        double sunset = 12.0 + hourAngle / 15.0;

        return (sunrise, sunset);
    }
}
