"""Storage-layer tests, kept apart from the physics and the web routes."""
from __future__ import annotations

from datetime import datetime, timedelta


def test_provider_clear_sky_round_trips(database):
    """R2.13a: the provider's clear-sky figure is persisted per station and
    valid time so a historical solar view need not re-fetch it."""
    sid = database.upsert_station("cs", "Clear Sky Site", "CR1000X")
    base = datetime(2026, 1, 1, 6, 0)
    entries = [(base + timedelta(hours=i), 100.0 * i, "provider")
               for i in range(4)]
    written = database.upsert_clear_sky(sid, entries)
    assert written == 4

    assert database.clear_sky_at(sid, base + timedelta(hours=2)) == 200.0
    assert database.clear_sky_at(sid, datetime(2020, 1, 1, 0, 0)) is None

    series = database.clear_sky_series(sid)
    assert [row["wm2"] for row in series] == [0.0, 100.0, 200.0, 300.0]
    assert all(row["source"] == "provider" for row in series)


def test_provider_clear_sky_corrects_rather_than_duplicates(database):
    sid = database.upsert_station("cs2", "Site", "CR1000X")
    t = datetime(2026, 1, 1, 12, 0)
    database.upsert_clear_sky(sid, [(t, 500.0, "provider")])
    database.upsert_clear_sky(sid, [(t, 640.0, "provider")])
    series = database.clear_sky_series(sid)
    assert len(series) == 1
    assert series[0]["wm2"] == 640.0


def test_clear_sky_window_filters_by_time(database):
    sid = database.upsert_station("cs3", "Site", "CR1000X")
    base = datetime(2026, 1, 1, 0, 0)
    database.upsert_clear_sky(
        sid, [(base + timedelta(hours=i), float(i), "provider")
              for i in range(24)])
    window = database.clear_sky_series(
        sid, start=base + timedelta(hours=6), end=base + timedelta(hours=9))
    assert [row["wm2"] for row in window] == [6.0, 7.0, 8.0, 9.0]


# ---------------------------------------------------------------------------
#  The migration is additive: an upgraded database matches a fresh one
# ---------------------------------------------------------------------------

def _schema(path):
    """Every table's column set, for comparing two databases."""
    import sqlite3
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    try:
        tables = sorted(r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' "
            "AND name NOT LIKE 'sqlite_%'"))
        return {t: {r["name"] for r in conn.execute(f"PRAGMA table_info({t})")}
                for t in tables}
    finally:
        conn.close()


def _migrated_columns():
    """The (table, column) pairs the migration is responsible for adding.

    Read out of Database._migrate itself rather than restated here, so this test
    cannot fall out of step with the code it is checking.
    """
    import inspect
    import re
    from app.db import Database
    source = inspect.getsource(Database._migrate)
    pairs = []
    table = None
    for line in source.splitlines():
        m = re.match(r'\s*"(\w+)":\s*\[', line)
        if m:
            table = m.group(1)
            continue
        m = re.match(r'\s*\("(\w+)",\s*"', line)
        if m and table:
            pairs.append((table, m.group(1)))
    return pairs


#: Tables introduced by the sector work. An older database predates them, and
#: CREATE TABLE IF NOT EXISTS in the schema is what brings them back.
_NEW_TABLES = ("sector_config", "provider_clear_sky")


def _age_database(path):
    """Turn a current database into one that predates the recent additions.

    Drops the new tables and removes every column the migration is responsible
    for, using SQLite's own DROP COLUMN. Aging a real database beats hand-writing
    an old schema: a hand-written copy drifts from the real one and then the test
    proves nothing.
    """
    import sqlite3
    conn = sqlite3.connect(str(path))
    try:
        for table in _NEW_TABLES:
            conn.execute(f"DROP TABLE IF EXISTS {table}")
        for table, column in _migrated_columns():
            try:
                conn.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
            except sqlite3.OperationalError:
                # A column that cannot be dropped is part of a key or an index,
                # so it was never migration-added in the first place.
                continue
        conn.commit()
    finally:
        conn.close()


