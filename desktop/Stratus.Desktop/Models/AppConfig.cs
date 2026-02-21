namespace Stratus.Desktop.Models;

/// <summary>
/// Server connection configuration.
/// </summary>
public class ServerConfig
{
    public string BaseUrl { get; set; } = "https://stratusweather.co.za";
    public string? Username { get; set; }
    public string? AuthToken { get; set; }
    public int ApiTimeoutSeconds { get; set; } = 30;
    public string? DirectConnectionString { get; set; }
    public bool UseDirectDb { get; set; }
}

/// <summary>
/// Application license information.
/// </summary>
public class LicenseInfo
{
    public string Key { get; set; } = string.Empty;
    public string? LicenseHolder { get; set; }
    public string? Organization { get; set; }
    public DateTime? ExpiryDate { get; set; }
    public LicenseType Type { get; set; } = LicenseType.Trial;
    public bool IsValid { get; set; }
    public int MaxStations { get; set; } = 2;
}

public enum LicenseType
{
    Trial,
    Standard,
    Professional,
    Enterprise
}
