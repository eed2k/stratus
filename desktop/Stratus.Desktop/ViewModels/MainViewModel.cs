using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.Painting;
using Serilog;
using SkiaSharp;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services;
using System.Collections.ObjectModel;

namespace Stratus.Desktop.ViewModels;

public partial class MainViewModel : ObservableObject
{
    private readonly ApiService _apiService;
    private readonly DatabaseService _dbService;
    private readonly DataAcquisitionService _daqService;

    [ObservableProperty] private string _statusText = "Ready";
    [ObservableProperty] private string _connectionStatus = "Disconnected";
    [ObservableProperty] private bool _isConnected;
    [ObservableProperty] private bool _isCollecting;
    [ObservableProperty] private WeatherStation? _selectedStation;
    [ObservableProperty] private WeatherRecord? _latestData;
    [ObservableProperty] private string _serverUrl = "https://stratusweather.co.za";
    [ObservableProperty] private string _email = string.Empty;
    [ObservableProperty] private string _selectedTimeRange = "24h";
    [ObservableProperty] private long _recordCount;
    [ObservableProperty] private string _licenseStatus = "Trial";

    public ObservableCollection<WeatherStation> Stations { get; } = new();
    public ObservableCollection<WeatherRecord> DataRecords { get; } = new();
    public ObservableCollection<string> LogMessages { get; } = new();

    public string[] TimeRanges { get; } = { "1h", "6h", "24h", "48h", "7d", "30d" };

    // ── LiveCharts2 series for the Charts tab ──
    [ObservableProperty] private ISeries[] _temperatureSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _humiditySeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _pressureSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _windSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _solarSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _batterySeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _rainfallSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _waterLevelSeries = Array.Empty<ISeries>();

    // Shared X-axis for all charts (time-based)
    [ObservableProperty] private Axis[] _chartXAxes = new Axis[]
    {
        new Axis
        {
            Labeler = v => new DateTime((long)v).ToString("HH:mm"),
            LabelsRotation = -45,
            TextSize = 10,
            LabelsPaint = new SolidColorPaint(SKColors.Gray),
            SeparatorsPaint = new SolidColorPaint(new SKColor(230, 230, 230)),
        }
    };

    public MainViewModel()
    {
        _apiService = App.ApiService;
        _dbService = App.DatabaseService;
        _daqService = App.DataAcquisitionService;

        // Wire up events
        _apiService.ConnectionStatusChanged += (_, connected) =>
        {
            IsConnected = connected;
            ConnectionStatus = connected ? "Connected" : "Disconnected";
        };

        _apiService.ErrorOccurred += (_, msg) =>
        {
            StatusText = msg;
            AddLog($"[ERROR] {msg}");
        };

        _daqService.DataReceived += (_, args) =>
        {
            System.Windows.Application.Current.Dispatcher.Invoke(() =>
            {
                LatestData = args.Record;
                StatusText = $"Data received: {args.StationName} at {args.Timestamp:HH:mm:ss}";
                AddLog($"[DATA] {args.StationName}: T={args.Record.Temperature:F1}°C, " +
                       $"RH={args.Record.Humidity:F0}%, P={args.Record.Pressure:F1}hPa");
            });
        };

        _daqService.StatusChanged += (_, msg) => StatusText = msg;

        // Check license
        var license = App.LicenseService.GetLicense();
        if (license != null && App.LicenseService.IsLicenseValid())
        {
            LicenseStatus = license.Type.ToString();
            if (license.ExpiryDate.HasValue)
                LicenseStatus += $" (expires {license.ExpiryDate.Value:yyyy-MM-dd})";
            else
                LicenseStatus += " (Lifetime)";
        }
        else
        {
            LicenseStatus = "No License";
        }

        _serverUrl = _apiService.BaseUrl;
    }

    [RelayCommand]
    private async Task ConnectAsync()
    {
        StatusText = "Connecting...";
        AddLog($"[INFO] Connecting to {ServerUrl}...");
        _apiService.SetServerUrl(ServerUrl);

        var healthy = await _apiService.CheckHealthAsync();
        if (healthy)
        {
            ConnectionStatus = "Server reachable";
            StatusText = "Server online, please log in";
            AddLog("[INFO] Server health check passed");
        }
        else
        {
            ConnectionStatus = "Unreachable";
            StatusText = "Cannot reach server";
            AddLog("[WARN] Server health check failed");
        }
    }

