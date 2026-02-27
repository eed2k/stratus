using System.IO;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Generates professional PDF reports with station summaries, statistics tables,
/// and data quality metrics. Uses QuestPDF for layout.
/// </summary>
public class ReportService
{
    static ReportService()
    {
        // QuestPDF community licence (free for revenue < $1M)
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    /// <summary>
    /// Generates a monthly or custom-range summary PDF report.
    /// </summary>
    public static string GenerateReport(ReportRequest request)
    {
        Log.Information("Generating report: {Title} ({From:d} – {To:d})",
            request.Title, request.From, request.To);

        var records = request.Records;
        var station = request.Station;

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.MarginHorizontal(40);
                page.MarginVertical(30);
                page.DefaultTextStyle(x => x.FontSize(10).FontFamily("Segoe UI"));

                page.Header().Element(c => ComposeHeader(c, request));
                page.Content().Element(c => ComposeContent(c, request, records));
                page.Footer().Element(ComposeFooter);
            });
        });

        var outputPath = request.OutputPath;
        if (string.IsNullOrEmpty(outputPath))
        {
            var exportDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "Stratus", "Reports");
            Directory.CreateDirectory(exportDir);
            var safeName = string.Join("_", (station?.Name ?? "Station").Split(Path.GetInvalidFileNameChars()));
            outputPath = Path.Combine(exportDir,
                $"{safeName}_Report_{request.From:yyyyMMdd}-{request.To:yyyyMMdd}.pdf");
        }

        doc.GeneratePdf(outputPath);
        Log.Information("Report saved to {Path}", outputPath);
        return outputPath;
    }

    private static void ComposeHeader(IContainer container, ReportRequest req)
    {
        container.Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().Column(c =>
                {
                    c.Item().Text(req.Title).FontSize(22).Bold().FontColor(Colors.Blue.Darken3);
                    c.Item().Text($"{req.Station?.Name ?? "Unknown Station"}")
                        .FontSize(14).FontColor(Colors.Grey.Darken2);
                });
                row.ConstantItem(120).AlignRight().Column(c =>
                {
                    c.Item().Text("STRATUS").FontSize(16).Bold().FontColor(Colors.Blue.Darken2);
                    c.Item().Text("Weather Report").FontSize(9).FontColor(Colors.Grey.Medium);
                });
            });

            col.Item().PaddingVertical(4).LineHorizontal(2).LineColor(Colors.Blue.Darken3);

            col.Item().Row(row =>
            {
                row.RelativeItem().Text($"Period: {req.From:yyyy-MM-dd} to {req.To:yyyy-MM-dd}")
                    .FontSize(9).FontColor(Colors.Grey.Darken1);
                row.RelativeItem().AlignRight().Text($"Generated: {DateTime.Now:yyyy-MM-dd HH:mm}")
                    .FontSize(9).FontColor(Colors.Grey.Darken1);
            });
            col.Item().PaddingBottom(8);
        });
    }

    private static void ComposeContent(IContainer container, ReportRequest req, IReadOnlyList<WeatherRecord> records)
    {
        container.Column(col =>
        {
            // Station info
            if (req.Station != null)
            {
                col.Item().Element(c => ComposeStationInfo(c, req.Station));
                col.Item().PaddingVertical(6);
            }

            // Data summary
            col.Item().Element(c => ComposeDataSummary(c, records, req.From, req.To));
            col.Item().PaddingVertical(8);

            // Statistical tables
            col.Item().Text("Statistical Summary").FontSize(14).Bold().FontColor(Colors.Blue.Darken3);
            col.Item().PaddingVertical(4);

            var stats = ComputeStatistics(records);
            col.Item().Element(c => ComposeStatsTable(c, stats));
            col.Item().PaddingVertical(8);

            // Data quality
            col.Item().Text("Data Quality").FontSize(14).Bold().FontColor(Colors.Blue.Darken3);
            col.Item().PaddingVertical(4);
            col.Item().Element(c => ComposeDataQuality(c, records, req.From, req.To));

            // Wind summary
            var windRecords = records.Where(r => r.WindSpeed.HasValue && r.WindDirection.HasValue).ToList();
            if (windRecords.Count > 0)
            {
                col.Item().PaddingVertical(8);
                col.Item().Text("Wind Summary").FontSize(14).Bold().FontColor(Colors.Blue.Darken3);
                col.Item().PaddingVertical(4);
                col.Item().Element(c => ComposeWindSummary(c, windRecords));
            }

            // Rainfall summary
            var rainRecords = records.Where(r => r.Rainfall.HasValue).ToList();
            if (rainRecords.Count > 0)
            {
                col.Item().PaddingVertical(8);
                col.Item().Text("Precipitation Summary").FontSize(14).Bold().FontColor(Colors.Blue.Darken3);
                col.Item().PaddingVertical(4);
                col.Item().Element(c => ComposeRainfallSummary(c, rainRecords));
            }
        });
    }

    private static void ComposeStationInfo(IContainer container, WeatherStation station)
    {
        container.Background(Colors.Grey.Lighten4).Padding(10).Column(col =>
        {
            col.Item().Text("Station Information").FontSize(12).Bold().FontColor(Colors.Blue.Darken3);
            col.Item().PaddingTop(4);
            col.Item().Row(row =>
            {
                row.RelativeItem().Text($"Name: {station.Name}").FontSize(10);
                row.RelativeItem().Text($"Location: {station.Location}").FontSize(10);
            });
            col.Item().Row(row =>
            {
                row.RelativeItem().Text($"Latitude: {station.Latitude:F6}°").FontSize(10);
                row.RelativeItem().Text($"Longitude: {station.Longitude:F6}°").FontSize(10);
                row.RelativeItem().Text($"Elevation: {station.Elevation:F0} m").FontSize(10);
            });
            if (!string.IsNullOrEmpty(station.DataloggerModel))
                col.Item().Text($"Datalogger: {station.DataloggerModel}").FontSize(10);
        });
    }

    private static void ComposeDataSummary(IContainer container, IReadOnlyList<WeatherRecord> records,
        DateTime from, DateTime to)
    {
        var expectedSpan = to - from;
        container.Row(row =>
        {
            void InfoBox(string label, string value)
            {
                row.RelativeItem().Border(1).BorderColor(Colors.Grey.Lighten2)
                    .Background(Colors.White).Padding(8).Column(c =>
                    {
                        c.Item().Text(label).FontSize(8).FontColor(Colors.Grey.Medium);
                        c.Item().Text(value).FontSize(16).Bold().FontColor(Colors.Blue.Darken3);
                    });
            }

            InfoBox("Total Records", $"{records.Count:N0}");
            InfoBox("Period", $"{expectedSpan.TotalDays:F0} days");
            InfoBox("First Record", records.Count > 0 ? records.Min(r => r.Timestamp).ToString("g") : "—");
            InfoBox("Last Record", records.Count > 0 ? records.Max(r => r.Timestamp).ToString("g") : "—");
        });
    }

    private static void ComposeStatsTable(IContainer container, List<DataSummary> stats)
    {
        container.Table(table =>
        {
            table.ColumnsDefinition(cols =>
            {
                cols.RelativeColumn(2);  // Parameter
                cols.RelativeColumn(1);  // Unit
                cols.RelativeColumn(1);  // Min
                cols.RelativeColumn(1);  // Max
                cols.RelativeColumn(1);  // Mean
                cols.RelativeColumn(1);  // Count
            });

            // Header
            table.Header(header =>
            {
                var headerStyle = TextStyle.Default.FontSize(9).Bold().FontColor(Colors.White);
                void HeaderCell(string text) =>
                    header.Cell().Background(Colors.Blue.Darken3).Padding(4).Text(text).Style(headerStyle);

                HeaderCell("Parameter");
                HeaderCell("Unit");
                HeaderCell("Min");
                HeaderCell("Max");
                HeaderCell("Mean");
                HeaderCell("Count");
            });

            foreach (var stat in stats)
            {
                var bg = stats.IndexOf(stat) % 2 == 0 ? Colors.White : Colors.Grey.Lighten4;
                var cellStyle = TextStyle.Default.FontSize(9);

                table.Cell().Background(bg).Padding(4).Text(stat.Field).Style(cellStyle);
                table.Cell().Background(bg).Padding(4).Text(stat.Unit).Style(cellStyle);
                table.Cell().Background(bg).Padding(4).AlignRight()
                    .Text(stat.Min?.ToString("F2") ?? "—").Style(cellStyle);
                table.Cell().Background(bg).Padding(4).AlignRight()
                    .Text(stat.Max?.ToString("F2") ?? "—").Style(cellStyle);
                table.Cell().Background(bg).Padding(4).AlignRight()
                    .Text(stat.Average?.ToString("F2") ?? "—").Style(cellStyle);
                table.Cell().Background(bg).Padding(4).AlignRight()
                    .Text(stat.Count.ToString("N0")).Style(cellStyle);
            }
        });
    }

    private static void ComposeDataQuality(IContainer container, IReadOnlyList<WeatherRecord> records,
        DateTime from, DateTime to)
    {
        if (records.Count < 2)
        {
            container.Text("Insufficient data for quality analysis").FontSize(10);
            return;
        }

        var sorted = records.OrderBy(r => r.Timestamp).ToList();
        var intervals = new List<double>();
        for (int i = 1; i < sorted.Count; i++)
            intervals.Add((sorted[i].Timestamp - sorted[i - 1].Timestamp).TotalMinutes);

        var medianInterval = intervals.OrderBy(x => x).ElementAt(intervals.Count / 2);
        var gapThreshold = medianInterval * 2;
        var gapCount = intervals.Count(i => i > gapThreshold);
        var totalSpan = (to - from).TotalMinutes;
        var coverage = totalSpan > 0 ? (1.0 - intervals.Where(i => i > gapThreshold).Sum() / totalSpan) * 100 : 100;

        container.Background(Colors.Grey.Lighten4).Padding(10).Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().Text($"Median sampling interval: {medianInterval:F1} min").FontSize(10);
                row.RelativeItem().Text($"Data gaps detected: {gapCount}").FontSize(10);
            });
            col.Item().Text($"Data coverage: {Math.Min(coverage, 100):F1}%").FontSize(10)
                .FontColor(coverage >= 95 ? Colors.Green.Darken2 : coverage >= 80 ? Colors.Orange.Darken2 : Colors.Red.Darken2);
        });
    }

    private static void ComposeWindSummary(IContainer container, List<WeatherRecord> windRecords)
    {
        var speeds = windRecords.Select(r => r.WindSpeed!.Value).ToList();
        var directions = windRecords.Select(r => r.WindDirection!.Value).ToList();
        var gusts = windRecords.Where(r => r.WindGust.HasValue).Select(r => r.WindGust!.Value).ToList();

        // Predominant wind direction (circular mean)
        var sinSum = directions.Sum(d => Math.Sin(d * Math.PI / 180));
        var cosSum = directions.Sum(d => Math.Cos(d * Math.PI / 180));
        var predominantDir = (Math.Atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
        var dirLabel = GetCompassDirection(predominantDir);

        container.Background(Colors.Grey.Lighten4).Padding(10).Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().Text($"Mean speed: {speeds.Average():F1} m/s").FontSize(10);
                row.RelativeItem().Text($"Max speed: {speeds.Max():F1} m/s").FontSize(10);
                row.RelativeItem().Text($"Predominant: {dirLabel} ({predominantDir:F0}°)").FontSize(10);
            });
            if (gusts.Count > 0)
                col.Item().Text($"Max gust: {gusts.Max():F1} m/s").FontSize(10);
        });
    }

    private static void ComposeRainfallSummary(IContainer container, List<WeatherRecord> rainRecords)
    {
        var values = rainRecords.Select(r => r.Rainfall!.Value).ToList();
        var total = values.Sum();
        var rainyCount = values.Count(v => v > 0);

        container.Background(Colors.Grey.Lighten4).Padding(10).Column(col =>
        {
            col.Item().Row(row =>
            {
                row.RelativeItem().Text($"Total rainfall: {total:F1} mm").FontSize(10);
                row.RelativeItem().Text($"Records with rain: {rainyCount}").FontSize(10);
                row.RelativeItem().Text($"Max per interval: {values.Max():F1} mm").FontSize(10);
            });
        });
    }

    private static void ComposeFooter(IContainer container)
    {
        container.Column(col =>
        {
            col.Item().LineHorizontal(1).LineColor(Colors.Grey.Lighten2);
            col.Item().PaddingTop(4).Row(row =>
            {
                row.RelativeItem().Text(t =>
                {
                    t.Span("Generated by ").FontSize(8).FontColor(Colors.Grey.Medium);
                    t.Span("Stratus Weather Station Manager").FontSize(8).Bold().FontColor(Colors.Blue.Darken2);
                    t.Span($"  •  © {DateTime.Now.Year} Lukas Esterhuizen").FontSize(8).FontColor(Colors.Grey.Medium);
                });
                row.ConstantItem(60).AlignRight().Text(t =>
                {
                    t.Span("Page ").FontSize(8).FontColor(Colors.Grey.Medium);
                    t.CurrentPageNumber().FontSize(8);
                    t.Span(" / ").FontSize(8).FontColor(Colors.Grey.Medium);
                    t.TotalPages().FontSize(8);
                });
            });
        });
    }

    private static List<DataSummary> ComputeStatistics(IReadOnlyList<WeatherRecord> records)
    {
        var stats = new List<DataSummary>();

        void AddStat(string name, string unit, Func<WeatherRecord, double?> selector)
        {
            var values = records.Select(selector).Where(v => v.HasValue).Select(v => v!.Value).ToList();
            if (values.Count == 0) return;
            stats.Add(new DataSummary
            {
                Field = name,
                Unit = unit,
                Min = values.Min(),
                Max = values.Max(),
                Average = values.Average(),
                Count = values.Count,
            });
        }

        AddStat("Temperature", "°C", r => r.Temperature);
        AddStat("Temperature Min", "°C", r => r.TemperatureMin);
        AddStat("Temperature Max", "°C", r => r.TemperatureMax);
        AddStat("Humidity", "%", r => r.Humidity);
        AddStat("Pressure", "hPa", r => r.Pressure);
        AddStat("Dew Point", "°C", r => r.DewPoint);
        AddStat("Air Density", "kg/m³", r => r.AirDensity);
        AddStat("Wind Speed", "m/s", r => r.WindSpeed);
        AddStat("Wind Direction", "°", r => r.WindDirection);
        AddStat("Wind Gust", "m/s", r => r.WindGust);
        AddStat("Rainfall", "mm", r => r.Rainfall);
        AddStat("Solar Radiation", "W/m²", r => r.SolarRadiation);
        AddStat("UV Index", "", r => r.UvIndex);
        AddStat("ETo", "mm", r => r.Eto);
        AddStat("Soil Temperature", "°C", r => r.SoilTemperature);
        AddStat("Soil Moisture", "%", r => r.SoilMoisture);
        AddStat("Battery Voltage", "V", r => r.BatteryVoltage);
        AddStat("PM2.5", "µg/m³", r => r.Pm25);
        AddStat("PM10", "µg/m³", r => r.Pm10);
        AddStat("CO₂", "ppm", r => r.Co2);
        AddStat("TVOC", "ppb", r => r.Tvoc);

        return stats;
    }

    private static string GetCompassDirection(double degrees)
    {
        string[] dirs = { "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                          "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW" };
        var index = (int)Math.Round(degrees / 22.5) % 16;
        return dirs[index];
    }
}

/// <summary>
/// Parameters for PDF report generation.
/// </summary>
public class ReportRequest
{
    public string Title { get; set; } = "Weather Station Report";
    public DateTime From { get; set; }
    public DateTime To { get; set; }
    public WeatherStation? Station { get; set; }
    public IReadOnlyList<WeatherRecord> Records { get; set; } = Array.Empty<WeatherRecord>();
    public string? OutputPath { get; set; }
}
