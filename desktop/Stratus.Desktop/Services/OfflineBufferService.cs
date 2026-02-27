using System.IO;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Serilog;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Services;

/// <summary>
/// Provides offline data buffering using a local SQLite database.
/// When the remote PostgreSQL database is unavailable, records are queued locally
/// and automatically synced when the connection is restored.
/// </summary>
public class OfflineBufferService : IDisposable
{
    private readonly string _dbPath;
    private SqliteConnection? _connection;
    private bool _disposed;
    private readonly object _syncLock = new();
    private static readonly JsonSerializerOptions JsonOpts = new();

    public int PendingCount { get; private set; }
    public bool IsBuffering { get; private set; }

    public event EventHandler<int>? PendingCountChanged;
    public event EventHandler<string>? StatusChanged;

    public OfflineBufferService(string appDataPath)
    {
        _dbPath = Path.Combine(appDataPath, "Data", "offline_buffer.db");
        Directory.CreateDirectory(Path.GetDirectoryName(_dbPath)!);
        Initialize();
    }

    private void Initialize()
    {
        try
        {
            _connection = new SqliteConnection($"Data Source={_dbPath}");
            _connection.Open();

            using var cmd = _connection.CreateCommand();
            cmd.CommandText = @"
                CREATE TABLE IF NOT EXISTS buffered_records (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    station_id INTEGER NOT NULL,
                    timestamp  TEXT    NOT NULL,
                    json_data  TEXT    NOT NULL,
                    created_at TEXT    DEFAULT (datetime('now')),
                    synced     INTEGER DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_buffered_synced ON buffered_records(synced);
                CREATE INDEX IF NOT EXISTS idx_buffered_station ON buffered_records(station_id);
            ";
            cmd.ExecuteNonQuery();

            RefreshPendingCount();
            Log.Information("Offline buffer initialised at {Path} ({Count} pending records)", _dbPath, PendingCount);
        }
        catch (Exception ex)
        {
            Log.Error(ex, "Failed to initialise offline buffer database");
        }
    }

    /// <summary>
    /// Buffers a weather record locally when the remote DB is unavailable.
    /// </summary>
    public void BufferRecord(WeatherRecord record)
    {
        if (_connection == null) return;
        lock (_syncLock)
        {
            try
            {
                var json = JsonSerializer.Serialize(record, JsonOpts);
                using var cmd = _connection.CreateCommand();
                cmd.CommandText = @"
                    INSERT INTO buffered_records (station_id, timestamp, json_data)
                    VALUES (@sid, @ts, @json)";
                cmd.Parameters.AddWithValue("@sid", record.StationId);
                cmd.Parameters.AddWithValue("@ts", record.Timestamp.ToString("O"));
                cmd.Parameters.AddWithValue("@json", json);
                cmd.ExecuteNonQuery();

                IsBuffering = true;
                RefreshPendingCount();
                StatusChanged?.Invoke(this, $"Buffered record for station {record.StationId}");
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to buffer record locally");
            }
        }
    }

    /// <summary>
    /// Retrieves unsynced records (oldest first) for pushing to the remote database.
    /// </summary>
    public List<(long Id, WeatherRecord Record)> GetPendingRecords(int batchSize = 100)
    {
        var results = new List<(long, WeatherRecord)>();
        if (_connection == null) return results;

        lock (_syncLock)
        {
            try
            {
                using var cmd = _connection.CreateCommand();
                cmd.CommandText = @"
                    SELECT id, json_data FROM buffered_records 
                    WHERE synced = 0 
                    ORDER BY timestamp ASC 
                    LIMIT @limit";
                cmd.Parameters.AddWithValue("@limit", batchSize);

                using var reader = cmd.ExecuteReader();
                while (reader.Read())
                {
                    var id = reader.GetInt64(0);
                    var json = reader.GetString(1);
                    var record = JsonSerializer.Deserialize<WeatherRecord>(json);
                    if (record != null)
                        results.Add((id, record));
                }
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to read pending buffer records");
            }
        }
        return results;
    }

    /// <summary>
    /// Marks records as synced after successful push to remote DB.
    /// </summary>
    public void MarkSynced(IEnumerable<long> ids)
    {
        if (_connection == null) return;
        lock (_syncLock)
        {
            try
            {
                using var transaction = _connection.BeginTransaction();
                foreach (var id in ids)
                {
                    using var cmd = _connection.CreateCommand();
                    cmd.Transaction = transaction;
                    cmd.CommandText = "UPDATE buffered_records SET synced = 1 WHERE id = @id";
                    cmd.Parameters.AddWithValue("@id", id);
                    cmd.ExecuteNonQuery();
                }
                transaction.Commit();
                RefreshPendingCount();

                if (PendingCount == 0) IsBuffering = false;
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to mark records as synced");
            }
        }
    }

    /// <summary>
    /// Attempts to sync all pending records to the remote database.
    /// Returns the number of successfully synced records.
    /// </summary>
    public async Task<int> SyncToRemoteAsync(DatabaseService dbService)
    {
        if (!dbService.IsConnected || PendingCount == 0) return 0;

        int totalSynced = 0;
        StatusChanged?.Invoke(this, $"Syncing {PendingCount} buffered records...");

        while (true)
        {
            var batch = GetPendingRecords(50);
            if (batch.Count == 0) break;

            var syncedIds = new List<long>();
            foreach (var (id, record) in batch)
            {
                try
                {
                    var success = await dbService.InsertWeatherRecordAsync(record);
                    if (success) syncedIds.Add(id);
                }
                catch (Exception ex)
                {
                    Log.Warning(ex, "Failed to sync buffered record {Id}", id);
                    break; // Stop on first failure — DB may be down again
                }
            }

            if (syncedIds.Count > 0)
            {
                MarkSynced(syncedIds);
                totalSynced += syncedIds.Count;
            }

            if (syncedIds.Count < batch.Count) break; // Some failed, stop
        }

        if (totalSynced > 0)
        {
            StatusChanged?.Invoke(this, $"Synced {totalSynced} buffered records to remote DB");
            Log.Information("Offline buffer sync: {Count} records pushed to remote DB", totalSynced);
        }

        return totalSynced;
    }

    /// <summary>
    /// Removes synced records older than the specified number of days to reclaim space.
    /// </summary>
    public int PurgeSynced(int olderThanDays = 30)
    {
        if (_connection == null) return 0;
        lock (_syncLock)
        {
            try
            {
                using var cmd = _connection.CreateCommand();
                cmd.CommandText = @"
                    DELETE FROM buffered_records 
                    WHERE synced = 1 AND created_at < datetime('now', @days)";
                cmd.Parameters.AddWithValue("@days", $"-{olderThanDays} days");
                return cmd.ExecuteNonQuery();
            }
            catch (Exception ex)
            {
                Log.Warning(ex, "Failed to purge synced buffer records");
                return 0;
            }
        }
    }

    private void RefreshPendingCount()
    {
        if (_connection == null) return;
        try
        {
            using var cmd = _connection.CreateCommand();
            cmd.CommandText = "SELECT COUNT(*) FROM buffered_records WHERE synced = 0";
            PendingCount = Convert.ToInt32(cmd.ExecuteScalar());
            PendingCountChanged?.Invoke(this, PendingCount);
        }
        catch { }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _connection?.Close();
        _connection?.Dispose();
    }
}