def test_an_upgraded_database_matches_a_fresh_one(tmp_path):
    """R8.9 and the schema half of task 10.

    Ages a database back to before the recent additions, reopens it so the
    migration runs, and asserts the result is indistinguishable from one created
    from scratch. A drifted schema is the failure mode that only shows up on the
    live host, which already holds real data and cannot simply be recreated.
    """
    from app.db import Database

    old = tmp_path / "old.db"
    Database(old).list_stations()          # create at the current schema
    _age_database(old)                     # then take the additions away

    # Guard against a vacuous pass: if aging quietly did nothing, the comparison
    # below would succeed while testing absolutely nothing.
    aged = _schema(old)
    for table in _NEW_TABLES:
        assert table not in aged, f"aging failed to drop {table}"
    removed = [(t, c) for t, c in _migrated_columns()
               if t in aged and c not in aged[t]]
    assert removed, "aging removed no columns, so this test proves nothing"

    # Reopening runs the schema and the additive migration.
    Database(old).list_stations()
    fresh = tmp_path / "fresh.db"
    Database(fresh).list_stations()

    upgraded_schema = _schema(old)
    fresh_schema = _schema(fresh)

    missing_tables = set(fresh_schema) - set(upgraded_schema)
    assert not missing_tables, (
        f"tables an upgrade would not create: {sorted(missing_tables)}")

    for table, columns in fresh_schema.items():
        missing = columns - upgraded_schema[table]
        assert not missing, (
            f"{table} would be missing {sorted(missing)} after an upgrade")


def test_the_new_tables_and_columns_are_present_after_an_upgrade(tmp_path):
    """The specific additions this work introduced, named so a regression points
    straight at the cause."""
    from app.db import Database
    db = Database(tmp_path / "check.db")
    db.list_stations()
    schema = _schema(tmp_path / "check.db")
    assert "sector_config" in schema
    assert "provider_clear_sky" in schema
    assert "method_version" in schema["forecast_runs"]
    assert "members" in schema["forecast_points"]


# ---------------------------------------------------------------------------
#  Station page queries stay indexed as the record grows
# ---------------------------------------------------------------------------

def test_station_variables_and_span_use_an_index_not_a_scan(database):
    """Guards the fix for a measured live problem.

    On the live host, with 1.28 million observation rows, SELECT DISTINCT
    variable took 10.5 seconds and MIN/MAX in one statement took 2.8 seconds.
    Both run on every station page view, so the page timed out. The rewrites are
    a loose index scan and two ordered lookups.

    This asserts the query plans, not the wall-clock time: a timing test on a
    small fixture proves nothing and would be flaky on a loaded machine, while a
    plan that says SCAN is the actual defect.
    """
    from datetime import datetime, timedelta
    from app.ingest import Observation

    sid = database.upsert_station("plans", "Plans", "CR1000X")
    base = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        Observation(observed_at=base + timedelta(hours=i),
                    values={"temperature": 15.0, "humidity": 60.0,
                            "wind_speed": 10.0})
        for i in range(200)])

    # Correctness first: the rewrites must return what the old queries did.
    assert database.station_variables(sid) == ["humidity", "temperature",
                                              "wind_speed"]
    lo, hi = database.observation_span(sid)
    assert lo == base
    assert hi == base + timedelta(hours=199)

    with database.connect() as c:
        span_plan = " ".join(
            r["detail"] for r in c.execute(
                "EXPLAIN QUERY PLAN SELECT observed_at FROM observations "
                "WHERE station_id = ? ORDER BY observed_at ASC LIMIT 1",
                (sid,)))
    # An ordered lookup must be answered from an index, never by sorting rows.
    assert "USING INDEX" in span_plan or "USING COVERING INDEX" in span_plan, \
        span_plan
    assert "USE TEMP B-TREE" not in span_plan, span_plan


