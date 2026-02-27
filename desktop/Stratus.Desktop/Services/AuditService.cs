using System.Collections.Concurrent;
using System.IO;
using System.Text.Json;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Manages audit trail logging. Records all significant user actions with
/// timestamps and context. Persists to rotating JSON log files in
/// %APPDATA%\Stratus\audit\
/// </summary>
public class AuditService
{
    private readonly string _auditDir;
    private readonly ConcurrentQueue<AuditEntry> _buffer = new();
    private readonly object _writeLock = new();
    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = false };

    public event EventHandler<AuditEntry>? EntryAdded;

    public AuditService(string appDataPath)
    {
        _auditDir = Path.Combine(appDataPath, "Audit");
        Directory.CreateDirectory(_auditDir);
        Serilog.Log.Information("Audit service initialised at {Path}", _auditDir);
    }

    /// <summary>
    /// Records an audit event.
    /// </summary>
    public void Log(AuditCategory category, string action, string details = "", int? stationId = null, string? user = null)
    {
        var entry = new AuditEntry
        {
            Timestamp = DateTime.UtcNow,
            Category = category,
            Action = action,
            Details = details,
            StationId = stationId,
            User = user ?? Environment.UserName,
        };

        _buffer.Enqueue(entry);
        FlushBuffer();
        EntryAdded?.Invoke(this, entry);

        Serilog.Log.Debug("[AUDIT] {Category} - {Action}: {Details}", category, action, details);
    }

    /// <summary>
    /// Convenience: log a system event
    /// </summary>
    public void LogSystem(string action, string details = "")
        => Log(AuditCategory.System, action, details);

    /// <summary>
    /// Convenience: log a data export event
    /// </summary>
    public void LogExport(string action, string details = "", int? stationId = null)
        => Log(AuditCategory.DataExport, action, details, stationId);

    private void FlushBuffer()
    {
        lock (_writeLock)
        {
            var filePath = Path.Combine(_auditDir, $"audit-{DateTime.UtcNow:yyyy-MM-dd}.jsonl");
            try
            {
                using var writer = new StreamWriter(filePath, append: true);
                while (_buffer.TryDequeue(out var entry))
                {
                    writer.WriteLine(JsonSerializer.Serialize(entry, JsonOpts));
                }
            }
            catch (Exception ex)
            {
                Serilog.Log.Warning(ex, "Failed to flush audit buffer");
            }
        }
    }

    /// <summary>
    /// Reads audit entries for a date range.
    /// </summary>
    public List<AuditEntry> GetEntries(DateTime from, DateTime to)
    {
        var entries = new List<AuditEntry>();
        var current = from.Date;

        while (current <= to.Date)
        {
            var filePath = Path.Combine(_auditDir, $"audit-{current:yyyy-MM-dd}.jsonl");
            if (File.Exists(filePath))
            {
                try
                {
                    foreach (var line in File.ReadLines(filePath))
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        var entry = JsonSerializer.Deserialize<AuditEntry>(line);
                        if (entry != null && entry.Timestamp >= from && entry.Timestamp <= to)
                            entries.Add(entry);
                    }
                }
                catch (Exception ex)
                {
                    Serilog.Log.Warning(ex, "Failed to read audit file {File}", filePath);
                }
            }
            current = current.AddDays(1);
        }

        return entries.OrderByDescending(e => e.Timestamp).ToList();
    }

    /// <summary>
    /// Gets the last N audit entries across all files.
    /// </summary>
    public List<AuditEntry> GetRecentEntries(int count = 100)
    {
        var entries = new List<AuditEntry>();
        var files = Directory.GetFiles(_auditDir, "audit-*.jsonl")
            .OrderByDescending(f => f)
            .Take(7);

        foreach (var file in files)
        {
            try
            {
                foreach (var line in File.ReadLines(file))
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    var entry = JsonSerializer.Deserialize<AuditEntry>(line);
                    if (entry != null) entries.Add(entry);
                }
            }
            catch { /* skip corrupt files */ }
        }

        return entries.OrderByDescending(e => e.Timestamp).Take(count).ToList();
    }

    /// <summary>
    /// Purges audit logs older than the specified number of days.
    /// </summary>
    public int PurgeOlderThan(int days = 365)
    {
        int deleted = 0;
        var cutoff = DateTime.UtcNow.AddDays(-days);
        foreach (var file in Directory.GetFiles(_auditDir, "audit-*.jsonl"))
        {
            try
            {
                var fi = new FileInfo(file);
                if (fi.CreationTimeUtc < cutoff)
                {
                    fi.Delete();
                    deleted++;
                }
            }
            catch (Exception ex)
            {
                Serilog.Log.Warning(ex, "Failed to delete old audit file {File}", file);
            }
        }
        return deleted;
    }
}