    [RelayCommand]
    private async Task LoginAsync(string password)
    {
        if (string.IsNullOrEmpty(Email))
        {
            StatusText = "Please enter email";
            return;
        }

        // Ensure HttpClient points to current ServerUrl before login
        _apiService.SetServerUrl(ServerUrl);

        StatusText = "Authenticating...";
        try
        {
            var success = await _apiService.LoginAsync(Email, password);

            if (success)
            {
                IsConnected = true;
                ConnectionStatus = "Connected";
                StatusText = "Authenticated, loading stations...";
                AddLog($"[INFO] Logged in as {Email}");
                await LoadStationsAsync();
            }
            else
            {
                StatusText = "Authentication failed";
                AddLog("[WARN] Login failed - check credentials");
            }
        }
        catch (Exception ex)
        {
            StatusText = $"Login error: {ex.Message}";
            AddLog($"[ERROR] Login failed: {ex.Message}");
        }
    }

    [RelayCommand]
    private async Task LoadStationsAsync()
    {
        StatusText = "Loading stations...";
        Stations.Clear();

        try
        {
            List<WeatherStation>? stations;
            if (_dbService.IsConnected)
            {
                stations = await _dbService.GetStationsAsync();
                AddLog($"[DB] Loaded {stations?.Count ?? 0} stations from database");
            }
            else
            {
                stations = await _apiService.GetStationsAsync();
                if (stations == null)
                {
                    // GetStationsAsync returns null on error — keep the error status visible
                    AddLog("[ERROR] Station fetch failed (see log for details)");
                    if (!StatusText.StartsWith("Failed"))
                        StatusText = "Failed to load stations — check connection & auth";
                    return;
                }
                AddLog($"[API] Loaded {stations.Count} stations from server");
            }

            foreach (var s in stations)
                Stations.Add(s);

            StatusText = $"{stations.Count} stations loaded";

            if (stations.Count > 0 && SelectedStation == null)
                SelectedStation = stations[0];
        }
        catch (Exception ex)
        {
            StatusText = $"Failed to load stations: {ex.Message}";
            AddLog($"[ERROR] Station load failed: {ex.Message}");
        }
    }

    [RelayCommand]
    private async Task LoadDataAsync()
    {
        if (SelectedStation == null) return;

        StatusText = $"Loading data for {SelectedStation.Name}...";
        DataRecords.Clear();

        try
        {
            var endTime = DateTime.UtcNow;
            var startTime = SelectedTimeRange switch
            {
                "1h" => endTime.AddHours(-1),
                "6h" => endTime.AddHours(-6),
                "24h" => endTime.AddHours(-24),
                "48h" => endTime.AddHours(-48),
                "7d" => endTime.AddDays(-7),
                "30d" => endTime.AddDays(-30),
                _ => endTime.AddHours(-24)
            };

            List<WeatherRecord> records;
            if (_dbService.IsConnected)
            {
                records = await _dbService.GetDataAsync(SelectedStation.Id, startTime, endTime);
                RecordCount = await _dbService.GetRecordCountAsync(SelectedStation.Id);
            }
            else
            {
                records = await _apiService.GetStationDataAsync(SelectedStation.Id, startTime, endTime);
                RecordCount = records.Count;
            }

            foreach (var r in records.OrderByDescending(r => r.Timestamp))
                DataRecords.Add(r);

            if (records.Count > 0)
                LatestData = records.OrderByDescending(r => r.Timestamp).First();

            // Update LiveCharts series
            UpdateCharts(records);

            StatusText = $"Loaded {records.Count} records for {SelectedStation.Name}";
            AddLog($"[DATA] Loaded {records.Count} records ({SelectedTimeRange})");
        }
        catch (Exception ex)
        {
            StatusText = $"Failed to load data: {ex.Message}";
            AddLog($"[ERROR] Data load failed: {ex.Message}");
        }
    }

