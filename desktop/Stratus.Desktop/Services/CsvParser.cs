using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Parses wind data files from multiple formats:
/// - Standard CSV (date, end_date, wind_direction, wind_speed)
/// - Campbell Scientific TOA5 format (4-line header)
/// - Generic CSV with auto-detected wind direction and speed columns
/// Integrated from WindRoseApp for Stratus Desktop.
/// </summary>
public static class CsvParser
{
    private static readonly string[] DateFormats = new[]
    {
        "yyyy-MM-dd HH:mm:ss+00:00",
        "yyyy-MM-dd HH:mm:ss",
        "yyyy-MM-dd HH:mm",
        "yyyy-MM-ddTHH:mm:ss",
        "yyyy-MM-ddTHH:mm:ssZ",
        "yyyy-MM-ddTHH:mm:ss+00:00",
        "yyyy-MM-ddTHH:mm:sszzzz",
        "dd/MM/yyyy HH:mm:ss",
        "dd/MM/yyyy HH:mm",
        "MM/dd/yyyy HH:mm:ss",
        "MM/dd/yyyy HH:mm",
        "MM/dd/yyyy h:mm:ss tt",
        "yyyy-MM-dd HH:mm:ss.f",
        "yyyy-MM-dd HH:mm:ss.ff",
        "yyyy-MM-dd HH:mm:ss.fff",
    };

    private static readonly string[] WindDirPatterns = new[]
    {
        "winddir", "wind_dir", "wdir", "wd", "winddirection", "wind_direction",
        "dir", "direction", "dirmean", "winddir_d1_wvt", "winddir_sd1_wvt",
        "wnddir", "avgwnddir", "winddiravg", "wind_dir_avg",
        "direzione", "dir_media", "direzione media"
    };

    private static readonly string[] WindSpdPatterns = new[]
    {
        "windspd", "wind_spd", "wspd", "ws", "windspeed", "wind_speed",
        "spd", "speed", "spdmean", "ws_ms_avg", "ws_ms_s_wvt",
        "wndspd", "avgwndspd", "windspdavg", "wind_spd_avg",
        "velocita", "vel_media", "velocita media",
        "ws_ms", "windspeed_ms"
    };

    private static readonly string[] TimestampPatterns = new[]
    {
        "timestamp", "datetime", "date", "time", "ts",
        "record_date", "date_time", "tmstamp",
        "inizio", "inizio validit"
    };

    /// <summary>
    /// Parse a CSV file and return WindDataPoint objects ready for wind rose calculation.
    /// </summary>
    public static List<WindDataPoint> ParseFile(string filePath, double latitude = -33.0)
    {
        var lines = File.ReadAllLines(filePath);

        if (lines.Length < 2)
            throw new InvalidDataException("File must contain a header row and at least one data row.");

        List<WindDataPoint> records;

        if (IsToa5Format(lines))
            records = ParseToa5(lines, latitude);
        else
            records = ParseStandardCsv(lines, latitude);

        return records;
    }

    #region TOA5 Parser

    private static bool IsToa5Format(string[] lines)
    {
        if (lines.Length < 5) return false;
        string firstLine = lines[0].Trim();
        return firstLine.StartsWith("\"TOA5\"", StringComparison.OrdinalIgnoreCase) ||
               firstLine.StartsWith("TOA5", StringComparison.OrdinalIgnoreCase);
    }

    private static List<WindDataPoint> ParseToa5(string[] lines, double latitude)
    {
        char delimiter = DetectDelimiter(lines[1]);
        string[] headers = SplitCsvLine(lines[1], delimiter)
            .Select(h => h.Trim().Trim('"')).ToArray();

        int tsCol = FindColumnIndex(headers, TimestampPatterns);
        if (tsCol < 0) tsCol = 0;

        int dirCol = FindColumnIndex(headers, WindDirPatterns);
        int spdCol = FindColumnIndex(headers, WindSpdPatterns);

        if (dirCol < 0 || spdCol < 0)
        {
            string[] units = SplitCsvLine(lines[2], delimiter)
                .Select(u => u.Trim().Trim('"').ToLowerInvariant()).ToArray();

            if (dirCol < 0)
            {
                for (int i = 0; i < units.Length; i++)
                {
                    if (units[i] == "deg" || units[i] == "degrees" || units[i] == "degree true")
                    {
                        dirCol = i;
                        break;
                    }
                }
            }

            if (spdCol < 0)
            {
                for (int i = 0; i < units.Length; i++)
                {
                    if (units[i] == "m/s" || units[i] == "meters/second" || units[i] == "m s-1")
                    {
                        spdCol = i;
                        break;
                    }
                }
            }
        }

        if (dirCol < 0)
            throw new InvalidDataException("Could not find wind direction column in TOA5 file.");
        if (spdCol < 0)
            throw new InvalidDataException("Could not find wind speed column in TOA5 file.");

        var records = new List<WindDataPoint>();
        for (int i = 4; i < lines.Length; i++)
        {
            string line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                var parts = SplitCsvLine(line, delimiter);
                var record = ParseDataRow(parts, tsCol, dirCol, spdCol);
                if (record != null)
                    records.Add(record);
            }
            catch { continue; }
        }

