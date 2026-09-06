"""SQLite storage for stations, observations, forecast runs and their scores.

WHY SQLITE

  One container, no separate database service, and the working set is small: a
  station logging every five minutes produces about 105,000 records a year and
  ten variables each. That is comfortably inside what SQLite handles well, and
  it keeps the forecast subdomain independent of the main Stratus Postgres so a
  problem here cannot affect live station ingest.

WHY OBSERVATIONS ARE STORED LONG, NOT WIDE

  One row per station, timestamp and variable, rather than a column per
  variable. Loggers disagree about which sensors exist, and a wide table means
  a schema migration every time someone uploads a file with a column we have
  not seen. Long format also makes the verification join trivial: a forecast
  point and an observation are matched on exactly (station, variable, time).

  The cost is row count and a slightly wordier query, which is the right trade
  at this scale.

IDEMPOTENCE IS THE POINT

  People re-upload files. They upload overlapping exports, then the same export
  again by accident. So:
    - an upload is fingerprinted by SHA-256 and a repeat is recognized
    - observations use INSERT OR REPLACE on (station, variable, time), so an
      overlapping file corrects rather than duplicates
  Without this the verification statistics would quietly count the same hour
  several times and the error metrics would be wrong in a way nobody would spot.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

TS_FMT = "%Y-%m-%d %H:%M:%S"

# Model background defaults applied to a NEW station. See the stations table
# comment in SCHEMA for why the background is on rather than off.
#
# Written as literals here rather than imported from ingest and providers.registry
# because the same values are also SQL column defaults, which have to be
# constants. tests/test_nwp_defaults.py asserts they stay in step with
# ingest.ENGINE_VARIABLES and registry.ALL_PROVIDER_NAMES, so the two cannot
# drift apart unnoticed.
DEFAULT_NWP_PROVIDERS = ("xweather",)
DEFAULT_NWP_VARIABLES = (
    "temperature", "humidity", "dew_point", "pressure", "wind_speed",
    "wind_gust", "wind_direction", "solar_radiation", "rainfall",
)


def to_db(when: datetime) -> str:
    return when.strftime(TS_FMT)


def from_db(raw: str) -> datetime:
    return datetime.strptime(raw, TS_FMT)


SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    logger_model  TEXT    NOT NULL DEFAULT '',
    -- Nullable because a logger file does not carry position. The operator
    -- supplies it, and a model background cannot be fetched without it.
    latitude      REAL,
    longitude     REAL,
    elevation_m   REAL,
    -- A Campbell logger is programmed in local standard time and does not
    -- shift for daylight saving, so its timestamps are naive and fixed. A model
    -- API answers in UTC. Without knowing the offset the two would be compared
    -- two hours apart, which would look like a forecast that is wrong by
    -- exactly one diurnal quarter-cycle. Defaults to +2 for SAST.
    utc_offset_hours REAL NOT NULL DEFAULT 2.0,
    created_at    TEXT    NOT NULL,
    -- Model background, ON by default with every engine variable selected.
    --
    -- The method is a station's own history CORRECTING a model background. With
    -- the background off a station can only ever reproduce its own past, which
    -- is the weaker half of that and not what a nano-climate forecast is for. So
    -- a new station is model-backed from the start; the operator can still
    -- narrow the variable list or switch it off per station afterwards.
    --
    -- Nothing is fetched until the station has coordinates (see
    -- forecasting.run_forecast), so this cannot spend the access budget on a
    -- station that was created and never positioned.
    nwp_enabled   INTEGER NOT NULL DEFAULT 1,
    nwp_providers TEXT    NOT NULL DEFAULT '["xweather"]',
    nwp_variables TEXT    NOT NULL DEFAULT '["temperature","humidity","dew_point","pressure","wind_speed","wind_gust","wind_direction","solar_radiation","rainfall"]'
);

CREATE TABLE IF NOT EXISTS uploads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id   INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    filename     TEXT    NOT NULL,
    sha256       TEXT    NOT NULL,
    uploaded_at  TEXT    NOT NULL,
    rows_kept    INTEGER NOT NULL DEFAULT 0,
    rows_skipped INTEGER NOT NULL DEFAULT 0,
    first_ts     TEXT,
    last_ts      TEXT,
    report_json  TEXT    NOT NULL DEFAULT '{}',
    UNIQUE (station_id, sha256)
);

CREATE TABLE IF NOT EXISTS observations (
    station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    observed_at TEXT    NOT NULL,
    variable    TEXT    NOT NULL,
    value       REAL    NOT NULL,
    PRIMARY KEY (station_id, variable, observed_at)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_obs_station_time
    ON observations (station_id, observed_at);

CREATE TABLE IF NOT EXISTS forecast_runs (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    station_id     INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    issued_at      TEXT    NOT NULL,
    -- The observation the run was launched from. Verification needs this to
    -- build a fair persistence baseline, and it is not always the same as
    -- issued_at when a file is uploaded after the fact.
    base_time      TEXT    NOT NULL,
    horizon_hours  INTEGER NOT NULL,
    provider       TEXT    NOT NULL DEFAULT '',
    resolution_km  REAL,
    -- Short hash of the forecast method's tuning constants. Lets the
    -- verification history separate "the method changed" from "the weather got
    -- harder", which an all-time average cannot do.
    method_version TEXT    NOT NULL DEFAULT '',
    notes          TEXT    NOT NULL DEFAULT '',
    UNIQUE (station_id, base_time, horizon_hours)
);

CREATE TABLE IF NOT EXISTS forecast_points (
    run_id       INTEGER NOT NULL REFERENCES forecast_runs(id)
                     ON DELETE CASCADE,
    valid_at     TEXT    NOT NULL,
    lead_hours   REAL    NOT NULL,
    variable     TEXT    NOT NULL,
    value        REAL,
    p10          REAL,
    p90          REAL,
    -- Baselines stored alongside the forecast, at the moment of issue. Scoring
    -- against a baseline reconstructed later would be arguing after the fact;
    -- storing it now means the comparison is honest.
    persistence  REAL,
    climatology  REAL,
    -- The analog ensemble members for this hour, as a JSON array of numbers.
    --
    -- Stored rather than reduced to p10/p90, because a percentile pair cannot
    -- answer the questions people actually ask. "What is the chance of frost
    -- tonight" is a tail probability, and recovering it from two percentiles
    -- means assuming a distribution shape that a frost night does not have.
    -- Keeping the members makes every threshold probability exact and empirical,
    -- and it is also what CRPS and a rank histogram need.
    --
    -- Cost is modest: about 15 numbers per point, so a 5 day run over 9
    -- variables is roughly 16k numbers, which SQLite stores comfortably.
    members      TEXT    NOT NULL DEFAULT '[]',
    sources_json TEXT    NOT NULL DEFAULT '{}',
    PRIMARY KEY (run_id, variable, valid_at)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_fp_lookup
    ON forecast_points (variable, valid_at);

-- One Dropbox folder watched per station, so a logger that keeps appending to
-- the same .dat feeds the forecast without anyone uploading by hand.
CREATE TABLE IF NOT EXISTS dropbox_sources (
    station_id     INTEGER PRIMARY KEY REFERENCES stations(id)
                       ON DELETE CASCADE,
    folder_path    TEXT    NOT NULL DEFAULT '',
    file_pattern   TEXT    NOT NULL DEFAULT '*.dat',
    enabled        INTEGER NOT NULL DEFAULT 0,
    interval_secs  INTEGER NOT NULL DEFAULT 900,
    -- Re-forecast after new data lands. The point of a continuous feed is that
    -- the forecast and its scores keep up on their own.
    auto_forecast  INTEGER NOT NULL DEFAULT 1,
    last_polled_at TEXT,
    last_status    TEXT    NOT NULL DEFAULT '',
    last_error     TEXT    NOT NULL DEFAULT '',
    files_seen     INTEGER NOT NULL DEFAULT 0,
    rows_added     INTEGER NOT NULL DEFAULT 0
);

-- What we have already ingested, keyed by Dropbox's own revision id. A file
-- whose rev has not moved is not downloaded again: the logger appends to the
-- same path every few minutes and re-downloading an unchanged multi-megabyte
-- export on every poll would waste the bandwidth and the API quota for nothing.
CREATE TABLE IF NOT EXISTS dropbox_seen (
    station_id   INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    path_lower   TEXT    NOT NULL,
    rev          TEXT    NOT NULL DEFAULT '',
    content_hash TEXT    NOT NULL DEFAULT '',
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    ingested_at  TEXT    NOT NULL DEFAULT '',
    rows_kept    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (station_id, path_lower)
) WITHOUT ROWID;

-- Cached row count per station, so the station page does not COUNT(*) a growing
-- table on every view. Measured on the live record at 1.28 million rows, that
-- count took 5.3 seconds from a cold cache and was the last thing making the
-- page time out.
--
-- Kept exact rather than approximate: it is recomputed after an ingest, which
-- happens on the Dropbox poller's thread where a few seconds cost nothing, and
-- it is only ever read on the request path. An approximate figure was rejected
-- because "readings stored" is a number an operator checks against their own
-- expectations, and a wrong one would undermine the rest of the page.
CREATE TABLE IF NOT EXISTS station_stats (
    station_id        INTEGER PRIMARY KEY REFERENCES stations(id)
                      ON DELETE CASCADE,
    observation_count INTEGER NOT NULL DEFAULT 0,
    updated_at        TEXT    NOT NULL DEFAULT ''
);

-- Which sector products a station shows, and the few site facts they need that
-- a logger file cannot carry (array tilt, hub height, crop). One row per
-- station. Nothing derived is stored here: every sector quantity is recomputed
-- on demand from the stored forecast points and this configuration, so a sector
-- page can never disagree with the forecast it came from.
CREATE TABLE IF NOT EXISTS sector_config (
    station_id       INTEGER PRIMARY KEY REFERENCES stations(id)
                     ON DELETE CASCADE,
    solar            INTEGER NOT NULL DEFAULT 0,
    wind             INTEGER NOT NULL DEFAULT 0,
    agriculture      INTEGER NOT NULL DEFAULT 0,
    agrivoltaics     INTEGER NOT NULL DEFAULT 0,
    -- Solar and agrivoltaic geometry.
    tilt_deg         REAL,
    surface_azimuth_deg REAL,
    rated_w          REAL,
    tracking         TEXT    NOT NULL DEFAULT 'fixed',
    row_pitch_m      REAL,
    collector_width_m REAL,
    albedo_surface   TEXT    NOT NULL DEFAULT 'grass',
    -- Wind.
    hub_height_m     REAL,
    measurement_height_m REAL,
    -- Agriculture.
    crop             TEXT    NOT NULL DEFAULT '',
    planting_date    TEXT    NOT NULL DEFAULT '',
    livestock        TEXT    NOT NULL DEFAULT ''
);

-- Provider clear-sky irradiance, per station and valid time. The Xweather
-- background carries solradClearSkyWM2 in NwpPoint.extras, which is not part of
-- forecast_points, so without this table the figure is gone by the time a
-- historical solar view is drawn and would have to be re-fetched at API cost.
-- The solar page prefers this over the Haurwitz fallback when a row exists.
CREATE TABLE IF NOT EXISTS provider_clear_sky (
    station_id  INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
    valid_at    TEXT    NOT NULL,
    wm2         REAL    NOT NULL,
    source      TEXT    NOT NULL DEFAULT 'provider',
    PRIMARY KEY (station_id, valid_at)
) WITHOUT ROWID;
"""


