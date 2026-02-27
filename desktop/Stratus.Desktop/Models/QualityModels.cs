using System.Text.Json.Serialization;

namespace Stratus.Desktop.Models;

/// <summary>
/// WMO-style quality control flag for a single sensor reading.
/// Follows WMO BUFR Table 033020 conventions.
/// </summary>
public enum QualityFlag
{
    /// <summary>QC not yet applied to this reading.</summary>
    NotChecked = -1,
    /// <summary>Passed all QA checks — data is reliable.</summary>
    Good = 0,
    /// <summary>Marginal — one or more checks raised a warning but data may still be usable.</summary>
    Suspect = 1,
    /// <summary>Failed one or more QA checks — do not use without review.</summary>
    Bad = 2,
    /// <summary>Value is null / sensor not reporting.</summary>
    Missing = 3,
}

/// <summary>
/// Configurable quality-control rule for a single sensor parameter.
/// Evaluated per-record by <see cref="Services.QualityFlagService"/>.
/// </summary>
public class QualityRule
{
    /// <summary>Property name on <see cref="WeatherRecord"/> (e.g. "Temperature").</summary>
    public string SensorField { get; set; } = string.Empty;

    /// <summary>Human-readable name for display.</summary>
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Engineering unit (°C, %, hPa, m/s …).</summary>
    public string Unit { get; set; } = string.Empty;

    // ── Range checks ──
    /// <summary>Plausible physical minimum (Bad if value &lt; this).</summary>
    public double? RangeMin { get; set; }

    /// <summary>Plausible physical maximum (Bad if value &gt; this).</summary>
    public double? RangeMax { get; set; }

    /// <summary>Suspect zone below — value is valid but marginal (Suspect if value &lt; this).</summary>
    public double? SuspectMin { get; set; }

    /// <summary>Suspect zone above — value is valid but marginal (Suspect if value &gt; this).</summary>
    public double? SuspectMax { get; set; }

    // ── Temporal checks (rate-of-change) ──
    /// <summary>Maximum allowed change between consecutive records. Exceeding → Suspect.</summary>
    public double? MaxRateOfChange { get; set; }

    /// <summary>Maximum allowed change between consecutive records (hard fail). Exceeding → Bad.</summary>
    public double? MaxRateOfChangeBad { get; set; }

    // ── Persistence / stuck-sensor check ──
    /// <summary>Number of consecutive identical readings before the sensor is flagged Suspect.</summary>
    public int? PersistenceLimit { get; set; }

    /// <summary>Whether this rule is active. Disabled rules are skipped.</summary>
    public bool IsEnabled { get; set; } = true;
}

/// <summary>
/// The result of QC evaluation for one sensor on one record.
/// </summary>
public class QualityFlagResult
{
    public string SensorField { get; set; } = string.Empty;
    public QualityFlag Flag { get; set; }
    public string Reason { get; set; } = string.Empty;
}

/// <summary>
/// Complete QC evaluation for a single <see cref="WeatherRecord"/>.
/// </summary>
public class RecordQualityResult
{
    public DateTime Timestamp { get; set; }

    /// <summary>Overall flag — worst flag across all sensors.</summary>
    public QualityFlag OverallFlag { get; set; } = QualityFlag.Good;

    /// <summary>Per-sensor flags.</summary>
    public List<QualityFlagResult> SensorFlags { get; set; } = new();

    /// <summary>Count of sensors flagged each level.</summary>
    public int GoodCount => SensorFlags.Count(f => f.Flag == QualityFlag.Good);
    public int SuspectCount => SensorFlags.Count(f => f.Flag == QualityFlag.Suspect);
    public int BadCount => SensorFlags.Count(f => f.Flag == QualityFlag.Bad);
    public int MissingCount => SensorFlags.Count(f => f.Flag == QualityFlag.Missing);
}

/// <summary>
/// Summary report of QC across an entire dataset.
/// </summary>
public class QualitySummary
{
    public int TotalRecords { get; set; }
    public int GoodRecords { get; set; }
    public int SuspectRecords { get; set; }
    public int BadRecords { get; set; }
    public int MissingRecords { get; set; }
    public double GoodPercent => TotalRecords > 0 ? 100.0 * GoodRecords / TotalRecords : 0;
    public double SuspectPercent => TotalRecords > 0 ? 100.0 * SuspectRecords / TotalRecords : 0;
    public double BadPercent => TotalRecords > 0 ? 100.0 * BadRecords / TotalRecords : 0;
    public double DataQualityIndex => TotalRecords > 0 ? 100.0 * (GoodRecords + 0.5 * SuspectRecords) / TotalRecords : 0;

    /// <summary>Per-sensor breakdown.</summary>
    public List<SensorQualitySummary> SensorSummaries { get; set; } = new();
}

/// <summary>
/// Per-sensor QC statistics across a dataset.
/// </summary>
public class SensorQualitySummary
{
    public string SensorField { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public int TotalChecked { get; set; }
    public int GoodCount { get; set; }
    public int SuspectCount { get; set; }
    public int BadCount { get; set; }
    public int MissingCount { get; set; }
    public double GoodPercent => TotalChecked > 0 ? 100.0 * GoodCount / TotalChecked : 0;
    public string MostCommonIssue { get; set; } = string.Empty;
}

/// <summary>
/// Wraps a WeatherRecord with its QC results for DataGrid binding.
/// </summary>
public class QualifiedRecord
{
    public WeatherRecord Record { get; set; } = null!;
    public RecordQualityResult Quality { get; set; } = null!;

    // Convenience bindings
    public DateTime Timestamp => Record.Timestamp;
    public QualityFlag OverallFlag => Quality.OverallFlag;
    public string FlagText => OverallFlag switch
    {
        QualityFlag.Good => "✓",
        QualityFlag.Suspect => "⚠",
        QualityFlag.Bad => "✗",
        QualityFlag.Missing => "–",
        _ => "?"
    };
    public int IssueCount => Quality.SuspectCount + Quality.BadCount;
    public string IssueList => string.Join("; ", Quality.SensorFlags
        .Where(f => f.Flag is QualityFlag.Suspect or QualityFlag.Bad)
        .Select(f => $"{f.SensorField}: {f.Reason}"));

    // Delegate main sensor values so DataGrid can bind directly
    public double? Temperature => Record.Temperature;
    public double? Humidity => Record.Humidity;
    public double? Pressure => Record.Pressure;
    public double? WindSpeed => Record.WindSpeed;
    public double? WindDirection => Record.WindDirection;
    public double? WindGust => Record.WindGust;
    public double? Rainfall => Record.Rainfall;
    public double? SolarRadiation => Record.SolarRadiation;
    public double? BatteryVoltage => Record.BatteryVoltage;
}
