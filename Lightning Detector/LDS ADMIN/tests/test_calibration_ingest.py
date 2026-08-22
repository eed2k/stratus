"""Calibration ingest endpoint (Task 4)."""
TOKEN = {"X-Auth-Token": "test-token"}


def test_calibration_rc_recal_stored_under_unit_tenant(client, db_session):
    from app.models import CalibrationEvent
    from app.bootstrap import platform_tenant_id

    # A unit must exist so its tenant can be resolved; register via heartbeat.
    assert client.post("/api/v1/heartbeat", headers=TOKEN,
                       json={"station_id": "GWLD1", "cpu_temp_c": 40.0}
                       ).status_code == 200

    r = client.post("/api/v1/calibration", headers=TOKEN, json={
        "station_id": "GWLD1", "kind": "rc_recal",
        "reason": "temp_delta", "cpu_temp_c": 44.2,
    })
    assert r.status_code == 200

    ev = (db_session.query(CalibrationEvent)
          .filter(CalibrationEvent.station_id == "GWLD1").one())
    assert ev.kind == "rc_recal"
    assert ev.reason == "temp_delta"
    assert ev.tenant_id == platform_tenant_id(db_session)


def test_calibration_antenna_check_fields(client, db_session):
    from app.models import CalibrationEvent

    client.post("/api/v1/heartbeat", headers=TOKEN,
                json={"station_id": "GWLD1", "cpu_temp_c": 40.0})

    r = client.post("/api/v1/calibration", headers=TOKEN, json={
        "station_id": "GWLD1", "kind": "antenna_check",
        "reason": "scheduled", "freq_hz": 496000, "in_tolerance": True,
        "tune_cap_before": 7, "tune_cap_after": 7,
    })
    assert r.status_code == 200

    ev = (db_session.query(CalibrationEvent)
          .filter(CalibrationEvent.kind == "antenna_check").one())
    assert ev.freq_hz == 496000
    assert ev.in_tolerance is True
    assert ev.tune_cap_before == 7 and ev.tune_cap_after == 7


def test_calibration_unknown_kind_defaults(client, db_session):
    from app.models import CalibrationEvent

    client.post("/api/v1/heartbeat", headers=TOKEN,
                json={"station_id": "GWLD1", "cpu_temp_c": 40.0})
    r = client.post("/api/v1/calibration", headers=TOKEN,
                    json={"station_id": "GWLD1", "kind": "bogus"})
    assert r.status_code == 200
    ev = db_session.query(CalibrationEvent).one()
    assert ev.kind == "rc_recal"  # unknown kind folds to a safe default


def test_calibration_rejects_bad_token(client):
    r = client.post("/api/v1/calibration",
                    headers={"X-Auth-Token": "wrong"},
                    json={"station_id": "GWLD1", "kind": "rc_recal"})
    assert r.status_code == 401