        if (records.Count == 0)
            throw new InvalidDataException("No valid data records found in TOA5 file.");

        ClassifyRecords(records, latitude);
        return records;
    }

    #endregion

    #region Standard CSV Parser

    private static List<WindDataPoint> ParseStandardCsv(string[] lines, double latitude)
    {
        char delimiter = DetectDelimiter(lines[0]);
        string[] headers = SplitCsvLine(lines[0], delimiter)
            .Select(h => h.Trim().Trim('"')).ToArray();

        int tsCol = FindColumnIndex(headers, TimestampPatterns);
        int dirCol = FindColumnIndex(headers, WindDirPatterns);
        int spdCol = FindColumnIndex(headers, WindSpdPatterns);

        if (headers.Length >= 4 && (tsCol < 0 || dirCol < 0 || spdCol < 0))
        {
            var testParts = SplitCsvLine(lines[1], delimiter);
            if (testParts.Length >= 4)
            {
                string testDate = testParts[0].Trim().Trim('"');
                if (TryParseDate(testDate, out _))
                {
                    if (tsCol < 0) tsCol = 0;

                    string testDir = testParts[2].Trim().Trim('"');
                    string testSpd = testParts[3].Trim().Trim('"');
                    if (double.TryParse(testDir, NumberStyles.Float, CultureInfo.InvariantCulture, out double td) &&
                        double.TryParse(testSpd, NumberStyles.Float, CultureInfo.InvariantCulture, out _))
                    {
                        if (td >= 0 && td <= 360)
                        {
                            if (dirCol < 0) dirCol = 2;
                            if (spdCol < 0) spdCol = 3;
                        }
                    }
                }
            }
        }

        if (dirCol < 0)
        {
            for (int i = 0; i < headers.Length; i++)
            {
                string h = headers[i].ToLowerInvariant();
                if (h.Contains("dir") || h.Contains("deg") || h.Contains("azimuth"))
                {
                    dirCol = i;
                    break;
                }
            }
        }

        if (spdCol < 0)
        {
            for (int i = 0; i < headers.Length; i++)
            {
                string h = headers[i].ToLowerInvariant();
                if ((h.Contains("speed") || h.Contains("spd") || h.Contains("vel") || h.Contains("m/s"))
                    && i != dirCol)
                {
                    spdCol = i;
                    break;
                }
            }
        }

        if (tsCol < 0) tsCol = 0;

        if (dirCol < 0)
            throw new InvalidDataException(
                "Could not find wind direction column.\n\n" +
                $"Detected columns: {string.Join(", ", headers)}");

        if (spdCol < 0)
            throw new InvalidDataException(
                "Could not find wind speed column.\n\n" +
                $"Detected columns: {string.Join(", ", headers)}");

        var records = new List<WindDataPoint>();
        int startRow = 1;

        if (lines.Length > 2)
        {
            var testRow = SplitCsvLine(lines[1], delimiter);
            if (testRow.Length > 0)
            {
                string firstVal = testRow[0].Trim().Trim('"').ToLowerInvariant();
                if (IsMetadataRow(firstVal))
                {
                    startRow = 2;
                    if (lines.Length > 3)
                    {
                        var testRow2 = SplitCsvLine(lines[2], delimiter);
                        if (testRow2.Length > 0 && IsMetadataRow(testRow2[0].Trim().Trim('"').ToLowerInvariant()))
                        {
                            startRow = 3;
                        }
                    }
                }
            }
        }

        for (int i = startRow; i < lines.Length; i++)
        {
            string line = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                var parts = SplitCsvLine(line, delimiter);
                var record = ParseDataRow(parts, tsCol, dirCol, spdCol);
                if (record != null)
                    records.Add(record);
            }
            catch { continue; }
        }

        if (records.Count == 0)
            throw new InvalidDataException("No valid data records found in the CSV file.");

        ClassifyRecords(records, latitude);
        return records;
    }

    private static bool IsMetadataRow(string value)
    {
        string[] metadataIndicators = { "ts", "rn", "deg", "degrees", "m/s", "m s-1",
            "avg", "smp", "tot", "wvc", "std", "min", "max", "unit", "\u00b0c", "w/m",
            "mm", "mbar", "hpa", "kpa", "%", "seconds", "minutes" };

        return metadataIndicators.Contains(value);
    }

    #endregion

    #region Shared Helpers

    private static WindDataPoint? ParseDataRow(string[] parts, int tsCol, int dirCol, int spdCol)
    {
        int maxCol = Math.Max(tsCol, Math.Max(dirCol, spdCol));
        if (parts.Length <= maxCol)
            return null;

        string dateStr = parts[tsCol].Trim().Trim('"');
        string dirStr = parts[dirCol].Trim().Trim('"');
        string speedStr = parts[spdCol].Trim().Trim('"');

        if (string.Equals(dirStr, "NAN", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(speedStr, "NAN", StringComparison.OrdinalIgnoreCase) ||
            string.IsNullOrEmpty(dirStr) || string.IsNullOrEmpty(speedStr) ||
            dirStr == "-" || speedStr == "-" ||
            dirStr == "NA" || speedStr == "NA")
            return null;

        if (!TryParseDate(dateStr, out DateTime date))
            return null;

        if (!double.TryParse(dirStr, NumberStyles.Float, CultureInfo.InvariantCulture, out double direction))
            return null;

        if (!double.TryParse(speedStr, NumberStyles.Float, CultureInfo.InvariantCulture, out double speed))
            return null;

        if (direction < 0 || direction > 360 || speed < 0)
            return null;

        return new WindDataPoint
        {
            Date = date,
            WindDirection = direction,
            WindSpeed = speed
        };
    }

    private static int FindColumnIndex(string[] headers, string[] patterns)
    {
        for (int i = 0; i < headers.Length; i++)
        {
            string h = headers[i].ToLowerInvariant()
                .Replace("\"", "").Replace("'", "").Trim();

            foreach (var pattern in patterns)
            {
                if (h == pattern || h.Contains(pattern))
                    return i;
            }
        }
        return -1;
    }

    private static char DetectDelimiter(string line)
    {
        if (line.Contains('\t')) return '\t';
        if (line.Contains(';')) return ';';
        return ',';
    }

    private static string[] SplitCsvLine(string line, char delimiter)
    {
        var result = new List<string>();
        bool inQuotes = false;
        var current = new System.Text.StringBuilder();

        foreach (char c in line)
        {
            if (c == '"')
                inQuotes = !inQuotes;
            else if (c == delimiter && !inQuotes)
            {
                result.Add(current.ToString());
                current.Clear();
            }
            else
                current.Append(c);
        }
        result.Add(current.ToString());
        return result.ToArray();
    }

    private static bool TryParseDate(string dateStr, out DateTime result)
    {
        foreach (var format in DateFormats)
        {
            if (DateTime.TryParseExact(dateStr, format, CultureInfo.InvariantCulture,
                DateTimeStyles.AllowWhiteSpaces, out result))
                return true;
        }

        return DateTime.TryParse(dateStr, CultureInfo.InvariantCulture,
            DateTimeStyles.AllowWhiteSpaces, out result);
    }

    /// <summary>
    /// Classify records by daylight and season (Southern Hemisphere).
    /// Uses <see cref="WindRoseCalculator.ClassifySeason"/> for consistent season mapping.
    /// </summary>
    private static void ClassifyRecords(List<WindDataPoint> records, double latitude)
    {
        foreach (var record in records)
        {
            record.WindDirection %= 360.0; // Normalise 360 -> 0

            record.Daylight = DaylightCalculator.IsDaylight(record.Date, latitude)
                ? DaylightType.Daylight
                : DaylightType.Nighttime;

            record.Season = WindRoseCalculator.ClassifySeason(record.Date.Month);
        }
    }

    #endregion
}
