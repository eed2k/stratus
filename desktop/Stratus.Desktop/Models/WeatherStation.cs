using System.Text.Json;
using System.Text.Json.Serialization;

namespace Stratus.Desktop.Models;

/// <summary>
/// Converts a JSON value that may be a number OR a quoted string to double?.
/// Handles the pg REAL → string pass-through from the Stratus API.
/// </summary>
public class FlexibleDoubleConverter : JsonConverter<double?>
{
    public override double? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        if (reader.TokenType == JsonTokenType.Number) return reader.GetDouble();
        if (reader.TokenType == JsonTokenType.String)
        {
            var s = reader.GetString();
            if (string.IsNullOrWhiteSpace(s)) return null;
            return double.TryParse(s, System.Globalization.NumberStyles.Float,
                System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : null;
        }
        return null;
    }

    public override void Write(Utf8JsonWriter writer, double? value, JsonSerializerOptions options)
    {
        if (value.HasValue) writer.WriteNumberValue(value.Value);
        else writer.WriteNullValue();
    }
}

/// <summary>
/// Represents a weather station in the Stratus system.
/// JSON property names match the server API response (camelCase from mapPgStation).
/// </summary>
public class WeatherStation
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Location { get; set; }

    [JsonConverter(typeof(FlexibleDoubleConverter))]
    public double? Latitude { get; set; }

    [JsonConverter(typeof(FlexibleDoubleConverter))]
    public double? Longitude { get; set; }

    [JsonPropertyName("altitude")]
    [JsonConverter(typeof(FlexibleDoubleConverter))]
    public double? Elevation { get; set; }

    public string? StationType { get; set; }
    public string? Protocol { get; set; }
    public string? ConnectionType { get; set; }
    public int? PakbusAddress { get; set; }
    public int? SecurityCode { get; set; }
    public string? DataloggerModel { get; set; }
    public string? DataloggerProgramName { get; set; }
    public string? ModemModel { get; set; }
    public string? ModemSerialNumber { get; set; }
    public string? Notes { get; set; }

    /// <summary>Server returns ingestId as a string (e.g. "ASFF2OAV").</summary>
    public string? IngestId { get; set; }

    public DateTime? CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }

    /// <summary>Server returns "apiEndpoint".</summary>
    [JsonPropertyName("apiEndpoint")]
    public string? Endpoint { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>Server returns "lastConnected" (ISO-8601 timestamp).</summary>
    [JsonPropertyName("lastConnected")]
    public DateTime? LastConnected { get; set; }

    /// <summary>Server returns "siteDescription".</summary>
    [JsonPropertyName("siteDescription")]
    public string? Description { get; set; }

    /// <summary>Server returns "stationImage" (base64 or URL).</summary>
    [JsonPropertyName("stationImage")]
    public string? ImageUrl { get; set; }

    /// <summary>
    /// Captures any additional JSON fields not explicitly mapped.
    /// </summary>
    [JsonExtensionData]
    public Dictionary<string, JsonElement>? AdditionalData { get; set; }

    /// <summary>
    /// Connection status computed from last connected timestamp.
    /// </summary>
    public ConnectionStatus Status => LastConnected switch
    {
        null => ConnectionStatus.Unknown,
        var t when (DateTime.UtcNow - t.Value).TotalMinutes < 15 => ConnectionStatus.Online,
        var t when (DateTime.UtcNow - t.Value).TotalHours < 1 => ConnectionStatus.Delayed,
        _ => ConnectionStatus.Offline
    };

    public override string ToString() => $"{Name} (ID: {Id})";
}

public enum ConnectionStatus
{
    Online,
    Delayed,
    Offline,
    Unknown
}
