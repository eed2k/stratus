using System.IO;
using System.Windows;
using Microsoft.Extensions.Configuration;
using Serilog;
using Stratus.Desktop.Services;

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
        var configPath = Path.Combine(appData, "appsettings.json");
        if (!File.Exists(configPath))
        {
            // Copy default config to app data
            var defaultConfig = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "appsettings.json");
            if (File.Exists(defaultConfig))
                File.Copy(defaultConfig, configPath);
        }

        _configuration = new ConfigurationBuilder()
            .SetBasePath(AppDomain.CurrentDomain.BaseDirectory)
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile(configPath, optional: true, reloadOnChange: true)
            .Build();

        // Initialize services
        LicenseService = new LicenseService(appData);
        ApiService = new ApiService(Configuration);
        DatabaseService = new DatabaseService(Configuration);
        DataAcquisitionService = new DataAcquisitionService(ApiService, DatabaseService);

        // Check license on startup
        if (!LicenseService.IsLicenseValid())
        {
            Log.Warning("No valid license found, showing activation dialog");
        }

        Log.Information("Stratus Desktop initialized successfully");
    }

    private void Application_Exit(object sender, ExitEventArgs e)
    {
        Log.Information("Stratus Desktop shutting down");
        DataAcquisitionService?.StopCollection();
        DatabaseService?.Dispose();
        Log.CloseAndFlush();
    }
}
