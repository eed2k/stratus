using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Detects gaps in station data time-series and attempts to backfill from
/// the datalogger memory via PakBus or from the API.
/// </summary>
public class DataGapService
{
    private readonly DatabaseService _dbService;
    private readonly ApiService _apiService;

    public event EventHandler<GapReport>? GapAnalysisComplete;
    public event EventHandler<string>? StatusChanged;

    public DataGapService(DatabaseService dbService, ApiService apiService)
    {
        _dbService = dbService;
        _apiService = apiService;
    }

    /// <summary>
    /// Analyses collected data for a station, detecting temporal gaps exceeding
    /// the expected collection interval.
    /// </summary>
    public GapReport AnalyseGaps(IReadOnlyList<WeatherRecord> records, int stationId, TimeSpan expectedInterval)
    {
        var report = new GapReport
        {
            StationId = stationId,
            AnalysedAt = DateTime.UtcNow,
            ExpectedInterval = expectedInterval,
            TotalRecords = records.Count,
        };

        if (records.Count < 2)
        {
            report.Status = "Insufficient data (need at least 2 records)";
            return report;
        }

        var sorted = records.OrderBy(r => r.Timestamp).ToList();
        report.FirstRecord = sorted[0].Timestamp;
        report.LastRecord = sorted[^1].Timestamp;

        // Allow 50% tolerance above expected interval before flagging a gap
        var threshold = expectedInterval * 1.5;

        for (int i = 1; i < sorted.Count; i++)
        {
            var delta = sorted[i].Timestamp - sorted[i - 1].Timestamp;
            if (delta > threshold)
            {
                report.Gaps.Add(new DataGap
                {
                    Start = sorted[i - 1].Timestamp,
                    End = sorted[i].Timestamp,
                    Duration = delta,
                    MissedRecords = (int)Math.Round(delta / expectedInterval) - 1,
                });
            }
        }

        // Coverage calculation
        var span = report.LastRecord - report.FirstRecord;
        if (span.TotalSeconds > 0)
        {
            var gapDuration = TimeSpan.FromTicks(report.Gaps.Sum(g => g.Duration.Ticks));
            report.CoveragePercent = (1.0 - gapDuration.TotalSeconds / span.TotalSeconds) * 100;
        }

        report.Status = report.Gaps.Count == 0
            ? "No gaps detected — data coverage is 100%"
            : $"Found {report.Gaps.Count} gap(s) totalling {FormatDuration(TimeSpan.FromTicks(report.Gaps.Sum(g => g.Duration.Ticks)))}";

        Log.Information("Gap analysis for station {Station}: {Count} gaps, {Coverage:F1}% coverage",
            stationId, report.Gaps.Count, report.CoveragePercent);

        GapAnalysisComplete?.Invoke(this, report);
        return report;
    }

    /// <summary>
    /// Attempts to backfill gaps from the API (server may have records from
    /// Dropbox sync or other sources).
    /// </summary>
    public async Task<int> BackfillFromApiAsync(int stationId, List<DataGap> gaps)
    {
        int recovered = 0;
        StatusChanged?.Invoke(this, $"Backfilling {gaps.Count} gap(s) from API...");

        foreach (var gap in gaps)
        {
            try
            {
                // Request data from the API for the gap period
                var records = await _apiService.GetDataRangeAsync(
                    stationId, gap.Start, gap.End);

                if (records != null && records.Count > 0)
                {
                    if (_dbService.IsConnected)
                    {
                        foreach (var record in records)
                        {
                            await _dbService.InsertWeatherRecordAsync(record);
                        }
                    }
                    recovered += records.Count;
                    gap.BackfilledRecords = records.Count;
                    StatusChanged?.Invoke(this, $"Recovered {records.Count} records for gap at {gap.Start:g}");
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to backfill gap at {Start}", gap.Start);
            }
        }

        StatusChanged?.Invoke(this, recovered > 0
            ? $"Backfill complete: {recovered} records recovered"
            : "Backfill complete: no additional records found");

        return recovered;
    }

    private static string FormatDuration(TimeSpan ts)
    {
        if (ts.TotalDays >= 1) return $"{ts.TotalDays:F1} days";
        if (ts.TotalHours >= 1) return $"{ts.TotalHours:F1} hours";
        return $"{ts.TotalMinutes:F0} minutes";
    }
}

/// <summary>
/// Summary of a gap analysis.
/// </summary>
public class GapReport
{
    public int StationId { get; set; }
    public DateTime AnalysedAt { get; set; }
    public TimeSpan ExpectedInterval { get; set; }
    public int TotalRecords { get; set; }
    public DateTime FirstRecord { get; set; }
    public DateTime LastRecord { get; set; }
    public double CoveragePercent { get; set; } = 100;
    public string Status { get; set; } = string.Empty;
    public List<DataGap> Gaps { get; set; } = new();
}

/// <summary>
/// Represents a gap in data continuity.
/// </summary>
public class DataGap
{
    public DateTime Start { get; set; }
    public DateTime End { get; set; }
    public TimeSpan Duration { get; set; }
    public int MissedRecords { get; set; }
    public int BackfilledRecords { get; set; }

    public override string ToString() =>
        $"{Start:yyyy-MM-dd HH:mm} → {End:yyyy-MM-dd HH:mm} ({Duration.TotalHours:F1}h, ~{MissedRecords} missed)";
}
