using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Win32;
using Serilog;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services;

namespace Stratus.Desktop.Views;

public partial class QualityDashboardWindow : Window
{
    private readonly QualityFlagService _qcService;
    private readonly IReadOnlyList<WeatherRecord> _records;
    private readonly string? _stationName;
    private List<RecordQualityResult> _results = new();
    private QualitySummary _summary = new();
    private List<QualifiedRecord> _qualifiedRecords = new();

    public QualityDashboardWindow(IReadOnlyList<WeatherRecord> records, string? stationName = null)
    {
        InitializeComponent();
        _qcService = App.QualityFlagService;
        _records = records;
        _stationName = stationName;
        Loaded += (_, _) => RunAnalysis();
    }

    private void RunAnalysis()
    {
        if (_records.Count == 0)
        {
            TxtSubtitle.Text = "No data loaded. Load station data first.";
            return;
        }

        try
        {
            Mouse.OverrideCursor = System.Windows.Input.Cursors.Wait;

            _results = _qcService.EvaluateDataset(_records);
            _summary = _qcService.Summarise(_records, _results);

            // Build qualified records list
            var ordered = _records.OrderBy(r => r.Timestamp).ToList();
            _qualifiedRecords = new List<QualifiedRecord>(ordered.Count);
            for (int i = 0; i < ordered.Count; i++)
            {
                _qualifiedRecords.Add(new QualifiedRecord
                {
                    Record = ordered[i],
                    Quality = _results[i],
                });
            }

            UpdateScorcards();
            UpdateQualityBar();
            SensorGrid.ItemsSource = _summary.SensorSummaries;
            ApplyFlaggedFilter();

            var timeRange = ordered.Count > 1
                ? $"{ordered.First().Timestamp:yyyy-MM-dd HH:mm} → {ordered.Last().Timestamp:yyyy-MM-dd HH:mm}"
                : ordered.First().Timestamp.ToString("yyyy-MM-dd HH:mm");

            TxtSubtitle.Text = $"{_stationName ?? "Station"} • {ordered.Count:N0} records • {timeRange} • {_qcService.Rules.Count(r => r.IsEnabled)} active rules";

            App.AuditService.Log(AuditCategory.DataExport, "QC analysis completed",
                $"DQI={_summary.DataQualityIndex:F1}%, Records={_summary.TotalRecords}, Bad={_summary.BadRecords}");
        }
        catch (Exception ex)
        {
            Log.Error(ex, "QC analysis failed");
            MessageBox.Show($"Analysis failed: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        finally
        {
            Mouse.OverrideCursor = null;
        }
    }

    private void UpdateScorcards()
    {
        var dqi = _summary.DataQualityIndex;
        TxtDqi.Text = $"{dqi:F1}";
        TxtDqi.Foreground = new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1D, 0x4E, 0xD8));

        TxtGood.Text = _summary.GoodRecords.ToString("N0");
        TxtGoodPct.Text = $"{_summary.GoodPercent:F1}%";

        TxtSuspect.Text = _summary.SuspectRecords.ToString("N0");
        TxtSuspectPct.Text = $"{_summary.SuspectPercent:F1}%";

        TxtBad.Text = _summary.BadRecords.ToString("N0");
        TxtBadPct.Text = $"{_summary.BadPercent:F1}%";

        var missPct = _summary.TotalRecords > 0 ? 100.0 * _summary.MissingRecords / _summary.TotalRecords : 0;
        TxtMissing.Text = _summary.MissingRecords.ToString("N0");
        TxtMissingPct.Text = $"{missPct:F1}%";
    }

    private void UpdateQualityBar()
    {
        var total = Math.Max(_summary.TotalRecords, 1);
        ColGood.Width = new GridLength(_summary.GoodRecords, GridUnitType.Star);
        ColSuspect.Width = new GridLength(Math.Max(_summary.SuspectRecords, 0), GridUnitType.Star);
        ColBad.Width = new GridLength(Math.Max(_summary.BadRecords, 0), GridUnitType.Star);
        ColMissing.Width = new GridLength(Math.Max(_summary.MissingRecords, 0), GridUnitType.Star);

        // Ensure at least a sliver for non-zero categories
        if (_summary.SuspectRecords == 0) ColSuspect.Width = new GridLength(0);
        if (_summary.BadRecords == 0) ColBad.Width = new GridLength(0);
        if (_summary.MissingRecords == 0) ColMissing.Width = new GridLength(0);
    }

    private void ApplyFlaggedFilter()
    {
        var showSuspect = ChkShowSuspect.IsChecked == true;
        var showBad = ChkShowBad.IsChecked == true;
        var showMissing = ChkShowMissing.IsChecked == true;

        var filtered = _qualifiedRecords.Where(qr =>
        {
            return qr.OverallFlag switch
            {
                QualityFlag.Suspect => showSuspect,
                QualityFlag.Bad => showBad,
                QualityFlag.Missing => showMissing,
                _ => false,
            };
        }).OrderByDescending(qr => qr.Timestamp).ToList();

        FlaggedGrid.ItemsSource = filtered;
        TxtFlaggedCount.Text = $"Showing {filtered.Count:N0} flagged records";
    }

    private void FilterChanged(object sender, RoutedEventArgs e) => ApplyFlaggedFilter();

    private void ConfigureRules_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new QualityRulesDialog { Owner = this };
        dialog.ShowDialog();
    }

    private void ReAnalyse_Click(object sender, RoutedEventArgs e) => RunAnalysis();

    private void ExportCsv_Click(object sender, RoutedEventArgs e)
    {
        var dlg = new SaveFileDialog
        {
            Filter = "CSV files|*.csv",
            FileName = $"qc_report_{DateTime.Now:yyyyMMdd_HHmmss}.csv",
            InitialDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Stratus")
        };

        if (dlg.ShowDialog() != true) return;

        try
        {
            var dir = Path.GetDirectoryName(dlg.FileName);
            if (dir != null) Directory.CreateDirectory(dir);

            var sb = new StringBuilder();
            sb.AppendLine("Timestamp,OverallFlag,IssueCount,Details");

            foreach (var qr in _qualifiedRecords.OrderBy(q => q.Timestamp))
            {
                var details = qr.IssueList.Replace("\"", "\"\"");
                sb.AppendLine($"{qr.Timestamp:yyyy-MM-dd HH:mm:ss},{qr.OverallFlag},{qr.IssueCount},\"{details}\"");
            }

            File.WriteAllText(dlg.FileName, sb.ToString(), Encoding.UTF8);
            App.AuditService.LogExport("QC report exported", dlg.FileName);
            MessageBox.Show($"Exported {_qualifiedRecords.Count} records to:\n{dlg.FileName}", "Export Complete",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "QC export failed");
            MessageBox.Show($"Export failed: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
