using System.Windows;
using System.Windows.Controls;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services;

namespace Stratus.Desktop.Views;

public partial class DataGapDialog : Window
{
    private readonly int _stationId;
    private readonly IReadOnlyList<WeatherRecord> _records;
    private GapReport? _report;

    public DataGapDialog(int stationId, IReadOnlyList<WeatherRecord> records, string? stationName = null)
    {
        InitializeComponent();
        _stationId = stationId;
        _records = records;
        StationText.Text = $"Station: {stationName ?? stationId.ToString()} — {records.Count:N0} records";
    }

    private void Analyse_Click(object sender, RoutedEventArgs e)
    {
        if (_records.Count < 2)
        {
            MessageBox.Show("Need at least 2 records for gap analysis.", "Insufficient Data",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var intervalMinutes = 5;
        if (IntervalCombo.SelectedItem is ComboBoxItem item && item.Tag is string tag)
            int.TryParse(tag, out intervalMinutes);

        var gapService = new DataGapService(App.DatabaseService, App.ApiService);
        _report = gapService.AnalyseGaps(_records, _stationId, TimeSpan.FromMinutes(intervalMinutes));

        GapGrid.ItemsSource = _report.Gaps;

        // Update summary
        SummaryPanel.Visibility = Visibility.Visible;
        TotalRecordsText.Text = _report.TotalRecords.ToString("N0");
        GapCountText.Text = _report.Gaps.Count.ToString();
        CoverageText.Text = $"{_report.CoveragePercent:F1}%";
        StatusText.Text = _report.Status;

        // Color code coverage
        CoverageText.Foreground = new System.Windows.Media.SolidColorBrush(
            _report.CoveragePercent >= 95
                ? System.Windows.Media.Color.FromRgb(0x05, 0x96, 0x69)
                : _report.CoveragePercent >= 80
                    ? System.Windows.Media.Color.FromRgb(0xD9, 0x73, 0x06)
                    : System.Windows.Media.Color.FromRgb(0xDC, 0x26, 0x26));

        BackfillBtn.IsEnabled = _report.Gaps.Count > 0;

        App.AuditService?.Log(AuditCategory.DataCollection, "Gap Analysis",
            $"{_report.Gaps.Count} gaps, {_report.CoveragePercent:F1}% coverage", _stationId);
    }

    private async void Backfill_Click(object sender, RoutedEventArgs e)
    {
        if (_report == null || _report.Gaps.Count == 0) return;

        BackfillBtn.IsEnabled = false;
        BackfillBtn.Content = "Backfilling...";

        try
        {
            var gapService = new DataGapService(App.DatabaseService, App.ApiService);
            var recovered = await gapService.BackfillFromApiAsync(_stationId, _report.Gaps);

            GapGrid.ItemsSource = null;
            GapGrid.ItemsSource = _report.Gaps;

            App.AuditService?.Log(AuditCategory.DataCollection, "Gap Backfill",
                $"Recovered {recovered} records", _stationId);

            MessageBox.Show($"Backfill complete: {recovered} records recovered.",
                "Backfill Results", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Backfill failed: {ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            BackfillBtn.IsEnabled = true;
            BackfillBtn.Content = "Backfill from API";
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
