using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.Painting;
using LiveChartsCore.SkiaSharpView.SKCharts;
using Serilog;
using SkiaSharp;
using Stratus.Desktop.Models;
using Stratus.Desktop.Services;
using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

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

    // ── Static chart images for the Charts tab ──
    // Rendered via LiveCharts2 SKCartesianChart off-screen, displayed as WPF Images.
    // Atmospheric
    [ObservableProperty] private ImageSource? _temperatureImage;
    [ObservableProperty] private ImageSource? _humidityImage;
    [ObservableProperty] private ImageSource? _pressureImage;
    [ObservableProperty] private ImageSource? _dewPointImage;
    // Wind
    [ObservableProperty] private ImageSource? _windImage;
    [ObservableProperty] private ImageSource? _windDirectionImage;
    // Precipitation
    [ObservableProperty] private ImageSource? _rainfallImage;
    // Solar
    [ObservableProperty] private ImageSource? _solarImage;
    [ObservableProperty] private ImageSource? _uvIndexImage;
    // Evapotranspiration
    [ObservableProperty] private ImageSource? _etoImage;
    // Soil
    [ObservableProperty] private ImageSource? _soilImage;
    // Air Quality
    [ObservableProperty] private ImageSource? _airQualityImage;
    // Battery & Power
    [ObservableProperty] private ImageSource? _batteryImage;
    // Water & Sensors
    [ObservableProperty] private ImageSource? _waterLevelImage;
    [ObservableProperty] private ImageSource? _switchImage;
    [ObservableProperty] private ImageSource? _lightningImage;
    // MPPT Charger 1
    [ObservableProperty] private ImageSource? _mpptPowerImage;
    [ObservableProperty] private ImageSource? _mpptVoltageImage;
    [ObservableProperty] private ImageSource? _mpptCurrentImage;
    // MPPT Charger 2
    [ObservableProperty] private ImageSource? _mppt2PowerImage;
    [ObservableProperty] private ImageSource? _mppt2VoltageImage;
    // Additional parameter charts
    [ObservableProperty] private ImageSource? _windPowerImage;
    [ObservableProperty] private ImageSource? _co2TvocImage;
    [ObservableProperty] private ImageSource? _airDensityImage;

    // Chart visibility (only show charts that have data)
    [ObservableProperty] private bool _hasTemperature;
    [ObservableProperty] private bool _hasHumidity;
    [ObservableProperty] private bool _hasPressure;
    [ObservableProperty] private bool _hasDewPoint;
    [ObservableProperty] private bool _hasWind;
    [ObservableProperty] private bool _hasWindDirection;
    [ObservableProperty] private bool _hasRainfall;
    [ObservableProperty] private bool _hasSolar;
    [ObservableProperty] private bool _hasUvIndex;
    [ObservableProperty] private bool _hasEto;
    [ObservableProperty] private bool _hasSoil;
    [ObservableProperty] private bool _hasAirQuality;
    [ObservableProperty] private bool _hasBattery;
    [ObservableProperty] private bool _hasWaterLevel;
    [ObservableProperty] private bool _hasSwitch;
    [ObservableProperty] private bool _hasLightning;
    [ObservableProperty] private bool _hasMpptPower;
    [ObservableProperty] private bool _hasMpptVoltage;
    [ObservableProperty] private bool _hasMpptCurrent;
    [ObservableProperty] private bool _hasMppt2Power;
    [ObservableProperty] private bool _hasMppt2Voltage;
    [ObservableProperty] private bool _hasWindPower;
    [ObservableProperty] private bool _hasCo2Tvoc;
    [ObservableProperty] private bool _hasAirDensity;

    // ── Chart export data (series + axes stored for high-res PNG re-rendering) ──
    public Dictionary<string, (ISeries[] Series, Axis[] YAxes, bool Visible)> ChartExportData { get; } = new();

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

            foreach (var s in stations!)
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

            // Apply QC/QA flags to loaded records
            ApplyQualityFlags(records);

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

    partial void OnSelectedTimeRangeChanged(string value)
    {
        if (SelectedStation != null)
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
                    AddLog($"[ERROR] Failed to reload data for time range: {ex.Message}");
                }
            });
        }
    }

    /// <summary>
    /// Called by the Serial Monitor when a new WeatherRecord arrives from PakBus.
    /// Updates the dashboard gauges with live logger data.
    /// </summary>
    public void UpdateFromLogger(WeatherRecord record)
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() =>
        {
            LatestData = record;
            StatusText = $"Logger data: {record.Timestamp:HH:mm:ss}";
            AddLog($"[LOGGER] T={record.Temperature:F1}°C RH={record.Humidity:F0}% " +
                   $"P={record.Pressure:F1}hPa WS={record.WindSpeed:F1}km/h Batt={record.BatteryVoltage:F2}V");
        });
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

    /// <summary>
    /// Runs QualityFlagService on the loaded records and stamps each WeatherRecord
    /// with its QcFlag / QcSummary for the DataGrid template column.
    /// </summary>
    private void ApplyQualityFlags(List<WeatherRecord> records)
    {
        try
        {
            var qcService = App.QualityFlagService;
            var results = qcService.EvaluateDataset(records);

            // Map results back to records (both are ordered ascending by timestamp)
            var ordered = records.OrderBy(r => r.Timestamp).ToList();
            for (int i = 0; i < ordered.Count && i < results.Count; i++)
            {
                ordered[i].QcFlag = (int)results[i].OverallFlag;
                ordered[i].QcSummary = string.Join("; ", results[i].SensorFlags
                    .Where(f => f.Flag is Models.QualityFlag.Suspect or Models.QualityFlag.Bad)
                    .Select(f => $"{f.SensorField}: {f.Reason}"));
            }

            var summary = qcService.Summarise(records, results);
            QcStatusText = $"QC: {summary.DataQualityIndex:F0}% DQI • {summary.GoodRecords}✓ {summary.SuspectRecords}⚠ {summary.BadRecords}✗";
            AddLog($"[QC] Dataset quality index: {summary.DataQualityIndex:F1}% — Good:{summary.GoodRecords} Suspect:{summary.SuspectRecords} Bad:{summary.BadRecords}");
        }
        catch (Exception ex)
        {
            AddLog($"[QC] Flag evaluation failed: {ex.Message}");
        }
    }

    [ObservableProperty] private string _qcStatusText = "QC: –";

    private void UpdateCharts(List<WeatherRecord> records)
    {
        if (records.Count == 0) return;

        var ordered = records.OrderBy(r => r.Timestamp).ToList();

        // No downsampling — static images handle any point count efficiently
        var sampled = ordered;

        // ── Build X-axis configuration for the loaded time range ──
        string dateFmt = SelectedTimeRange switch
        {
            "1h" or "6h" => "HH:mm",
            "24h" or "48h" => "dd/MM HH:mm",
            _ => "dd MMM"
        };

        double minStep = SelectedTimeRange switch
        {
            "1h"  => TimeSpan.FromMinutes(5).Ticks,
            "6h"  => TimeSpan.FromMinutes(30).Ticks,
            "24h" => TimeSpan.FromHours(2).Ticks,
            "48h" => TimeSpan.FromHours(4).Ticks,
            "7d"  => TimeSpan.FromDays(1).Ticks,
            "30d" => TimeSpan.FromDays(3).Ticks,
            _     => TimeSpan.FromHours(2).Ticks
        };

        // ═══ White Theme: bold dark text/grid on white chart background ═══
        var xAxes = new Axis[]
        {
            new Axis
            {
                Name = "Date / Time",
                NameTextSize = 44,
                NamePaint = new SolidColorPaint(new SKColor(0x1E, 0x29, 0x3B)) { SKTypeface = SKTypeface.FromFamilyName("Segoe UI", SKFontStyleWeight.Bold, SKFontStyleWidth.Normal, SKFontStyleSlant.Upright) },
                Labeler = v => { try { return new DateTime((long)v).ToString(dateFmt); } catch { return ""; } },
                LabelsRotation = -45,
                TextSize = 36,
                MinStep = minStep,
                LabelsPaint = new SolidColorPaint(new SKColor(0x1E, 0x29, 0x3B)),
                SeparatorsPaint = new SolidColorPaint(new SKColor(0xE2, 0xE8, 0xF0)) { StrokeThickness = 1 },
            }
        };

        // Clear export data
        ChartExportData.Clear();

        // Helper to build points from a nullable double selector
        List<DateTimePoint> Pts(Func<WeatherRecord, double?> sel) =>
            sampled.Where(r => sel(r).HasValue)
                   .Select(r => new DateTimePoint(r.Timestamp, sel(r)!.Value))
                   .ToList();

        // ═══ Bold trace series on white background ═══
        LineSeries<DateTimePoint> Line(List<DateTimePoint> pts, string name, byte r, byte g, byte b, bool fill = false) =>
            new()
            {
                Values = pts, Name = name,
                Stroke = new SolidColorPaint(new SKColor(r, g, b)) { StrokeThickness = 5 },
                Fill = fill ? new SolidColorPaint(new SKColor(r, g, b, 0x30)) : null,
                GeometrySize = 0, LineSmoothness = 0.3
            };

        // Dashed line overlay (min/max)
        LineSeries<DateTimePoint> Dash(List<DateTimePoint> pts, string name, byte r, byte g, byte b) =>
            new()
            {
                Values = pts, Name = name,
                Stroke = new SolidColorPaint(new SKColor(r, g, b)) { StrokeThickness = 3.5f, PathEffect = new LiveChartsCore.SkiaSharpView.Painting.Effects.DashEffect(new float[] { 10, 6 }) },
                Fill = null, GeometrySize = 0, LineSmoothness = 0.3
            };

        // Helper to render a chart and store export data
        ImageSource? Render(string label, ISeries[] series, Axis[] yAxes)
        {
            ChartExportData[label] = (series, yAxes, series.Length > 0);
            return RenderChartImage(series, xAxes, yAxes, title: label);
        }

        int chartCount = 0;

        // ═══ RTDM bright trace colors for dark background ═══

        // ── Temperature (+ DewPoint + Min/Max overlays) ──
        var tempPts = Pts(x => x.Temperature);
        var dewPts = Pts(x => x.DewPoint);
        var tMinPts = Pts(x => x.TemperatureMin);
        var tMaxPts = Pts(x => x.TemperatureMax);
        if (tempPts.Count > 0)
        {
            var s = new List<ISeries> { Line(tempPts, "Temperature (°C)", 0x1D, 0x4E, 0xD8) };
            if (dewPts.Count > 0) s.Add(Line(dewPts, "Dew Point (°C)", 0x1E, 0x40, 0xAF));
            if (tMinPts.Count > 0) s.Add(Dash(tMinPts, "Temp Min (°C)", 0x1E, 0x29, 0x3B));
            if (tMaxPts.Count > 0) s.Add(Dash(tMaxPts, "Temp Max (°C)", 0x00, 0x00, 0x00));
            TemperatureImage = Render("Temperature", s.ToArray(), MakeYAxes("Temperature (°C)"));
            HasTemperature = true; chartCount++;
        } else { HasTemperature = false; TemperatureImage = null; }

        // ── Humidity ──
        var humPts = Pts(x => x.Humidity);
        HasHumidity = humPts.Count > 0;
        HumidityImage = HasHumidity
            ? Render("Humidity", new ISeries[] { Line(humPts, "Humidity (%)", 0x1D, 0x4E, 0xD8) }, MakeYAxes("Relative Humidity (%)", "F0", 0, 100))
            : null;
        if (HasHumidity) chartCount++;

        // ── Pressure (+ Sea Level overlay) ──
        var presPts = Pts(x => x.Pressure);
        var presSL = Pts(x => x.PressureSeaLevel);
        var presList = new List<ISeries>();
        if (presPts.Count > 0) presList.Add(Line(presPts, "Pressure (hPa)", 0x1D, 0x4E, 0xD8));
        if (presSL.Count > 0) presList.Add(Line(presSL, "Sea-Level Pressure (hPa)", 0x1E, 0x29, 0x3B));
        HasPressure = presList.Count > 0;
        PressureImage = HasPressure ? Render("Pressure", presList.ToArray(), MakeYAxes("Pressure (hPa)", "F0")) : null;
        if (HasPressure) chartCount++;

        // ── Dew Point (standalone — only if no temperature chart) ──
        HasDewPoint = dewPts.Count > 0 && tempPts.Count == 0;
        DewPointImage = HasDewPoint
            ? Render("Dew Point", new ISeries[] { Line(dewPts, "Dew Point (°C)", 0x1D, 0x4E, 0xD8) }, MakeYAxes("Dew Point (°C)"))
            : null;
        if (HasDewPoint) chartCount++;

        // ── Wind Speed + Gust ──
        var windPts = Pts(x => x.WindSpeed);
        var gustPts = Pts(x => x.WindGust);
        var windList = new List<ISeries>();
        if (windPts.Count > 0) windList.Add(Line(windPts, "Wind Speed (km/h)", 0x1D, 0x4E, 0xD8));
        if (gustPts.Count > 0) windList.Add(Line(gustPts, "Wind Gust (km/h)", 0x1E, 0x29, 0x3B));
        HasWind = windList.Count > 0;
        WindImage = HasWind ? Render("Wind Speed", windList.ToArray(), MakeYAxes("Speed (km/h)", "F0", minLimit: 0)) : null;
        if (HasWind) chartCount++;

        // ── Wind Direction ──
        var wdirPts = Pts(x => x.WindDirection);
        HasWindDirection = wdirPts.Count > 0;
        WindDirectionImage = HasWindDirection
            ? Render("Wind Direction", new ISeries[] { new ScatterSeries<DateTimePoint> {
                Values = wdirPts, Name = "Wind Direction (°)", Stroke = null,
                Fill = new SolidColorPaint(new SKColor(0x1D, 0x4E, 0xD8)), GeometrySize = 6
            } }, MakeYAxes("Direction (°)", "F0", 0, 360))
            : null;
        if (HasWindDirection) chartCount++;

        // ── Wind Power ──
        var wpPts = Pts(x => x.WindPower);
        HasWindPower = wpPts.Count > 0;
        WindPowerImage = HasWindPower
            ? Render("Wind Power", new ISeries[] { Line(wpPts, "Wind Power (W/m²)", 0x1D, 0x4E, 0xD8, true) }, MakeYAxes("Power (W/m²)", "F0", minLimit: 0))
            : null;
        if (HasWindPower) chartCount++;

        // ── Rainfall (bar + 24h cumulative overlay) ──
        var rainPts = Pts(x => x.Rainfall);
        var rain24 = Pts(x => x.Rainfall24h);
        var rainList = new List<ISeries>();
        if (rainPts.Count > 0) rainList.Add(new ColumnSeries<DateTimePoint> {
            Values = rainPts, Name = "Rainfall (mm)",
            Fill = new SolidColorPaint(new SKColor(0x1D, 0x4E, 0xD8)), Stroke = null, MaxBarWidth = 8
        });
        if (rain24.Count > 0) rainList.Add(Line(rain24, "Rainfall 24h (mm)", 0x1E, 0x29, 0x3B));
        HasRainfall = rainList.Count > 0;
        RainfallImage = HasRainfall ? Render("Rainfall", rainList.ToArray(), MakeYAxes("Rainfall (mm)", "F1", minLimit: 0)) : null;
        if (HasRainfall) chartCount++;

        // ── Solar Radiation (+ Max overlay) ──
        var solPts = Pts(x => x.SolarRadiation);
        var solMax = Pts(x => x.SolarRadiationMax);
        var solList = new List<ISeries>();
        if (solPts.Count > 0) solList.Add(Line(solPts, "Solar Radiation (W/m²)", 0x1D, 0x4E, 0xD8, true));
        if (solMax.Count > 0) solList.Add(Dash(solMax, "Solar Max (W/m²)", 0x1E, 0x29, 0x3B));
        HasSolar = solList.Count > 0;
        SolarImage = HasSolar ? Render("Solar Radiation", solList.ToArray(), MakeYAxes("Irradiance (W/m²)", "F0", minLimit: 0)) : null;
        if (HasSolar) chartCount++;

        // ── UV Index ──
        var uvPts = Pts(x => x.UvIndex);
        HasUvIndex = uvPts.Count > 0;
        UvIndexImage = HasUvIndex
            ? Render("UV Index", new ISeries[] { Line(uvPts, "UV Index", 0x1D, 0x4E, 0xD8) }, MakeYAxes("UV Index", "F1", minLimit: 0))
            : null;
        if (HasUvIndex) chartCount++;

        // ── Evapotranspiration (+ 24h overlay) ──
        var etoPts = Pts(x => x.Eto);
        var eto24 = Pts(x => x.Eto24h);
        var etoList = new List<ISeries>();
        if (etoPts.Count > 0) etoList.Add(Line(etoPts, "ETo (mm/day)", 0x1D, 0x4E, 0xD8, true));
        if (eto24.Count > 0) etoList.Add(Line(eto24, "ETo 24h (mm)", 0x1E, 0x29, 0x3B));
        HasEto = etoList.Count > 0;
        EtoImage = HasEto ? Render("Evapotranspiration", etoList.ToArray(), MakeYAxes("ETo (mm/day)", "F2", minLimit: 0)) : null;
        if (HasEto) chartCount++;

        // ── Soil (Temperature + Moisture + Leaf Wetness) ──
        var stPts = Pts(x => x.SoilTemperature);
        var smPts = Pts(x => x.SoilMoisture);
        var lwPts = Pts(x => x.LeafWetness);
        var soilList = new List<ISeries>();
        if (stPts.Count > 0) soilList.Add(Line(stPts, "Soil Temp (°C)", 0x1D, 0x4E, 0xD8));
        if (smPts.Count > 0) soilList.Add(Line(smPts, "Soil Moisture (%)", 0x1E, 0x29, 0x3B));
        if (lwPts.Count > 0) soilList.Add(Line(lwPts, "Leaf Wetness", 0x00, 0x00, 0x00));
        HasSoil = soilList.Count > 0;
        SoilImage = HasSoil ? Render("Soil", soilList.ToArray(), MakeYAxes("Value")) : null;
        if (HasSoil) chartCount++;

        // ── Air Quality (PM1 + PM2.5 + PM10) ──
        var pm1Pts = Pts(x => x.Pm1);
        var pm25Pts = Pts(x => x.Pm25);
        var pm10Pts = Pts(x => x.Pm10);
        var aqList = new List<ISeries>();
        if (pm1Pts.Count > 0) aqList.Add(Line(pm1Pts, "PM1 (µg/m³)", 0x1D, 0x4E, 0xD8));
        if (pm25Pts.Count > 0) aqList.Add(Line(pm25Pts, "PM2.5 (µg/m³)", 0x1E, 0x29, 0x3B));
        if (pm10Pts.Count > 0) aqList.Add(Line(pm10Pts, "PM10 (µg/m³)", 0x00, 0x00, 0x00));
        HasAirQuality = aqList.Count > 0;
        AirQualityImage = HasAirQuality ? Render("Air Quality", aqList.ToArray(), MakeYAxes("Concentration (µg/m³)", "F0", minLimit: 0)) : null;
        if (HasAirQuality) chartCount++;

        // ── CO₂ & TVOC ──
        var co2Pts = Pts(x => x.Co2);
        var tvocPts = Pts(x => x.Tvoc);
        var ctList = new List<ISeries>();
        if (co2Pts.Count > 0) ctList.Add(Line(co2Pts, "CO₂ (ppm)", 0x1D, 0x4E, 0xD8));
        if (tvocPts.Count > 0) ctList.Add(Line(tvocPts, "TVOC (ppb)", 0x1E, 0x29, 0x3B));
        HasCo2Tvoc = ctList.Count > 0;
        Co2TvocImage = HasCo2Tvoc ? Render("CO2 TVOC", ctList.ToArray(), MakeYAxes("Concentration", "F0", minLimit: 0)) : null;
        if (HasCo2Tvoc) chartCount++;

        // ── Air Density ──
        var adPts = Pts(x => x.AirDensity);
        HasAirDensity = adPts.Count > 0;
        AirDensityImage = HasAirDensity
            ? Render("Air Density", new ISeries[] { Line(adPts, "Air Density (kg/m³)", 0x1D, 0x4E, 0xD8) }, MakeYAxes("Density (kg/m³)", "F3"))
            : null;
        if (HasAirDensity) chartCount++;

        // ── Battery & Power (Battery + Charger + Panel Temp) ──
        var battPts = Pts(x => x.BatteryVoltage);
        var chgPts = Pts(x => x.ChargerVoltage);
        var pnlPts = Pts(x => x.PanelTemperature);
        var battList = new List<ISeries>();
        if (battPts.Count > 0) battList.Add(Line(battPts, "Battery (V)", 0x1D, 0x4E, 0xD8));
        if (chgPts.Count > 0) battList.Add(Line(chgPts, "Charger (V)", 0x1E, 0x29, 0x3B));
        if (pnlPts.Count > 0) battList.Add(Line(pnlPts, "Panel Temp (°C)", 0x00, 0x00, 0x00));
        HasBattery = battList.Count > 0;
        BatteryImage = HasBattery ? Render("Battery Power", battList.ToArray(), MakeYAxes("Voltage (V) / Temp (°C)", "F2")) : null;
        if (HasBattery) chartCount++;

        // ── Water Level ──
        var wlPts = Pts(x => x.WaterLevel);
        HasWaterLevel = wlPts.Count > 0;
        WaterLevelImage = HasWaterLevel
            ? Render("Water Level", new ISeries[] { Line(wlPts, "Water Level (mm)", 0x1D, 0x4E, 0xD8, true) }, MakeYAxes("Level (mm)", "F0", minLimit: 0))
            : null;
        if (HasWaterLevel) chartCount++;

        // ── Temperature Switch + Level Switch ──
        var tswPts = Pts(x => x.TemperatureSwitch);
        var lswPts = Pts(x => x.LevelSwitch);
        var tsoPts = Pts(x => x.TemperatureSwitchOutlet);
        var swList = new List<ISeries>();
        if (tswPts.Count > 0) swList.Add(Line(tswPts, "Temp Switch (mV)", 0x1D, 0x4E, 0xD8));
        if (lswPts.Count > 0) swList.Add(Line(lswPts, "Level Switch (mV)", 0x1E, 0x29, 0x3B));
        if (tsoPts.Count > 0) swList.Add(Line(tsoPts, "Temp Switch Outlet (mV)", 0x00, 0x00, 0x00));
        HasSwitch = swList.Count > 0;
        SwitchImage = HasSwitch ? Render("Switches", swList.ToArray(), MakeYAxes("Value (mV)", "F0")) : null;
        if (HasSwitch) chartCount++;

        // ── Lightning ──
        var ltPts = Pts(x => x.Lightning);
        HasLightning = ltPts.Count > 0;
        LightningImage = HasLightning
            ? Render("Lightning", new ISeries[] { new ColumnSeries<DateTimePoint> {
                Values = ltPts, Name = "Lightning (strikes)",
                Fill = new SolidColorPaint(new SKColor(0x1D, 0x4E, 0xD8)), Stroke = null, MaxBarWidth = 6
            } }, MakeYAxes("Strikes", "F0", minLimit: 0))
            : null;
        if (HasLightning) chartCount++;

        // ── MPPT Charger 1 — Power ──
        var mp1Pts = Pts(x => x.MpptSolarPower);
        HasMpptPower = mp1Pts.Count > 0;
        MpptPowerImage = HasMpptPower
            ? Render("MPPT1 Power", new ISeries[] { Line(mp1Pts, "MPPT Solar Power (W)", 0x1D, 0x4E, 0xD8, true) }, MakeYAxes("Power (W)", "F1", minLimit: 0))
            : null;
        if (HasMpptPower) chartCount++;

        // ── MPPT Charger 1 — Voltage ──
        var msv = Pts(x => x.MpptSolarVoltage);
        var mbv = Pts(x => x.MpptBatteryVoltage);
        var mlv = Pts(x => x.MpptLoadVoltage);
        var mvList = new List<ISeries>();
        if (msv.Count > 0) mvList.Add(Line(msv, "Solar V", 0x1D, 0x4E, 0xD8));
        if (mbv.Count > 0) mvList.Add(Line(mbv, "Battery V", 0x1E, 0x29, 0x3B));
        if (mlv.Count > 0) mvList.Add(Line(mlv, "Load V", 0x00, 0x00, 0x00));
        HasMpptVoltage = mvList.Count > 0;
        MpptVoltageImage = HasMpptVoltage ? Render("MPPT1 Voltage", mvList.ToArray(), MakeYAxes("Voltage (V)", "F2")) : null;
        if (HasMpptVoltage) chartCount++;

        // ── MPPT Charger 1 — Current ──
        var msc = Pts(x => x.MpptSolarCurrent);
        var mbc = Pts(x => x.MpptBatteryCurrent);
        var mlc = Pts(x => x.MpptLoadCurrent);
        var mcList = new List<ISeries>();
        if (msc.Count > 0) mcList.Add(Line(msc, "Solar mA", 0x1D, 0x4E, 0xD8));
        if (mbc.Count > 0) mcList.Add(Line(mbc, "Battery mA", 0x1E, 0x29, 0x3B));
        if (mlc.Count > 0) mcList.Add(Line(mlc, "Load mA", 0x00, 0x00, 0x00));
        HasMpptCurrent = mcList.Count > 0;
        MpptCurrentImage = HasMpptCurrent ? Render("MPPT1 Current", mcList.ToArray(), MakeYAxes("Current (mA)", "F0")) : null;
        if (HasMpptCurrent) chartCount++;

        // ── MPPT Charger 2 — Power ──
        var m2pPts = Pts(x => x.Mppt2SolarPower);
        HasMppt2Power = m2pPts.Count > 0;
        Mppt2PowerImage = HasMppt2Power
            ? Render("MPPT2 Power", new ISeries[] { Line(m2pPts, "MPPT2 Solar Power (W)", 0x1D, 0x4E, 0xD8, true) }, MakeYAxes("Power (W)", "F1", minLimit: 0))
            : null;
        if (HasMppt2Power) chartCount++;

        // ── MPPT Charger 2 — Voltage ──
        var m2sv = Pts(x => x.Mppt2SolarVoltage);
        var m2bv = Pts(x => x.Mppt2BatteryVoltage);
        var m2lv = Pts(x => x.Mppt2LoadVoltage);
        var m2vList = new List<ISeries>();
        if (m2sv.Count > 0) m2vList.Add(Line(m2sv, "Solar V", 0x1D, 0x4E, 0xD8));
        if (m2bv.Count > 0) m2vList.Add(Line(m2bv, "Battery V", 0x1E, 0x29, 0x3B));
        if (m2lv.Count > 0) m2vList.Add(Line(m2lv, "Load V", 0x00, 0x00, 0x00));
        HasMppt2Voltage = m2vList.Count > 0;
        Mppt2VoltageImage = HasMppt2Voltage ? Render("MPPT2 Voltage", m2vList.ToArray(), MakeYAxes("Voltage (V)", "F2")) : null;
        if (HasMppt2Voltage) chartCount++;

        AddLog($"[CHARTS] Rendered {chartCount} static chart image(s) for {SelectedTimeRange} range ({sampled.Count} points)");
    }

    // ═══════════════════════════════════════════════════════════════
    // White Chart Theme
    // ═════════════════════════════════════════════════════════════
    private static readonly SKColor ChartBg = SKColors.White;
    private static readonly SKColor ChartTitleBg = new(0xF8, 0xFA, 0xFC);    // Light grey title strip
    private static readonly SKColor ChartTitleFg = new(0x1E, 0x29, 0x3B);    // Dark text

    /// <summary>
    /// Renders a chart as a static PNG image using LiveCharts2 off-screen SkiaSharp renderer.
    /// White background with dark text, professional clean look.
    /// Returns a frozen BitmapImage for WPF.
    /// </summary>
    private static ImageSource? RenderChartImage(ISeries[] series, Axis[] xAxes, Axis[] yAxes,
        string? title = null, int width = 3200, int height = 800)
    {
        if (series.Length == 0) return null;

        try
        {
            const int titleHeight = 100;
            int totalHeight = string.IsNullOrEmpty(title) ? height : height + titleHeight;

            var chart = new SKCartesianChart
            {
                Width = width,
                Height = height,
                Series = series,
                XAxes = xAxes,
                YAxes = yAxes,
                Background = ChartBg,
                LegendPosition = LiveChartsCore.Measure.LegendPosition.Top,
                LegendTextSize = 32,
                LegendTextPaint = new SolidColorPaint(new SKColor(0x1E, 0x29, 0x3B)),
            };

            using var chartImage = chart.GetImage();

            // Composite: dark title bar + dark chart
            var info = new SKImageInfo(width, totalHeight);
            using var surface = SKSurface.Create(info);
            var canvas = surface.Canvas;
            canvas.Clear(ChartTitleBg);

            if (!string.IsNullOrEmpty(title))
            {
                // Draw accent line under title
                using var accentPaint = new SKPaint
                {
                    Color = new SKColor(0x1D, 0x4E, 0xD8),
                    StrokeWidth = 2,
                    IsAntialias = true,
                };
                canvas.DrawLine(0, titleHeight - 1, width, titleHeight - 1, accentPaint);

                using var titlePaint = new SKPaint
                {
                    Color = ChartTitleFg,
                    IsAntialias = true,
                    TextSize = 60,
                    Typeface = SKTypeface.FromFamilyName("Segoe UI", SKFontStyleWeight.Bold, SKFontStyleWidth.Normal, SKFontStyleSlant.Upright),
                    TextAlign = SKTextAlign.Center,
                };
                canvas.DrawText(title, width / 2f, 68, titlePaint);
                canvas.DrawBitmap(SKBitmap.FromImage(chartImage), 0, titleHeight);
            }
            else
            {
                canvas.DrawBitmap(SKBitmap.FromImage(chartImage), 0, 0);
            }

            using var finalImage = surface.Snapshot();
            using var encoded = finalImage.Encode(SKEncodedImageFormat.Png, 100);
            var bytes = encoded.ToArray();

            var bmp = new BitmapImage();
            bmp.BeginInit();
            bmp.CacheOption = BitmapCacheOption.OnLoad;
            bmp.StreamSource = new MemoryStream(bytes);
            bmp.EndInit();
            bmp.Freeze();
            return bmp;
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to render chart image ({Title})", title);
            return null;
        }
    }

    /// <summary>
    /// Creates a Y-axis array with clean white theme styling.
    /// Dark text and light grid for professional aesthetics.
    /// </summary>
    private static Axis[] MakeYAxes(string name, string format = "F1",
        double? minLimit = null, double? maxLimit = null) => new Axis[]
    {
        new Axis
        {
            Name = name,
            NameTextSize = 44,
            NamePaint = new SolidColorPaint(new SKColor(0x1E, 0x29, 0x3B)) { SKTypeface = SKTypeface.FromFamilyName("Segoe UI", SKFontStyleWeight.Bold, SKFontStyleWidth.Normal, SKFontStyleSlant.Upright) },
            TextSize = 36,
            LabelsPaint = new SolidColorPaint(new SKColor(0x1E, 0x29, 0x3B)),
            SeparatorsPaint = new SolidColorPaint(new SKColor(0xE2, 0xE8, 0xF0)) { StrokeThickness = 1 },
            Labeler = v => v.ToString(format),
            MinLimit = minLimit,
            MaxLimit = maxLimit,
            Padding = new LiveChartsCore.Drawing.Padding(0, 10, 0, 10),
        }
    };
}
