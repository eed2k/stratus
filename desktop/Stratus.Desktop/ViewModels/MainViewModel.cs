using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Serilog;
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
    [ObservableProperty] private string _username = string.Empty;
    [ObservableProperty] private string _selectedTimeRange = "24h";
    [ObservableProperty] private long _recordCount;
    [ObservableProperty] private string _licenseStatus = "Trial";

    public ObservableCollection<WeatherStation> Stations { get; } = new();
    public ObservableCollection<WeatherRecord> DataRecords { get; } = new();
    public ObservableCollection<string> LogMessages { get; } = new();

    public string[] TimeRanges { get; } = { "1h", "6h", "24h", "48h", "7d", "30d" };

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
            StatusText = "Server online — please log in";
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
        if (string.IsNullOrEmpty(Username))
        {
            StatusText = "Please enter username";
            return;
        }

        StatusText = "Authenticating...";
        var success = await _apiService.LoginAsync(Username, password);

        if (success)
        {
            StatusText = "Authenticated — loading stations...";
            AddLog($"[INFO] Logged in as {Username}");
            await LoadStationsAsync();
        }
        else
        {
            StatusText = "Authentication failed";
        }
    }

    [RelayCommand]
    private async Task LoadStationsAsync()
    {
        StatusText = "Loading stations...";
        Stations.Clear();

        List<WeatherStation> stations;
        if (_dbService.IsConnected)
        {
            stations = await _dbService.GetStationsAsync();
            AddLog($"[DB] Loaded {stations.Count} stations from database");
        }
        else
        {
            stations = await _apiService.GetStationsAsync();
            AddLog($"[API] Loaded {stations.Count} stations from server");
        }

        foreach (var s in stations)
            Stations.Add(s);

        StatusText = $"{stations.Count} stations loaded";

        if (stations.Count > 0 && SelectedStation == null)
            SelectedStation = stations[0];
    }

    [RelayCommand]
    private async Task LoadDataAsync()
    {
        if (SelectedStation == null) return;

        StatusText = $"Loading data for {SelectedStation.Name}...";
        DataRecords.Clear();

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

        StatusText = $"Loaded {records.Count} records for {SelectedStation.Name}";
        AddLog($"[DATA] Loaded {records.Count} records ({SelectedTimeRange})");
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
        var (success, message) = await DatabaseService.TestConnectionAsync(connectionString);

        if (success)
        {
            _dbService.Connect(connectionString);
            StatusText = "Database connected";
            AddLog($"[DB] {message}");
            await LoadStationsAsync();
        }
        else
        {
            StatusText = $"DB connection failed: {message}";
            AddLog($"[DB ERROR] {message}");
        }
    }

    partial void OnSelectedStationChanged(WeatherStation? value)
    {
        if (value != null)
        {
            _ = LoadDataAsync();
        }
    }

    private void AddLog(string message)
    {
        var entry = $"[{DateTime.Now:HH:mm:ss}] {message}";
        System.Windows.Application.Current.Dispatcher.Invoke(() =>
        {
            LogMessages.Insert(0, entry);
            if (LogMessages.Count > 500)
                LogMessages.RemoveAt(LogMessages.Count - 1);
        });
    }
}
