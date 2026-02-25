using System;
using System.Globalization;
using System.Windows;
using System.Windows.Media;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Controls;

/// <summary>
/// Custom WPF control that renders a wind rose chart using DrawingContext.
/// 
/// <para>
/// Wind direction sectors are drawn as stacked wedges coloured by speed category.
/// The chart includes a radial grid with percentage labels, 16-point compass labels,
/// a colour legend, and calm percentage indicator at the centre.
/// </para>
/// <para>
/// <b>Data binding:</b> Set the <see cref="WindRoseData"/> dependency property
/// with a <see cref="WindRoseResult"/> to render the chart. Setting it to null
/// shows a placeholder message.
/// </para>
/// <para>
/// <b>Export:</b> Use <c>RenderTargetBitmap</c> to capture the control as a PNG.
/// </para>
/// </summary>
public class WindRoseControl : FrameworkElement
{
    /// <summary>
    /// Identifies the <see cref="WindRoseData"/> dependency property.
    /// </summary>
    public static readonly DependencyProperty WindRoseDataProperty =
        DependencyProperty.Register(nameof(WindRoseData), typeof(WindRoseResult),
            typeof(WindRoseControl),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

    /// <summary>
    /// Gets or sets the wind rose data to render. Setting to null shows a placeholder.
    /// </summary>
    public WindRoseResult? WindRoseData
    {
        get => (WindRoseResult?)GetValue(WindRoseDataProperty);
        set => SetValue(WindRoseDataProperty, value);
    }

    // Cached brushes and pens (frozen for thread safety and performance)
    private static readonly Brush[] SpeedBrushes;
    private static readonly Pen OutlinePen = new(Brushes.White, 0.5);
    private static readonly Pen GridPen = new(new SolidColorBrush(Color.FromArgb(80, 120, 120, 120)), 0.5);
    private static readonly Pen AxisPen = new(new SolidColorBrush(Color.FromArgb(100, 80, 80, 80)), 0.5);
    private static readonly Pen LegendBoxPen = new(Brushes.Gray, 0.5);
    private static readonly Typeface ChartTypeface = new(
        new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);

    static WindRoseControl()
    {
        OutlinePen.Freeze();
        GridPen.Freeze();
        AxisPen.Freeze();
        LegendBoxPen.Freeze();

        SpeedBrushes = new Brush[WindSpeedCategories.Categories.Length];
        for (int i = 0; i < WindSpeedCategories.Categories.Length; i++)
        {
            var color = (Color)ColorConverter.ConvertFromString(WindSpeedCategories.Categories[i].Color);
            SpeedBrushes[i] = new SolidColorBrush(color);
            SpeedBrushes[i].Freeze();
        }
    }

    /// <inheritdoc/>
    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);

        double width = ActualWidth;
        double height = ActualHeight;

        // Guard against degenerate layout (collapsed or pre-layout)
        if (width < 50 || height < 50)
            return;

        var data = WindRoseData;
        if (data == null || data.Sectors.Count == 0)
        {
            DrawNoDataMessage(dc, width, height);
            return;
        }

        double titleHeight = 40;
        double legendWidth = 160;
        double plotSize = Math.Min(width - legendWidth - 20, height - titleHeight - 20);
        if (plotSize < 100) plotSize = 100;

        double radius = plotSize / 2.0 - 30;
        if (radius < 20) radius = 20;
        double centerX = (width - legendWidth) / 2.0;
        double centerY = titleHeight + plotSize / 2.0;

        // Cache DPI for this render pass
        double pixelsPerDip = VisualTreeHelper.GetDpi(this).PixelsPerDip;

        dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, width, height));
        DrawTitle(dc, data.Title, width - legendWidth, titleHeight, pixelsPerDip);
        DrawGrid(dc, centerX, centerY, radius, data.MaxPercentage, pixelsPerDip);
        DrawSectors(dc, centerX, centerY, radius, data);
        DrawDirectionLabels(dc, centerX, centerY, radius, pixelsPerDip);
        DrawLegend(dc, width - legendWidth + 10, titleHeight + 20, data, pixelsPerDip);
        DrawCalmInfo(dc, centerX, centerY, data.CalmPercentage, pixelsPerDip);
    }

    private void DrawNoDataMessage(DrawingContext dc, double width, double height)
    {
        dc.DrawRectangle(Brushes.White, null, new Rect(0, 0, width, height));
        double ppd = VisualTreeHelper.GetDpi(this).PixelsPerDip;
        var text = MakeText("No wind data available.\nSelect a station and load data to generate a wind rose.",
            14, Brushes.Gray, Math.Max(width - 40, 200), ppd);
        dc.DrawText(text, new Point((width - text.Width) / 2, (height - text.Height) / 2));
    }

    private void DrawTitle(DrawingContext dc, string title, double availableWidth, double titleHeight, double ppd)
    {
        var text = MakeText(title, 18, Brushes.Black, availableWidth, ppd);
        text.SetFontWeight(FontWeights.Bold);
        dc.DrawText(text, new Point(
            (availableWidth - text.Width) / 2,
            (titleHeight - text.Height) / 2));
    }

    private void DrawGrid(DrawingContext dc, double cx, double cy, double radius, double maxPct, double ppd)
    {
        double gridMax = Math.Ceiling(maxPct / 5.0) * 5.0;
        if (gridMax < 5) gridMax = 5;

        int numCircles = (int)(gridMax / 5.0);
        if (numCircles > 8) numCircles = (int)(gridMax / 10.0);
        if (numCircles < 1) numCircles = 1;

        double interval = gridMax / numCircles;

        for (int i = 1; i <= numCircles; i++)
        {
            double pct = i * interval;
            double r = (pct / gridMax) * radius;
            dc.DrawEllipse(null, GridPen, new Point(cx, cy), r, r);

            var text = MakeText($"{pct:F0}%", 9, Brushes.Gray, 60, ppd);
            dc.DrawText(text, new Point(cx + 3, cy - r - text.Height));
        }

        // Draw 8 axis lines (N, NE, E, SE, S, SW, W, NW)
        for (int angle = 0; angle < 360; angle += 45)
        {
            double rad = (angle - 90) * Math.PI / 180.0;
            double x2 = cx + radius * Math.Cos(rad);
            double y2 = cy + radius * Math.Sin(rad);
            dc.DrawLine(AxisPen, new Point(cx, cy), new Point(x2, y2));
        }
    }

    private static void DrawSectors(DrawingContext dc, double cx, double cy, double radius, WindRoseResult data)
    {
        double gridMax = Math.Ceiling(data.MaxPercentage / 5.0) * 5.0;
        if (gridMax < 5) gridMax = 5;

        var categories = WindSpeedCategories.Categories;

        foreach (var sector in data.Sectors)
        {
            double cumulativeRadius = 0;
            for (int c = 0; c < categories.Length && c < sector.SpeedBinPercentages.Length; c++)
            {
                double pct = sector.SpeedBinPercentages[c];
                if (pct <= 0) continue;

                double innerR = (cumulativeRadius / gridMax) * radius;
                cumulativeRadius += pct;
                double outerR = (cumulativeRadius / gridMax) * radius;

                DrawWedge(dc, cx, cy, innerR, outerR,
                    sector.StartAngle, sector.EndAngle,
                    SpeedBrushes[c], OutlinePen);
            }
        }
    }

    /// <summary>
    /// Draw a single wedge (annular sector) using StreamGeometry for efficiency.
    /// </summary>
    private static void DrawWedge(DrawingContext dc, double cx, double cy,
        double innerRadius, double outerRadius,
        double startAngle, double endAngle,
        Brush fill, Pen pen)
    {
        if (outerRadius <= 0) return;

        double startRad = (startAngle - 90) * Math.PI / 180.0;
        double endRad = (endAngle - 90) * Math.PI / 180.0;

        Point outerStart = new(cx + outerRadius * Math.Cos(startRad), cy + outerRadius * Math.Sin(startRad));
        Point outerEnd = new(cx + outerRadius * Math.Cos(endRad), cy + outerRadius * Math.Sin(endRad));

        double angleDiff = endAngle - startAngle;
        bool isLargeArc = angleDiff > 180;

        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            if (innerRadius <= 0.5)
            {
                // Degenerate inner radius: draw a pie slice from centre
                var centre = new Point(cx, cy);
                ctx.BeginFigure(centre, true, true);
                ctx.LineTo(outerStart, true, false);
                ctx.ArcTo(outerEnd, new Size(outerRadius, outerRadius), 0,
                    isLargeArc, SweepDirection.Clockwise, true, false);
                ctx.LineTo(centre, true, false);
            }
            else
            {
                Point innerStart = new(cx + innerRadius * Math.Cos(startRad), cy + innerRadius * Math.Sin(startRad));
                Point innerEnd = new(cx + innerRadius * Math.Cos(endRad), cy + innerRadius * Math.Sin(endRad));

                ctx.BeginFigure(outerStart, true, true);
                ctx.ArcTo(outerEnd, new Size(outerRadius, outerRadius), 0,
                    isLargeArc, SweepDirection.Clockwise, true, false);
                ctx.LineTo(innerEnd, true, false);
                ctx.ArcTo(innerStart, new Size(innerRadius, innerRadius), 0,
                    isLargeArc, SweepDirection.Counterclockwise, true, false);
                ctx.LineTo(outerStart, true, false);
            }
        }
        geometry.Freeze();
        dc.DrawGeometry(fill, pen, geometry);
    }

    private void DrawDirectionLabels(DrawingContext dc, double cx, double cy, double radius, double ppd)
    {
        // 16-point compass rose labels
        var directions = new (string Label, double Angle)[]
        {
            ("N", 0), ("NNE", 22.5), ("NE", 45), ("ENE", 67.5),
            ("E", 90), ("ESE", 112.5), ("SE", 135), ("SSE", 157.5),
            ("S", 180), ("SSW", 202.5), ("SW", 225), ("WSW", 247.5),
            ("W", 270), ("WNW", 292.5), ("NW", 315), ("NNW", 337.5)
        };

        double labelOffset = radius + 18;
        foreach (var (label, angle) in directions)
        {
            double rad = (angle - 90) * Math.PI / 180.0;
            double x = cx + labelOffset * Math.Cos(rad);
            double y = cy + labelOffset * Math.Sin(rad);

            var text = MakeText(label, 12, Brushes.Black, 40, ppd);
            text.SetFontWeight(FontWeights.SemiBold);
            dc.DrawText(text, new Point(x - text.Width / 2, y - text.Height / 2));
        }
    }

    private void DrawLegend(DrawingContext dc, double x, double y, WindRoseResult data, double ppd)
    {
        var categories = WindSpeedCategories.Categories;
        string unitLabel = "Wind Speed (km/h)";

        var titleText = MakeText(unitLabel, 11, Brushes.Black, 150, ppd);
        titleText.SetFontWeight(FontWeights.Bold);
        dc.DrawText(titleText, new Point(x, y));
        y += 25;

        double boxSize = 16;
        double spacing = 22;

        // Draw legend entries from highest to lowest speed
        for (int i = categories.Length - 1; i >= 0; i--)
        {
            dc.DrawRectangle(SpeedBrushes[i], LegendBoxPen,
                new Rect(x, y, boxSize, boxSize));

            var text = MakeText(categories[i].Label, 10, Brushes.Black, 130, ppd);
            dc.DrawText(text, new Point(x + boxSize + 6, y + 1));
            y += spacing;
        }

        y += 10;
        var countText = MakeText($"n = {data.TotalRecords:N0}", 10, Brushes.Gray, 150, ppd);
        dc.DrawText(countText, new Point(x, y));
    }

    private void DrawCalmInfo(DrawingContext dc, double cx, double cy, double calmPct, double ppd)
    {
        var text = MakeText($"Calm: {calmPct:F1}%", 10, Brushes.DarkSlateGray, 100, ppd);
        dc.DrawText(text, new Point(cx - text.Width / 2, cy - text.Height / 2));
    }

    /// <summary>
    /// Create formatted text using cached typeface for consistent, efficient rendering.
    /// </summary>
    private static FormattedText MakeText(string text, double fontSize, Brush brush, double maxWidth, double pixelsPerDip)
    {
        return new FormattedText(
            text,
            CultureInfo.InvariantCulture,
            FlowDirection.LeftToRight,
            ChartTypeface,
            fontSize,
            brush,
            pixelsPerDip)
        {
            MaxTextWidth = maxWidth
        };
    }
}
