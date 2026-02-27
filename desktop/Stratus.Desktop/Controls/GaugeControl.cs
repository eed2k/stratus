using System;
using System.Globalization;
using System.Windows;
using System.Windows.Media;

namespace Stratus.Desktop.Controls;

/// <summary>
/// RTDM-style circular analog gauge control with needle, color-coded arc zones,
/// and large digital readout. Renders via DrawingContext for crisp vector output.
///
/// <para><b>Properties:</b></para>
/// <list type="bullet">
///     <item><see cref="Value"/> — current reading</item>
///     <item><see cref="MinValue"/>, <see cref="MaxValue"/> — gauge range</item>
///     <item><see cref="Unit"/> — unit label (°C, %, hPa, etc.)</item>
///     <item><see cref="Label"/> — parameter name</item>
///     <item><see cref="ValueFormat"/> — format string for the digital readout</item>
///     <item><see cref="AccentColor"/> — main accent color for the gauge arc</item>
/// </list>
/// </summary>
public class GaugeControl : FrameworkElement
{
    // ═══════════════ Dependency Properties ═══════════════

    public static readonly DependencyProperty ValueProperty =
        DependencyProperty.Register(nameof(Value), typeof(double?), typeof(GaugeControl),
            new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty MinValueProperty =
        DependencyProperty.Register(nameof(MinValue), typeof(double), typeof(GaugeControl),
            new FrameworkPropertyMetadata(0.0, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty MaxValueProperty =
        DependencyProperty.Register(nameof(MaxValue), typeof(double), typeof(GaugeControl),
            new FrameworkPropertyMetadata(100.0, FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty UnitProperty =
        DependencyProperty.Register(nameof(Unit), typeof(string), typeof(GaugeControl),
            new FrameworkPropertyMetadata("", FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty LabelProperty =
        DependencyProperty.Register(nameof(Label), typeof(string), typeof(GaugeControl),
            new FrameworkPropertyMetadata("", FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty ValueFormatProperty =
        DependencyProperty.Register(nameof(ValueFormat), typeof(string), typeof(GaugeControl),
            new FrameworkPropertyMetadata("F1", FrameworkPropertyMetadataOptions.AffectsRender));

    public static readonly DependencyProperty AccentColorProperty =
        DependencyProperty.Register(nameof(AccentColor), typeof(Color), typeof(GaugeControl),
            new FrameworkPropertyMetadata(Color.FromRgb(0x1D, 0x4E, 0xD8), FrameworkPropertyMetadataOptions.AffectsRender));

    // ═══════════════ Properties ═══════════════

    public double? Value { get => (double?)GetValue(ValueProperty); set => SetValue(ValueProperty, value); }
    public double MinValue { get => (double)GetValue(MinValueProperty); set => SetValue(MinValueProperty, value); }
    public double MaxValue { get => (double)GetValue(MaxValueProperty); set => SetValue(MaxValueProperty, value); }
    public string Unit { get => (string)GetValue(UnitProperty); set => SetValue(UnitProperty, value); }
    public string Label { get => (string)GetValue(LabelProperty); set => SetValue(LabelProperty, value); }
    public string ValueFormat { get => (string)GetValue(ValueFormatProperty); set => SetValue(ValueFormatProperty, value); }
    public Color AccentColor { get => (Color)GetValue(AccentColorProperty); set => SetValue(AccentColorProperty, value); }

    // ═══════════════ Constants ═══════════════

    private const double StartAngle = 225;   // Gauge arc starts at lower-left (225°)
    private const double SweepAngle = 270;   // 270° sweep (from 225° to -45° / 315°)

    private static readonly Typeface GaugeTypeface = new(
        new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Normal, FontStretches.Normal);
    private static readonly Typeface GaugeBoldTypeface = new(
        new FontFamily("Consolas"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal);
    private static readonly Typeface GaugeLabelTypeface = new(
        new FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal);

    // White theme colors
    private static readonly Brush PanelBg = Brushes.White;
    private static readonly Brush PanelBorder = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0));
    private static readonly Brush TickBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly Brush TickLabelBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly Brush LabelBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly Brush ValueBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly Brush NeedleBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly Brush NeedleCenter = new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0));
    private static readonly Brush DimBrush = new SolidColorBrush(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly Pen BorderPen;
    private static readonly Pen TickPen;
    private static readonly Pen MajorTickPen;

    static GaugeControl()
    {
        PanelBorder.Freeze(); TickBrush.Freeze();
        TickLabelBrush.Freeze(); LabelBrush.Freeze(); ValueBrush.Freeze();
        NeedleBrush.Freeze(); NeedleCenter.Freeze(); DimBrush.Freeze();

        BorderPen = new Pen(PanelBorder, 1.5); BorderPen.Freeze();
        TickPen = new Pen(TickBrush, 1); TickPen.Freeze();
        MajorTickPen = new Pen(TickBrush, 1.5); MajorTickPen.Freeze();
    }

    /// <inheritdoc/>
    protected override void OnRender(DrawingContext dc)
    {
        base.OnRender(dc);

        double w = ActualWidth;
        double h = ActualHeight;
        if (w < 40 || h < 40) return;

        double ppd = VisualTreeHelper.GetDpi(this).PixelsPerDip;

        // Panel background with rounded corners
        var rect = new Rect(0, 0, w, h);
        dc.DrawRoundedRectangle(PanelBg, BorderPen, rect, 6, 6);

        // Layout: label at top, gauge in center, digital readout at bottom
        double labelHeight = 30;
        double readoutHeight = 44;
        double availableForGauge = h - labelHeight - readoutHeight - 16;
        double gaugeSize = Math.Min(w - 20, availableForGauge);
        if (gaugeSize < 30) gaugeSize = 30;

        double radius = gaugeSize / 2.0 - 4;
        double cx = w / 2.0;
        double cy = labelHeight + 8 + gaugeSize / 2.0;

        DrawLabel(dc, cx, 0, w, labelHeight, ppd);
        DrawArcBackground(dc, cx, cy, radius);
        DrawTicks(dc, cx, cy, radius, ppd);
        DrawArcFill(dc, cx, cy, radius);
        DrawNeedle(dc, cx, cy, radius);
        DrawCenterDot(dc, cx, cy);
        DrawDigitalReadout(dc, cx, h - readoutHeight, w, readoutHeight, ppd);
    }

    private void DrawLabel(DrawingContext dc, double cx, double y, double width, double labelHeight, double ppd)
    {
        if (string.IsNullOrEmpty(Label)) return;

        // Draw header block background
        var headerRect = new Rect(4, y + 2, width - 8, labelHeight - 2);
        var headerBg = new SolidColorBrush(Color.FromRgb(0xF1, 0xF5, 0xF9));
        headerBg.Freeze();
        dc.DrawRoundedRectangle(headerBg, null, headerRect, 3, 3);

        // Bold centered label text
        var text = new FormattedText(
            Label, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            GaugeLabelTypeface, 14, LabelBrush, ppd)
        {
            MaxTextWidth = width - 12,
            TextAlignment = TextAlignment.Center
        };
        text.SetFontWeight(FontWeights.Bold);
        dc.DrawText(text, new Point(6, y + (labelHeight - text.Height) / 2));
    }

    private void DrawArcBackground(DrawingContext dc, double cx, double cy, double radius)
    {
        // Draw the full 270° grey arc track
        double arcWidth = Math.Max(radius * 0.12, 4);
        var trackPen = new Pen(new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)), arcWidth);
        trackPen.StartLineCap = PenLineCap.Round;
        trackPen.EndLineCap = PenLineCap.Round;
        trackPen.Freeze();

        var trackGeometry = CreateArc(cx, cy, radius - arcWidth / 2, 0, SweepAngle);
        dc.DrawGeometry(null, trackPen, trackGeometry);
    }

    private void DrawArcFill(DrawingContext dc, double cx, double cy, double radius)
    {
        if (Value == null) return;

        double range = MaxValue - MinValue;
        if (range <= 0) return;

        double ratio = Math.Clamp((Value.Value - MinValue) / range, 0, 1);
        double fillSweep = ratio * SweepAngle;

        double arcWidth = Math.Max(radius * 0.12, 4);
        var accent = AccentColor;
        var fillBrush = new SolidColorBrush(accent);
        fillBrush.Freeze();
        var fillPen = new Pen(fillBrush, arcWidth);
        fillPen.StartLineCap = PenLineCap.Round;
        fillPen.EndLineCap = PenLineCap.Round;
        fillPen.Freeze();

        if (fillSweep > 0.5)
        {
            var fillGeometry = CreateArc(cx, cy, radius - arcWidth / 2, 0, fillSweep);
            dc.DrawGeometry(null, fillPen, fillGeometry);
        }
    }

    private void DrawTicks(DrawingContext dc, double cx, double cy, double radius, double ppd)
    {
        double range = MaxValue - MinValue;
        if (range <= 0) return;

        // Determine nice tick spacing
        int majorTicks = 5;
        double majorStep = range / majorTicks;

        // Make major step a nice number
        double magnitude = Math.Pow(10, Math.Floor(Math.Log10(majorStep)));
        double residual = majorStep / magnitude;
        if (residual <= 1.5) majorStep = magnitude;
        else if (residual <= 3.5) majorStep = 2 * magnitude;
        else if (residual <= 7.5) majorStep = 5 * magnitude;
        else majorStep = 10 * magnitude;

        double innerRadius = radius * 0.72;
        double outerRadius = radius * 0.84;
        double labelRadius = radius * 0.55;

        // Scale tick label font with gauge size for readability
        double tickFontSize = Math.Max(9, radius * 0.12);

        // Draw major ticks with labels
        for (double val = MinValue; val <= MaxValue + majorStep * 0.01; val += majorStep)
        {
            if (val > MaxValue) val = MaxValue;
            double ratio = (val - MinValue) / range;
            double angle = StartAngle - ratio * SweepAngle;
            double rad = angle * Math.PI / 180.0;

            double cos = Math.Cos(rad);
            double sin = -Math.Sin(rad);

            dc.DrawLine(MajorTickPen,
                new Point(cx + innerRadius * cos, cy + innerRadius * sin),
                new Point(cx + outerRadius * cos, cy + outerRadius * sin));

            // Draw tick label — plain FormattedText (no MaxTextWidth/TextAlignment)
            // so that Width/Height reflect actual glyph bounds for precise centering
            string tickLabel = val.ToString("F0");
            var text = new FormattedText(
                tickLabel, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
                GaugeTypeface, tickFontSize, TickLabelBrush, ppd);
            dc.DrawText(text, new Point(
                cx + labelRadius * cos - text.Width / 2,
                cy + labelRadius * sin - text.Height / 2));

            if (Math.Abs(val - MaxValue) < majorStep * 0.01) break;
        }

        // Draw minor ticks (subdivide each major by 5)
        double minorStep = majorStep / 5;
        for (double val = MinValue; val <= MaxValue + minorStep * 0.01; val += minorStep)
        {
            if (val > MaxValue) val = MaxValue;
            double ratio = (val - MinValue) / range;
            double angle = StartAngle - ratio * SweepAngle;
            double rad = angle * Math.PI / 180.0;

            double cos = Math.Cos(rad);
            double sin = -Math.Sin(rad);

            dc.DrawLine(TickPen,
                new Point(cx + (outerRadius - 3) * cos, cy + (outerRadius - 3) * sin),
                new Point(cx + outerRadius * cos, cy + outerRadius * sin));

            if (Math.Abs(val - MaxValue) < minorStep * 0.01) break;
        }
    }

    private void DrawNeedle(DrawingContext dc, double cx, double cy, double radius)
    {
        if (Value == null) return;

        double range = MaxValue - MinValue;
        if (range <= 0) return;

        double ratio = Math.Clamp((Value.Value - MinValue) / range, 0, 1);
        double angle = StartAngle - ratio * SweepAngle;
        double rad = angle * Math.PI / 180.0;

        double needleLength = radius * 0.78;
        double tailLength = radius * 0.15;

        double cos = Math.Cos(rad);
        double sin = -Math.Sin(rad);

        var needlePen = new Pen(NeedleBrush, 2.5);
        needlePen.StartLineCap = PenLineCap.Round;
        needlePen.EndLineCap = PenLineCap.Triangle;
        needlePen.Freeze();

        // Draw needle: tail behind center + main line
        Point tail = new(cx - tailLength * cos, cy - tailLength * sin);
        Point tip = new(cx + needleLength * cos, cy + needleLength * sin);
        dc.DrawLine(needlePen, tail, tip);
    }

    private static void DrawCenterDot(DrawingContext dc, double cx, double cy)
    {
        dc.DrawEllipse(NeedleCenter, null, new Point(cx, cy), 5, 5);
        dc.DrawEllipse(NeedleBrush, null, new Point(cx, cy), 2.5, 2.5);
    }

    private void DrawDigitalReadout(DrawingContext dc, double cx, double y, double width, double height, double ppd)
    {
        // Light panel for digital readout
        double readoutWidth = width * 0.8;
        double readoutLeft = cx - readoutWidth / 2;
        var readoutRect = new Rect(readoutLeft, y, readoutWidth, height - 4);
        var readoutBg = new SolidColorBrush(Color.FromRgb(0xF1, 0xF5, 0xF9));
        readoutBg.Freeze();
        var readoutBorder = new Pen(new SolidColorBrush(Color.FromRgb(0xE2, 0xE8, 0xF0)), 1);
        readoutBorder.Freeze();
        dc.DrawRoundedRectangle(readoutBg, readoutBorder, readoutRect, 3, 3);

        string valueStr = Value.HasValue ? Value.Value.ToString(ValueFormat) : "--";
        string display = $"{valueStr} {Unit}";

        // Use readout rect width for MaxTextWidth and position at readoutLeft so TextAlignment.Center works correctly
        var text = new FormattedText(
            display, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            GaugeBoldTypeface, 18, ValueBrush, ppd)
        {
            MaxTextWidth = readoutWidth,
            TextAlignment = TextAlignment.Center
        };
        text.SetFontWeight(FontWeights.Bold);
        dc.DrawText(text, new Point(
            readoutLeft,
            y + (height - 4 - text.Height) / 2));
    }

    // ═══════════════ Geometry Helpers ═══════════════

    /// <summary>
    /// Creates a 270° arc geometry starting from the StartAngle (225°).
    /// The arc sweep goes clockwise from startOffset to startOffset + sweepDegrees.
    /// </summary>
    private StreamGeometry CreateArc(double cx, double cy, double radius,
        double startOffset, double sweepDegrees)
    {
        var geometry = new StreamGeometry();
        using (var ctx = geometry.Open())
        {
            // Start angle in standard coords
            double startRad = (StartAngle - startOffset) * Math.PI / 180.0;
            double endRad = (StartAngle - startOffset - sweepDegrees) * Math.PI / 180.0;

            Point start = new(
                cx + radius * Math.Cos(startRad),
                cy - radius * Math.Sin(startRad));
            Point end = new(
                cx + radius * Math.Cos(endRad),
                cy - radius * Math.Sin(endRad));

            bool isLargeArc = sweepDegrees > 180;

            ctx.BeginFigure(start, false, false);
            ctx.ArcTo(end, new Size(radius, radius), 0,
                isLargeArc, SweepDirection.Clockwise, true, false);
        }
        geometry.Freeze();
        return geometry;
    }

    private static FormattedText MakeText(string text, double fontSize, Brush brush, double maxWidth, double ppd)
    {
        return new FormattedText(
            text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight,
            GaugeTypeface, fontSize, brush, ppd)
        {
            MaxTextWidth = maxWidth,
            TextAlignment = TextAlignment.Center
        };
    }
}
