using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services.PakBus;
using Stratus.Desktop.ViewModels;

namespace Stratus.Desktop.Views;

/// <summary>
/// Serial monitor window for PakBus/LoggerNet communication.
/// Shows real-time data from a locally connected Campbell Scientific datalogger.
/// </summary>
public partial class SerialMonitorWindow : Window
{
    private readonly LoggerConnectionService _logger;
    private int _packetCounter;
    private const int MaxMonitorLines = 2000;

    public SerialMonitorWindow()
    {
        InitializeComponent();

        _logger = App.LoggerService;

        // Wire up events
        _logger.MonitorLog += Logger_MonitorLog;
        _logger.DataReceived += Logger_DataReceived;
        _logger.ConnectionStateChanged += Logger_ConnectionStateChanged;
        _logger.StatusChanged += Logger_StatusChanged;
        _logger.ErrorOccurred += Logger_ErrorOccurred;
        _logger.RawDataReceived += Logger_RawDataReceived;

        // Populate ports
        RefreshPorts();

        // If already connected, update UI state
        if (_logger.IsConnected)
        {
            UpdateUIState(connected: true, polling: _logger.IsPolling);
        }

        Closed += (_, _) =>
        {
            _logger.MonitorLog -= Logger_MonitorLog;
            _logger.DataReceived -= Logger_DataReceived;
            _logger.ConnectionStateChanged -= Logger_ConnectionStateChanged;
            _logger.StatusChanged -= Logger_StatusChanged;
            _logger.ErrorOccurred -= Logger_ErrorOccurred;
            _logger.RawDataReceived -= Logger_RawDataReceived;
        };
    }

    private void RefreshPorts()
    {
        var currentSelection = PortCombo.SelectedItem as string;
        PortCombo.Items.Clear();

        var ports = SerialPortService.GetAvailablePorts();
        foreach (var port in ports)
            PortCombo.Items.Add(port);

        if (ports.Length > 0)
        {
            if (currentSelection != null && ports.Contains(currentSelection))
                PortCombo.SelectedItem = currentSelection;
            else
                PortCombo.SelectedIndex = 0;
        }

        AppendLog($"[SYSTEM] Found {ports.Length} serial port(s): {string.Join(", ", ports)}");
    }

    private int GetSelectedBaud()
    {
        if (BaudCombo.SelectedItem is ComboBoxItem item && int.TryParse(item.Content?.ToString(), out int baud))
            return baud;
        return 115200;
    }

    private int GetSelectedInterval()
    {
        if (IntervalCombo.SelectedItem is ComboBoxItem item && item.Tag is string tag && int.TryParse(tag, out int seconds))
            return seconds;
        return 30;
    }

    private ushort GetLoggerAddress()
    {
        if (ushort.TryParse(AddressBox.Text, out ushort addr))
            return addr;
        return 1;
    }

    #region Event Handlers

