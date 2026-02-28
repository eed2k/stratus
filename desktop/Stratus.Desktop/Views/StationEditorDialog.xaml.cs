using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Views;

public partial class StationEditorDialog : Window
{
    private readonly WeatherStation? _existing;
    private readonly Services.ApiService _api;

    public bool StationModified { get; private set; }

    /// <summary>
    /// Create dialog for editing an existing station or creating a new one.
    /// Pass null for a new station.
    /// </summary>
    public StationEditorDialog(WeatherStation? station = null)
    {
        _existing = station;
        _api = App.ApiService;

        InitializeComponent();

        if (station != null)
        {
            Title = $"Edit Station: {station.Name} — Stratus";
            NameBox.Text = station.Name;
            DescBox.Text = station.Description ?? "";
            LatBox.Text = station.Latitude?.ToString("F6", CultureInfo.InvariantCulture) ?? "";
            LonBox.Text = station.Longitude?.ToString("F6", CultureInfo.InvariantCulture) ?? "";
            ElevBox.Text = station.Elevation?.ToString("F1", CultureInfo.InvariantCulture) ?? "";
            TzBox.Text = station.TimeZone ?? "Africa/Johannesburg";

            // Select datalogger model
            if (!string.IsNullOrEmpty(station.DataloggerModel))
            {
                foreach (ComboBoxItem item in LoggerCombo.Items)
                {
                    if ((string)item.Content == station.DataloggerModel)
                    {
                        LoggerCombo.SelectedItem = item;
                        break;
                    }
                }
            }

            // Select protocol
            if (!string.IsNullOrEmpty(station.Protocol))
            {
                foreach (ComboBoxItem item in ProtocolCombo.Items)
                {
                    if ((string)item.Content == station.Protocol)
                    {
                        ProtocolCombo.SelectedItem = item;
                        break;
                    }
                }
            }
        }
        else
        {
            Title = "Create New Station — Stratus";
        }
    }

    private async void Save_Click(object sender, RoutedEventArgs e)
    {
        var name = NameBox.Text.Trim();
        if (string.IsNullOrEmpty(name))
        {
            MessageBox.Show("Station name is required.", "Validation", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        double? lat = null, lon = null, elev = null;
        if (double.TryParse(LatBox.Text, NumberStyles.Any, CultureInfo.InvariantCulture, out var latVal)) lat = latVal;
        if (double.TryParse(LonBox.Text, NumberStyles.Any, CultureInfo.InvariantCulture, out var lonVal)) lon = lonVal;
        if (double.TryParse(ElevBox.Text, NumberStyles.Any, CultureInfo.InvariantCulture, out var elevVal)) elev = elevVal;

        var logger = (LoggerCombo.SelectedItem as ComboBoxItem)?.Content as string ?? "CR1000X";
        var protocol = (ProtocolCombo.SelectedItem as ComboBoxItem)?.Content as string ?? "api";

        try
        {
            if (_existing != null)
            {
                // Update existing
                var updates = new
                {
                    name,
                    description = DescBox.Text.Trim(),
                    latitude = lat,
                    longitude = lon,
                    elevation = elev,
                    dataloggerModel = logger,
                    protocol,
                    timeZone = TzBox.Text.Trim()
                };

                var ok = await _api.UpdateStationAsync(_existing.Id, updates);
                if (ok)
                {
                    StationModified = true;
                    MessageBox.Show("Station updated successfully.", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
                    DialogResult = true;
                    Close();
                }
                else
                {
                    MessageBox.Show("Failed to update station.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
            else
            {
                // Create new
                var station = new WeatherStation
                {
                    Name = name,
                    Description = DescBox.Text.Trim(),
                    Latitude = lat,
                    Longitude = lon,
                    Elevation = elev,
                    DataloggerModel = logger,
                    Protocol = protocol,
                    TimeZone = TzBox.Text.Trim()
                };

                var created = await _api.CreateStationAsync(station);
                if (created != null)
                {
                    StationModified = true;
                    MessageBox.Show($"Station '{name}' created (ID: {created.Id}).", "Success", MessageBoxButton.OK, MessageBoxImage.Information);
                    DialogResult = true;
                    Close();
                }
                else
                {
                    MessageBox.Show("Failed to create station.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
                }
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save station");
            MessageBox.Show($"Error: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private async void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (_existing == null) return;

        var result = MessageBox.Show(
            $"Permanently delete station '{_existing.Name}' and all its data?\n\nThis action cannot be undone.",
            "Confirm Delete",
            MessageBoxButton.YesNo, MessageBoxImage.Warning);

        if (result != MessageBoxResult.Yes) return;

        try
        {
            var ok = await _api.DeleteStationAsync(_existing.Id);
            if (ok)
            {
                StationModified = true;
                MessageBox.Show("Station deleted.", "Done", MessageBoxButton.OK, MessageBoxImage.Information);
                DialogResult = true;
                Close();
            }
            else
            {
                MessageBox.Show("Failed to delete station.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to delete station {Id}", _existing.Id);
            MessageBox.Show($"Error: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
