using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Views;

public partial class CalibrationDialog : Window
{
    private readonly int _stationId;

    public CalibrationDialog(int stationId)
    {
        InitializeComponent();
        _stationId = stationId;

        // Populate sensor combo
        var sensors = Services.CalibrationService.GetAvailableSensorFields()
            .Select(s => new { s.Field, Display = $"{s.Display} ({s.Unit})", s.Unit })
            .ToList();
        SensorCombo.ItemsSource = sensors;
        SensorCombo.SelectedIndex = 0;

        RefreshGrid();
    }

    private void RefreshGrid()
    {
        var profiles = App.CalibrationService?.GetStationProfiles(_stationId).ToList() ?? new();
        CalGrid.ItemsSource = profiles;

        // Check for overdue calibrations
        var overdue = profiles.Where(p => p.IsOverdue).ToList();
        if (overdue.Count > 0)
        {
            OverdueWarning.Visibility = Visibility.Visible;
            OverdueText.Text = $"⚠ {overdue.Count} sensor(s) have overdue calibrations: {string.Join(", ", overdue.Select(p => p.DisplayName))}";
        }
        else
        {
            OverdueWarning.Visibility = Visibility.Collapsed;
        }
    }

    private void CalGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (CalGrid.SelectedItem is CalibrationProfile profile)
        {
            SlopeBox.Text = profile.Slope.ToString("F6");
            OffsetBox.Text = profile.Offset.ToString("F4");
            CalibratedByBox.Text = profile.CalibratedBy;
            CertRefBox.Text = profile.CertificateReference;
            IntervalBox.Text = profile.CalibrationIntervalDays.ToString();
            NotesBox.Text = profile.Notes;

            // Select matching sensor in combo
            var sensors = SensorCombo.ItemsSource as IEnumerable<dynamic>;
            if (sensors != null)
            {
                int idx = 0;
                foreach (var s in sensors)
                {
                    if ((string)s.Field == profile.SensorField)
                    {
                        SensorCombo.SelectedIndex = idx;
                        break;
                    }
                    idx++;
                }
            }
        }
    }

    private void AddUpdate_Click(object sender, RoutedEventArgs e)
    {
        if (SensorCombo.SelectedItem == null) return;
        if (!double.TryParse(SlopeBox.Text, NumberStyles.Any, CultureInfo.InvariantCulture, out var slope))
        {
            MessageBox.Show("Invalid slope value.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (!double.TryParse(OffsetBox.Text, NumberStyles.Any, CultureInfo.InvariantCulture, out var offset))
        {
            MessageBox.Show("Invalid offset value.", "Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        if (!int.TryParse(IntervalBox.Text, out var interval)) interval = 365;

        dynamic sensor = SensorCombo.SelectedItem;

        // Check if updating existing or creating new
        var existing = App.CalibrationService?.GetProfile(_stationId, (string)sensor.Field);
        var profile = existing ?? new CalibrationProfile { StationId = _stationId };

        profile.SensorField = (string)sensor.Field;
        profile.DisplayName = ((string)sensor.Display).Split(" (")[0];
        profile.Unit = (string)sensor.Unit;
        profile.Slope = slope;
        profile.Offset = offset;
        profile.CalibratedBy = CalibratedByBox.Text;
        profile.CertificateReference = CertRefBox.Text;
        profile.CalibrationIntervalDays = interval;
        profile.Notes = NotesBox.Text;

        App.CalibrationService?.AddOrUpdate(profile);
        App.AuditService?.Log(AuditCategory.Calibration, "Calibration Updated",
            $"{profile.DisplayName}: slope={slope:F6}, offset={offset:F4}", _stationId);

        RefreshGrid();
    }

    private void MarkCalibrated_Click(object sender, RoutedEventArgs e)
    {
        if (CalGrid.SelectedItem is not CalibrationProfile profile) return;

        profile.LastCalibrationDate = DateTime.UtcNow;
        profile.NextCalibrationDue = DateTime.UtcNow.AddDays(profile.CalibrationIntervalDays);
        App.CalibrationService?.AddOrUpdate(profile);
        App.AuditService?.Log(AuditCategory.Calibration, "Sensor Calibrated",
            $"{profile.DisplayName}: next due {profile.NextCalibrationDue:yyyy-MM-dd}", _stationId);

        RefreshGrid();
    }

    private void Remove_Click(object sender, RoutedEventArgs e)
    {
        if (CalGrid.SelectedItem is not CalibrationProfile profile) return;

        var result = MessageBox.Show($"Remove calibration profile for {profile.DisplayName}?",
            "Confirm", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (result != MessageBoxResult.Yes) return;

        App.CalibrationService?.Remove(profile.Id);
        App.AuditService?.Log(AuditCategory.Calibration, "Calibration Removed",
            profile.DisplayName, _stationId);
        RefreshGrid();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