    private async void Connect_Click(object sender, RoutedEventArgs e)
    {
        if (PortCombo.SelectedItem == null)
        {
            MessageBox.Show("Please select a COM port.", "No Port", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var port = PortCombo.SelectedItem.ToString()!;
        var baud = GetSelectedBaud();
        var addr = GetLoggerAddress();

        ConnectButton.IsEnabled = false;
        ConnectButton.Content = "Connecting...";

        var success = await _logger.ConnectAsync(port, baud, addr);

        if (!success)
        {
            ConnectButton.IsEnabled = true;
            ConnectButton.Content = "Connect";
            MessageBox.Show($"Failed to connect to {port}.\nCheck that the logger is powered on and connected via USB.",
                "Connection Failed", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Disconnect_Click(object sender, RoutedEventArgs e)
    {
        _logger.Disconnect();
    }

    private async void PollOnce_Click(object sender, RoutedEventArgs e)
    {
        PollOnceButton.IsEnabled = false;
        PollOnceButton.Content = "Collecting...";
        try
        {
            await _logger.CollectDataOnce();
        }
        finally
        {
            PollOnceButton.IsEnabled = _logger.IsConnected;
            PollOnceButton.Content = "Poll Now";
        }
    }

    private void StartPolling_Click(object sender, RoutedEventArgs e)
    {
        _logger.PollIntervalSeconds = GetSelectedInterval();
        _logger.StartPolling();
        UpdateUIState(connected: true, polling: true);
    }

    private void StopPolling_Click(object sender, RoutedEventArgs e)
    {
        _logger.StopPolling();
        UpdateUIState(connected: true, polling: false);
    }

    private void RefreshPorts_Click(object sender, RoutedEventArgs e)
    {
        RefreshPorts();
    }

    private void Clear_Click(object sender, RoutedEventArgs e)
    {
        MonitorOutput.Clear();
        _packetCounter = 0;
        PacketCount.Text = "0";
    }

    #endregion

    #region Logger Events

    private void Logger_MonitorLog(object? sender, string message)
    {
        Dispatcher.InvokeAsync(() => AppendLog(message));
    }

    private void Logger_DataReceived(object? sender, WeatherRecord record)
    {
        Dispatcher.InvokeAsync(() =>
        {
            _packetCounter++;
            PacketCount.Text = _packetCounter.ToString();

            // Update live values
            LiveTimestamp.Text = record.Timestamp.ToString("yyyy-MM-dd HH:mm:ss");
            LiveTemp.Text = record.Temperature.HasValue ? $"{record.Temperature:F1} °C" : "— °C";
            LiveHumidity.Text = record.Humidity.HasValue ? $"{record.Humidity:F1} %" : "— %";
            LivePressure.Text = record.Pressure.HasValue ? $"{record.Pressure:F1} hPa" : "— hPa";
            LiveWind.Text = record.WindSpeed.HasValue ? $"{record.WindSpeed:F1} m/s" : "— m/s";
            LiveWindDir.Text = record.WindDirection.HasValue ? $"{record.WindDirection:F0}°" : "— °";
            LiveRain.Text = record.Rainfall.HasValue ? $"{record.Rainfall:F1} mm" : "— mm";
            LiveSolar.Text = record.SolarRadiation.HasValue ? $"{record.SolarRadiation:F0} W/m²" : "— W/m²";
            LiveBattery.Text = record.BatteryVoltage.HasValue ? $"{record.BatteryVoltage:F2} V" : "— V";

            // Also push to main Stratus dashboard
            if (Application.Current.MainWindow?.DataContext is MainViewModel vm)
            {
                vm.UpdateFromLogger(record);
            }
        });
    }

    private void Logger_ConnectionStateChanged(object? sender, bool connected)
    {
        Dispatcher.InvokeAsync(() =>
        {
            UpdateUIState(connected, _logger.IsPolling);
        });
    }

    private void Logger_StatusChanged(object? sender, string message)
    {
        Dispatcher.InvokeAsync(() =>
        {
            StatusText.Text = message;
        });
    }

    private void Logger_ErrorOccurred(object? sender, string message)
    {
        Dispatcher.InvokeAsync(() =>
        {
            StatusText.Text = $"Error: {message}";
        });
    }

    private void Logger_RawDataReceived(object? sender, byte[] data)
    {
        // Could show hex dump — handled via MonitorLog instead
    }

    #endregion

    private void AppendLog(string message)
    {
        MonitorOutput.AppendText(message + "\n");

        // Trim if too long
        if (MonitorOutput.LineCount > MaxMonitorLines)
        {
            var text = MonitorOutput.Text;
            var trimPoint = text.IndexOf('\n', text.Length / 3);
            if (trimPoint > 0)
                MonitorOutput.Text = text[(trimPoint + 1)..];
        }

        MonitorOutput.ScrollToEnd();
    }

    private void UpdateUIState(bool connected, bool polling)
    {
        ConnectButton.IsEnabled = !connected;
        ConnectButton.Content = "Connect";
        DisconnectButton.IsEnabled = connected;
        PollOnceButton.IsEnabled = connected && !polling;
        StartPollingButton.IsEnabled = connected && !polling;
        StopPollingButton.IsEnabled = connected && polling;

        PortCombo.IsEnabled = !connected;
        BaudCombo.IsEnabled = !connected;
        AddressBox.IsEnabled = !connected;
        IntervalCombo.IsEnabled = !polling;

        StatusIndicator.Fill = connected
            ? (polling ? Brushes.LimeGreen : Brushes.Orange)
            : Brushes.Gray;

        StatusText.Text = connected
            ? (polling ? $"Polling {_logger.PortName} every {_logger.PollIntervalSeconds}s" : $"Connected to {_logger.PortName}")
            : "Not connected";
    }
}