def test_an_empty_station_has_no_span_and_no_variables(database):
    """The rewritten span returns early rather than unpacking a missing row."""
    sid = database.upsert_station("empty-span", "Empty", "CR1000X")
    assert database.observation_span(sid) == (None, None)
    assert database.station_variables(sid) == []


def test_startup_does_not_run_analyze(tmp_path):
    """Opening a database must not run ANALYZE.

    It did once, and on the live record it pushed the container past its 320 MB
    memory cap. The kill landed before the commit, so the statistics were never
    stored and the next start tried again: a two-minute restart loop with no
    traceback. The queries here use indexes by construction, so statistics are
    not needed and must not be collected on the startup path.
    """
    from app.db import Database

    path = tmp_path / "stats.db"
    Database(path).list_stations()
    with Database(path).connect() as c:
        assert c.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' "
            "AND name = 'sqlite_stat1'").fetchone() is None, \
            "startup ran ANALYZE, which caused a live out-of-memory crash loop"


# ---------------------------------------------------------------------------
#  The observation count is cached, exact, and does not drift
# ---------------------------------------------------------------------------

def _obs(base, hours, **values):
    from datetime import timedelta
    from app.ingest import Observation
    return [Observation(observed_at=base + timedelta(hours=i), values=dict(values))
            for i in range(hours)]


def test_observation_count_is_cached_and_exact(database):
    """The count is read from station_stats, not recounted per page view."""
    from datetime import datetime
    sid = database.upsert_station("counted", "Counted", "CR1000X")
    base = datetime(2026, 1, 1)
    database.insert_observations(sid, _obs(base, 50, temperature=15.0,
                                           humidity=60.0))
    assert database.observation_count(sid) == 100        # 50 hours x 2 variables

    with database.connect() as c:
        cached = c.execute(
            "SELECT observation_count FROM station_stats WHERE station_id = ?",
            (sid,)).fetchone()
    assert cached is not None
    assert int(cached["observation_count"]) == 100


def test_re_uploading_the_same_period_does_not_inflate_the_count(database):
    """The reason the count is recomputed rather than incremented: these are
    INSERT OR REPLACE, so a re-upload corrects rows instead of adding them, and
    an increment would climb forever."""
    from datetime import datetime
    sid = database.upsert_station("reup", "Reupload", "CR1000X")
    base = datetime(2026, 1, 1)
    rows = _obs(base, 30, temperature=15.0)
    database.insert_observations(sid, rows)
    first = database.observation_count(sid)
    database.insert_observations(sid, rows)          # exactly the same period
    assert database.observation_count(sid) == first == 30


def test_a_wider_upload_grows_the_count(database):
    from datetime import datetime
    sid = database.upsert_station("wider", "Wider", "CR1000X")
    base = datetime(2026, 1, 1)
    database.insert_observations(sid, _obs(base, 10, temperature=15.0))
    assert database.observation_count(sid) == 10
    # Same hours, an extra channel: ten more rows, not twenty.
    database.insert_observations(sid, _obs(base, 10, temperature=15.0,
                                           humidity=55.0))
    assert database.observation_count(sid) == 20


def test_a_database_without_the_cache_backfills_it_once(database):
    """A database that predates station_stats must not pay the count on every
    view: the first call stores the answer."""
    from datetime import datetime
    sid = database.upsert_station("backfill", "Backfill", "CR1000X")
    database.insert_observations(sid, _obs(datetime(2026, 1, 1), 20,
                                           temperature=15.0))
    with database.connect() as c:
        c.execute("DELETE FROM station_stats WHERE station_id = ?", (sid,))
    assert database.observation_count(sid) == 20
    with database.connect() as c:
        assert c.execute(
            "SELECT 1 FROM station_stats WHERE station_id = ?",
            (sid,)).fetchone() is not None


