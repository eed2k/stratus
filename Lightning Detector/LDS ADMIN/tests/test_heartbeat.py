"""Heartbeat ingest: retention pruning (Task 3) and CPU-load backward
compatibility (Property 8)."""
from datetime import timedelta

TOKEN = {"X-Auth-Token": "test-token"}


def _post_hb(client, **fields):
    body = {"station_id": "GWLD1"}
    body.update(fields)
    return client.post("/api/v1/heartbeat", headers=TOKEN, json=body)


def test_heartbeat_prunes_beyond_retention(client, db_session):
    from app.models import HeartbeatSample
    from app.timeutil import now_sast

    # Register the unit and store one recent sample.
    assert _post_hb(client, cpu_temp_c=40.0, cpu_load_pct=12.5).status_code == 200

    # Inject an ancient sample well beyond the 70-day retention window.
    db_session.add(HeartbeatSample(
        station_id="GWLD1", ts=now_sast() - timedelta(days=120), cpu_temp_c=30.0))
    db_session.commit()

    # A new heartbeat triggers the prune.
    assert _post_hb(client, cpu_temp_c=41.0, cpu_load_pct=15.0).status_code == 200

    rows = (db_session.query(HeartbeatSample)
            .filter(HeartbeatSample.station_id == "GWLD1").all())
    assert rows, "recent samples should survive"
    # Nothing older than the retention window remains.
    assert all((now_sast() - s.ts).days < 70 for s in rows)


def test_heartbeat_stores_cpu_load_when_present(client, db_session):
    from app.models import HeartbeatSample

    assert _post_hb(client, cpu_temp_c=42.0, cpu_load_pct=33.0).status_code == 200
    sample = (db_session.query(HeartbeatSample)
              .filter(HeartbeatSample.station_id == "GWLD1")
              .order_by(HeartbeatSample.id.desc()).first())
    assert sample is not None
    assert sample.cpu_load_pct == 33.0


def test_heartbeat_accepts_missing_cpu_load(client, db_session):
    # Older detectors send no cpu_load_pct; the panel must still accept it and
    # store a null load (Property 8, backward compatibility).
    from app.models import HeartbeatSample

    assert _post_hb(client, cpu_temp_c=39.5).status_code == 200
    sample = (db_session.query(HeartbeatSample)
              .filter(HeartbeatSample.station_id == "GWLD1")
              .order_by(HeartbeatSample.id.desc()).first())
    assert sample is not None
    assert sample.cpu_load_pct is None


def test_heartbeat_rejects_bad_token(client):
    r = client.post("/api/v1/heartbeat",
                    headers={"X-Auth-Token": "wrong"},
                    json={"station_id": "GWLD1", "cpu_temp_c": 40.0})
    assert r.status_code == 401