@dataclass
class Station:
    id: int
    slug: str
    name: str
    logger_model: str = ""
    latitude: float | None = None
    longitude: float | None = None
    elevation_m: float | None = None
    utc_offset_hours: float = 2.0
    nwp_enabled: bool = True
    nwp_providers: list[str] | None = None
    nwp_variables: list[str] | None = None

    @property
    def has_position(self) -> bool:
        return self.latitude is not None and self.longitude is not None


class Database:
    """Thin wrapper. Deliberately not an ORM: the queries here are few and the
    verification join reads far better as SQL than as a chain of method calls.
    """

    def __init__(self, path: str | Path = "data/forecast.db"):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init()

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(str(self.path), timeout=30,
                               detect_types=0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init(self) -> None:
        with self.connect() as c:
            c.executescript(SCHEMA)
            self._migrate(c)

    # NOTE: there is deliberately no ANALYZE here.
    #
    # An earlier version ran ANALYZE once at startup to give the query planner
    # statistics. On the live record, 1.28 million rows in a 112 MB database
    # inside a 320 MB container, ANALYZE pushed the process past its memory cap
    # and the out-of-memory reaper killed it. Because the kill happened before
    # the commit, the statistics were never stored, so the next start ran ANALYZE
    # again: a restart loop every two minutes that took the service down with no
    # traceback to explain it.
    #
    # The queries in this module are written not to need statistics. The loose
    # index scan in station_variables and the two ordered lookups in
    # observation_span use indexes by construction rather than by the planner's
    # choice, which is why removing this costs nothing. If statistics are ever
    # wanted, run ANALYZE as a maintenance task against the file, never on the
    # startup path of a memory-capped container.

    @staticmethod
    def _migrate(c: sqlite3.Connection) -> None:
        """Add columns introduced after a database was first created.

        CREATE TABLE IF NOT EXISTS does nothing to a table that already exists,
        so a new column has to be added explicitly or an upgraded database and a
        fresh one end up with different schemas. Only additive, nullable or
        defaulted columns belong here, which is all SQLite can add anyway.
        """
        wanted = {
            "stations": [
                ("utc_offset_hours", "REAL NOT NULL DEFAULT 2.0"),
                # Matches the SCHEMA defaults: a database being brought up to
                # this version gets the background on, like a fresh one.
                ("nwp_enabled", "INTEGER NOT NULL DEFAULT 1"),
                ("nwp_providers", "TEXT NOT NULL DEFAULT '[\"xweather\"]'"),
                ("nwp_variables",
                 "TEXT NOT NULL DEFAULT '[\"temperature\",\"humidity\","
                 "\"dew_point\",\"pressure\",\"wind_speed\",\"wind_gust\","
                 "\"wind_direction\",\"solar_radiation\",\"rainfall\"]'"),
                ("elevation_m", "REAL"),
            ],
            "forecast_points": [
                ("persistence", "REAL"),
                ("climatology", "REAL"),
                ("members", "TEXT NOT NULL DEFAULT '[]'"),
                # Was in the fresh schema and written by insert_points, but
                # missing here, so a database created before it was added would
                # never gain the column and every insert would fail. Found by
                # the fresh-versus-upgraded schema test.
                ("sources_json", "TEXT NOT NULL DEFAULT '{}'"),
            ],
            "forecast_runs": [
                ("resolution_km", "REAL"),
                ("provider", "TEXT NOT NULL DEFAULT ''"),
                # A short hash of the forecast method's tuning constants, so a
                # change of method is visible in the verification history rather
                # than silently averaged together with the old one.
                ("method_version", "TEXT NOT NULL DEFAULT ''"),
            ],
        }
        for table, columns in wanted.items():
            try:
                existing = {r["name"] for r in
                            c.execute(f"PRAGMA table_info({table})")}
            except sqlite3.Error:
                continue
            if not existing:
                continue
            for name, decl in columns:
                if name not in existing:
                    c.execute(
                        f"ALTER TABLE {table} ADD COLUMN {name} {decl}")

    # -- stations ---------------------------------------------------------

    def upsert_station(self, slug: str, name: str,
                       logger_model: str = "") -> int:
        with self.connect() as c:
            row = c.execute("SELECT id FROM stations WHERE slug = ?",
                            (slug,)).fetchone()
            if row:
                # A later upload may carry a better name or model; do not let
                # it blank out what is already there.
                if name or logger_model:
                    c.execute(
                        "UPDATE stations SET name = COALESCE(NULLIF(?, ''), "
                        "name), logger_model = COALESCE(NULLIF(?, ''), "
                        "logger_model) WHERE id = ?",
                        (name, logger_model, row["id"]))
                return int(row["id"])
            # The model background is written explicitly rather than left to the
            # column default, because a database created by an earlier version
            # has these columns with the old off-by-default and a new station
            # there would silently be history-only.
            cur = c.execute(
                "INSERT INTO stations (slug, name, logger_model, created_at, "
                "nwp_enabled, nwp_providers, nwp_variables) "
                "VALUES (?, ?, ?, ?, 1, ?, ?)",
                (slug, name or slug, logger_model,
                 to_db(datetime.now()),
                 json.dumps(list(DEFAULT_NWP_PROVIDERS)),
                 json.dumps(list(DEFAULT_NWP_VARIABLES))))
            return int(cur.lastrowid)

    def _station_from_row(self, r: sqlite3.Row) -> Station:
        return Station(
            id=int(r["id"]), slug=r["slug"], name=r["name"],
            logger_model=r["logger_model"],
            latitude=r["latitude"], longitude=r["longitude"],
            elevation_m=r["elevation_m"],
            utc_offset_hours=float(r["utc_offset_hours"]
                                   if r["utc_offset_hours"] is not None
                                   else 2.0),
            nwp_enabled=bool(r["nwp_enabled"]),
            nwp_providers=json.loads(r["nwp_providers"] or "[]"),
            nwp_variables=json.loads(r["nwp_variables"] or "[]"))

    def get_station(self, station_id: int) -> Station | None:
        with self.connect() as c:
            r = c.execute("SELECT * FROM stations WHERE id = ?",
                          (station_id,)).fetchone()
            return self._station_from_row(r) if r else None

    def get_station_by_slug(self, slug: str) -> Station | None:
        with self.connect() as c:
            r = c.execute("SELECT * FROM stations WHERE slug = ?",
                          (slug,)).fetchone()
            return self._station_from_row(r) if r else None

    def list_stations(self) -> list[Station]:
        with self.connect() as c:
            return [self._station_from_row(r) for r in
                    c.execute("SELECT * FROM stations ORDER BY name")]

    def update_station_position(self, station_id: int,
                                latitude: float | None,
                                longitude: float | None,
                                elevation_m: float | None,
                                utc_offset_hours: float | None = None) -> None:
        with self.connect() as c:
            if utc_offset_hours is None:
                c.execute(
                    "UPDATE stations SET latitude = ?, longitude = ?, "
                    "elevation_m = ? WHERE id = ?",
                    (latitude, longitude, elevation_m, station_id))
            else:
                c.execute(
                    "UPDATE stations SET latitude = ?, longitude = ?, "
                    "elevation_m = ?, utc_offset_hours = ? WHERE id = ?",
                    (latitude, longitude, elevation_m, utc_offset_hours,
                     station_id))

    def update_station_nwp(self, station_id: int, enabled: bool,
                           providers: list[str],
                           variables: list[str]) -> None:
        with self.connect() as c:
            c.execute(
                "UPDATE stations SET nwp_enabled = ?, nwp_providers = ?, "
                "nwp_variables = ? WHERE id = ?",
                (1 if enabled else 0, json.dumps(list(providers)),
                 json.dumps(list(variables)), station_id))

    def delete_station(self, station_id: int) -> None:
        # Cascades to uploads, observations, runs and points.
        with self.connect() as c:
            c.execute("DELETE FROM stations WHERE id = ?", (station_id,))

    # -- uploads and observations -----------------------------------------

    def upload_already_seen(self, station_id: int, sha256: str) -> bool:
        with self.connect() as c:
            return c.execute(
                "SELECT 1 FROM uploads WHERE station_id = ? AND sha256 = ?",
                (station_id, sha256)).fetchone() is not None

    def record_upload(self, station_id: int, filename: str, sha256: str,
                      rows_kept: int, rows_skipped: int,
                      first_ts: datetime | None, last_ts: datetime | None,
                      report: dict) -> int:
        with self.connect() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO uploads (station_id, filename, sha256, "
                "uploaded_at, rows_kept, rows_skipped, first_ts, last_ts, "
                "report_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (station_id, filename, sha256, to_db(datetime.now()),
                 rows_kept, rows_skipped,
                 to_db(first_ts) if first_ts else None,
                 to_db(last_ts) if last_ts else None,
                 json.dumps(report, default=str)))
            return int(cur.lastrowid or 0)

    def list_uploads(self, station_id: int) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute(
                "SELECT * FROM uploads WHERE station_id = ? "
                "ORDER BY uploaded_at DESC", (station_id,))]

    #: Rows sent to SQLite per executemany. Chosen so the pending list stays
    #: small enough to be irrelevant against the container's 320 MB cap, while
    #: still being large enough that the per-statement overhead disappears.
    INSERT_BATCH = 20_000

    def insert_observations(self, station_id: int, observations) -> int:
        """Store readings. Re-uploading the same period corrects, not duplicates.

        Inserted in batches rather than building one list for the whole file.
        A multi-year export is millions of readings, and one tuple per reading
        held in memory alongside the parsed file was enough to have the container
        killed by the out-of-memory reaper on a 320 MB cap: the live service was
        restarting every two minutes on the Dropbox poller before this was
        batched. Peak memory is now bounded by INSERT_BATCH regardless of how
        large the upload is.
        """
        sql = ("INSERT OR REPLACE INTO observations "
               "(station_id, observed_at, variable, value) "
               "VALUES (?, ?, ?, ?)")
        written = 0
        batch: list[tuple] = []
        with self.connect() as c:
            for obs in observations:
                stamp = to_db(obs.observed_at)
                for variable, value in obs.values.items():
                    batch.append((station_id, stamp, variable, float(value)))
                if len(batch) >= self.INSERT_BATCH:
                    c.executemany(sql, batch)
                    written += len(batch)
                    batch.clear()
            if batch:
                c.executemany(sql, batch)
                written += len(batch)
                batch.clear()
            if written:
                # Recount rather than adding `written`: these are INSERT OR
                # REPLACE, so re-uploading a period corrects rows instead of
                # adding them, and an increment would drift upward forever. Done
                # after the batches are released, so the scan does not run while
                # a large pending list is still held.
                self._refresh_count(c, station_id)
        return written

    @staticmethod
    def _refresh_count(c: sqlite3.Connection, station_id: int) -> int:
        """Recompute a station's observation count, and cache it if it can be.

        The cache row is only written for a station that still exists. Asking for
        the count of a station that has just been deleted is legitimate, and it
        must answer zero rather than fail on the foreign key.
        """
        n = int(c.execute("SELECT COUNT(*) AS n FROM observations "
                          "WHERE station_id = ?", (station_id,)).fetchone()["n"])
        exists = c.execute("SELECT 1 FROM stations WHERE id = ?",
                           (station_id,)).fetchone()
        if exists:
            c.execute(
                "INSERT INTO station_stats (station_id, observation_count, "
                "updated_at) VALUES (?, ?, ?) "
                "ON CONFLICT(station_id) DO UPDATE SET "
                "observation_count = excluded.observation_count, "
                "updated_at = excluded.updated_at",
                (station_id, n, to_db(datetime.now())))
        return n

    # -- sector configuration --------------------------------------------

    #: Physical ranges for the numeric sector settings. A value outside these is
    #: rejected rather than clamped: silently changing what an operator typed
    #: would leave the page disagreeing with the database.
    SECTOR_RANGES = {
        "tilt_deg": (0.0, 90.0),
        "surface_azimuth_deg": (0.0, 360.0),
        "rated_w": (1.0, 100_000_000.0),
        "row_pitch_m": (0.1, 500.0),
        "collector_width_m": (0.1, 500.0),
        "hub_height_m": (1.0, 300.0),
        "measurement_height_m": (0.5, 300.0),
    }

    SECTORS = ("solar", "wind", "agriculture", "agrivoltaics")

    def get_sector_config(self, station_id: int) -> dict | None:
        with self.connect() as c:
            r = c.execute("SELECT * FROM sector_config WHERE station_id = ?",
                          (station_id,)).fetchone()
        return dict(r) if r else None

    def upsert_sector_config(self, station_id: int, **fields) -> None:
        """Save a station's sector configuration.

        Raises ValueError for a numeric value outside its physical range, so a
        typo in a tilt cannot quietly become a forecast.
        """
        for name, (lo, hi) in self.SECTOR_RANGES.items():
            value = fields.get(name)
            if value is None:
                continue
            if not lo <= float(value) <= hi:
                raise ValueError(
                    f"{name} must be between {lo} and {hi}, got {value}")
        tracking = fields.get("tracking", "fixed")
        if tracking not in ("fixed", "single_axis"):
            raise ValueError(
                f"tracking must be 'fixed' or 'single_axis', got {tracking!r}")

        columns = ["solar", "wind", "agriculture", "agrivoltaics",
                   "tilt_deg", "surface_azimuth_deg", "rated_w", "tracking",
                   "row_pitch_m", "collector_width_m", "albedo_surface",
                   "hub_height_m", "measurement_height_m",
                   "crop", "planting_date", "livestock"]
        defaults = {"tracking": "fixed", "albedo_surface": "grass",
                    "crop": "", "planting_date": "", "livestock": ""}
        values = []
        for col in columns:
            if col in self.SECTORS:
                values.append(1 if fields.get(col) else 0)
            else:
                values.append(fields.get(col, defaults.get(col)))

        placeholders = ", ".join("?" for _ in range(len(columns) + 1))
        assignments = ", ".join(f"{c} = excluded.{c}" for c in columns)
        with self.connect() as c:
            c.execute(
                f"INSERT INTO sector_config (station_id, {', '.join(columns)}) "
                f"VALUES ({placeholders}) "
                f"ON CONFLICT(station_id) DO UPDATE SET {assignments}",
                [station_id] + values)

    def enabled_sectors(self, station_id: int) -> list[str]:
        """Which sectors this station shows, in a stable order."""
        cfg = self.get_sector_config(station_id)
        if not cfg:
            return []
        return [s for s in self.SECTORS if cfg.get(s)]

    # -- provider clear sky ----------------------------------------------

    def upsert_clear_sky(self, station_id: int, entries) -> int:
        """Store provider clear-sky W/m2 keyed by valid time.

        `entries` is an iterable of (valid_at datetime, wm2, source). Re-storing
        the same hour corrects rather than duplicates, the same idempotence the
        observations use.
        """
        rows = [(station_id, to_db(v), float(w), s) for v, w, s in entries]
        if not rows:
            return 0
        with self.connect() as c:
            c.executemany(
                "INSERT OR REPLACE INTO provider_clear_sky "
                "(station_id, valid_at, wm2, source) VALUES (?, ?, ?, ?)",
                rows)
        return len(rows)

    def clear_sky_at(self, station_id: int,
                     valid_at: datetime) -> float | None:
        """The stored provider clear-sky W/m2 for one hour, or None."""
        with self.connect() as c:
            r = c.execute(
                "SELECT wm2 FROM provider_clear_sky "
                "WHERE station_id = ? AND valid_at = ?",
                (station_id, to_db(valid_at))).fetchone()
        return r["wm2"] if r else None

    def clear_sky_series(self, station_id: int,
                         start: datetime | None = None,
                         end: datetime | None = None) -> list[dict]:
        """Stored provider clear-sky over a window, oldest first."""
        q = ("SELECT valid_at, wm2, source FROM provider_clear_sky "
             "WHERE station_id = ?")
        args: list = [station_id]
        if start is not None:
            q += " AND valid_at >= ?"
            args.append(to_db(start))
        if end is not None:
            q += " AND valid_at <= ?"
            args.append(to_db(end))
        q += " ORDER BY valid_at"
        with self.connect() as c:
            return [{"valid_at": from_db(r["valid_at"]), "wm2": r["wm2"],
                     "source": r["source"]} for r in c.execute(q, args)]

    def observation_count(self, station_id: int) -> int:
        """How many readings are stored for a station.

        Reads the cached figure, which insert_observations keeps current. Falls
        back to counting once, and stores the result, so a database that predates
        the cache pays the cost a single time rather than on every page view.
        """
        with self.connect() as c:
            row = c.execute(
                "SELECT observation_count FROM station_stats "
                "WHERE station_id = ?", (station_id,)).fetchone()
            if row is not None:
                return int(row["observation_count"])
            return self._refresh_count(c, station_id)

    def station_variables(self, station_id: int) -> list[str]:
        """The distinct variables stored for a station.

        A plain SELECT DISTINCT reads every row for the station. That is fine on
        a small record and ruinous on a real one: measured on the live host at
        1.28 million rows it took 9.9 seconds, and it runs on every station page
        view.

        This is a loose index scan instead. The primary key is
        (station_id, variable, observed_at), so asking for the smallest variable
        greater than the last one found is an index seek, and the whole list
        costs one seek per distinct variable rather than one read per row. Nine
        variables means nine seeks.
        """
        sql = """
            WITH RECURSIVE step(v) AS (
                SELECT MIN(variable) FROM observations WHERE station_id = ?
                UNION ALL
                SELECT (SELECT MIN(variable) FROM observations
                         WHERE station_id = ? AND variable > step.v)
                  FROM step WHERE step.v IS NOT NULL
            )
            SELECT v FROM step WHERE v IS NOT NULL ORDER BY v
        """
        with self.connect() as c:
            return [r["v"] for r in c.execute(sql, (station_id, station_id))]

    def observation_span(self, station_id: int):
        """Earliest and latest observation time for a station.

        Deliberately two queries. SQLite optimizes a single MIN or MAX into an
        index lookup, but asking for both in one statement defeats that and
        scans the table: 3.3 seconds on the live record. Two ordered lookups
        against idx_obs_station_time are two seeks.
        """
        with self.connect() as c:
            lo = c.execute(
                "SELECT observed_at FROM observations WHERE station_id = ? "
                "ORDER BY observed_at ASC LIMIT 1", (station_id,)).fetchone()
            if not lo:
                return None, None
            hi = c.execute(
                "SELECT observed_at FROM observations WHERE station_id = ? "
                "ORDER BY observed_at DESC LIMIT 1", (station_id,)).fetchone()
        return from_db(lo["observed_at"]), from_db(hi["observed_at"])

    def series(self, station_id: int, variable: str,
               start: datetime | None = None,
               end: datetime | None = None) -> list[tuple[datetime, float]]:
        sql = ("SELECT observed_at, value FROM observations "
               "WHERE station_id = ? AND variable = ?")
        args: list = [station_id, variable]
        if start:
            sql += " AND observed_at >= ?"
            args.append(to_db(start))
        if end:
            sql += " AND observed_at <= ?"
            args.append(to_db(end))
        sql += " ORDER BY observed_at"
        with self.connect() as c:
            return [(from_db(r["observed_at"]), float(r["value"]))
                    for r in c.execute(sql, args)]

    def latest_observation(self, station_id: int, variable: str):
        with self.connect() as c:
            r = c.execute(
                "SELECT observed_at, value FROM observations "
                "WHERE station_id = ? AND variable = ? "
                "ORDER BY observed_at DESC LIMIT 1",
                (station_id, variable)).fetchone()
        if not r:
            return None
        return from_db(r["observed_at"]), float(r["value"])

    # -- forecast runs ----------------------------------------------------

    def create_run(self, station_id: int, base_time: datetime,
                   horizon_hours: int, provider: str = "",
                   resolution_km: float | None = None,
                   notes: str = "", method_version: str = "") -> int:
        """Start a run, replacing any previous run for the same base and horizon.

        Replacing rather than adding: re-running the same base time is a
        recompute, and keeping both would double-count that base time in the
        verification statistics.
        """
        with self.connect() as c:
            c.execute(
                "DELETE FROM forecast_runs WHERE station_id = ? "
                "AND base_time = ? AND horizon_hours = ?",
                (station_id, to_db(base_time), horizon_hours))
            cur = c.execute(
                "INSERT INTO forecast_runs (station_id, issued_at, base_time, "
                "horizon_hours, provider, resolution_km, notes, "
                "method_version) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (station_id, to_db(datetime.now()), to_db(base_time),
                 horizon_hours, provider, resolution_km, notes,
                 method_version))
            return int(cur.lastrowid)

    def insert_points(self, run_id: int, points) -> int:
        """`points` are (valid_at, lead_hours, variable, value, p10, p90,
        persistence, climatology, sources, members).

        `members` is optional for callers written before the ensemble was
        stored; it defaults to an empty list.
        """
        rows = []
        for point in points:
            (valid_at, lead, variable, value, p10, p90,
             persistence, climatology, sources) = point[:9]
            members = point[9] if len(point) > 9 else None
            clean = []
            for m in (members or ()):
                try:
                    f = float(m)
                except (TypeError, ValueError):
                    continue
                if f == f and f not in (float("inf"), float("-inf")):
                    clean.append(round(f, 4))
            rows.append((run_id, to_db(valid_at), float(lead), variable,
                         value, p10, p90, persistence, climatology,
                         json.dumps(clean), json.dumps(sources or {})))
        if not rows:
            return 0
        with self.connect() as c:
            c.executemany(
                "INSERT OR REPLACE INTO forecast_points (run_id, valid_at, "
                "lead_hours, variable, value, p10, p90, persistence, "
                "climatology, members, sources_json) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        return len(rows)

    @staticmethod
    def decode_members(raw) -> list[float]:
        """Members column back to a list of floats. Never raises."""
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except (TypeError, ValueError):
            return []
        if not isinstance(data, list):
            return []
        out = []
        for m in data:
            try:
                out.append(float(m))
            except (TypeError, ValueError):
                continue
        return out

    def latest_run(self, station_id: int, horizon_hours: int) -> dict | None:
        with self.connect() as c:
            r = c.execute(
                "SELECT * FROM forecast_runs WHERE station_id = ? "
                "AND horizon_hours = ? ORDER BY base_time DESC LIMIT 1",
                (station_id, horizon_hours)).fetchone()
            return dict(r) if r else None

    def list_runs(self, station_id: int, limit: int = 100) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute(
                "SELECT * FROM forecast_runs WHERE station_id = ? "
                "ORDER BY base_time DESC LIMIT ?", (station_id, limit))]

    def run_points(self, run_id: int,
                   variable: str | None = None) -> list[dict]:
        sql = "SELECT * FROM forecast_points WHERE run_id = ?"
        args: list = [run_id]
        if variable:
            sql += " AND variable = ?"
            args.append(variable)
        sql += " ORDER BY variable, valid_at"
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql, args)]

    # -- verification -----------------------------------------------------

    def matched_pairs(self, station_id: int, variable: str | None = None,
                      horizon_hours: int | None = None) -> list[dict]:
        """Every forecast point that now has an observation to score against.

        The join is the whole verification story: a forecast point is scored
        only once the hour it predicted has actually happened and been uploaded.
        Points still in the future simply do not appear, which is why the
        verification page grows over time instead of being complete at once.
        """
        sql = """
            SELECT fp.variable      AS variable,
                   fp.valid_at      AS valid_at,
                   fp.lead_hours    AS lead_hours,
                   fp.value         AS forecast,
                   fp.p10           AS p10,
                   fp.p90           AS p90,
                   fp.persistence   AS persistence,
                   fp.climatology   AS climatology,
                   fp.members       AS members,
                   r.horizon_hours  AS horizon_hours,
                   r.base_time      AS base_time,
                   o.value          AS observed
            FROM forecast_points fp
            JOIN forecast_runs r ON r.id = fp.run_id
            JOIN observations o
              ON o.station_id = r.station_id
             AND o.variable   = fp.variable
             AND o.observed_at = fp.valid_at
            WHERE r.station_id = ?
              AND fp.value IS NOT NULL
        """
        args: list = [station_id]
        if variable:
            sql += " AND fp.variable = ?"
            args.append(variable)
        if horizon_hours:
            sql += " AND r.horizon_hours = ?"
            args.append(horizon_hours)
        sql += " ORDER BY fp.variable, fp.lead_hours, fp.valid_at"
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql, args)]

    # -- Dropbox feed -----------------------------------------------------

    def get_dropbox_source(self, station_id: int) -> dict | None:
        with self.connect() as c:
            r = c.execute("SELECT * FROM dropbox_sources WHERE station_id = ?",
                          (station_id,)).fetchone()
            return dict(r) if r else None

    def upsert_dropbox_source(self, station_id: int, folder_path: str,
                              file_pattern: str, enabled: bool,
                              interval_secs: int,
                              auto_forecast: bool) -> None:
        with self.connect() as c:
            c.execute(
                "INSERT INTO dropbox_sources (station_id, folder_path, "
                "file_pattern, enabled, interval_secs, auto_forecast) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(station_id) DO UPDATE SET "
                "folder_path = excluded.folder_path, "
                "file_pattern = excluded.file_pattern, "
                "enabled = excluded.enabled, "
                "interval_secs = excluded.interval_secs, "
                "auto_forecast = excluded.auto_forecast",
                (station_id, folder_path.strip(), file_pattern.strip()
                 or "*.dat", 1 if enabled else 0,
                 max(60, int(interval_secs)), 1 if auto_forecast else 0))

    def list_dropbox_sources(self, only_enabled: bool = True) -> list[dict]:
        sql = ("SELECT d.*, s.slug, s.name FROM dropbox_sources d "
               "JOIN stations s ON s.id = d.station_id")
        if only_enabled:
            sql += " WHERE d.enabled = 1"
        with self.connect() as c:
            return [dict(r) for r in c.execute(sql)]

    def record_dropbox_poll(self, station_id: int, status: str, error: str,
                            files_seen: int, rows_added: int) -> None:
        with self.connect() as c:
            c.execute(
                "UPDATE dropbox_sources SET last_polled_at = ?, "
                "last_status = ?, last_error = ?, files_seen = ?, "
                "rows_added = ? WHERE station_id = ?",
                (to_db(datetime.now()), status[:400], error[:800],
                 files_seen, rows_added, station_id))

    def dropbox_seen_rev(self, station_id: int, path_lower: str) -> str | None:
        with self.connect() as c:
            r = c.execute(
                "SELECT rev FROM dropbox_seen WHERE station_id = ? "
                "AND path_lower = ?", (station_id, path_lower)).fetchone()
            return r["rev"] if r else None

    def record_dropbox_file(self, station_id: int, path_lower: str, rev: str,
                            content_hash: str, size_bytes: int,
                            rows_kept: int) -> None:
        with self.connect() as c:
            c.execute(
                "INSERT OR REPLACE INTO dropbox_seen (station_id, path_lower, "
                "rev, content_hash, size_bytes, ingested_at, rows_kept) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (station_id, path_lower, rev, content_hash, size_bytes,
                 to_db(datetime.now()), rows_kept))

    def list_dropbox_files(self, station_id: int) -> list[dict]:
        with self.connect() as c:
            return [dict(r) for r in c.execute(
                "SELECT * FROM dropbox_seen WHERE station_id = ? "
                "ORDER BY ingested_at DESC", (station_id,))]

    def prune_orphan_runs(self, station_id: int) -> int:
        """Drop runs whose points can never be scored because the base time is
        newer than every observation we hold. Housekeeping only."""
        with self.connect() as c:
            cur = c.execute(
                "DELETE FROM forecast_runs WHERE station_id = ? AND id NOT IN "
                "(SELECT DISTINCT run_id FROM forecast_points)",
                (station_id,))
            return cur.rowcount or 0
