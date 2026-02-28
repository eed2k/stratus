using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using Serilog;
using Stratus.Desktop.Models;
using WinMessageBox = System.Windows.MessageBox;

namespace Stratus.Desktop.Views;

public partial class AlarmManagerDialog : Window
{
    private readonly int _stationId;
    private readonly Services.ApiService _api;
    private List<AlarmRule> _alarms = new();
    private List<AlarmEvent> _events = new();

    public AlarmManagerDialog(int stationId)
    {
        _stationId = stationId;
        _api = App.ApiService;
        InitializeComponent();
        Loaded += async (_, _) => await LoadDataAsync();
    }

    private async Task LoadDataAsync()
    {
        try
        {
            _alarms = await _api.GetAlarmsAsync(_stationId);
            AlarmGrid.ItemsSource = _alarms;

            _events = await _api.GetAlarmEventsAsync(_stationId);
            EventGrid.ItemsSource = _events;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to load alarm data");
            WinMessageBox.Show($"Failed to load alarms: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private void AlarmGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (AlarmGrid.SelectedItem is AlarmRule rule)
        {
            // Populate edit fields
            foreach (ComboBoxItem item in ParamCombo.Items)
                if ((string)item.Content == rule.Parameter) { ParamCombo.SelectedItem = item; break; }
            foreach (ComboBoxItem item in ConditionCombo.Items)
                if ((string)item.Content == rule.Condition) { ConditionCombo.SelectedItem = item; break; }
            foreach (ComboBoxItem item in SeverityCombo.Items)
                if ((string)item.Content == rule.Severity) { SeverityCombo.SelectedItem = item; break; }

            ThresholdBox.Text = rule.Threshold.ToString("F2", CultureInfo.InvariantCulture);
            MessageBox.Text = rule.Message ?? string.Empty;
            CooldownBox.Text = rule.CooldownMinutes.ToString();
        }
    }

    private async void AddAlarm_Click(object sender, RoutedEventArgs e)
    {
        if (ParamCombo.SelectedItem is not ComboBoxItem paramItem) return;
        if (ConditionCombo.SelectedItem is not ComboBoxItem condItem) return;
        if (SeverityCombo.SelectedItem is not ComboBoxItem sevItem) return;
        if (!double.TryParse(ThresholdBox.Text, NumberStyles.Any, CultureInfo.InvariantCulture, out var threshold)) return;
        int.TryParse(CooldownBox.Text, out var cooldown);
        if (cooldown <= 0) cooldown = 30;

        var alarm = new AlarmRule
        {
            StationId = _stationId,
            Parameter = (string)paramItem.Content,
            Condition = (string)condItem.Content,
            Threshold = threshold,
            Severity = (string)sevItem.Content,
            Message = MessageBox.Text,
            CooldownMinutes = cooldown,
            Enabled = true
        };

        // If editing an existing alarm, update it; otherwise create new
        if (AlarmGrid.SelectedItem is AlarmRule existing)
        {
            alarm.Id = existing.Id;
            var ok = await _api.UpdateAlarmAsync(alarm);
            if (!ok)
            {
                System.Windows.MessageBox.Show("Failed to update alarm.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
        }
        else
        {
            var created = await _api.CreateAlarmAsync(alarm);
            if (created == null)
            {
                System.Windows.MessageBox.Show("Failed to create alarm.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }
        }

        await LoadDataAsync();
    }

    private async void DeleteAlarm_Click(object sender, RoutedEventArgs e)
    {
        if (AlarmGrid.SelectedItem is not AlarmRule rule) return;

        var result = System.Windows.MessageBox.Show(
            $"Delete alarm: {rule.Summary}?", "Confirm Delete",
            MessageBoxButton.YesNo, MessageBoxImage.Question);

        if (result != MessageBoxResult.Yes) return;

        await _api.DeleteAlarmAsync(rule.Id);
        await LoadDataAsync();
    }

    private async void Acknowledge_Click(object sender, RoutedEventArgs e)
    {
        if (EventGrid.SelectedItem is not AlarmEvent evt) return;
        if (evt.Acknowledged) return;

        await _api.AcknowledgeAlarmAsync(evt.Id);
        await LoadDataAsync();
    }

    private async void Refresh_Click(object sender, RoutedEventArgs e)
    {
        await LoadDataAsync();
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