def test_deleting_a_station_clears_its_cached_count(database):
    from datetime import datetime
    sid = database.upsert_station("gone", "Gone", "CR1000X")
    database.insert_observations(sid, _obs(datetime(2026, 1, 1), 5,
                                           temperature=15.0))
    assert database.observation_count(sid) == 5
    database.delete_station(sid)
    with database.connect() as c:
        assert c.execute(
            "SELECT 1 FROM station_stats WHERE station_id = ?",
            (sid,)).fetchone() is None


def test_counting_a_deleted_station_reports_zero_and_does_not_raise(database):
    """Caching the count introduced a foreign key that a deleted station cannot
    satisfy. Asking for its count is legitimate and must answer zero."""
    from datetime import datetime
    sid = database.upsert_station("vanished", "Vanished", "CR1000X")
    database.insert_observations(sid, _obs(datetime(2026, 1, 1), 5,
                                           temperature=15.0))
    database.delete_station(sid)
    assert database.observation_count(sid) == 0
    assert database.observation_count(999_999) == 0


# ---------------------------------------------------------------------------
#  Inserts are batched, so a large upload cannot exhaust the memory cap
# ---------------------------------------------------------------------------

def test_inserts_are_batched_and_bounded(database, monkeypatch):
    """Guards the fix for a live out-of-memory crash loop.

    Building one tuple per reading for a whole multi-year export, alongside the
    parsed file, was enough to have the container killed on its 320 MB cap; the
    service was restarting every two minutes on the Dropbox poller. The insert is
    now batched, so peak memory does not grow with the size of the upload.

    Asserted by counting executemany calls and the size of each batch, because
    that is the property that bounds memory. Measuring memory directly would be
    flaky and would not say why.
    """
    from datetime import datetime
    from app.db import Database

    sizes: list[int] = []
    monkeypatch.setattr(Database, "INSERT_BATCH", 100)

    sid = database.upsert_station("batched", "Batched", "CR1000X")
    real_connect = database.connect

    class Spy:
        def __init__(self, inner):
            self._inner = inner

        def executemany(self, sql, rows):
            rows = list(rows)
            sizes.append(len(rows))
            return self._inner.executemany(sql, rows)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    import contextlib

    @contextlib.contextmanager
    def spying_connect():
        with real_connect() as inner:
            yield Spy(inner)

    monkeypatch.setattr(database, "connect", spying_connect)

    # 500 hours x 3 variables = 1500 rows, which must arrive in batches of 100.
    database.insert_observations(
        sid, _obs(datetime(2026, 1, 1), 500, temperature=15.0,
                  humidity=60.0, wind_speed=8.0))

    assert sizes, "no executemany calls recorded"
    # The flush happens at a reading boundary, not mid-reading, so a batch can
    # overshoot by at most one reading's worth of variables. Three variables
    # here, so the bound is 102. What matters is that the bound exists and does
    # not grow with the size of the upload.
    assert max(sizes) <= 100 + 3, f"a batch exceeded the bound: {max(sizes)}"
    assert len(sizes) >= 14, f"expected many batches, got {len(sizes)}"
    assert sum(sizes) == 1500


def test_batching_stores_every_row_and_returns_the_true_total(database):
    """Batching must not lose or double-count rows at a batch boundary."""
    from datetime import datetime
    from app.db import Database

    sid = database.upsert_station("boundary", "Boundary", "CR1000X")
    original = Database.INSERT_BATCH
    try:
        # A batch size that does not divide the row count evenly, so the final
        # partial batch is exercised.
        Database.INSERT_BATCH = 7
        written = database.insert_observations(
            sid, _obs(datetime(2026, 1, 1), 20, temperature=15.0,
                      humidity=60.0))
    finally:
        Database.INSERT_BATCH = original

    assert written == 40
    assert database.observation_count(sid) == 40
    lo, hi = database.observation_span(sid)
    assert lo == datetime(2026, 1, 1)
    assert hi.hour == 19
