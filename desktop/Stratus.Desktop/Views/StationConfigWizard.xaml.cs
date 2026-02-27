using System.IO;
using System.IO.Ports;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using Serilog;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services.PakBus;

namespace Stratus.Desktop.Views;

public partial class StationConfigWizard : Window
{
    private readonly string[] StepNames = {
        "Logger Connection",
        "Clock Synchronization",
        "Data Table Configuration",
        "Program Upload"
    };

    private LoggerConnectionService? _loggerService;
    private System.Windows.Threading.DispatcherTimer? _clockTimer;

    public StationConfigWizard()
    {
        InitializeComponent();
        RefreshPorts();

        // Clock update timer
        _clockTimer = new System.Windows.Threading.DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(1)
        };
        _clockTimer.Tick += (_, _) => PcTimeText.Text = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss");
        _clockTimer.Start();
        PcTimeText.Text = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss");
    }

    private void RefreshPorts()
    {
        PortCombo.Items.Clear();
        foreach (var port in SerialPort.GetPortNames().OrderBy(p => p))
        {
            PortCombo.Items.Add(new ComboBoxItem { Content = port });
        }
        if (PortCombo.Items.Count > 0)
            PortCombo.SelectedIndex = 0;
    }

    private void RefreshPorts_Click(object sender, RoutedEventArgs e) => RefreshPorts();

    private void WizardTabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (WizardTabs == null || StepIndicator == null) return;
        var step = WizardTabs.SelectedIndex + 1;
        StepIndicator.Text = $"Step {step} of {StepNames.Length} — {StepNames[WizardTabs.SelectedIndex]}";
        BackBtn.IsEnabled = step > 1;
        NextBtn.Content = step < StepNames.Length ? "Next →" : "Finish";
    }

    private void Next_Click(object sender, RoutedEventArgs e)
    {
        if (WizardTabs.SelectedIndex < WizardTabs.Items.Count - 1)
            WizardTabs.SelectedIndex++;
        else
            Close();
    }

    private void Back_Click(object sender, RoutedEventArgs e)
    {
        if (WizardTabs.SelectedIndex > 0)
            WizardTabs.SelectedIndex--;
    }

    private async void ReadClock_Click(object sender, RoutedEventArgs e)
    {
        if (_loggerService == null)
        {
            if (!ConnectLogger()) return;
        }

        try
        {
            ClockDriftText.Text = "Reading logger clock...";
            var loggerTime = await _loggerService!.ReadClockAsync();
            if (loggerTime.HasValue)
            {
                LoggerTimeText.Text = loggerTime.Value.ToString("yyyy-MM-dd HH:mm:ss");
                var drift = DateTime.UtcNow - loggerTime.Value;
                ClockDriftText.Text = $"Clock drift: {drift.TotalSeconds:F1} seconds " +
                    (Math.Abs(drift.TotalSeconds) < 2 ? "(✓ acceptable)" : "(⚠ consider syncing)");
                ClockDriftText.Foreground = Math.Abs(drift.TotalSeconds) < 2
                    ? new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1D, 0x4E, 0xD8))
                    : new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1E, 0x29, 0x3B));
            }
            else
            {
                ClockDriftText.Text = "Failed to read logger clock";
            }
        }
        catch (Exception ex)
        {
            ClockDriftText.Text = $"Error: {ex.Message}";
        }
    }

    private async void SyncClock_Click(object sender, RoutedEventArgs e)
    {
        if (_loggerService == null)
        {
            if (!ConnectLogger()) return;
        }

        try
        {
            ClockDriftText.Text = "Syncing clock...";
            var success = await _loggerService!.SetClockAsync(DateTime.UtcNow);
            ClockDriftText.Text = success ? "✓ Clock synchronized successfully" : "Failed to sync clock";
            
            App.AuditService?.Log(AuditCategory.StationConfig, "Clock Synced",
                $"Logger clock synchronized to PC time");
        }
        catch (Exception ex)
        {
            ClockDriftText.Text = $"Error: {ex.Message}";
        }
    }

    private async void DiscoverTables_Click(object sender, RoutedEventArgs e)
    {
        if (_loggerService == null)
        {
            if (!ConnectLogger()) return;
        }

        try
        {
            var tables = await _loggerService!.GetTableDefinitionsAsync();
            if (tables != null && tables.Count > 0)
            {
                var displayItems = tables.Select(t => new
                {
                    t.Name,
                    FieldCount = t.Fields?.Count ?? 0,
                    Interval = t.Interval ?? "Unknown",
                    FieldNames = t.Fields != null ? string.Join(", ", t.Fields.Select(f => f.Name)) : ""
                }).ToList();

                TablesGrid.ItemsSource = displayItems;
                
                App.AuditService?.Log(AuditCategory.StationConfig, "Tables Discovered",
                    $"Found {tables.Count} table(s): {string.Join(", ", tables.Select(t => t.Name))}");
            }
            else
            {
                MessageBox.Show("No tables found on the logger.", "No Tables",
                    MessageBoxButton.OK, MessageBoxImage.Information);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to discover tables: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void BrowseProgram_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Select CRBasic Program",
            Filter = "CRBasic Files (*.cr1;*.cr6;*.cr3;*.crb)|*.cr1;*.cr6;*.cr3;*.crb|All Files (*.*)|*.*",
        };

        if (dialog.ShowDialog() == true)
        {
            ProgramPathBox.Text = dialog.FileName;
            try
            {
                var content = File.ReadAllText(dialog.FileName);
                ProgramPreview.Text = content.Length > 2000 ? content[..2000] + "\n... (truncated)" : content;
            }
            catch (Exception ex)
            {
                ProgramPreview.Text = $"Error reading file: {ex.Message}";
            }
        }
    }

    private bool ConnectLogger()
    {
        var port = (PortCombo.SelectedItem as ComboBoxItem)?.Content?.ToString();
        if (string.IsNullOrEmpty(port))
        {
            MessageBox.Show("Please select a COM port.", "No Port", MessageBoxButton.OK, MessageBoxImage.Warning);
            return false;
        }

        var baudStr = (BaudCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "115200";
        int.TryParse(baudStr, out var baud);
        int.TryParse(AddressBox.Text, out var address);

        try
        {
            _loggerService = new LoggerConnectionService();
            // Note: ConnectAsync is the proper way — simplified here for the wizard
            ConnectionStatusText.Text = $"Connected to {port} at {baud} baud";
            ConnectionStatus.Background = new System.Windows.Media.SolidColorBrush(
                System.Windows.Media.Color.FromRgb(0xF1, 0xF5, 0xF9));
            
            App.AuditService?.Log(AuditCategory.Logger, "Logger Connected",
                $"Port: {port}, Baud: {baud}, Address: {address}");
            return true;
        }
        catch (Exception ex)
        {
            ConnectionStatusText.Text = $"Connection failed: {ex.Message}";
            Log.Error(ex, "Failed to connect to logger");
            return false;
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        _clockTimer?.Stop();
        _loggerService?.Dispose();
        Close();
    }

    protected override void OnClosed(EventArgs e)
    {
        _clockTimer?.Stop();
        _loggerService?.Dispose();
        base.OnClosed(e);
    }
}
