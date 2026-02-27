using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;

namespace Stratus.Desktop.Views;

public partial class HelpWindow : Window
{
    private static readonly SolidColorBrush HeadingBrush = new(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly SolidColorBrush SubheadingBrush = new(Color.FromRgb(0x1D, 0x4E, 0xD8));
    private static readonly SolidColorBrush TextBrush = new(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly SolidColorBrush CodeBrush = new(Color.FromRgb(0x1E, 0x29, 0x3B));
    private static readonly FontFamily MonoFont = new("Consolas");

    public HelpWindow()
    {
        InitializeComponent();
        TopicList.SelectedIndex = 0;
    }

    private void TopicList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TopicList.SelectedItem is not ListBoxItem item) return;
        var topic = item.Tag?.ToString() ?? "start";
        ShowTopic(topic);
    }

    private void ShowTopic(string topic)
    {
        var doc = new FlowDocument { PagePadding = new Thickness(0) };

        switch (topic)
        {
            case "start":
                AddHeading(doc, "Getting Started");
                AddPara(doc, "Welcome to Stratus Weather Station Manager — a research-grade desktop application for weather station data acquisition, monitoring, and analysis.");
                AddSubheading(doc, "Quick Start");
                AddBullet(doc, "1. Enter the server URL and your credentials in the left panel");
                AddBullet(doc, "2. Click Connect to establish a server connection");
                AddBullet(doc, "3. Select a station from the list");
                AddBullet(doc, "4. Click Load Data to retrieve weather records");
                AddBullet(doc, "5. Browse Charts, Wind Rose, and Data tabs for analysis");
                AddSubheading(doc, "System Requirements");
                AddBullet(doc, "• Windows 10/11 (64-bit)");
                AddBullet(doc, "• .NET 8.0 Runtime (included in installer)");
                AddBullet(doc, "• Internet connection for server/database access");
                AddBullet(doc, "• Serial port (USB-to-RS232) for direct logger connection");
                break;

            case "server":
                AddHeading(doc, "Server Connection");
                AddPara(doc, "Stratus connects to a remote VPS running the Stratus server software. The server provides REST API access to station data, user authentication, and Dropbox sync.");
                AddSubheading(doc, "Configuration");
                AddBullet(doc, "• Default server: https://stratusweather.co.za");
                AddBullet(doc, "• Enter your admin email and password");
                AddBullet(doc, "• The server uses session cookies for authentication");
                AddPara(doc, "Server URL and poll interval are saved in Settings and persist between sessions.");
                break;

            case "database":
                AddHeading(doc, "Database Setup");
                AddPara(doc, "Stratus can connect directly to a PostgreSQL database (Neon, Supabase, or local) for faster data access. The app supports both URI and key-value connection strings.");
                AddSubheading(doc, "Connecting");
                AddBullet(doc, "• Go to Database → Connect to PostgreSQL...");
                AddBullet(doc, "• Paste your PostgreSQL connection string");
                AddBullet(doc, "• SSL is auto-enabled for cloud databases (Neon, Supabase)");
                AddCode(doc, "postgresql://user:pass@host.neon.tech/dbname?sslmode=require");
                break;

            case "collection":
                AddHeading(doc, "Data Collection");
                AddPara(doc, "Stratus polls the server API at a configurable interval (default: 30 seconds). Collected data is displayed on gauges and stored in the database.");
                AddSubheading(doc, "Start/Stop Collection");
                AddBullet(doc, "• Station → Start Collection to begin polling");
                AddBullet(doc, "• Configure interval in Settings (5s to 30min)");
                AddBullet(doc, "• Live data appears on the dashboard gauges");
                AddPara(doc, "If the database connection is lost during collection, data is automatically buffered locally and synced when the connection is restored.");
                break;

            case "pakbus":
                AddHeading(doc, "PakBus / Serial Monitor");
                AddPara(doc, "Connect directly to Campbell Scientific dataloggers via RS-232 serial using the PakBus protocol. The Serial Monitor provides a terminal-style interface for real-time communication.");
                AddSubheading(doc, "Connection Setup");
                AddBullet(doc, "• Go to Logger → Serial Monitor...");
                AddBullet(doc, "• Select COM port, baud rate (default: 115200)");
                AddBullet(doc, "• Set PakBus address (default: 1)");
                AddBullet(doc, "• Click Connect to establish link");
                AddSubheading(doc, "Supported Features");
                AddBullet(doc, "• Hello handshake and clock synchronization");
                AddBullet(doc, "• Table definition discovery");
                AddBullet(doc, "• Automatic data collection (FP2, IEEE4, IEEE8)");
                break;

            case "charts":
                AddHeading(doc, "Charts & Visualization");
                AddPara(doc, "The Charts tab displays publication-quality time-series charts for all measured parameters. Charts are rendered using LiveCharts2 with SkiaSharp for high-resolution output.");
                AddSubheading(doc, "Available Charts");
                AddBullet(doc, "• Temperature, Humidity, Pressure, Dew Point");
                AddBullet(doc, "• Wind Speed/Direction, Rainfall, Solar Radiation");
                AddBullet(doc, "• Soil Temp/Moisture, Air Quality (PM/CO₂/TVOC)");
                AddBullet(doc, "• Battery voltage, MPPT charger parameters");
                AddSubheading(doc, "Exporting Charts");
                AddPara(doc, "Use Tools → Export All Charts as PNG to save all visible charts as high-resolution PNG images.");
                break;

            case "windrose":
                AddHeading(doc, "Wind Rose Analysis");
                AddPara(doc, "Generate wind rose diagrams from station data or imported CSV/TOA5 files. Supports configurable sector angles (5° to 45°) and multiple time periods.");
                AddSubheading(doc, "Usage");
                AddBullet(doc, "• Load station data with wind speed/direction");
                AddBullet(doc, "• Tools → Generate Wind Rose");
                AddBullet(doc, "• Or import a CSV file via Tools → Import TOA5/CSV");
                AddBullet(doc, "• Export as PNG for publications");
                break;

            case "reports":
                AddHeading(doc, "PDF Reports");
                AddPara(doc, "Generate professional PDF reports with statistical summaries, data quality metrics, wind analysis, and precipitation summaries.");
                AddSubheading(doc, "Generating a Report");
                AddBullet(doc, "• Tools → Generate PDF Report...");
                AddBullet(doc, "• Select date range (quick presets available)");
                AddBullet(doc, "• Click Generate Report");
                AddBullet(doc, "• Report is saved to Documents/Stratus/Reports/");
                AddPara(doc, "Reports include: temperature/humidity/pressure/wind statistics, data coverage metrics, and rainfall totals.");
                break;

            case "calibration":
                AddHeading(doc, "Calibration Management");
                AddPara(doc, "Track sensor calibration dates, apply correction coefficients (slope + offset), and receive alerts when calibrations are overdue.");
                AddSubheading(doc, "Adding a Calibration Profile");
                AddBullet(doc, "• Tools → Calibration Manager...");
                AddBullet(doc, "• Select sensor, enter slope and offset");
                AddBullet(doc, "• Corrected Value = (Raw × Slope) + Offset");
                AddBullet(doc, "• Set calibration interval and reference info");
                AddPara(doc, "Overdue calibrations are highlighted with a red warning bar. All calibration changes are recorded in the audit trail.");
                break;

            case "export":
                AddHeading(doc, "Data Export");
                AddPara(doc, "Export collected data in CSV or TOA5 format for analysis in external tools (Excel, R, Python, etc.).");
                AddSubheading(doc, "Export Options");
                AddBullet(doc, "• File → Export Data... for CSV/TOA5 export");
                AddBullet(doc, "• Tools → Export All Charts as PNG for imagery");
                AddBullet(doc, "• Tools → Export Wind Rose PNG for wind diagrams");
                break;

            case "audit":
                AddHeading(doc, "Audit Trail");
                AddPara(doc, "Every significant user action is recorded with timestamps for compliance and traceability. The audit trail is stored in JSONL files in the Stratus app data folder.");
                AddSubheading(doc, "Viewing the Audit Log");
                AddBullet(doc, "• Tools → Audit Trail...");
                AddBullet(doc, "• Filter by date range and category");
                AddBullet(doc, "• Export to CSV for reporting");
                AddPara(doc, "Tracked actions: login, data collection start/stop, exports, calibration changes, settings modifications, report generation, database connections.");
                break;

            case "offline":
                AddHeading(doc, "Offline Data Buffering");
                AddPara(doc, "When the PostgreSQL database connection is lost, Stratus automatically buffers incoming weather records in a local SQLite database. Records are synced when the connection is restored.");
                AddSubheading(doc, "How It Works");
                AddBullet(doc, "• Buffer is stored at %APPDATA%\\Stratus\\Data\\offline_buffer.db");
                AddBullet(doc, "• Pending record count is shown in the status bar");
                AddBullet(doc, "• Auto-sync runs when database reconnects");
                AddBullet(doc, "• Synced records are purged after 30 days");
                break;

            case "gaps":
                AddHeading(doc, "Data Gap Detection & Backfill");
                AddPara(doc, "Analyse collected data for temporal gaps and attempt to recover missing records from the server API or logger memory.");
                AddSubheading(doc, "Gap Analysis");
                AddBullet(doc, "• Tools → Data Gap Analysis...");
                AddBullet(doc, "• Detects gaps exceeding 1.5× the expected interval");
                AddBullet(doc, "• Shows coverage percentage and gap details");
                AddBullet(doc, "• Click Backfill to attempt recovery from the API");
                break;

            case "update":
                AddHeading(doc, "Auto-Update");
                AddPara(doc, "Stratus checks for updates from the GitHub releases page. When a new version is available, you can download and install it directly from the application.");
                AddSubheading(doc, "Checking for Updates");
                AddBullet(doc, "• Help → Check for Updates");
                AddBullet(doc, "• Or enable automatic checks in Settings");
                break;

            case "licence":
                AddHeading(doc, "Licence Management");
                AddPara(doc, "Stratus requires a valid licence key for operation beyond the trial period. Licence information is encrypted and stored locally using Windows DPAPI.");
                AddSubheading(doc, "Activation");
                AddBullet(doc, "• Tools → Licence Activation...");
                AddBullet(doc, "• Enter your licence key");
                AddBullet(doc, "• Key is validated against the holder/type/expiry");
                break;

            case "shortcuts":
                AddHeading(doc, "Keyboard Shortcuts");
                AddShortcut(doc, "F1", "Open Help");
                AddShortcut(doc, "F5", "Refresh / Load Data");
                AddShortcut(doc, "Ctrl+E", "Export Data");
                AddShortcut(doc, "Ctrl+P", "Generate PDF Report");
                AddShortcut(doc, "Ctrl+D", "Connect Database");
                AddShortcut(doc, "Ctrl+L", "Open Serial Monitor");
                break;

            case "trouble":
                AddHeading(doc, "Troubleshooting");
                AddSubheading(doc, "Connection Issues");
                AddBullet(doc, "• Verify server URL is correct (including https://)");
                AddBullet(doc, "• Check firewall and proxy settings");
                AddBullet(doc, "• For database: ensure SSL mode is set for cloud hosts");
                AddSubheading(doc, "Serial Port Issues");
                AddBullet(doc, "• Verify COM port appears in Device Manager");
                AddBullet(doc, "• Check USB-to-RS232 adapter drivers");
                AddBullet(doc, "• Try 115200 baud first, then 9600");
                AddSubheading(doc, "Log Files");
                AddPara(doc, "Detailed logs are stored at %APPDATA%\\Stratus\\Logs\\. Include these when reporting issues.");
                break;
        }

        HelpContent.Document = doc;
    }

