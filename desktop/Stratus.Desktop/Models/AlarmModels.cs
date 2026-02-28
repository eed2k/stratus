using System.Text.Json.Serialization;

namespace Stratus.Desktop.Models;

/// <summary>
/// Alarm threshold definition — matches server alarm schema.
/// </summary>
public class AlarmRule
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("stationId")] public int StationId { get; set; }
    [JsonPropertyName("parameter")] public string Parameter { get; set; } = "";
    [JsonPropertyName("condition")] public string Condition { get; set; } = "above";  // above, below, equals, rate_of_change
    [JsonPropertyName("threshold")] public double Threshold { get; set; }
    [JsonPropertyName("severity")] public string Severity { get; set; } = "warning";  // info, warning, critical
    [JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("cooldownMinutes")] public int CooldownMinutes { get; set; } = 30;
    [JsonPropertyName("createdAt")] public DateTime CreatedAt { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    /// <summary>Display-friendly summary of the alarm rule.</summary>
    public string Summary => $"{Parameter} {Condition} {Threshold} ({Severity})";
}

/// <summary>
/// Alarm event — a triggered alarm instance.
/// </summary>
public class AlarmEvent
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("alarmId")] public int AlarmId { get; set; }
    [JsonPropertyName("stationId")] public int StationId { get; set; }
    [JsonPropertyName("stationName")] public string? StationName { get; set; }
    [JsonPropertyName("parameter")] public string Parameter { get; set; } = "";
    [JsonPropertyName("value")] public double Value { get; set; }
    [JsonPropertyName("threshold")] public double Threshold { get; set; }
    [JsonPropertyName("severity")] public string Severity { get; set; } = "warning";
    [JsonPropertyName("message")] public string? Message { get; set; }
    [JsonPropertyName("acknowledged")] public bool Acknowledged { get; set; }
    [JsonPropertyName("acknowledgedBy")] public string? AcknowledgedBy { get; set; }
    [JsonPropertyName("acknowledgedAt")] public DateTime? AcknowledgedAt { get; set; }
    [JsonPropertyName("triggeredAt")] public DateTime TriggeredAt { get; set; }

    /// <summary>Display text for the alarm grid.</summary>
    public string DisplayText => $"[{Severity.ToUpper()}] {Parameter} = {Value:F2} (threshold: {Threshold:F2}) — {Message}";
}
