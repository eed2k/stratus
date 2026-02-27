using System.IO;
using System.Reflection;
using System.Text.Json;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Quality Control / Quality Assurance engine.
/// Evaluates weather records against configurable rules using WMO-style
/// range checks, rate-of-change tests, and stuck-sensor (persistence) detection.
/// Rules are persisted to %APPDATA%\Stratus\qc_rules.json.
/// </summary>
public class QualityFlagService
{
    private readonly string _rulesPath;
    private List<QualityRule> _rules;
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    // Reflection cache: property name → PropertyInfo on WeatherRecord
    private static readonly Dictionary<string, PropertyInfo> _propCache = new();

    static QualityFlagService()
    {
        foreach (var p in typeof(WeatherRecord).GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            if (p.PropertyType == typeof(double?))
                _propCache[p.Name] = p;
        }
    }

    public IReadOnlyList<QualityRule> Rules => _rules.AsReadOnly();

    public event EventHandler? RulesChanged;

    public QualityFlagService(string appDataPath)
    {
        _rulesPath = Path.Combine(appDataPath, "qc_rules.json");
        _rules = LoadRules();
        Log.Information("QualityFlagService initialised with {Count} rules from {Path}", _rules.Count, _rulesPath);
    }

    #region Rule Management

    /// <summary>Returns default WMO-aligned rules for common meteorological sensors.</summary>
    public static List<QualityRule> GetDefaultRules() => new()
    {
        new QualityRule { SensorField = "Temperature", DisplayName = "Air Temperature", Unit = "°C",
            RangeMin = -50, RangeMax = 60, SuspectMin = -40, SuspectMax = 50,
            MaxRateOfChange = 5, MaxRateOfChangeBad = 15, PersistenceLimit = 12 },

        new QualityRule { SensorField = "Humidity", DisplayName = "Relative Humidity", Unit = "%",
            RangeMin = 0, RangeMax = 103, SuspectMin = 2, SuspectMax = 100,
            MaxRateOfChange = 20, MaxRateOfChangeBad = 50, PersistenceLimit = 24 },

        new QualityRule { SensorField = "Pressure", DisplayName = "Barometric Pressure", Unit = "hPa",
            RangeMin = 870, RangeMax = 1084, SuspectMin = 920, SuspectMax = 1060,
            MaxRateOfChange = 3, MaxRateOfChangeBad = 10, PersistenceLimit = 6 },

        new QualityRule { SensorField = "WindSpeed", DisplayName = "Wind Speed", Unit = "m/s",
            RangeMin = 0, RangeMax = 75, SuspectMin = 0, SuspectMax = 50,
            MaxRateOfChange = 15, MaxRateOfChangeBad = 40, PersistenceLimit = 30 },

        new QualityRule { SensorField = "WindDirection", DisplayName = "Wind Direction", Unit = "°",
            RangeMin = 0, RangeMax = 360, PersistenceLimit = 30 },

        new QualityRule { SensorField = "WindGust", DisplayName = "Wind Gust", Unit = "m/s",
            RangeMin = 0, RangeMax = 100, SuspectMax = 65, MaxRateOfChangeBad = 50 },

        new QualityRule { SensorField = "Rainfall", DisplayName = "Rainfall (interval)", Unit = "mm",
            RangeMin = 0, RangeMax = 100, SuspectMax = 50 },

        new QualityRule { SensorField = "SolarRadiation", DisplayName = "Solar Radiation", Unit = "W/m²",
            RangeMin = 0, RangeMax = 1500, SuspectMin = 0, SuspectMax = 1361,
            MaxRateOfChange = 500, PersistenceLimit = 12 },

        new QualityRule { SensorField = "UvIndex", DisplayName = "UV Index", Unit = "",
            RangeMin = 0, RangeMax = 16, SuspectMax = 12 },

        new QualityRule { SensorField = "DewPoint", DisplayName = "Dew Point", Unit = "°C",
            RangeMin = -60, RangeMax = 50, SuspectMin = -50, SuspectMax = 40 },

        new QualityRule { SensorField = "SoilTemperature", DisplayName = "Soil Temperature", Unit = "°C",
            RangeMin = -30, RangeMax = 70, SuspectMin = -20, SuspectMax = 55,
            MaxRateOfChange = 3, PersistenceLimit = 24 },

        new QualityRule { SensorField = "SoilMoisture", DisplayName = "Soil Moisture", Unit = "%",
            RangeMin = 0, RangeMax = 100, SuspectMin = 1, SuspectMax = 95,
            PersistenceLimit = 48 },

        new QualityRule { SensorField = "BatteryVoltage", DisplayName = "Battery Voltage", Unit = "V",
            RangeMin = 0, RangeMax = 18, SuspectMin = 11, SuspectMax = 15.5,
            MaxRateOfChange = 2 },

        new QualityRule { SensorField = "Pm25", DisplayName = "PM2.5", Unit = "µg/m³",
            RangeMin = 0, RangeMax = 1000, SuspectMax = 500, PersistenceLimit = 12 },

        new QualityRule { SensorField = "Co2", DisplayName = "CO₂", Unit = "ppm",
            RangeMin = 200, RangeMax = 5000, SuspectMin = 300, SuspectMax = 2000 },
    };

