using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Manages software license validation and activation.
/// Uses HMAC-SHA256 key verification with machine-bound activation.
/// </summary>
public class LicenseService
{
    private readonly string _licenseFilePath;
    private LicenseInfo? _cachedLicense;
    
    // License validation secret — loaded from embedded resource or config
    // In production, this should be validated server-side
    private static readonly byte[] LicenseSecret = LoadLicenseSecret();

    private static byte[] LoadLicenseSecret()
    {
        // Try environment variable first, then fall back to a config file
        var secret = Environment.GetEnvironmentVariable("STRATUS_LICENSE_SECRET");
        if (!string.IsNullOrEmpty(secret))
            return Encoding.UTF8.GetBytes(secret);
        
        // Default development placeholder — override for production
        return Encoding.UTF8.GetBytes("CHANGE-ME-IN-PRODUCTION");
    }

    public LicenseService(string appDataPath)
    {
        _licenseFilePath = Path.Combine(appDataPath, "license.dat");
        LoadLicense();
    }

    /// <summary>
    /// Validates a license key and activates if valid.
    /// Key format: XXXX-XXXX-XXXX-XXXX-XXXX (25 chars, 5 groups of 4)
    /// </summary>
    public LicenseActivationResult ActivateLicense(string licenseKey, string holderName, string organization)
    {
        licenseKey = licenseKey.Trim().ToUpperInvariant();

        // Validate format
        if (!IsValidKeyFormat(licenseKey))
        {
            return new LicenseActivationResult
            {
                Success = false,
                Message = "Invalid license key format. Expected: XXXX-XXXX-XXXX-XXXX-XXXX"
            };
        }

        // Validate key integrity (HMAC check on key prefix)
        var keyParts = licenseKey.Split('-');
        var keyBody = string.Join("", keyParts[..4]);
        var checksum = keyParts[4];

        using var hmac = new HMACSHA256(LicenseSecret);
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(keyBody));
        var expectedChecksum = Convert.ToHexString(hash)[..4].ToUpperInvariant();

        if (checksum != expectedChecksum)
        {
            Log.Warning("License key validation failed: invalid checksum");
            return new LicenseActivationResult
            {
                Success = false,
                Message = "Invalid license key. Please verify the key and try again."
            };
        }

        // Determine license type from key prefix
        var licenseType = keyParts[0][..2] switch
        {
            "ST" => LicenseType.Standard,
            "PR" => LicenseType.Professional,
            "EN" => LicenseType.Enterprise,
            _ => LicenseType.Trial
        };

        var maxStations = licenseType switch
        {
            LicenseType.Standard => 5,
            LicenseType.Professional => 25,
            LicenseType.Enterprise => 999,
            _ => 2
        };

        // Lifetime key: if key body contains "LIFE", no expiry
        var isLifetime = keyBody.Contains("LIFE");

        // Create license
        var license = new LicenseInfo
        {
            Key = licenseKey,
            LicenseHolder = holderName,
            Organization = organization,
            ExpiryDate = isLifetime ? null : DateTime.UtcNow.AddYears(1),
            Type = licenseType,
            IsValid = true,
            MaxStations = maxStations
        };

        // Save license
        SaveLicense(license);
        _cachedLicense = license;

        Log.Information("License activated: {Type} for {Holder} ({Org}), max {Stations} stations",
            licenseType, holderName, organization, maxStations);

        return new LicenseActivationResult
        {
            Success = true,
            Message = $"License activated successfully. Type: {licenseType}, Max Stations: {maxStations}",
            License = license
        };
    }

    public bool IsLicenseValid()
    {
        if (_cachedLicense == null) return false;
        if (!_cachedLicense.IsValid) return false;
        if (_cachedLicense.ExpiryDate.HasValue && _cachedLicense.ExpiryDate.Value < DateTime.UtcNow) return false;
        return true;
    }

    public LicenseInfo? GetLicense() => _cachedLicense;

    public LicenseType GetLicenseType() => _cachedLicense?.Type ?? LicenseType.Trial;

    /// <summary>
    /// Generate a trial license for evaluation purposes.
    /// </summary>
    public LicenseInfo GenerateTrialLicense()
    {
        var trial = new LicenseInfo
        {
            Key = "TRIAL",
            LicenseHolder = Environment.UserName,
            Organization = "Trial",
            ExpiryDate = DateTime.UtcNow.AddDays(30),
            Type = LicenseType.Trial,
            IsValid = true,
            MaxStations = 2
        };

        SaveLicense(trial);
        _cachedLicense = trial;

        Log.Information("Trial license generated, expires {Expiry}", trial.ExpiryDate);
        return trial;
    }

    private static bool IsValidKeyFormat(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return false;
        var parts = key.Split('-');
        return parts.Length == 5 && parts.All(p => p.Length == 4);
    }

    private void LoadLicense()
    {
        try
        {
            if (!File.Exists(_licenseFilePath)) return;

            var encrypted = File.ReadAllBytes(_licenseFilePath);
            var json = Encoding.UTF8.GetString(ProtectedData.Unprotect(
                encrypted, LicenseSecret[..16], DataProtectionScope.CurrentUser));
            _cachedLicense = JsonSerializer.Deserialize<LicenseInfo>(json);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load license file");
            _cachedLicense = null;
        }
    }

    private void SaveLicense(LicenseInfo license)
    {
        try
        {
            var json = JsonSerializer.Serialize(license);
            var encrypted = ProtectedData.Protect(
                Encoding.UTF8.GetBytes(json), LicenseSecret[..16], DataProtectionScope.CurrentUser);
            File.WriteAllBytes(_licenseFilePath, encrypted);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save license file");
        }
    }
}

public class LicenseActivationResult
{
    public bool Success { get; set; }
    public string Message { get; set; } = string.Empty;
    public LicenseInfo? License { get; set; }
}
