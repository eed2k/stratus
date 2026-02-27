using System.Text.Json.Serialization;

namespace Stratus.Desktop.Models;

/// <summary>
/// Calibration profile for a sensor channel.
/// Stores correction coefficients and calibration metadata.
/// </summary>
public class CalibrationProfile
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];

    [JsonPropertyName("stationId")]
    public int StationId { get; set; }

    [JsonPropertyName("sensorField")]
    public string SensorField { get; set; } = string.Empty;

    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; } = string.Empty;

    [JsonPropertyName("unit")]
    public string Unit { get; set; } = string.Empty;

    /// <summary>Correction: CorrectedValue = (RawValue * Slope) + Offset</summary>
    [JsonPropertyName("slope")]
    public double Slope { get; set; } = 1.0;

    [JsonPropertyName("offset")]
    public double Offset { get; set; } = 0.0;

    [JsonPropertyName("lastCalibrationDate")]
    public DateTime? LastCalibrationDate { get; set; }

    [JsonPropertyName("nextCalibrationDue")]
    public DateTime? NextCalibrationDue { get; set; }

    /// <summary>Calibration interval in days (e.g. 365 for annual)</summary>
    [JsonPropertyName("calibrationIntervalDays")]
    public int CalibrationIntervalDays { get; set; } = 365;

    [JsonPropertyName("calibratedBy")]
    public string CalibratedBy { get; set; } = string.Empty;

    [JsonPropertyName("certificateRef")]
    public string CertificateReference { get; set; } = string.Empty;

    [JsonPropertyName("notes")]
    public string Notes { get; set; } = string.Empty;

    [JsonPropertyName("isEnabled")]
    public bool IsEnabled { get; set; } = true;

    /// <summary>
    /// Applies correction to a raw reading.
    /// </summary>
    public double Apply(double rawValue) => IsEnabled ? (rawValue * Slope) + Offset : rawValue;

    /// <summary>
    /// Whether the calibration is overdue.
    /// </summary>
    public bool IsOverdue => NextCalibrationDue.HasValue && NextCalibrationDue.Value < DateTime.UtcNow;
}

/// <summary>
/// Audit trail entry for tracking user actions.
/// </summary>
public class AuditEntry
{
    [JsonPropertyName("timestamp")]
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("action")]
    public string Action { get; set; } = string.Empty;

    [JsonPropertyName("category")]
    public AuditCategory Category { get; set; }

    [JsonPropertyName("details")]
    public string Details { get; set; } = string.Empty;

    [JsonPropertyName("user")]
    public string User { get; set; } = string.Empty;

    [JsonPropertyName("stationId")]
    public int? StationId { get; set; }

    public override string ToString()
        => $"[{Timestamp:yyyy-MM-dd HH:mm:ss}] [{Category}] {Action} — {Details}";
}

public enum AuditCategory
{
    System,
    Login,
    DataCollection,
    DataExport,
    StationConfig,
    Calibration,
    Database,
    License,
    Logger,
    Report,
    Settings
}