    public void AddRule(QualityRule rule)
    {
        _rules.Add(rule);
        SaveRules();
        RulesChanged?.Invoke(this, EventArgs.Empty);
    }

    public void UpdateRule(QualityRule rule)
    {
        var idx = _rules.FindIndex(r => r.SensorField == rule.SensorField);
        if (idx >= 0) _rules[idx] = rule;
        else _rules.Add(rule);
        SaveRules();
        RulesChanged?.Invoke(this, EventArgs.Empty);
    }

    public void RemoveRule(string sensorField)
    {
        _rules.RemoveAll(r => r.SensorField == sensorField);
        SaveRules();
        RulesChanged?.Invoke(this, EventArgs.Empty);
    }

    public void ResetToDefaults()
    {
        _rules = GetDefaultRules();
        SaveRules();
        RulesChanged?.Invoke(this, EventArgs.Empty);
    }

    public void SaveRules()
    {
        try
        {
            File.WriteAllText(_rulesPath, JsonSerializer.Serialize(_rules, JsonOpts));
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to save QC rules");
        }
    }

    private List<QualityRule> LoadRules()
    {
        try
        {
            if (File.Exists(_rulesPath))
            {
                var json = File.ReadAllText(_rulesPath);
                return JsonSerializer.Deserialize<List<QualityRule>>(json, JsonOpts) ?? GetDefaultRules();
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load QC rules, using defaults");
        }
        return GetDefaultRules();
    }

    #endregion

    #region QC Evaluation

    /// <summary>
    /// Evaluate a single record against all enabled rules.
    /// </summary>
    public RecordQualityResult Evaluate(WeatherRecord record, WeatherRecord? previous = null)
    {
        var result = new RecordQualityResult { Timestamp = record.Timestamp };

        foreach (var rule in _rules.Where(r => r.IsEnabled))
        {
            var flag = EvaluateSensor(record, previous, rule);
            result.SensorFlags.Add(flag);
            if (flag.Flag > result.OverallFlag)
                result.OverallFlag = flag.Flag;
        }

        return result;
    }

    /// <summary>
    /// Evaluate a dataset (ordered by timestamp ascending).
    /// Applies range, rate-of-change, and persistence checks.
    /// </summary>
    public List<RecordQualityResult> EvaluateDataset(IReadOnlyList<WeatherRecord> records)
    {
        if (records.Count == 0) return new();

        var ordered = records.OrderBy(r => r.Timestamp).ToList();
        var results = new List<RecordQualityResult>(ordered.Count);

        // First pass: range + rate-of-change
        RecordQualityResult? prev = null;
        for (int i = 0; i < ordered.Count; i++)
        {
            var prevRecord = i > 0 ? ordered[i - 1] : null;
            var qr = Evaluate(ordered[i], prevRecord);
            results.Add(qr);
            prev = qr;
        }

        // Second pass: persistence (stuck-sensor) check
        ApplyPersistenceChecks(ordered, results);

        return results;
    }

    /// <summary>
    /// Generate a dataset-wide quality summary.
    /// </summary>
    public QualitySummary Summarise(IReadOnlyList<WeatherRecord> records, List<RecordQualityResult>? precomputed = null)
    {
        var results = precomputed ?? EvaluateDataset(records);

        var summary = new QualitySummary
        {
            TotalRecords = results.Count,
            GoodRecords = results.Count(r => r.OverallFlag == QualityFlag.Good),
            SuspectRecords = results.Count(r => r.OverallFlag == QualityFlag.Suspect),
            BadRecords = results.Count(r => r.OverallFlag == QualityFlag.Bad),
            MissingRecords = results.Count(r => r.OverallFlag == QualityFlag.Missing),
        };

        // Per-sensor breakdown
        var sensorFields = _rules.Where(r => r.IsEnabled).Select(r => r.SensorField).ToList();
        foreach (var field in sensorFields)
        {
            var rule = _rules.First(r => r.SensorField == field);
            var allFlags = results.SelectMany(r => r.SensorFlags).Where(f => f.SensorField == field).ToList();
            if (allFlags.Count == 0) continue;

            var issues = allFlags
                .Where(f => f.Flag is QualityFlag.Suspect or QualityFlag.Bad)
                .GroupBy(f => f.Reason)
                .OrderByDescending(g => g.Count())
                .FirstOrDefault();

            summary.SensorSummaries.Add(new SensorQualitySummary
            {
                SensorField = field,
                DisplayName = rule.DisplayName,
                TotalChecked = allFlags.Count,
                GoodCount = allFlags.Count(f => f.Flag == QualityFlag.Good),
                SuspectCount = allFlags.Count(f => f.Flag == QualityFlag.Suspect),
                BadCount = allFlags.Count(f => f.Flag == QualityFlag.Bad),
                MissingCount = allFlags.Count(f => f.Flag == QualityFlag.Missing),
                MostCommonIssue = issues?.Key ?? "—",
            });
        }

        return summary;
    }

    private QualityFlagResult EvaluateSensor(WeatherRecord record, WeatherRecord? previous, QualityRule rule)
    {
        var result = new QualityFlagResult { SensorField = rule.SensorField };

        if (!_propCache.TryGetValue(rule.SensorField, out var prop))
        {
            result.Flag = QualityFlag.NotChecked;
            result.Reason = "Unknown field";
            return result;
        }

        var value = (double?)prop.GetValue(record);

        // ── Missing check ──
        if (value is null)
        {
            result.Flag = QualityFlag.Missing;
            result.Reason = "Null/missing value";
            return result;
        }

        double v = value.Value;

        // ── Hard range check (Bad) ──
        if (rule.RangeMin.HasValue && v < rule.RangeMin.Value)
        {
            result.Flag = QualityFlag.Bad;
            result.Reason = $"Below minimum ({v:F2} < {rule.RangeMin.Value})";
            return result;
        }
        if (rule.RangeMax.HasValue && v > rule.RangeMax.Value)
        {
            result.Flag = QualityFlag.Bad;
            result.Reason = $"Above maximum ({v:F2} > {rule.RangeMax.Value})";
            return result;
        }

        // ── Soft range check (Suspect) ──
        if (rule.SuspectMin.HasValue && v < rule.SuspectMin.Value)
        {
            result.Flag = QualityFlag.Suspect;
            result.Reason = $"Near lower bound ({v:F2} < {rule.SuspectMin.Value})";
            return result;
        }
        if (rule.SuspectMax.HasValue && v > rule.SuspectMax.Value)
        {
            result.Flag = QualityFlag.Suspect;
            result.Reason = $"Near upper bound ({v:F2} > {rule.SuspectMax.Value})";
            return result;
        }

        // ── Rate-of-change check ──
        if (previous != null)
        {
            var prevVal = (double?)prop.GetValue(previous);
            if (prevVal.HasValue)
            {
                double delta = Math.Abs(v - prevVal.Value);

                if (rule.MaxRateOfChangeBad.HasValue && delta > rule.MaxRateOfChangeBad.Value)
                {
                    result.Flag = QualityFlag.Bad;
                    result.Reason = $"Spike (Δ{delta:F2} > {rule.MaxRateOfChangeBad.Value})";
                    return result;
                }
                if (rule.MaxRateOfChange.HasValue && delta > rule.MaxRateOfChange.Value)
                {
                    result.Flag = QualityFlag.Suspect;
                    result.Reason = $"Rapid change (Δ{delta:F2} > {rule.MaxRateOfChange.Value})";
                    return result;
                }
            }
        }

        // Passed all checks
        result.Flag = QualityFlag.Good;
        return result;
    }

    /// <summary>
    /// Scans each sensor for consecutive identical readings exceeding the persistence limit.
    /// Promotes Good/Suspect flags to Suspect for affected records.
    /// </summary>
    private void ApplyPersistenceChecks(List<WeatherRecord> ordered, List<RecordQualityResult> results)
    {
        foreach (var rule in _rules.Where(r => r.IsEnabled && r.PersistenceLimit.HasValue))
        {
            if (!_propCache.TryGetValue(rule.SensorField, out var prop)) continue;

            int runLength = 1;
            double? lastValue = null;
            int runStart = 0;

            for (int i = 0; i < ordered.Count; i++)
            {
                var v = (double?)prop.GetValue(ordered[i]);
                if (v.HasValue && lastValue.HasValue && Math.Abs(v.Value - lastValue.Value) < 1e-9)
                {
                    runLength++;
                }
                else
                {
                    // End of a run — flag if exceeded limit
                    if (runLength >= rule.PersistenceLimit!.Value)
                        FlagPersistenceRun(results, rule.SensorField, runStart, i - 1, runLength);
                    runLength = 1;
                    runStart = i;
                }
                lastValue = v;
            }
            // Final run at end of dataset
            if (runLength >= rule.PersistenceLimit!.Value)
                FlagPersistenceRun(results, rule.SensorField, runStart, ordered.Count - 1, runLength);
        }
    }

    private static void FlagPersistenceRun(List<RecordQualityResult> results, string sensorField,
        int startIdx, int endIdx, int runLength)
    {
        for (int i = startIdx; i <= endIdx && i < results.Count; i++)
        {
            var sf = results[i].SensorFlags.FirstOrDefault(f => f.SensorField == sensorField);
            if (sf != null && sf.Flag < QualityFlag.Suspect)
            {
                sf.Flag = QualityFlag.Suspect;
                sf.Reason = $"Stuck sensor ({runLength} identical readings)";
                // Re-evaluate overall
                results[i].OverallFlag = results[i].SensorFlags.Max(f => f.Flag);
            }
        }
    }

    #endregion

    #region Sensor Field Registry

    /// <summary>
    /// All numeric sensor fields available on <see cref="WeatherRecord"/>
    /// with user-friendly names.
    /// </summary>
    public static IReadOnlyList<(string Field, string Display, string Unit)> GetAllSensorFields() => new[]
    {
        ("Temperature", "Air Temperature", "°C"),
        ("TemperatureMin", "Temperature Min", "°C"),
        ("TemperatureMax", "Temperature Max", "°C"),
        ("Humidity", "Relative Humidity", "%"),
        ("Pressure", "Barometric Pressure", "hPa"),
        ("PressureSeaLevel", "Sea-Level Pressure", "hPa"),
        ("DewPoint", "Dew Point", "°C"),
        ("AirDensity", "Air Density", "kg/m³"),
        ("WindSpeed", "Wind Speed", "m/s"),
        ("WindDirection", "Wind Direction", "°"),
        ("WindGust", "Wind Gust", "m/s"),
        ("WindGust10min", "Wind Gust (10 min)", "m/s"),
        ("WindPower", "Wind Power", "W/m²"),
        ("WindDirStdDev", "Wind Dir Std Dev", "°"),
        ("Rainfall", "Rainfall (interval)", "mm"),
        ("Rainfall10min", "Rainfall (10 min)", "mm"),
        ("Rainfall24h", "Rainfall (24h)", "mm"),
        ("SolarRadiation", "Solar Radiation", "W/m²"),
        ("SolarRadiationMax", "Solar Radiation Max", "W/m²"),
        ("UvIndex", "UV Index", ""),
        ("Eto", "Evapotranspiration", "mm"),
        ("SoilTemperature", "Soil Temperature", "°C"),
        ("SoilMoisture", "Soil Moisture", "%"),
        ("LeafWetness", "Leaf Wetness", ""),
        ("BatteryVoltage", "Battery Voltage", "V"),
        ("PanelTemperature", "Panel Temperature", "°C"),
        ("ChargerVoltage", "Charger Voltage", "V"),
        ("Pm25", "PM2.5", "µg/m³"),
        ("Pm10", "PM10", "µg/m³"),
        ("Pm1", "PM1.0", "µg/m³"),
        ("Co2", "CO₂", "ppm"),
        ("Tvoc", "TVOC", "ppb"),
        ("WaterLevel", "Water Level", "mm"),
    };

    #endregion
}
