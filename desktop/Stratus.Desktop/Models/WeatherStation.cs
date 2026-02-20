namespace Stratus.Desktop.Models;

/// <summary>
/// Represents a weather station in the Stratus system.
/// </summary>
public class WeatherStation
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Location { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public double? Elevation { get; set; }
    public string? StationType { get; set; }
    public string? Endpoint { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime? LastConnected { get; set; }
    public string? Description { get; set; }
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
