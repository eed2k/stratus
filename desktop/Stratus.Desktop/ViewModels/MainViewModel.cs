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
    // Atmospheric
    [ObservableProperty] private ISeries[] _temperatureSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _humiditySeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _pressureSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _dewPointSeries = Array.Empty<ISeries>();
    // Wind
    [ObservableProperty] private ISeries[] _windSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _windDirectionSeries = Array.Empty<ISeries>();
    // Precipitation
    [ObservableProperty] private ISeries[] _rainfallSeries = Array.Empty<ISeries>();
    // Solar
    [ObservableProperty] private ISeries[] _solarSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _uvIndexSeries = Array.Empty<ISeries>();
    // Evapotranspiration
    [ObservableProperty] private ISeries[] _etoSeries = Array.Empty<ISeries>();
    // Soil
    [ObservableProperty] private ISeries[] _soilSeries = Array.Empty<ISeries>();
    // Air Quality
    [ObservableProperty] private ISeries[] _airQualitySeries = Array.Empty<ISeries>();
    // Battery & Power
    [ObservableProperty] private ISeries[] _batterySeries = Array.Empty<ISeries>();
    // Water & Sensors
    [ObservableProperty] private ISeries[] _waterLevelSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _switchSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _lightningSeries = Array.Empty<ISeries>();
    // MPPT Charger 1
    [ObservableProperty] private ISeries[] _mpptPowerSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _mpptVoltageSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _mpptCurrentSeries = Array.Empty<ISeries>();
    // MPPT Charger 2
    [ObservableProperty] private ISeries[] _mppt2PowerSeries = Array.Empty<ISeries>();
    [ObservableProperty] private ISeries[] _mppt2VoltageSeries = Array.Empty<ISeries>();

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

        // Helper to build points from a nullable double selector
        List<DateTimePoint> Pts(Func<WeatherRecord, double?> sel) =>
            ordered.Where(r => sel(r).HasValue)
                   .Select(r => new DateTimePoint(r.Timestamp, sel(r)!.Value))
                   .ToList();

        // Helper to create a line series
        LineSeries<DateTimePoint> Line(List<DateTimePoint> pts, string name, byte r, byte g, byte b, bool fill = false) =>
            new()
            {
                Values = pts, Name = name,
                Stroke = new SolidColorPaint(new SKColor(r, g, b)) { StrokeThickness = 2 },
                Fill = fill ? new SolidColorPaint(new SKColor(r, g, b, 0x30)) : null,
                GeometrySize = 0, LineSmoothness = 0.3
            };

        // ── Temperature (+ DewPoint overlay) ──
        var tempPts = Pts(x => x.Temperature);
        var dewPts = Pts(x => x.DewPoint);
        if (tempPts.Count > 0)
        {
            var s = new List<ISeries> { Line(tempPts, "Temperature (°C)", 0xEF, 0x44, 0x44) };
            if (dewPts.Count > 0) s.Add(Line(dewPts, "Dew Point (°C)", 0x8B, 0x5C, 0xF6));
            TemperatureSeries = s.ToArray();
            HasTemperature = true;
        } else HasTemperature = false;

        // ── Humidity ──
        var humPts = Pts(x => x.Humidity);
        HumiditySeries = humPts.Count > 0 ? new ISeries[] { Line(humPts, "Humidity (%)", 0x3B, 0x82, 0xF6) } : Array.Empty<ISeries>();
        HasHumidity = humPts.Count > 0;

        // ── Pressure ──
        var presPts = Pts(x => x.Pressure);
        HasPressure = presPts.Count > 0;
        PressureSeries = HasPressure ? new ISeries[] { Line(presPts, "Pressure (hPa)", 0x64, 0x74, 0x8B) } : Array.Empty<ISeries>();

        // ── Dew Point (standalone if no temperature) ──
        HasDewPoint = dewPts.Count > 0 && tempPts.Count == 0;
        DewPointSeries = HasDewPoint ? new ISeries[] { Line(dewPts, "Dew Point (°C)", 0x8B, 0x5C, 0xF6) } : Array.Empty<ISeries>();

        // ── Wind Speed + Gust ──
        var windPts = Pts(x => x.WindSpeed);
        var gustPts = Pts(x => x.WindGust);
        var windList = new List<ISeries>();
        if (windPts.Count > 0) windList.Add(Line(windPts, "Wind Speed (km/h)", 0x22, 0xC5, 0x5E));
        if (gustPts.Count > 0) windList.Add(Line(gustPts, "Wind Gust (km/h)", 0xF9, 0x73, 0x16));
        WindSeries = windList.ToArray();
        HasWind = windList.Count > 0;

        // ── Wind Direction ──
        var wdirPts = Pts(x => x.WindDirection);
        HasWindDirection = wdirPts.Count > 0;
        WindDirectionSeries = HasWindDirection ? new ISeries[] { new ScatterSeries<DateTimePoint>
        {
            Values = wdirPts, Name = "Wind Direction (°)",
            Stroke = null,
            Fill = new SolidColorPaint(new SKColor(0x06, 0xB6, 0xD4)),
            GeometrySize = 3
        } } : Array.Empty<ISeries>();

        // ── Rainfall (bar chart) ──
        var rainPts = Pts(x => x.Rainfall);
        HasRainfall = rainPts.Count > 0;
        RainfallSeries = HasRainfall ? new ISeries[] { new ColumnSeries<DateTimePoint>
        {
            Values = rainPts, Name = "Rainfall (mm)",
            Fill = new SolidColorPaint(new SKColor(0x38, 0xBD, 0xF8)),
            Stroke = null, MaxBarWidth = 8
        } } : Array.Empty<ISeries>();

        // ── Solar Radiation ──
        var solPts = Pts(x => x.SolarRadiation);
        HasSolar = solPts.Count > 0;
        SolarSeries = HasSolar ? new ISeries[] { Line(solPts, "Solar Radiation (W/m²)", 0xEA, 0xB3, 0x08, true) } : Array.Empty<ISeries>();

        // ── UV Index ──
        var uvPts = Pts(x => x.UvIndex);
        HasUvIndex = uvPts.Count > 0;
        UvIndexSeries = HasUvIndex ? new ISeries[] { Line(uvPts, "UV Index", 0xA8, 0x55, 0xF7) } : Array.Empty<ISeries>();

        // ── Evapotranspiration ──
        var etoPts = Pts(x => x.Eto);
        HasEto = etoPts.Count > 0;
        EtoSeries = HasEto ? new ISeries[] { Line(etoPts, "ETo (mm/day)", 0x14, 0xB8, 0xA6, true) } : Array.Empty<ISeries>();

        // ── Soil (Temperature + Moisture) ──
        var stPts = Pts(x => x.SoilTemperature);
        var smPts = Pts(x => x.SoilMoisture);
        var soilList = new List<ISeries>();
        if (stPts.Count > 0) soilList.Add(Line(stPts, "Soil Temp (°C)", 0x92, 0x40, 0x0E));
        if (smPts.Count > 0) soilList.Add(Line(smPts, "Soil Moisture (%)", 0x16, 0xA3, 0x4A));
        SoilSeries = soilList.ToArray();
        HasSoil = soilList.Count > 0;

        // ── Air Quality (PM2.5 + PM10) ──
        var pm25Pts = Pts(x => x.Pm25);
        var pm10Pts = Pts(x => x.Pm10);
        var aqList = new List<ISeries>();
        if (pm25Pts.Count > 0) aqList.Add(Line(pm25Pts, "PM2.5 (µg/m³)", 0xF5, 0x9E, 0x0B));
        if (pm10Pts.Count > 0) aqList.Add(Line(pm10Pts, "PM10 (µg/m³)", 0xEF, 0x44, 0x44));
        AirQualitySeries = aqList.ToArray();
        HasAirQuality = aqList.Count > 0;

        // ── Battery & Power (Battery + Charger + Panel Temp) ──
        var battPts = Pts(x => x.BatteryVoltage);
        var chgPts = Pts(x => x.ChargerVoltage);
        var pnlPts = Pts(x => x.PanelTemperature);
        var battList = new List<ISeries>();
        if (battPts.Count > 0) battList.Add(Line(battPts, "Battery (V)", 0x16, 0xA3, 0x4A));
        if (chgPts.Count > 0) battList.Add(Line(chgPts, "Charger (V)", 0xEA, 0xB3, 0x08));
        if (pnlPts.Count > 0) battList.Add(Line(pnlPts, "Panel Temp (°C)", 0xEF, 0x44, 0x44));
        BatterySeries = battList.ToArray();
        HasBattery = battList.Count > 0;

        // ── Water Level ──
        var wlPts = Pts(x => x.WaterLevel);
        HasWaterLevel = wlPts.Count > 0;
        WaterLevelSeries = HasWaterLevel ? new ISeries[] { Line(wlPts, "Water Level (mm)", 0x06, 0xB6, 0xD4, true) } : Array.Empty<ISeries>();

        // ── Temperature Switch + Level Switch ──
        var tswPts = Pts(x => x.TemperatureSwitch);
        var lswPts = Pts(x => x.LevelSwitch);
        var tsoPts = Pts(x => x.TemperatureSwitchOutlet);
        var swList = new List<ISeries>();
        if (tswPts.Count > 0) swList.Add(Line(tswPts, "Temp Switch (mV)", 0xEF, 0x44, 0x44));
        if (lswPts.Count > 0) swList.Add(Line(lswPts, "Level Switch (mV)", 0x3B, 0x82, 0xF6));
        if (tsoPts.Count > 0) swList.Add(Line(tsoPts, "Temp Switch Outlet (mV)", 0xF9, 0x73, 0x16));
        SwitchSeries = swList.ToArray();
        HasSwitch = swList.Count > 0;

        // ── Lightning ──
        var ltPts = Pts(x => x.Lightning);
        HasLightning = ltPts.Count > 0;
        LightningSeries = HasLightning ? new ISeries[] { new ColumnSeries<DateTimePoint>
        {
            Values = ltPts, Name = "Lightning (strikes)",
            Fill = new SolidColorPaint(new SKColor(0xFA, 0xCC, 0x15)),
            Stroke = null, MaxBarWidth = 6
        } } : Array.Empty<ISeries>();

        // ── MPPT Charger 1 — Power ──
        var mp1Pts = Pts(x => x.MpptSolarPower);
        HasMpptPower = mp1Pts.Count > 0;
        MpptPowerSeries = HasMpptPower ? new ISeries[] { Line(mp1Pts, "MPPT Solar Power (W)", 0xEA, 0xB3, 0x08, true) } : Array.Empty<ISeries>();

        // ── MPPT Charger 1 — Voltage ──
        var msv = Pts(x => x.MpptSolarVoltage);
        var mbv = Pts(x => x.MpptBatteryVoltage);
        var mlv = Pts(x => x.MpptLoadVoltage);
        var mvList = new List<ISeries>();
        if (msv.Count > 0) mvList.Add(Line(msv, "Solar V", 0xEA, 0xB3, 0x08));
        if (mbv.Count > 0) mvList.Add(Line(mbv, "Battery V", 0x16, 0xA3, 0x4A));
        if (mlv.Count > 0) mvList.Add(Line(mlv, "Load V", 0x3B, 0x82, 0xF6));
        MpptVoltageSeries = mvList.ToArray();
        HasMpptVoltage = mvList.Count > 0;

        // ── MPPT Charger 1 — Current ──
        var msc = Pts(x => x.MpptSolarCurrent);
        var mbc = Pts(x => x.MpptBatteryCurrent);
        var mlc = Pts(x => x.MpptLoadCurrent);
        var mcList = new List<ISeries>();
        if (msc.Count > 0) mcList.Add(Line(msc, "Solar mA", 0xEA, 0xB3, 0x08));
        if (mbc.Count > 0) mcList.Add(Line(mbc, "Battery mA", 0x16, 0xA3, 0x4A));
        if (mlc.Count > 0) mcList.Add(Line(mlc, "Load mA", 0x3B, 0x82, 0xF6));
        MpptCurrentSeries = mcList.ToArray();
        HasMpptCurrent = mcList.Count > 0;

        // ── MPPT Charger 2 — Power ──
        var m2pPts = Pts(x => x.Mppt2SolarPower);
        HasMppt2Power = m2pPts.Count > 0;
        Mppt2PowerSeries = HasMppt2Power ? new ISeries[] { Line(m2pPts, "MPPT2 Solar Power (W)", 0xF9, 0x73, 0x16, true) } : Array.Empty<ISeries>();

        // ── MPPT Charger 2 — Voltage ──
        var m2sv = Pts(x => x.Mppt2SolarVoltage);
        var m2bv = Pts(x => x.Mppt2BatteryVoltage);
        var m2lv = Pts(x => x.Mppt2LoadVoltage);
        var m2vList = new List<ISeries>();
        if (m2sv.Count > 0) m2vList.Add(Line(m2sv, "Solar V", 0xF9, 0x73, 0x16));
        if (m2bv.Count > 0) m2vList.Add(Line(m2bv, "Battery V", 0x16, 0xA3, 0x4A));
        if (m2lv.Count > 0) m2vList.Add(Line(m2lv, "Load V", 0x3B, 0x82, 0xF6));
        Mppt2VoltageSeries = m2vList.ToArray();
        HasMppt2Voltage = m2vList.Count > 0;

        AddLog($"[CHARTS] Updated — {(HasTemperature?1:0)+(HasHumidity?1:0)+(HasPressure?1:0)+(HasWind?1:0)+(HasRainfall?1:0)+(HasSolar?1:0)+(HasBattery?1:0)+(HasWaterLevel?1:0)+(HasMpptPower?1:0)} active charts");
    }
}
