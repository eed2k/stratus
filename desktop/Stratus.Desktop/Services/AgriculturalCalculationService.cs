using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Agricultural and meteorological derived calculations for Campbell Scientific
/// weather station data. Provides FAO-56 Penman-Monteith ETo, VPD, heat index,
/// wind chill, wet bulb temperature, growing degree days, chill hours, and
/// data aggregation (hourly/daily/monthly summaries).
/// </summary>
public static class AgriculturalCalculationService
{
    // ══════════════════════════════════════════════════════════════════════
    //  DERIVED PARAMETERS (computed from existing sensor data)
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Saturation vapour pressure (kPa) from temperature using the Tetens formula.
    /// </summary>
    public static double SaturationVapourPressure(double tempC)
        => 0.6108 * Math.Exp(17.27 * tempC / (tempC + 237.3));

    /// <summary>
    /// Actual vapour pressure (kPa) from temperature and relative humidity.
    /// </summary>
    public static double ActualVapourPressure(double tempC, double rhPercent)
        => SaturationVapourPressure(tempC) * (rhPercent / 100.0);

    /// <summary>
    /// Vapour Pressure Deficit (kPa). Key parameter for crop science and greenhouse management.
    /// VPD = es - ea. Typical range: 0.0–4.0 kPa.
    /// </summary>
    public static double VPD(double tempC, double rhPercent)
        => SaturationVapourPressure(tempC) - ActualVapourPressure(tempC, rhPercent);

    /// <summary>
    /// Dew point temperature (°C) from temperature and RH using Magnus formula.
    /// </summary>
    public static double DewPoint(double tempC, double rhPercent)
    {
        double a = 17.27, b = 237.3;
        double gamma = a * tempC / (b + tempC) + Math.Log(rhPercent / 100.0);
        return b * gamma / (a - gamma);
    }

    /// <summary>
    /// Heat Index (°C) using the Rothfusz regression (NWS algorithm).
    /// Valid when T ≥ 27°C and RH ≥ 40%.
    /// </summary>
    public static double? HeatIndex(double tempC, double rhPercent)
    {
        if (tempC < 27) return null; // not applicable below 27°C

        double tf = tempC * 9.0 / 5.0 + 32.0; // convert to Fahrenheit for NWS formula
        double hi = -42.379 + 2.04901523 * tf + 10.14333127 * rhPercent
                    - 0.22475541 * tf * rhPercent - 0.00683783 * tf * tf
                    - 0.05481717 * rhPercent * rhPercent + 0.00122874 * tf * tf * rhPercent
                    + 0.00085282 * tf * rhPercent * rhPercent
                    - 0.00000199 * tf * tf * rhPercent * rhPercent;

        // Adjustment for low humidity
        if (rhPercent < 13 && tf >= 80 && tf <= 112)
            hi -= (13 - rhPercent) / 4.0 * Math.Sqrt((17 - Math.Abs(tf - 95)) / 17.0);

        // Adjustment for high humidity
        if (rhPercent > 85 && tf >= 80 && tf <= 87)
            hi += (rhPercent - 85) / 10.0 * (87 - tf) / 5.0;

        return (hi - 32.0) * 5.0 / 9.0; // back to Celsius
    }

    /// <summary>
    /// Wind Chill (°C) using Environment Canada / NWS formula.
    /// Valid when T ≤ 10°C and wind speed ≥ 4.8 km/h.
    /// Wind speed input in m/s (converted internally to km/h).
    /// </summary>
    public static double? WindChill(double tempC, double windSpeedMs)
    {
        double windKmh = windSpeedMs * 3.6;
        if (tempC > 10 || windKmh < 4.8) return null;

        return 13.12 + 0.6215 * tempC
               - 11.37 * Math.Pow(windKmh, 0.16)
               + 0.3965 * tempC * Math.Pow(windKmh, 0.16);
    }