    private static void AddHeading(FlowDocument doc, string text)
    {
        var para = new Paragraph(new Run(text))
        {
            FontSize = 22, FontWeight = FontWeights.Bold, Foreground = HeadingBrush,
            Margin = new Thickness(0, 0, 0, 8)
        };
        doc.Blocks.Add(para);
    }

    private static void AddSubheading(FlowDocument doc, string text)
    {
        var para = new Paragraph(new Run(text))
        {
            FontSize = 15, FontWeight = FontWeights.SemiBold, Foreground = SubheadingBrush,
            Margin = new Thickness(0, 12, 0, 4)
        };
        doc.Blocks.Add(para);
    }

    private static void AddPara(FlowDocument doc, string text)
    {
        var para = new Paragraph(new Run(text))
        {
            FontSize = 13, Foreground = TextBrush, Margin = new Thickness(0, 0, 0, 6),
            LineHeight = 20
        };
        doc.Blocks.Add(para);
    }

    private static void AddBullet(FlowDocument doc, string text)
    {
        var para = new Paragraph(new Run(text))
        {
            FontSize = 13, Foreground = TextBrush, Margin = new Thickness(16, 0, 0, 2),
            LineHeight = 20
        };
        doc.Blocks.Add(para);
    }

    private static void AddCode(FlowDocument doc, string text)
    {
        var para = new Paragraph(new Run(text))
        {
            FontSize = 12, Foreground = CodeBrush, FontFamily = MonoFont,
            Margin = new Thickness(16, 4, 0, 4),
            Background = new SolidColorBrush(Color.FromRgb(0xF1, 0xF5, 0xF9)),
            Padding = new Thickness(8, 4, 8, 4)
        };
        doc.Blocks.Add(para);
    }

    private static void AddShortcut(FlowDocument doc, string key, string description)
    {
        var para = new Paragraph();
        para.Inlines.Add(new Run(key) { FontFamily = MonoFont, FontWeight = FontWeights.Bold, Foreground = SubheadingBrush });
        para.Inlines.Add(new Run($"  —  {description}") { Foreground = TextBrush });
        para.FontSize = 13;
        para.Margin = new Thickness(16, 0, 0, 2);
        doc.Blocks.Add(para);
    }
}
