using System.IO;
using System.Text.Json;
using System.Windows;
using Serilog;

namespace Stratus.Desktop.Views;

public partial class SettingsDialog : Window
{
    private readonly string _settingsPath;

    public SettingsDialog()
    {
        InitializeComponent();
        _settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Stratus", "settings.json");
        LoadSettings();
    }

    private void LoadSettings()
    {
        // Defaults
        ServerUrlBox.Text = App.ApiService.BaseUrl;
        TimeoutBox.Text = "30";
        PollIntervalBox.Text = "60";
        AutoConnectCheck.IsChecked = false;

        // Load saved settings if available
        try
        {
            if (File.Exists(_settingsPath))
            {
                var json = File.ReadAllText(_settingsPath);
                var settings = JsonSerializer.Deserialize<AppSettings>(json,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (settings != null)
                {
                    if (!string.IsNullOrEmpty(settings.ServerUrl))
                        ServerUrlBox.Text = settings.ServerUrl;
                    TimeoutBox.Text = settings.ApiTimeout.ToString();
                    PollIntervalBox.Text = settings.PollInterval.ToString();
                    AutoConnectCheck.IsChecked = settings.AutoConnect;

                    // Set export format selection
                    ExportFormatBox.SelectedIndex = settings.ExportFormat == "CSV" ? 1 : 0;

                    // Set export range selection
                    ExportRangeBox.SelectedIndex = settings.ExportRangeDays switch
                    {
                        7 => 0,
                        90 => 2,
                        -1 => 3,
                        _ => 1 // 30 days default
                    };
                }
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to load settings");
        }
    }

    private void Save_Click(object sender, RoutedEventArgs e)
    {
        if (!int.TryParse(TimeoutBox.Text, out var timeout) || timeout < 5 || timeout > 300)
        {
            MessageBox.Show("API Timeout must be between 5 and 300 seconds.",
                "Invalid Setting", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        if (!int.TryParse(PollIntervalBox.Text, out var poll) || poll < 10 || poll > 3600)
        {
            MessageBox.Show("Polling interval must be between 10 and 3600 seconds.",
                "Invalid Setting", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var exportRangeDays = ExportRangeBox.SelectedIndex switch
        {
            0 => 7,
            2 => 90,
            3 => -1, // All
            _ => 30
        };

        var settings = new AppSettings
        {
            ServerUrl = ServerUrlBox.Text.Trim(),
            ApiTimeout = timeout,
            PollInterval = poll,
            AutoConnect = AutoConnectCheck.IsChecked == true,
            ExportFormat = ExportFormatBox.SelectedIndex == 1 ? "CSV" : "TOA5",
            ExportRangeDays = exportRangeDays
        };

        try
        {
            var dir = Path.GetDirectoryName(_settingsPath)!;
            Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_settingsPath, json);
            Log.Information("Settings saved to {Path}", _settingsPath);

            // Apply server URL if changed
            if (!string.Equals(App.ApiService.BaseUrl, settings.ServerUrl, StringComparison.OrdinalIgnoreCase))
            {
                App.ApiService.SetServerUrl(settings.ServerUrl);
            }

            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save settings");
            MessageBox.Show($"Failed to save settings: {ex.Message}",
                "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }

    private class AppSettings
    {
        public string ServerUrl { get; set; } = "https://stratusweather.co.za";
        public int ApiTimeout { get; set; } = 30;
        public int PollInterval { get; set; } = 60;
        public bool AutoConnect { get; set; }
        public string ExportFormat { get; set; } = "TOA5";
        public int ExportRangeDays { get; set; } = 30;
    }
}
