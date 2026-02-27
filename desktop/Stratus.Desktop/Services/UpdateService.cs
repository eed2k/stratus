using System.IO;
using System.Net.Http;
using System.Text.Json;
using Serilog;

namespace Stratus.Desktop.Services;

/// <summary>
/// Checks for application updates from a GitHub releases endpoint or custom update server.
/// Downloads and stages update packages for installation on next restart.
/// </summary>
public class UpdateService
{
    private readonly string _appDataPath;
    private readonly HttpClient _http;

    // Defaults to GitHub releases API — can be overridden
    public string UpdateUrl { get; set; } = "https://api.github.com/repos/eed2k/stratus/releases/latest";

    public Version CurrentVersion { get; }

    public event EventHandler<UpdateInfo>? UpdateAvailable;
    public event EventHandler<string>? StatusChanged;
    public event EventHandler<int>? DownloadProgressChanged;

    public UpdateService(string appDataPath)
    {
        _appDataPath = appDataPath;
        CurrentVersion = typeof(UpdateService).Assembly.GetName().Version ?? new Version(1, 1, 0);
        _http = new HttpClient();
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("Stratus-Desktop/1.0");
    }

    /// <summary>
    /// Checks the remote endpoint for a newer version.
    /// </summary>
    public async Task<UpdateInfo?> CheckForUpdateAsync()
    {
        try
        {
            StatusChanged?.Invoke(this, "Checking for updates...");
            Log.Information("Checking for updates at {Url}", UpdateUrl);

            var response = await _http.GetStringAsync(UpdateUrl);
            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;

            var tagName = root.GetProperty("tag_name").GetString() ?? "";
            var versionStr = tagName.TrimStart('v', 'V');
            if (!Version.TryParse(versionStr, out var remoteVersion))
            {
                Log.Warning("Could not parse remote version: {Tag}", tagName);
                StatusChanged?.Invoke(this, "Could not determine remote version");
                return null;
            }

            var info = new UpdateInfo
            {
                Version = remoteVersion,
                TagName = tagName,
                ReleaseNotes = root.GetProperty("body").GetString() ?? "",
                PublishedAt = root.TryGetProperty("published_at", out var pub) ? pub.GetString() ?? "" : "",
                IsNewer = remoteVersion > CurrentVersion,
            };

            // Find Windows asset
            if (root.TryGetProperty("assets", out var assets))
            {
                foreach (var asset in assets.EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString() ?? "";
                    if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                        name.EndsWith(".msi", StringComparison.OrdinalIgnoreCase) ||
                        name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        info.DownloadUrl = asset.GetProperty("browser_download_url").GetString() ?? "";
                        info.FileName = name;
                        info.FileSize = asset.TryGetProperty("size", out var size) ? size.GetInt64() : 0;
                        break;
                    }
                }
            }

            Log.Information("Update check: Current={Current} Remote={Remote} Newer={IsNewer}",
                CurrentVersion, remoteVersion, info.IsNewer);

            if (info.IsNewer)
            {
                StatusChanged?.Invoke(this, $"Update available: v{remoteVersion}");
                UpdateAvailable?.Invoke(this, info);
            }
            else
            {
                StatusChanged?.Invoke(this, "You are running the latest version");
            }

            return info;
        }
        catch (HttpRequestException ex)
        {
            Log.Warning(ex, "Update check failed (network)");
            StatusChanged?.Invoke(this, "Update check failed: network error");
            return null;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Update check failed");
            StatusChanged?.Invoke(this, "Update check failed");
            return null;
        }
    }

    /// <summary>
    /// Downloads the update installer to a temporary location.
    /// </summary>
    public async Task<string?> DownloadUpdateAsync(UpdateInfo info)
    {
        if (string.IsNullOrEmpty(info.DownloadUrl)) return null;

        try
        {
            var updateDir = Path.Combine(_appDataPath, "Updates");
            Directory.CreateDirectory(updateDir);
            var filePath = Path.Combine(updateDir, info.FileName ?? $"Stratus-Update-{info.Version}.exe");

            StatusChanged?.Invoke(this, $"Downloading update v{info.Version}...");
            Log.Information("Downloading update from {Url}", info.DownloadUrl);

            using var response = await _http.GetAsync(info.DownloadUrl, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();

            var totalBytes = response.Content.Headers.ContentLength ?? info.FileSize;
            long downloadedBytes = 0;

            using var contentStream = await response.Content.ReadAsStreamAsync();
            using var fileStream = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None, 81920);
            var buffer = new byte[81920];
            int bytesRead;

            while ((bytesRead = await contentStream.ReadAsync(buffer)) > 0)
            {
                await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead));
                downloadedBytes += bytesRead;

                if (totalBytes > 0)
                {
                    var progress = (int)(downloadedBytes * 100 / totalBytes);
                    DownloadProgressChanged?.Invoke(this, progress);
                }
            }

            Log.Information("Update downloaded to {Path} ({Size:N0} bytes)", filePath, downloadedBytes);
            StatusChanged?.Invoke(this, "Update downloaded. Restart to install.");
            return filePath;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to download update");
            StatusChanged?.Invoke(this, "Update download failed");
            return null;
        }
    }

    /// <summary>
    /// Launches the downloaded installer and exits the application.
    /// </summary>
    public static void LaunchInstallerAndExit(string installerPath)
    {
        try
        {
            Log.Information("Launching installer: {Path}", installerPath);
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = installerPath,
                UseShellExecute = true,
            });
            System.Windows.Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to launch installer");
        }
    }
}

public class UpdateInfo
{
    public Version Version { get; set; } = new(0, 0, 0);
    public string TagName { get; set; } = string.Empty;
    public string ReleaseNotes { get; set; } = string.Empty;
    public string PublishedAt { get; set; } = string.Empty;
    public bool IsNewer { get; set; }
    public string DownloadUrl { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public long FileSize { get; set; }
}
