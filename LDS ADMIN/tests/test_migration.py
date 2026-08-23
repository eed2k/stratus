"""Schema top-up (add_missing_columns) idempotency on a populated database.

Simulates an older unit_status table that predates the metadata columns, then
checks that add_missing_columns adds them, preserves existing rows, and is safe
to run repeatedly.
"""
from sqlalchemy import create_engine, text, inspect


def _legacy_engine(tmp_path):
    # A standalone SQLite file with an old-shape unit_status table.
    url = f"sqlite:///{tmp_path.as_posix()}/legacy.db"
    eng = create_engine(url)
    with eng.begin() as conn:
        conn.execute(text(
            "CREATE TABLE unit_status ("
            "station_id VARCHAR(64) PRIMARY KEY, "
            "tenant_id INTEGER, "
            "last_seen DATETIME, "
            "last_kind VARCHAR(16), "
            "cpu_temp_c FLOAT, "
            "rssi_dbm INTEGER)"
        ))
        conn.execute(text(
            "INSERT INTO unit_status (station_id, tenant_id, cpu_temp_c) "
            "VALUES ('GWLD1', 1, 41.5)"
        ))
    return eng


def test_add_missing_columns_is_idempotent(tmp_path, monkeypatch):
    import app.bootstrap as bootstrap

    eng = _legacy_engine(tmp_path)
    # Point the migration at our legacy engine.
    monkeypatch.setattr(bootstrap, "engine", eng)

    # Before: the new columns do not exist.
    cols_before = {c["name"] for c in inspect(eng).get_columns("unit_status")}
    assert "site_label" not in cols_before
    assert "latitude" not in cols_before

    # First run adds them.
    bootstrap.add_missing_columns()
    cols_after = {c["name"] for c in inspect(eng).get_columns("unit_status")}
    assert {"site_label", "latitude", "longitude", "altitude_m"} <= cols_after

    # Existing row survived untouched.
    with eng.begin() as conn:
        row = conn.execute(text(
            "SELECT station_id, tenant_id, cpu_temp_c FROM unit_status"
        )).fetchone()
    assert row[0] == "GWLD1"
    assert row[1] == 1
    assert abs(row[2] - 41.5) < 1e-6

    # Second run is a no-op (must not raise).
    bootstrap.add_missing_columns()
    cols_again = {c["name"] for c in inspect(eng).get_columns("unit_status")}
    assert cols_after == cols_again