    /// <summary>
    /// Wet Bulb Temperature (°C) approximation using the Stull formula (2011).
    /// Accurate to ±0.3°C for RH 5–99% and T −20–50°C.
    /// </summary>
    public static double WetBulbTemperature(double tempC, double rhPercent)
    {
        return tempC * Math.Atan(0.151977 * Math.Sqrt(rhPercent + 8.313659))
               + Math.Atan(tempC + rhPercent)
               - Math.Atan(rhPercent - 1.676331)
               + 0.00391838 * Math.Pow(rhPercent, 1.5) * Math.Atan(0.023101 * rhPercent)
               - 4.686035;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  FAO-56 PENMAN-MONTEITH REFERENCE EVAPOTRANSPIRATION
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// FAO-56 Penman-Monteith reference evapotranspiration (mm/day).
    /// Standard method for short grass reference crop.
    /// </summary>
    /// <param name="tempC">Mean daily temperature (°C).</param>
    /// <param name="rhPercent">Mean daily relative humidity (%).</param>
    /// <param name="windSpeedMs">Mean daily wind speed at 2m height (m/s).</param>
    /// <param name="solarRadiation">Daily total solar radiation (MJ/m²/day). Pass W/m² average × 0.0864 to convert.</param>
    /// <param name="tempMinC">Minimum daily temperature (°C).</param>
    /// <param name="tempMaxC">Maximum daily temperature (°C).</param>
    /// <param name="latitudeDeg">Station latitude in decimal degrees.</param>
    /// <param name="elevationM">Station elevation in metres above sea level.</param>
    /// <param name="dayOfYear">Day of year (1-366).</param>
    /// <returns>ETo in mm/day, or null if inputs are insufficient.</returns>
    public static double? PenmanMonteithETo(
        double tempC, double rhPercent, double windSpeedMs, double solarRadiation,
        double tempMinC, double tempMaxC, double latitudeDeg, double elevationM, int dayOfYear)
    {
        if (solarRadiation <= 0 || rhPercent <= 0) return null;

        // Psychrometric constant (kPa/°C)
        double P = 101.3 * Math.Pow((293 - 0.0065 * elevationM) / 293, 5.26); // atmospheric pressure
        double gamma = 0.000665 * P;

        // Slope of saturation vapour pressure curve (kPa/°C)
        double esMax = SaturationVapourPressure(tempMaxC);
        double esMin = SaturationVapourPressure(tempMinC);
        double es = (esMax + esMin) / 2.0;
        double ea = esMin * (rhPercent / 100.0); // conservative: use Tmin for ea
        double delta = 4098 * SaturationVapourPressure(tempC) / Math.Pow(tempC + 237.3, 2);

        // Solar geometry
        double latRad = latitudeDeg * Math.PI / 180.0;
        double dr = 1 + 0.033 * Math.Cos(2 * Math.PI * dayOfYear / 365.0);
        double solarDecl = 0.409 * Math.Sin(2 * Math.PI * dayOfYear / 365.0 - 1.39);
        double ws = Math.Acos(-Math.Tan(latRad) * Math.Tan(solarDecl));

        // Extraterrestrial radiation (MJ/m²/day)
        double Gsc = 0.0820; // solar constant
        double Ra = (24.0 * 60.0 / Math.PI) * Gsc * dr *
            (ws * Math.Sin(latRad) * Math.Sin(solarDecl) +
             Math.Cos(latRad) * Math.Cos(solarDecl) * Math.Sin(ws));

        // Clear-sky radiation
        double Rso = (0.75 + 2e-5 * elevationM) * Ra;

        // Net solar (shortwave) radiation — albedo 0.23
        double Rs = solarRadiation; // already in MJ/m²/day
        double Rns = 0.77 * Rs;

        // Net longwave radiation
        double sigma = 4.903e-9; // Stefan-Boltzmann
        double RsRso = Rso > 0 ? Math.Min(Rs / Rso, 1.0) : 0.5;
        double Rnl = sigma * ((Math.Pow(tempMaxC + 273.16, 4) + Math.Pow(tempMinC + 273.16, 4)) / 2.0)
                     * (0.34 - 0.14 * Math.Sqrt(ea))
                     * (1.35 * RsRso - 0.35);

        double Rn = Rns - Rnl;
        double G = 0; // soil heat flux ≈ 0 for daily

        // FAO-56 equation (grass reference)
        double numerator = 0.408 * delta * (Rn - G) + gamma * (900 / (tempC + 273)) * windSpeedMs * (es - ea);
        double denominator = delta + gamma * (1 + 0.34 * windSpeedMs);

        double eto = numerator / denominator;
        return Math.Max(0, eto);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  GROWING DEGREE DAYS & CHILL HOURS
    // ══════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Growing Degree Days for a single record interval.
    /// GDD = max(0, (Tmax + Tmin) / 2 - Tbase).
    /// Default base: 10°C (most crops). Common alternatives: 0°C (wheat), 5°C (pasture), 30°F/−1.1°C (some models).
    /// </summary>
    public static double GrowingDegreeDays(double tempMinC, double tempMaxC, double tBase = 10.0)
    {
        double avg = (tempMaxC + tempMinC) / 2.0;
        return Math.Max(0, avg - tBase);
    }

    /// <summary>
    /// Chill hours accumulated. Counts hours where temperature is between 0–7.2°C (Utah model simplified).
    /// Returns 1.0 for a qualifying hour, 0.0 otherwise.
    /// </summary>
    public static double ChillHourContribution(double tempC)
    {
        // Utah model simplified: full chill unit for 0–7.2°C
        if (tempC >= 0 && tempC <= 7.2) return 1.0;
        // Partial chill for 7.2–13°C
        if (tempC > 7.2 && tempC <= 13.0) return 0.5;
        // Negative chill for >18°C (cancels accumulation)
        if (tempC > 18.0) return -1.0;
        return 0;
    }

    /// <summary>
    /// Calculate cumulative chill hours from a time-sorted list of records.
    /// </summary>
    public static List<(DateTime Time, double CumulativeChill)> CumulativeChillHours(
        IEnumerable<WeatherRecord> records)
    {
        var result = new List<(DateTime, double)>();
        double cumulative = 0;
        foreach (var r in records)
        {
            if (r.Temperature.HasValue)
            {
                cumulative += ChillHourContribution(r.Temperature.Value);
                cumulative = Math.Max(0, cumulative); // floor at 0
            }
            result.Add((r.Timestamp, cumulative));
        }
        return result;
    }

    /// <summary>
    /// Calculate cumulative GDD from a time-sorted list of daily records.
    /// </summary>
    public static List<(DateTime Date, double CumulativeGDD)> CumulativeGrowingDegreeDays(
        IEnumerable<WeatherRecord> records, double tBase = 10.0)
    {
        var result = new List<(DateTime, double)>();
        double cumulative = 0;
        foreach (var r in records)
        {
            if (r.TemperatureMin.HasValue && r.TemperatureMax.HasValue)
                cumulative += GrowingDegreeDays(r.TemperatureMin.Value, r.TemperatureMax.Value, tBase);
            else if (r.Temperature.HasValue)
                cumulative += Math.Max(0, r.Temperature.Value - tBase);
            result.Add((r.Timestamp.Date, cumulative));
        }
        return result;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  DATA AGGREGATION ENGINE (raw interval → hourly/daily/monthly)
    // ══════════════════════════════════════════════════════════════════════

    public enum AggregationPeriod { Hourly, Daily, Weekly, Monthly }

    /// <summary>
    /// Aggregate raw interval records into summaries (hourly, daily, weekly, or monthly).
    /// Returns one AggregatedRecord per period containing min/max/avg/sum/count for every numeric field.
    /// </summary>
    public static List<AggregatedRecord> Aggregate(
        IEnumerable<WeatherRecord> records, AggregationPeriod period)
    {
        var groups = period switch
        {
            AggregationPeriod.Hourly => records.GroupBy(r => new DateTime(r.Timestamp.Year, r.Timestamp.Month, r.Timestamp.Day, r.Timestamp.Hour, 0, 0, r.Timestamp.Kind)),
            AggregationPeriod.Daily => records.GroupBy(r => r.Timestamp.Date),
            AggregationPeriod.Weekly => records.GroupBy(r => r.Timestamp.Date.AddDays(-(int)r.Timestamp.DayOfWeek)),
            AggregationPeriod.Monthly => records.GroupBy(r => new DateTime(r.Timestamp.Year, r.Timestamp.Month, 1, 0, 0, 0, r.Timestamp.Kind)),
            _ => throw new ArgumentOutOfRangeException(nameof(period))
        };

        return groups.OrderBy(g => g.Key).Select(g =>
        {
            var list = g.ToList();
            return new AggregatedRecord
            {
                PeriodStart = g.Key,
                PeriodLabel = period switch
                {
                    AggregationPeriod.Hourly => g.Key.ToString("yyyy-MM-dd HH:00"),
                    AggregationPeriod.Daily => g.Key.ToString("yyyy-MM-dd"),
                    AggregationPeriod.Weekly => $"Week {g.Key:yyyy-MM-dd}",
                    AggregationPeriod.Monthly => g.Key.ToString("yyyy-MM"),
                    _ => g.Key.ToString("yyyy-MM-dd")
                },
                RecordCount = list.Count,

                // Temperature
                TemperatureAvg = Avg(list, r => r.Temperature),
                TemperatureMin = Min(list, r => r.Temperature),
                TemperatureMax = Max(list, r => r.Temperature),

                // Humidity
                HumidityAvg = Avg(list, r => r.Humidity),
                HumidityMin = Min(list, r => r.Humidity),
                HumidityMax = Max(list, r => r.Humidity),

                // Pressure
                PressureAvg = Avg(list, r => r.Pressure),
                PressureMin = Min(list, r => r.Pressure),
                PressureMax = Max(list, r => r.Pressure),

                // Wind
                WindSpeedAvg = Avg(list, r => r.WindSpeed),
                WindSpeedMax = Max(list, r => r.WindSpeed),
                WindGustMax = Max(list, r => r.WindGust),

                // Rainfall — SUM for totals
                RainfallTotal = Sum(list, r => r.Rainfall),

                // Solar
                SolarRadiationAvg = Avg(list, r => r.SolarRadiation),
                SolarRadiationMax = Max(list, r => r.SolarRadiation),

                // ETo — SUM for daily/period total
                EtoTotal = Sum(list, r => r.Eto),

                // Dew Point
                DewPointAvg = Avg(list, r => r.DewPoint),

                // Soil
                SoilTemperatureAvg = Avg(list, r => r.SoilTemperature),
                SoilMoistureAvg = Avg(list, r => r.SoilMoisture),

                // Battery
                BatteryVoltageMin = Min(list, r => r.BatteryVoltage),
                BatteryVoltageAvg = Avg(list, r => r.BatteryVoltage),

                // Derived — computed from averages
                VPD = list.All(r => r.Temperature.HasValue && r.Humidity.HasValue)
                    ? AgriculturalCalculationService.VPD(Avg(list, r => r.Temperature)!.Value, Avg(list, r => r.Humidity)!.Value)
                    : null,
            };
        }).ToList();
    }

    /// <summary>
    /// Calculate cumulative rainfall from time-sorted records.
    /// </summary>
    public static List<(DateTime Time, double CumulativeRainfall)> CumulativeRainfall(
        IEnumerable<WeatherRecord> records)
    {
        var result = new List<(DateTime, double)>();
        double cumulative = 0;
        foreach (var r in records.OrderBy(r => r.Timestamp))
        {
            cumulative += r.Rainfall ?? 0;
            result.Add((r.Timestamp, cumulative));
        }
        return result;
    }

    // ── Helpers ──

    private static double? Avg(List<WeatherRecord> records, Func<WeatherRecord, double?> sel)
    {
        var vals = records.Select(sel).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return vals.Count > 0 ? vals.Average() : null;
    }

    private static double? Min(List<WeatherRecord> records, Func<WeatherRecord, double?> sel)
    {
        var vals = records.Select(sel).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return vals.Count > 0 ? vals.Min() : null;
    }

    private static double? Max(List<WeatherRecord> records, Func<WeatherRecord, double?> sel)
    {
        var vals = records.Select(sel).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return vals.Count > 0 ? vals.Max() : null;
    }

    private static double? Sum(List<WeatherRecord> records, Func<WeatherRecord, double?> sel)
    {
        var vals = records.Select(sel).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return vals.Count > 0 ? vals.Sum() : null;
    }
}

/// <summary>
/// Represents an aggregated weather data summary for a time period.
/// </summary>
public class AggregatedRecord
{
    public DateTime PeriodStart { get; set; }
    public string PeriodLabel { get; set; } = "";
    public int RecordCount { get; set; }

    // Temperature
    public double? TemperatureAvg { get; set; }
    public double? TemperatureMin { get; set; }
    public double? TemperatureMax { get; set; }

    // Humidity
    public double? HumidityAvg { get; set; }
    public double? HumidityMin { get; set; }
    public double? HumidityMax { get; set; }

    // Pressure
    public double? PressureAvg { get; set; }
    public double? PressureMin { get; set; }
    public double? PressureMax { get; set; }

    // Wind
    public double? WindSpeedAvg { get; set; }
    public double? WindSpeedMax { get; set; }
    public double? WindGustMax { get; set; }

    // Rainfall
    public double? RainfallTotal { get; set; }

    // Solar
    public double? SolarRadiationAvg { get; set; }
    public double? SolarRadiationMax { get; set; }

    // ETo
    public double? EtoTotal { get; set; }

    // Dew Point
    public double? DewPointAvg { get; set; }

    // Soil
    public double? SoilTemperatureAvg { get; set; }
    public double? SoilMoistureAvg { get; set; }

    // Battery
    public double? BatteryVoltageMin { get; set; }
    public double? BatteryVoltageAvg { get; set; }

    // Derived
    public double? VPD { get; set; }
}
