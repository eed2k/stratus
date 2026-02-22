using System.Text.Json.Serialization;

namespace Stratus.Desktop.Models;

/// <summary>
/// Represents a weather station in the Stratus system.
/// JSON property names match the server API response (camelCase from mapPgStation).
/// </summary>
public class WeatherStation
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Location { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    /// <summary>Server returns "altitude" (metres above sea level).</summary>
    [JsonPropertyName("altitude")]
    public double? Elevation { get; set; }

    public string? StationType { get; set; }

    /// <summary>Server returns "apiEndpoint".</summary>
    [JsonPropertyName("apiEndpoint")]
    public string? Endpoint { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>Server returns "lastConnected" (ISO-8601 timestamp).</summary>
    [JsonPropertyName("lastConnected")]
    public DateTime? LastConnected { get; set; }

    /// <summary>Server returns "siteDescription".</summary>
    [JsonPropertyName("siteDescription")]
    public string? Description { get; set; }

    /// <summary>Server returns "stationImage" (base64 or URL).</summary>
    [JsonPropertyName("stationImage")]
    public string? ImageUrl { get; set; }

    /// <summary>
    /// Connection status computed from last connected timestamp.
    /// </summary>
    public ConnectionStatus Status => LastConnected switch
    {
        null => ConnectionStatus.Unknown,
        var t when (DateTime.UtcNow - t.Value).TotalMinutes < 15 => ConnectionStatus.Online,
        var t when (DateTime.UtcNow - t.Value).TotalHours < 1 => ConnectionStatus.Delayed,
        _ => ConnectionStatus.Offline
    };

    public override string ToString() => $"{Name} (ID: {Id})";
}

public enum ConnectionStatus
{
    Online,
    Delayed,
    Offline,
    Unknown
}
