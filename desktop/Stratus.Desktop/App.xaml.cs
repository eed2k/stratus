using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Extensions.Configuration;
using Serilog;
using Stratus.Desktop.Services;
using Stratus.Desktop.Views;

namespace Stratus.Desktop;

public partial class App : Application
{
    private static IConfiguration? _configuration;
    public static IConfiguration Configuration => _configuration
        ?? throw new InvalidOperationException("Configuration not initialized");

    public static LicenseService LicenseService { get; private set; } = null!;
    public static ApiService ApiService { get; private set; } = null!;
    public static DatabaseService DatabaseService { get; private set; } = null!;
    public static DataAcquisitionService DataAcquisitionService { get; private set; } = null!;

    private void Application_Startup(object sender, StartupEventArgs e)
    {
        // Ensure app data directories exist
        var appData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Stratus");
        Directory.CreateDirectory(appData);
        Directory.CreateDirectory(Path.Combine(appData, "Logs"));
        Directory.CreateDirectory(Path.Combine(appData, "Data"));
        Directory.CreateDirectory(Path.Combine(appData, "Export"));

        // Configure Serilog
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Information()
            .WriteTo.File(
                Path.Combine(appData, "Logs", "stratus-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30,
                outputTemplate: "{Timestamp:yyyy-MM-dd HH:mm:ss.fff} [{Level:u3}] {Message:lj}{NewLine}{Exception}")
            .WriteTo.Console()
            .CreateLogger();

        Log.Information("Stratus Desktop v{Version} starting", 
            typeof(App).Assembly.GetName().Version);

        // Load configuration
        // Always refresh cached config from built-in defaults to prevent stale URLs
        var configPath = Path.Combine(appData, "appsettings.json");
        var defaultConfig = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "appsettings.json");
        if (File.Exists(defaultConfig))
            File.Copy(defaultConfig, configPath, overwrite: true);

        _configuration = new ConfigurationBuilder()
            .SetBasePath(AppDomain.CurrentDomain.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: true)
            .Build();

        // Initialize services
        LicenseService = new LicenseService(appData);
        ApiService = new ApiService(Configuration);
        DatabaseService = new DatabaseService(Configuration);
        DataAcquisitionService = new DataAcquisitionService(ApiService, DatabaseService);

        // Check for first-run setup
        var setupMarker = Path.Combine(appData, ".setup-complete");
        if (!File.Exists(setupMarker))
        {
            Log.Information("First run detected, showing setup wizard");
            var setupDialog = new SetupWizardDialog();
            var result = setupDialog.ShowDialog();

            if (result != true || !setupDialog.SetupCompleted)
            {
                Log.Information("Setup cancelled, shutting down");
                Shutdown();
                return;
            }

            // Apply server URL from setup
            if (!string.IsNullOrWhiteSpace(setupDialog.ServerUrl))
            {
                ApiService.SetServerUrl(setupDialog.ServerUrl);
            }
        }
        else
        {
            // Not first run - check licence validity
            if (!LicenseService.IsLicenseValid())
            {
                Log.Warning("No valid licence found");
            }
        }

        // Apply user-saved settings (server URL, poll interval, etc.)
        ApplyUserSettings();

        Log.Information("Stratus Desktop initialised successfully");
    }

    /// <summary>
    /// Loads user-saved settings from %LOCALAPPDATA%\Stratus\settings.json
    /// and applies them to the running services.
    /// </summary>
    private static void ApplyUserSettings()
    {
        try
        {
            var settingsPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Stratus", "settings.json");

            if (!File.Exists(settingsPath)) return;

            var json = File.ReadAllText(settingsPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            if (root.TryGetProperty("ServerUrl", out var urlProp))
            {
                var url = urlProp.GetString();
                if (!string.IsNullOrWhiteSpace(url))
                    ApiService.SetServerUrl(url);
            }

            if (root.TryGetProperty("PollInterval", out var pollProp) && pollProp.TryGetInt32(out var poll))
            {
                DataAcquisitionService.PollIntervalSeconds = poll;
            }

            Log.Information("User settings applied from {Path}", settingsPath);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load user settings");
        }
    }

    private void Application_Exit(object sender, ExitEventArgs e)
    {
        Log.Information("Stratus Desktop shutting down");
        DataAcquisitionService?.StopCollection();
        DatabaseService?.Dispose();
        Log.CloseAndFlush();
    }
}
