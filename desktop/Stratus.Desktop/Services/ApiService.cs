using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Configuration;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// HTTP client service for communicating with the Stratus VPS API.
/// Handles authentication, request retry, and response parsing.
/// </summary>
public class ApiService : IDisposable
{
    private HttpClient _httpClient;
    private HttpClientHandler _handler;
    private CookieContainer _cookies;
    private readonly JsonSerializerOptions _jsonOptions;
    private bool _isAuthenticated;
    private string _baseUrl;
    private string? _userEmail;
    private string? _userRole;

    public bool IsAuthenticated => _isAuthenticated;
    public string BaseUrl => _baseUrl;
    public string? UserEmail => _userEmail;
    public string? UserRole => _userRole;

    public event EventHandler<bool>? ConnectionStatusChanged;
    public event EventHandler<string>? ErrorOccurred;

    public ApiService(IConfiguration config)
    {
        _baseUrl = config["Server:BaseUrl"] ?? "https://stratusweather.co.za";
        var timeout = int.TryParse(config["Server:ApiTimeout"], out var t) ? t : 30;

        _cookies = new CookieContainer();
        _handler = new HttpClientHandler
        {
            CookieContainer = _cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            ServerCertificateCustomValidationCallback = (_, cert, _, errors) =>
            {
                if (errors == System.Net.Security.SslPolicyErrors.None) return true;
                try { var host = new Uri(_baseUrl).Host; return host == "localhost" || host == "127.0.0.1"; }
                catch { return false; }
            }
        };
        _httpClient = new HttpClient(_handler)
        {
            BaseAddress = new Uri(_baseUrl.TrimEnd('/') + "/"),
            Timeout = TimeSpan.FromSeconds(timeout)
        };
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "Stratus-Desktop/1.1.0");