    [RelayCommand]
    private void ToggleCollection()
    {
        if (IsCollecting)
        {
            _daqService.StopCollection();
            IsCollecting = false;
            AddLog("[INFO] Data collection stopped");
        }
        else
        {
            _daqService.StartCollection(60);
            IsCollecting = true;
            AddLog("[INFO] Data collection started (60s interval)");
        }
    }

    [RelayCommand]
    private async Task ExportDataAsync()
    {
        if (SelectedStation == null) return;

        var endTime = DateTime.UtcNow;
        var startTime = endTime.AddDays(-30);

        var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var exportDir = System.IO.Path.Combine(docs, "Stratus");
        System.IO.Directory.CreateDirectory(exportDir);

        var fileName = $"Stratus_{SelectedStation.Name}_{DateTime.Now:yyyyMMdd_HHmmss}.csv";
        var filePath = System.IO.Path.Combine(exportDir, fileName);

        await _daqService.ExportToCsvAsync(SelectedStation.Id, startTime, endTime, filePath, "TOA5");
        AddLog($"[EXPORT] Saved to {filePath}");
    }

    [RelayCommand]
    private async Task ConnectDatabaseAsync(string connectionString)
    {
        StatusText = "Testing database connection...";
        AddLog("[DB] Testing connection...");

        try
        {
            var (success, message) = await DatabaseService.TestConnectionAsync(connectionString);

            if (success)
            {
                var connected = _dbService.Connect(connectionString);
                if (connected)
                {
                    StatusText = "Database connected";
                    AddLog($"[DB] {message}");
                    await LoadStationsAsync();
                }
                else
                {
                    StatusText = "DB connection failed after test passed";
                    AddLog("[DB ERROR] Connection succeeded in test but failed on actual connect");
                }
            }
            else
            {
                StatusText = $"DB connection failed: {message}";
                AddLog($"[DB ERROR] {message}");
            }
        }
        catch (Exception ex)
        {
            StatusText = $"DB connection error: {ex.Message}";
            AddLog($"[DB ERROR] {ex.Message}");
        }
    }

