using System.Windows;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services;

namespace Stratus.Desktop.Views;

public partial class ReportDialog : Window
{
    private readonly WeatherStation? _station;
    private readonly IReadOnlyList<WeatherRecord> _records;

    public ReportDialog(WeatherStation? station, IReadOnlyList<WeatherRecord> records)
    {
        InitializeComponent();
        _station = station;
        _records = records;

        // Default to last 30 days
        ToDate.SelectedDate = DateTime.Now;
        FromDate.SelectedDate = DateTime.Now.AddDays(-30);

        if (station != null)
        {
            StationInfoText.Text = $"{station.Name} — {station.Location}";
        }
        RecordCountText.Text = $"{records.Count:N0} records loaded";
    }

    private void LastWeek_Click(object sender, RoutedEventArgs e)
    {
        ToDate.SelectedDate = DateTime.Now;
        FromDate.SelectedDate = DateTime.Now.AddDays(-7);
    }

    private void LastMonth_Click(object sender, RoutedEventArgs e)
    {
        ToDate.SelectedDate = DateTime.Now;
        FromDate.SelectedDate = DateTime.Now.AddDays(-30);
    }

    private void ThisMonth_Click(object sender, RoutedEventArgs e)
    {
        var now = DateTime.Now;
        FromDate.SelectedDate = new DateTime(now.Year, now.Month, 1);
        ToDate.SelectedDate = now;
    }

    private void Last3Months_Click(object sender, RoutedEventArgs e)
    {
        ToDate.SelectedDate = DateTime.Now;
        FromDate.SelectedDate = DateTime.Now.AddMonths(-3);
    }

    private void ThisYear_Click(object sender, RoutedEventArgs e)
    {
        var now = DateTime.Now;
        FromDate.SelectedDate = new DateTime(now.Year, 1, 1);
        ToDate.SelectedDate = now;
    }

    private async void Generate_Click(object sender, RoutedEventArgs e)
    {
        if (!FromDate.SelectedDate.HasValue || !ToDate.SelectedDate.HasValue)
        {
            MessageBox.Show("Please select a date range.", "Missing Dates", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var from = FromDate.SelectedDate.Value;
        var to = ToDate.SelectedDate.Value;

        // Filter records to date range
        var filtered = _records
            .Where(r => r.Timestamp >= from && r.Timestamp <= to.AddDays(1))
            .ToList();

        if (filtered.Count == 0)
        {
            MessageBox.Show("No data records found in the selected date range.", "No Data",
                MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        GenerateBtn.IsEnabled = false;
        StatusText.Text = "Generating report...";
        ProgressBar.IsIndeterminate = true;
        ProgressBar.Visibility = Visibility.Visible;

        try
        {
            var request = new ReportRequest
            {
                Title = TitleBox.Text,
                From = from,
                To = to,
                Station = _station,
                Records = filtered,
            };

            var outputPath = await Task.Run(() => ReportService.GenerateReport(request));

            App.AuditService?.Log(AuditCategory.Report, "PDF Report Generated",
                $"{TitleBox.Text}: {from:d} to {to:d} ({filtered.Count} records)", _station?.Id);

            StatusText.Text = $"Report saved!";
            ProgressBar.Visibility = Visibility.Collapsed;

            var result = MessageBox.Show(
                $"Report generated successfully!\n\n{outputPath}\n\nOpen the file now?",
                "Report Complete", MessageBoxButton.YesNo, MessageBoxImage.Information);

            if (result == MessageBoxResult.Yes)
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = outputPath,
                    UseShellExecute = true,
                });
            }

            DialogResult = true;
            Close();
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Error: {ex.Message}";
            ProgressBar.Visibility = Visibility.Collapsed;
            MessageBox.Show($"Failed to generate report:\n\n{ex.Message}", "Error",
                MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            GenerateBtn.IsEnabled = true;
        }
    }

    private void Cancel_Click(object sender, RoutedEventArgs e) => Close();
}
