"""Detector telemetry: CPU-load parsing and calibration payload (Task 5.3).

Hardware modules are stubbed by conftest so the module imports off-target.
"""
import io
import json
import types
import logging

import lightning_detector as ld


# ---------------------------------------------------------------------------
# get_cpu_load_pct parsing
# ---------------------------------------------------------------------------

def test_cpu_load_parses_loadavg(monkeypatch):
    monkeypatch.setattr(ld.os, "cpu_count", lambda: 1)
    monkeypatch.setattr(
        ld, "open",
        lambda *a, **k: io.StringIO("0.50 0.40 0.30 1/123 4567"),
        raising=False,
    )
    assert ld.get_cpu_load_pct() == 50.0


def test_cpu_load_scales_by_cores(monkeypatch):
    monkeypatch.setattr(ld.os, "cpu_count", lambda: 4)
    monkeypatch.setattr(
        ld, "open",
        lambda *a, **k: io.StringIO("2.00 1.0 0.5 1/1 1"),
        raising=False,
    )
    # 2.0 load over 4 cores -> 50%
    assert ld.get_cpu_load_pct() == 50.0


def test_cpu_load_unavailable_returns_sentinel(monkeypatch):
    def _boom(*a, **k):
        raise IOError("no /proc on this platform")
    monkeypatch.setattr(ld, "open", _boom, raising=False)
    assert ld.get_cpu_load_pct() == -1.0


# ---------------------------------------------------------------------------
# Calibration webhook payload construction (network mocked)
# ---------------------------------------------------------------------------

class _Resp:
    status = 200
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


def _make_detector_stub():
    """A minimal object exposing what the webhook methods need."""
    cfg = ld.Config()
    cfg.STATION_ID = "GWLD1"
    cfg.ALERT_WEBHOOK_ENABLED = True
    cfg.CALIBRATION_REPORT_ENABLED = True
    cfg.ALERT_WEBHOOK_URL = "https://panel.example.com/api/v1/lightning"
    cfg.ALERT_WEBHOOK_TOKEN = "secret"
    cfg.ALERT_WEBHOOK_TIMEOUT = 5

    obj = types.SimpleNamespace(config=cfg, logger=logging.getLogger("test"))
    # Bind the methods under test to the stub.
    obj._calibration_url = types.MethodType(ld.LightningDetector._calibration_url, obj)
    obj._calibration_webhook = types.MethodType(ld.LightningDetector._calibration_webhook, obj)
    return obj


def test_calibration_url_derivation():
    obj = _make_detector_stub()
    assert obj._calibration_url() == "https://panel.example.com/api/v1/calibration"


def test_calibration_webhook_builds_payload(monkeypatch):
    obj = _make_detector_stub()
    captured = {}

    def _fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = json.loads(req.data.decode("utf-8"))
        captured["token"] = req.get_header("X-auth-token")
        return _Resp()

    monkeypatch.setattr(ld.urllib.request, "urlopen", _fake_urlopen)

    obj._calibration_webhook(
        kind="antenna_check", reason="scheduled", cpu_temp_c=44.25,
        freq_hz=496000, in_tolerance=False, tune_cap_before=7, tune_cap_after=8,
    )

    assert captured["url"].endswith("/api/v1/calibration")
    assert captured["token"] == "secret"
    body = captured["body"]
    assert body["station_id"] == "GWLD1"
    assert body["kind"] == "antenna_check"
    assert body["in_tolerance"] is False
    assert body["freq_hz"] == 496000
    assert body["tune_cap_before"] == 7 and body["tune_cap_after"] == 8
    assert body["cpu_temp_c"] == 44.2  # rounded to 1 dp


def test_calibration_webhook_skipped_when_disabled(monkeypatch):
    obj = _make_detector_stub()
    obj.config.CALIBRATION_REPORT_ENABLED = False
    called = {"n": 0}

    def _fake_urlopen(req, timeout=None):
        called["n"] += 1
        return _Resp()

    monkeypatch.setattr(ld.urllib.request, "urlopen", _fake_urlopen)
    obj._calibration_webhook(kind="rc_recal", reason="interval", cpu_temp_c=40.0)
    assert called["n"] == 0  # no network call when disabled