    partial void OnSelectedStationChanged(WeatherStation? value)
    {
        if (value != null)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await System.Windows.Application.Current.Dispatcher.InvokeAsync(
                        async () => await LoadDataAsync());
                }
                catch (Exception ex)
                {
                    AddLog($"[ERROR] Failed to load data: {ex.Message}");
                }
            });
        }
    }

    public void AddLog(string message)
    {
        var entry = $"[{DateTime.Now:HH:mm:ss}] {message}";
        System.Windows.Application.Current.Dispatcher.Invoke(() =>
        {
            LogMessages.Insert(0, entry);
            if (LogMessages.Count > 500)
                LogMessages.RemoveAt(LogMessages.Count - 1);
        });
    }

    private void UpdateCharts(List<WeatherRecord> records)
    {
        if (records.Count == 0) return;

        var ordered = records.OrderBy(r => r.Timestamp).ToList();

        // Helper to build a point collection from a selector
        List<DateTimePoint> BuildPoints(Func<WeatherRecord, double?> selector)
        {
            return ordered
                .Where(r => selector(r).HasValue)
                .Select(r => new DateTimePoint(r.Timestamp, selector(r)!.Value))
                .ToList();
        }

        var tempPts = BuildPoints(r => r.Temperature);
        var humPts  = BuildPoints(r => r.Humidity);
        var presPts = BuildPoints(r => r.Pressure);
        var windPts = BuildPoints(r => r.WindSpeed);
        var gustPts = BuildPoints(r => r.WindGust);
        var solPts  = BuildPoints(r => r.SolarRadiation);
        var battPts = BuildPoints(r => r.BatteryVoltage);
        var rainPts = BuildPoints(r => r.Rainfall);
        var wlPts   = BuildPoints(r => r.WaterLevel);

        // Temperature
        if (tempPts.Count > 0)
            TemperatureSeries = new ISeries[]
            {
                new LineSeries<DateTimePoint>
                {
                    Values = tempPts,
                    Name = "Temperature (°C)",
                    Stroke = new SolidColorPaint(new SKColor(0xEF, 0x44, 0x44)) { StrokeThickness = 2 },
                    Fill = null,
                    GeometrySize = 0,
                    LineSmoothness = 0.3
                }
            };

        // Humidity
        if (humPts.Count > 0)
            HumiditySeries = new ISeries[]
            {
                new LineSeries<DateTimePoint>
                {
                    Values = humPts,
                    Name = "Humidity (%)",
                    Stroke = new SolidColorPaint(new SKColor(0x3B, 0x82, 0xF6)) { StrokeThickness = 2 },
                    Fill = null,
                    GeometrySize = 0,
                    LineSmoothness = 0.3
                }
            };

        // Pressure
        if (presPts.Count > 0)
            PressureSeries = new ISeries[]
            {
                new LineSeries<DateTimePoint>
                {
                    Values = presPts,
                    Name = "Pressure (hPa)",
                    Stroke = new SolidColorPaint(new SKColor(0x64, 0x74, 0x8B)) { StrokeThickness = 2 },
                    Fill = null,
                    GeometrySize = 0,
                    LineSmoothness = 0.3
                }
            };

        // Wind Speed + Gust
        var windSeries = new List<ISeries>();
        if (windPts.Count > 0)
            windSeries.Add(new LineSeries<DateTimePoint>
            {
                Values = windPts,
                Name = "Wind Speed (m/s)",
                Stroke = new SolidColorPaint(new SKColor(0x22, 0xC5, 0x5E)) { StrokeThickness = 2 },
                Fill = null,
                GeometrySize = 0,
                LineSmoothness = 0.3
            });
        if (gustPts.Count > 0)
            windSeries.Add(new LineSeries<DateTimePoint>
            {
                Values = gustPts,
                Name = "Wind Gust (m/s)",
                Stroke = new SolidColorPaint(new SKColor(0xF9, 0x73, 0x16)) { StrokeThickness = 2 },
                Fill = null,
                GeometrySize = 0,
                LineSmoothness = 0.3
            });
        if (windSeries.Count > 0)
            WindSeries = windSeries.ToArray();

        // Solar Radiation
        if (solPts.Count > 0)
            SolarSeries = new ISeries[]
            {
                new LineSeries<DateTimePoint>
                {
                    Values = solPts,
                    Name = "Solar Radiation (W/m²)",
                    Stroke = new SolidColorPaint(new SKColor(0xEA, 0xB3, 0x08)) { StrokeThickness = 2 },
                    Fill = new SolidColorPaint(new SKColor(0xEA, 0xB3, 0x08, 0x30)),
                    GeometrySize = 0,
                    LineSmoothness = 0.3
                }
            };

        // Battery Voltage
        if (battPts.Count > 0)
            BatterySeries = new ISeries[]
            {
                new LineSeries<DateTimePoint>
                {
                    Values = battPts,
                    Name = "Battery (V)",
                    Stroke = new SolidColorPaint(new SKColor(0x16, 0xA3, 0x4A)) { StrokeThickness = 2 },
                    Fill = null,
                    GeometrySize = 0,
                    LineSmoothness = 0.3
                }
            };

        // Rainfall (bar chart)
        if (rainPts.Count > 0)
            RainfallSeries = new ISeries[]
            {
                new ColumnSeries<DateTimePoint>
                {
                    Values = rainPts,
                    Name = "Rainfall (mm)",
                    Fill = new SolidColorPaint(new SKColor(0x38, 0xBD, 0xF8)),
                    Stroke = null,
                    MaxBarWidth = 8
                }
            };

        // Water Level
        if (wlPts.Count > 0)
            WaterLevelSeries = new ISeries[]
            {
                new LineSeries<DateTimePoint>
                {
                    Values = wlPts,
                    Name = "Water Level (mm)",
                    Stroke = new SolidColorPaint(new SKColor(0x06, 0xB6, 0xD4)) { StrokeThickness = 2 },
                    Fill = new SolidColorPaint(new SKColor(0x06, 0xB6, 0xD4, 0x30)),
                    GeometrySize = 0,
                    LineSmoothness = 0.3
                }
            };
    }
}
