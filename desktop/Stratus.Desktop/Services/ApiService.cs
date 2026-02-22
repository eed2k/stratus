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
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
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
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate
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
        try
        {
            Log.Information("Fetching stations from {Url}api/stations (auth header present: {HasAuth})",
                _baseUrl + "/", _httpClient.DefaultRequestHeaders.Contains("X-User-Email"));

            var response = await _httpClient.GetAsync("api/stations");

            if (!response.IsSuccessStatusCode)
            {
                var errorBody = await response.Content.ReadAsStringAsync();
                Log.Error("GET /api/stations failed: {StatusCode} {Reason} — {Body}",
                    (int)response.StatusCode, response.ReasonPhrase, errorBody);
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
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to fetch stations");
            ErrorOccurred?.Invoke(this, $"Failed to fetch stations: {ex.Message}");
            return null;
        }
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