        _jsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase
        };
    }

    /// <summary>
    /// Configure the server URL (recreates HttpClient with fresh cookies).
    /// </summary>
    public void SetServerUrl(string url)
    {
        _baseUrl = url.TrimEnd('/');
        var timeout = _httpClient.Timeout;
        _httpClient.Dispose();

        _cookies = new CookieContainer();
        _handler = new HttpClientHandler
        {
            CookieContainer = _cookies,
            UseCookies = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            ServerCertificateCustomValidationCallback = (_, cert, _, errors) =>
            {
                if (errors == System.Net.Security.SslPolicyErrors.None) return true;
                try { var host = new Uri(_baseUrl).Host; return host == "localhost" || host == "127.0.0.1"; }
                catch { return false; }
            }
        };
        _httpClient = new HttpClient(_handler)
        {
            BaseAddress = new Uri(_baseUrl + "/"),
            Timeout = timeout
        };
        _httpClient.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/json"));
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "Stratus-Desktop/1.1.0");

        _isAuthenticated = false;
        Log.Information("API base URL set to {Url}", _baseUrl);
    }

    /// <summary>
    /// Authenticate with the Stratus server using email and password.
    /// Server uses session cookies (connect.sid) for auth.
    /// </summary>
    public async Task<bool> LoginAsync(string email, string password)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync("api/auth/login",
                new { email, password });

            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<LoginResponse>(_jsonOptions);
                if (result?.Success == true)
                {
                    _isAuthenticated = true;
                    _userEmail = result.User?.Email;
                    _userRole = result.User?.Role;

                    // Server identifies sessions via X-User-Email header
                    if (_userEmail != null)
                    {
                        _httpClient.DefaultRequestHeaders.Remove("X-User-Email");
                        _httpClient.DefaultRequestHeaders.Add("X-User-Email", _userEmail);
                        Log.Information("X-User-Email header set to {Email}", _userEmail);
                    }
                    else
                    {
                        Log.Warning("Login succeeded but User.Email was null — auth header NOT set");
                    }

                    ConnectionStatusChanged?.Invoke(this, true);
                    Log.Information("Authenticated as {User} (role: {Role})", _userEmail, _userRole);
                    return true;
                }
                else
                {
                    var msg = result?.Message ?? "Unknown error";
                    Log.Warning("Login failed: {Message}", msg);
                    ErrorOccurred?.Invoke(this, $"Login failed: {msg}");
                    return false;
                }
            }

            var error = await response.Content.ReadAsStringAsync();
            Log.Warning("Login failed: {Status} {Error}", response.StatusCode, error);
            ErrorOccurred?.Invoke(this, $"Login failed: {response.StatusCode}");
            return false;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Login request failed");
            ErrorOccurred?.Invoke(this, $"Connection failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Log out and clear session.
    /// </summary>
    public void Logout()
    {
        _isAuthenticated = false;
        _userEmail = null;
        _userRole = null;
        // Clear cookies for a fresh session
        SetServerUrl(_baseUrl);
        ConnectionStatusChanged?.Invoke(this, false);
    }

    /// <summary>
    /// Fetch all weather stations from the API.
    /// Returns null on error so callers can distinguish "no stations" from "request failed".
    /// </summary>
    public async Task<List<WeatherStation>?> GetStationsAsync()
    {
        const int maxRetries = 2;
        for (int attempt = 0; attempt <= maxRetries; attempt++)
        {
            try
            {
                Log.Information("Fetching stations from {Url}api/stations (attempt {Attempt}, auth: {HasAuth})",
                    _baseUrl + "/", attempt + 1, _httpClient.DefaultRequestHeaders.Contains("X-User-Email"));

                var response = await _httpClient.GetAsync("api/stations");

                if (!response.IsSuccessStatusCode)
                {
                    var errorBody = await response.Content.ReadAsStringAsync();
                    Log.Error("GET /api/stations failed: {StatusCode} {Reason} — {Body}",
                        (int)response.StatusCode, response.ReasonPhrase, errorBody);

                    // On 401, re-login might help
                    if ((int)response.StatusCode == 401 && attempt < maxRetries)
                    {
                        Log.Warning("Station fetch got 401 — will retry after short delay");
                        await Task.Delay(1000);
                        continue;
                    }

                    ErrorOccurred?.Invoke(this,
                        $"Failed to fetch stations: {(int)response.StatusCode} {response.ReasonPhrase}");
                    return null;
                }

                var json = await response.Content.ReadAsStringAsync();
                Log.Debug("Stations response ({Length} chars): {Preview}",
                    json.Length, json.Length > 500 ? json[..500] + "…" : json);

                var stations = JsonSerializer.Deserialize<List<WeatherStation>>(json, _jsonOptions);
                Log.Information("Deserialized {Count} stations", stations?.Count ?? 0);
                return stations ?? new List<WeatherStation>();
            }
            catch (HttpRequestException ex)
            {
                Log.Error(ex, "HTTP request error fetching stations (attempt {Attempt})", attempt + 1);
                if (attempt < maxRetries)
                {
                    await Task.Delay(1500);
                    continue;
                }
                ErrorOccurred?.Invoke(this, $"Connection error: {ex.Message}");
                return null;
            }
            catch (TaskCanceledException ex) when (ex.InnerException is TimeoutException)
            {
                Log.Error(ex, "Timeout fetching stations (attempt {Attempt})", attempt + 1);
                if (attempt < maxRetries)
                {
                    await Task.Delay(1000);
                    continue;
                }
                ErrorOccurred?.Invoke(this, "Request timed out — server may be slow or unreachable");
                return null;
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Failed to fetch stations");
                ErrorOccurred?.Invoke(this, $"Failed to fetch stations: {ex.Message}");
                return null;
            }
        }
        return null;
    }

    /// <summary>
    /// Fetch weather data for a station within a time range.
    /// </summary>
    public async Task<List<WeatherRecord>> GetStationDataAsync(
        int stationId, DateTime? startTime = null, DateTime? endTime = null, int limit = 1000)
    {
        try
        {
            // Server requires startTime and endTime — default to last 24h if not provided
            var end = endTime ?? DateTime.UtcNow;
            var start = startTime ?? end.AddHours(-24);
            var query = $"api/stations/{stationId}/data?limit={limit}&startTime={start:O}&endTime={end:O}";

            var response = await _httpClient.GetAsync(query);
            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                Log.Warning("GET data for station {Id} failed: {Status} {Body}",
                    stationId, (int)response.StatusCode, errorBody);
                return new List<WeatherRecord>();
            }
            var data = await response.Content.ReadFromJsonAsync<List<WeatherRecord>>(_jsonOptions);
            return data ?? new List<WeatherRecord>();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch data for station {Id}", stationId);
            ErrorOccurred?.Invoke(this, $"Failed to fetch data: {ex.Message}");
            return new List<WeatherRecord>();
        }
    }

    /// <summary>
    /// Fetch the latest data point for a station.
    /// </summary>
    public async Task<WeatherRecord?> GetLatestDataAsync(int stationId)
    {
        try
        {
            var response = await _httpClient.GetAsync($"api/stations/{stationId}/data/latest");
            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("GET /api/stations/{Id}/data/latest returned {Status}", stationId, (int)response.StatusCode);
                return null;
            }
            return await response.Content.ReadFromJsonAsync<WeatherRecord>(_jsonOptions);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch latest data for station {Id}", stationId);
            return null;
        }
    }

    /// <summary>
    /// Fetch weather data for a station within a specific date range.
    /// Used for gap backfill operations.
    /// </summary>
    public async Task<List<WeatherRecord>> GetDataRangeAsync(int stationId, DateTime start, DateTime end)
    {
        try
        {
            var query = $"api/stations/{stationId}/data?startTime={start:O}&endTime={end:O}&limit=10000";
            var response = await _httpClient.GetAsync(query);
            if (!response.IsSuccessStatusCode)
            {
                Log.Warning("GET data range for station {Id} failed: {Status}", stationId, (int)response.StatusCode);
                return new List<WeatherRecord>();
            }
            var data = await response.Content.ReadFromJsonAsync<List<WeatherRecord>>(_jsonOptions);
            return data ?? new List<WeatherRecord>();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch data range for station {Id}", stationId);
            return new List<WeatherRecord>();
        }
    }

    /// <summary>
    /// Check server health / connectivity.
    /// </summary>
    public async Task<bool> CheckHealthAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync("api/health");
            return response.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Alarm Management API
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Fetch all alarm rules for a station.
    /// </summary>
    public async Task<List<AlarmRule>> GetAlarmsAsync(int stationId)
    {
        try
        {
            var response = await _httpClient.GetAsync($"api/alarms?stationId={stationId}");
            if (!response.IsSuccessStatusCode) return new List<AlarmRule>();
            return await response.Content.ReadFromJsonAsync<List<AlarmRule>>(_jsonOptions) ?? new();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch alarms for station {Id}", stationId);
            return new();
        }
    }

    /// <summary>
    /// Create a new alarm rule.
    /// </summary>
    public async Task<AlarmRule?> CreateAlarmAsync(AlarmRule alarm)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync("api/alarms", alarm, _jsonOptions);
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadFromJsonAsync<AlarmRule>(_jsonOptions);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to create alarm");
            return null;
        }
    }

    /// <summary>
    /// Update an existing alarm rule.
    /// </summary>
    public async Task<bool> UpdateAlarmAsync(AlarmRule alarm)
    {
        try
        {
            var response = await _httpClient.PatchAsJsonAsync($"api/alarms/{alarm.Id}", alarm, _jsonOptions);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to update alarm {Id}", alarm.Id);
            return false;
        }
    }

    /// <summary>
    /// Delete an alarm rule.
    /// </summary>
    public async Task<bool> DeleteAlarmAsync(int alarmId)
    {
        try
        {
            var response = await _httpClient.DeleteAsync($"api/alarms/{alarmId}");
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to delete alarm {Id}", alarmId);
            return false;
        }
    }

    /// <summary>
    /// Fetch alarm event history.
    /// </summary>
    public async Task<List<AlarmEvent>> GetAlarmEventsAsync(int? stationId = null, int limit = 100)
    {
        try
        {
            var query = stationId.HasValue
                ? $"api/alarm-events?stationId={stationId}&limit={limit}"
                : $"api/alarm-events?limit={limit}";
            var response = await _httpClient.GetAsync(query);
            if (!response.IsSuccessStatusCode) return new();
            return await response.Content.ReadFromJsonAsync<List<AlarmEvent>>(_jsonOptions) ?? new();
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch alarm events");
            return new();
        }
    }

    /// <summary>
    /// Acknowledge an alarm event.
    /// </summary>
    public async Task<bool> AcknowledgeAlarmAsync(int eventId)
    {
        try
        {
            var response = await _httpClient.PostAsync($"api/alarm-events/{eventId}/acknowledge", null);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to acknowledge alarm event {Id}", eventId);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // Station Management API
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Create a new weather station.
    /// </summary>
    public async Task<WeatherStation?> CreateStationAsync(WeatherStation station)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync("api/stations", station, _jsonOptions);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Log.Warning("Create station failed: {Status} {Body}", (int)response.StatusCode, body);
                ErrorOccurred?.Invoke(this, $"Create station failed: {response.StatusCode}");
                return null;
            }
            return await response.Content.ReadFromJsonAsync<WeatherStation>(_jsonOptions);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to create station");
            ErrorOccurred?.Invoke(this, $"Failed to create station: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Update station metadata (name, location, description).
    /// </summary>
    public async Task<bool> UpdateStationAsync(int stationId, object updates)
    {
        try
        {
            var response = await _httpClient.PatchAsJsonAsync($"api/stations/{stationId}", updates, _jsonOptions);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to update station {Id}", stationId);
            return false;
        }
    }

    /// <summary>
    /// Delete a weather station.
    /// </summary>
    public async Task<bool> DeleteStationAsync(int stationId)
    {
        try
        {
            var response = await _httpClient.DeleteAsync($"api/stations/{stationId}");
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to delete station {Id}", stationId);
            return false;
        }
    }

    /// <summary>
    /// Upload TOA5 file data to the server for bulk import.
    /// </summary>
    public async Task<bool> ImportDataAsync(int stationId, string filePath)
    {
        try
        {
            using var content = new MultipartFormDataContent();
            var fileBytes = await File.ReadAllBytesAsync(filePath);
            content.Add(new ByteArrayContent(fileBytes), "file", Path.GetFileName(filePath));

            var response = await _httpClient.PostAsync($"api/stations/{stationId}/import", content);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                Log.Warning("Import failed: {Status} {Body}", (int)response.StatusCode, body);
                return false;
            }
            return true;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to import data for station {Id}", stationId);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // User Preferences API
    // ═══════════════════════════════════════════════════════════════

    /// <summary>
    /// Fetch user preferences (units, timezone, notification settings).
    /// </summary>
    public async Task<Dictionary<string, JsonElement>?> GetUserPreferencesAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync("api/user/preferences");
            if (!response.IsSuccessStatusCode) return null;
            return await response.Content.ReadFromJsonAsync<Dictionary<string, JsonElement>>(_jsonOptions);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch user preferences");
            return null;
        }
    }

    /// <summary>
    /// Save user preferences to the server.
    /// </summary>
    public async Task<bool> SaveUserPreferencesAsync(object preferences)
    {
        try
        {
            var response = await _httpClient.PutAsJsonAsync("api/user/preferences", preferences, _jsonOptions);
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to save user preferences");
            return false;
        }
    }

    public void Dispose()
    {
        _httpClient.Dispose();
    }

    private class LoginResponse
    {
        public bool Success { get; set; }
        public string? Message { get; set; }
        public LoginUser? User { get; set; }
    }

    private class LoginUser
    {
        public string? Email { get; set; }
        public string? FirstName { get; set; }
        public string? LastName { get; set; }
        public string? Role { get; set; }
    }
}
