using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using LiveChartsCore;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.Painting;
using LiveChartsCore.SkiaSharpView.SKCharts;
using Microsoft.Win32;
using SkiaSharp;
using Stratus.Desktop.Controls;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services;
using Stratus.Desktop.ViewModels;

namespace Stratus.Desktop.Views;

public partial class MainWindow : Window
{
    private List<WindDataPoint>? _currentWindData;
    private int _currentSectorAngle = 15;

    public MainWindow()
    {
        // Register value converters
        Resources.Add("BoolToColorConverter", new BoolToColorConverter());
        Resources.Add("BoolToCollectionText", new BoolToCollectionTextConverter());
        
        InitializeComponent();
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
        {
            await vm.LoginCommand.ExecuteAsync(PasswordBox.Password);
        }
    }

    private void Exit_Click(object sender, RoutedEventArgs e)
    {
        Application.Current.Shutdown();
    }

    private void ConnectDb_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new DatabaseConnectionDialog { Owner = this };
        if (dialog.ShowDialog() == true && DataContext is MainViewModel vm)
        {
            _ = vm.ConnectDatabaseCommand.ExecuteAsync(dialog.ConnectionString);
        }
    }

    private void DisconnectDb_Click(object sender, RoutedEventArgs e)
    {
        App.DatabaseService.Disconnect();
        if (DataContext is MainViewModel vm)
        {
            vm.AddLog("[DB] Disconnected from database");
        }
    }

    private void License_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new LicenseDialog { Owner = this };
        dialog.ShowDialog();
    }

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SettingsDialog { Owner = this };
        dialog.ShowDialog();
    }

    private void About_Click(object sender, RoutedEventArgs e)
    {
        var version = typeof(App).Assembly.GetName().Version;
        MessageBox.Show(
            $"Stratus Weather Station Manager\n" +
            $"Version {version}\n\n" +
            $"Research-grade weather station data acquisition\n" +
            $"and monitoring software.\n\n" +
            $"\u00a9 2025-2026 Lukas Esterhuizen. All rights reserved.\n\n" +
            $"Built with .NET 8, WPF, Npgsql",
            "About Stratus", MessageBoxButton.OK, MessageBoxImage.Information);
    }

    private SerialMonitorWindow? _serialMonitor;

    private void SerialMonitor_Click(object sender, RoutedEventArgs e)
    {
        if (_serialMonitor == null || !_serialMonitor.IsLoaded)
        {
            _serialMonitor = new SerialMonitorWindow { Owner = this };
            _serialMonitor.Closed += (_, _) => _serialMonitor = null;
            _serialMonitor.Show();
        }
        else
        {
            _serialMonitor.Activate();
        }
    }

    #region Wind Rose

    private void AngleSlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        // Guard: fires during XAML initialization before controls are assigned
        if (AngleLabel == null || WindRose24h == null)
            return;

        _currentSectorAngle = (int)e.NewValue;
        AngleLabel.Text = $"{_currentSectorAngle}\u00B0";

        // Recompute if we already have data
        if (_currentWindData != null && _currentWindData.Count > 0)
        {
            ComputeAndDisplayWindRoses(_currentWindData);
        }
    }

    private async void GenerateWindRose_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not MainViewModel vm)
            return;

        var records = vm.DataRecords;
        if (records == null || records.Count == 0)
        {
            MessageBox.Show("No station data loaded. Please select a station and load data first.",
                "No Data", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // Check that we have wind data columns
        var windRecords = records.Where(r => r.WindSpeed.HasValue && r.WindDirection.HasValue).ToList();
        if (windRecords.Count == 0)
        {
            MessageBox.Show("No wind speed/direction data found in the loaded records.",
                "No Wind Data", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // Offload conversion to background thread for large datasets
        var windData = await Task.Run(() => WindRoseCalculator.ConvertFromWeatherRecords(windRecords));
        _currentWindData = windData;

        string stationName = vm.SelectedStation?.Name ?? "Unknown Station";
        ComputeAndDisplayWindRoses(windData, stationName);

        vm.AddLog($"Wind rose generated from {windData.Count:N0} records ({stationName})");
    }

    private async void ImportCsvWindRose_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog
        {
            Title = "Import TOA5/CSV Wind Data",
            Filter = "Data Files (*.csv;*.dat;*.txt)|*.csv;*.dat;*.txt|TOA5 Files (*.dat)|*.dat|CSV Files (*.csv)|*.csv|All Files (*.*)|*.*",
            DefaultExt = ".dat"
        };

        if (dialog.ShowDialog() != true)
            return;

        try
        {
            // Parse on background thread to keep UI responsive for large files
            var windData = await Task.Run(() => CsvParser.ParseFile(dialog.FileName));
            _currentWindData = windData;

            string fileName = Path.GetFileNameWithoutExtension(dialog.FileName);
            ComputeAndDisplayWindRoses(windData, fileName);

            if (DataContext is MainViewModel vm)
                vm.AddLog($"Wind rose generated from file: {dialog.FileName} ({windData.Count:N0} records)");

            MessageBox.Show($"Successfully loaded {windData.Count:N0} wind records from file.",
                "Import Complete", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (IOException ex)
        {
            MessageBox.Show($"Error reading CSV file:\n\n{ex.Message}",
                "File Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        catch (InvalidDataException ex)
        {
            MessageBox.Show($"Invalid CSV format:\n\n{ex.Message}",
                "Format Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
        catch (FormatException ex)
        {
            MessageBox.Show($"Error parsing CSV data:\n\n{ex.Message}",
                "Parse Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void ExportWindRosePng_Click(object sender, RoutedEventArgs e)
    {
        if (_currentWindData == null || _currentWindData.Count == 0)
        {
            MessageBox.Show("No wind rose data to export. Generate a wind rose first.",
                "No Data", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // Get the currently visible wind rose control
        var activeControl = GetActiveWindRoseControl();
        if (activeControl == null)
        {
            MessageBox.Show("No wind rose tab is currently selected.",
                "Export Error", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var dialog = new SaveFileDialog
        {
            Title = "Export Wind Rose as PNG",
            Filter = "PNG Image (*.png)|*.png",
            DefaultExt = ".png",
            FileName = $"WindRose_{DateTime.Now:yyyyMMdd_HHmmss}.png"
        };

        if (dialog.ShowDialog() != true)
            return;

        try
        {
            ExportControlToPng(activeControl, dialog.FileName);

            if (DataContext is MainViewModel vm)
                vm.AddLog($"Wind rose exported to: {dialog.FileName}");

            MessageBox.Show("Wind rose exported successfully.",
                "Export Complete", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (IOException ex)
        {
            MessageBox.Show($"Error saving PNG file:\n\n{ex.Message}",
                "File Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void ComputeAndDisplayWindRoses(List<WindDataPoint> windData, string? title = null)
    {
        string prefix = title ?? "Wind Rose";
        double angle = _currentSectorAngle;
        var now = windData.Count > 0 ? windData.Max(d => d.Date) : DateTime.UtcNow;

        // 24h — last 24 hours of data
        var data24h = windData.Where(d => d.Date >= now.AddHours(-24)).ToList();
        WindRose24h.WindRoseData = WindRoseCalculator.Calculate(
            data24h.Count > 0 ? data24h : windData, angle, $"{prefix} — 24h");

        // 1d — last 1 calendar day
        var data1d = windData.Where(d => d.Date >= now.AddDays(-1)).ToList();
        WindRose1d.WindRoseData = WindRoseCalculator.Calculate(
            data1d.Count > 0 ? data1d : windData, angle, $"{prefix} — 1 Day");

        // 3d — last 3 days
        var data3d = windData.Where(d => d.Date >= now.AddDays(-3)).ToList();
        WindRose3d.WindRoseData = WindRoseCalculator.Calculate(
            data3d.Count > 0 ? data3d : windData, angle, $"{prefix} — 3 Days");

        // 7d — last 7 days
        var data7d = windData.Where(d => d.Date >= now.AddDays(-7)).ToList();
        WindRose7d.WindRoseData = WindRoseCalculator.Calculate(
            data7d.Count > 0 ? data7d : windData, angle, $"{prefix} — 7 Days");

        // 30d — last 30 days (all data)
        var data30d = windData.Where(d => d.Date >= now.AddDays(-30)).ToList();
        WindRose30d.WindRoseData = WindRoseCalculator.Calculate(
            data30d.Count > 0 ? data30d : windData, angle, $"{prefix} — 30 Days");
    }

    private WindRoseControl? GetActiveWindRoseControl()
    {
        if (WindRoseTabControl.SelectedItem is not System.Windows.Controls.TabItem tab)
            return null;

        return tab.Content as WindRoseControl;
    }

    /// <summary>
    /// Exports all visible charts as individual PNG images using LiveCharts2’s
    /// off-screen SkiaSharp renderer (RenderTargetBitmap cannot capture SkiaSharp content).
    /// </summary>
    private void ExportCharts_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is not MainViewModel vm || vm.SelectedStation == null)
        {
            MessageBox.Show("Load station data first, then export charts.", "No Data",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var exportDir = System.IO.Path.Combine(docs, "Stratus", "Charts",
            $"{vm.SelectedStation.Name}_{DateTime.Now:yyyyMMdd_HHmmss}");
        Directory.CreateDirectory(exportDir);

        int count = 0;
        foreach (var (label, (series, yAxes, visible)) in vm.ChartExportData)
        {
            if (!visible || series.Length == 0) continue;

            try
            {
                const int exportWidth = 3200;
                const int exportChartHeight = 800;
                const int titleHeight = 100;
                int totalHeight = exportChartHeight + titleHeight;

                // Build a minimal X-axis for the export render
                var xAxes = new Axis[]
                {
                    new Axis
                    {
                        Labeler = v => { try { return new DateTime((long)v).ToString("MM/dd HH:mm"); } catch { return ""; } },
                        LabelsRotation = -45,
                        TextSize = 36,
                        LabelsPaint = new SolidColorPaint(new SKColor(0x1E, 0x29, 0x3B)),
                    }
                };

                var skChart = new SKCartesianChart
                {
                    Width = exportWidth,
                    Height = exportChartHeight,
                    Series = series,
                    XAxes = xAxes,
                    YAxes = yAxes.Length > 0 ? yAxes : Array.Empty<LiveChartsCore.Kernel.Sketches.ICartesianAxis>(),
                    Background = SKColors.White,
                    LegendPosition = LiveChartsCore.Measure.LegendPosition.Top,
                    LegendTextSize = 32,
                };

                using var chartImage = skChart.GetImage();

                // Composite: title bar + chart
                var info = new SKImageInfo(exportWidth, totalHeight);
                using var surface = SKSurface.Create(info);
                var canvas = surface.Canvas;
                canvas.Clear(new SKColor(0xF8, 0xFA, 0xFC));  // Light title bar bg

                // Draw title
                string titleText = $"{label}  —  {vm.SelectedStation.Name}";
                using var titlePaint = new SKPaint
                {
                    Color = new SKColor(0x1E, 0x29, 0x3B),  // Dark title text
                    IsAntialias = true,
                    TextSize = 60,
                    Typeface = SKTypeface.FromFamilyName("Segoe UI", SKFontStyleWeight.Bold, SKFontStyleWidth.Normal, SKFontStyleSlant.Upright),
                    TextAlign = SKTextAlign.Center,
                };
                canvas.DrawText(titleText, exportWidth / 2f, 70, titlePaint);

                // Accent line under title
                using var accentPen = new SKPaint { Color = new SKColor(0x25, 0x63, 0xEB), StrokeWidth = 3, IsAntialias = true };
                canvas.DrawLine(0, titleHeight - 2, exportWidth, titleHeight - 2, accentPen);
                canvas.DrawBitmap(SKBitmap.FromImage(chartImage), 0, titleHeight);

                using var finalImage = surface.Snapshot();
                using var encoded = finalImage.Encode(SKEncodedImageFormat.Png, 100);

                string safeName = string.Join("_", label.Split(Path.GetInvalidFileNameChars()));
                string filePath = Path.Combine(exportDir, $"{safeName}.png");
                using var fs = File.Create(filePath);
                encoded.SaveTo(fs);
                count++;
            }
            catch (Exception ex)
            {
                vm.AddLog($"[WARN] Failed to export '{label}': {ex.Message}");
            }
        }

        if (count > 0)
        {
            vm.AddLog($"[EXPORT] Saved {count} chart(s) to {exportDir}");
            System.Diagnostics.Process.Start("explorer.exe", exportDir);
        }
        else
        {
            MessageBox.Show("No visible charts to export. Load data first.", "No Charts",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    /// <summary>
    /// Renders a <see cref="WindRoseControl"/> to a high-resolution PNG file
    /// using an offscreen clone so the live visual tree is not mutated.
    /// </summary>
    private static void ExportControlToPng(WindRoseControl source, string filePath)
    {
        const int width = 1200;
        const int height = 800;
        const double dpi = 192.0; // 2× resolution for publication-quality output

        // Create offscreen clone to avoid mutating the live visual tree
        var offscreen = new WindRoseControl
        {
            WindRoseData = source.WindRoseData,
            Width = width,
            Height = height
        };

        offscreen.Measure(new Size(width, height));
        offscreen.Arrange(new Rect(0, 0, width, height));
        offscreen.UpdateLayout();

        var renderBitmap = new RenderTargetBitmap(
            (int)(width * dpi / 96.0),
            (int)(height * dpi / 96.0),
            dpi, dpi,
            PixelFormats.Pbgra32);

        renderBitmap.Render(offscreen);

        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(renderBitmap));

        using var stream = File.Create(filePath);
        encoder.Save(stream);
    }

    #endregion

    #region Professional Features — Reports, Calibration, Audit, Gaps, Config, Help, Updates

    private void Report_Click(object sender, RoutedEventArgs e)
    {
        var vm = (MainViewModel)DataContext;
        var dialog = new ReportDialog(vm.SelectedStation, vm.DataRecords.ToList())
        {
            Owner = this
        };
        dialog.ShowDialog();
    }

    private void Calibration_Click(object sender, RoutedEventArgs e)
    {
        var vm = (MainViewModel)DataContext;
        var stationId = vm.SelectedStation?.Id ?? 0;
        var dialog = new CalibrationDialog(stationId)
        {
            Owner = this
        };
        dialog.ShowDialog();
    }

    private void AuditTrail_Click(object sender, RoutedEventArgs e)
    {
        var window = new AuditLogWindow
        {
            Owner = this
        };
        window.ShowDialog();
    }

    private void DataGap_Click(object sender, RoutedEventArgs e)
    {
        var vm = (MainViewModel)DataContext;
        var station = vm.SelectedStation;
        var dialog = new DataGapDialog(station?.Id ?? 0, vm.DataRecords.ToList(), station?.Name)
        {
            Owner = this
        };
        dialog.ShowDialog();
    }

    private void StationConfig_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new StationConfigWizard
        {
            Owner = this
        };
        dialog.ShowDialog();
    }

    private void Help_Click(object sender, RoutedEventArgs e)
    {
        var window = new HelpWindow
        {
            Owner = this
        };
        window.Show();
    }

    private void CheckUpdate_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new UpdateDialog
        {
            Owner = this
        };
        dialog.ShowDialog();
    }

    private void QcDashboard_Click(object sender, RoutedEventArgs e)
    {
        var vm = (MainViewModel)DataContext;
        var window = new QualityDashboardWindow(vm.DataRecords.ToList(), vm.SelectedStation?.Name)
        {
            Owner = this
        };
        window.ShowDialog();
    }

    private void QcRules_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new QualityRulesDialog
        {
            Owner = this
        };
        dialog.ShowDialog();
    }

    #endregion
}

/// <summary>
/// Converts bool to color (green for connected, red for disconnected).
/// </summary>
public class BoolToColorConverter : IValueConverter
{
    private static readonly SolidColorBrush ConnectedBrush;
    private static readonly SolidColorBrush DisconnectedBrush;

    static BoolToColorConverter()
    {
        ConnectedBrush = new SolidColorBrush(Color.FromRgb(0x27, 0xAE, 0x60));
        ConnectedBrush.Freeze();
        DisconnectedBrush = new SolidColorBrush(Color.FromRgb(0xE7, 0x4C, 0x3C));
        DisconnectedBrush.Freeze();
    }

    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is true ? ConnectedBrush : DisconnectedBrush;
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}

/// <summary>
/// Converts collection state to button text.
/// </summary>
public class BoolToCollectionTextConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is true ? "Stop Collection" : "Start Collection";
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
