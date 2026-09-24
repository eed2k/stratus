"""Test mode: the commissioning state in which this detector stops filtering.

Every assertion here is about ending the state, not entering it. While test mode
is on the unit reports disturbers, fires on a single event, and both the
interference guard and the validation buffer stand aside, so the failure that
matters is a detector left in it: filtering nothing, alerting on RFI, and looking
perfectly healthy while it does.

Three things end it, and none depends on the others: the local deadline, the
panel's answer, and a restart.
"""
import time
import types

import pytest

import quaggasklip_detector as qd


class _NullLogger:
    def debug(self, *a, **k): pass
    def info(self, *a, **k): pass
    def warning(self, *a, **k): pass
    def error(self, *a, **k): pass
    def critical(self, *a, **k): pass


class _Sensor:
    """Records the register writes test mode makes and unmakes."""

    def __init__(self):
        self.mask_disturber = True
        self.min_strikes = 5
        self.writes = []
        self.fail = False

    def set_mask_disturber(self, mask):
        if self.fail:
            raise OSError("simulated SPI failure")
        self.mask_disturber = mask
        self.writes.append(("mask_disturber", mask))

    def set_min_strikes(self, strikes):
        if self.fail:
            raise OSError("simulated SPI failure")
        self.min_strikes = strikes
        self.writes.append(("min_strikes", strikes))

    def get_noise_floor(self):
        return 4


class _Stub:
    """Just enough of the detector to run the test-mode machinery.

    Methods and the `_testing` property are taken from the real class, so these
    tests exercise shipped code rather than a copy of it.
    """
    _testing = qd.QuaggasklipDetector._testing
    _panel_url = qd.QuaggasklipDetector._panel_url
    _poll_panel_config = qd.QuaggasklipDetector._poll_panel_config
    _enter_test_mode = qd.QuaggasklipDetector._enter_test_mode
    _exit_test_mode = qd.QuaggasklipDetector._exit_test_mode
    _apply_test_registers = qd.QuaggasklipDetector._apply_test_registers
    _service_test_mode = qd.QuaggasklipDetector._service_test_mode
    _interference_check = qd.QuaggasklipDetector._interference_check
    _buffer_strike = qd.QuaggasklipDetector._buffer_strike

    def __init__(self, answer=None, **cfg):
        from collections import deque
        self.config = qd.Config()
        self.config.ALERT_WEBHOOK_ENABLED = True
        self.config.ALERT_WEBHOOK_URL = \
            "https://panel.example/quaggasklip/api/v1/lightning"
        self.config.ALERT_WEBHOOK_TOKEN = "t"
        for key, value in cfg.items():
            setattr(self.config, key.upper(), value)
        self.logger = _NullLogger()
        self.sensor = _Sensor()
        self._test_mode_until = 0.0
        self._last_config_poll = 0.0
        self._recent_strikes = deque()
        self._interference_until = 0.0
        self._validation_buffer = []
        self._validation_flush_time = 0.0
        self._last_varied_distance_ts = 0.0
        # What the panel will answer, and what was asked.
        self.answer = answer
        self.polled = []

    def _get_panel(self, url, what):
        self.polled.append(url)
        return self.answer


# ---------------------------------------------------------------------------
# The deadline
# ---------------------------------------------------------------------------

def test_a_fresh_detector_is_not_testing():
    """Test mode is held in memory only, so a restart comes up filtering.

    A unit that could boot into test mode after an unattended reboot would sit
    there alerting on interference with nobody aware it had been left armed.
    """
    stub = _Stub()
    assert stub._testing is False
    assert stub._test_mode_until == 0.0


def test_entering_sets_a_deadline_and_makes_the_sensor_credulous():
    stub = _Stub()
    stub._enter_test_mode(600)
    assert stub._testing is True
    assert stub.sensor.mask_disturber is False
    assert stub.sensor.min_strikes == 1


def test_entering_twice_does_not_rewrite_the_registers():
    """A poll every minute must not mean an SPI write every minute."""
    stub = _Stub()
    stub._enter_test_mode(600)
    writes = len(stub.sensor.writes)
    stub._enter_test_mode(600)
    stub._enter_test_mode(600)
    assert len(stub.sensor.writes) == writes


def test_a_later_poll_extends_the_same_window():
    stub = _Stub()
    stub._enter_test_mode(60)
    first = stub._test_mode_until
    stub._enter_test_mode(600)
    assert stub._test_mode_until > first


def test_exiting_restores_the_configured_filtering():
    stub = _Stub()
    stub._enter_test_mode(600)
    stub._exit_test_mode("test")
    assert stub._testing is False
    assert stub.sensor.mask_disturber == stub.config.MASK_DISTURBER
    assert stub.sensor.min_strikes == stub.config.MIN_STRIKES


def test_the_window_closes_on_its_own_deadline(monkeypatch):
    """Closed by the loop, not by the next poll: the window has to end on time
    even when the panel has become unreachable."""
    stub = _Stub()
    stub._enter_test_mode(600)
    # Move the deadline into the past rather than waiting ten minutes.
    stub._test_mode_until = time.monotonic() - 0.01
    stub._service_test_mode()
    assert stub._testing is False
    assert stub.sensor.mask_disturber == stub.config.MASK_DISTURBER


def test_servicing_does_nothing_when_it_was_never_on():
    stub = _Stub()
    stub._service_test_mode()
    assert stub.sensor.writes == []


def test_a_failed_register_restore_is_reported_not_swallowed():
    """The sensor is left more sensitive than configured, which produces false
    alerts. That needs a restart, so it cannot be logged at debug and forgotten."""
    stub = _Stub()
    stub._enter_test_mode(600)
    stub.sensor.fail = True
    errors = []
    stub.logger = types.SimpleNamespace(
        debug=lambda *a, **k: None, info=lambda *a, **k: None,
        warning=lambda *a, **k: None, critical=lambda *a, **k: None,
        error=lambda *a, **k: errors.append(a))
    stub._exit_test_mode("test")
    assert errors, "a failed restore was silent"


# ---------------------------------------------------------------------------
# The poll
# ---------------------------------------------------------------------------

def test_the_poll_asks_the_right_endpoint_for_this_station():
    stub = _Stub(answer={"test_mode": False, "test_mode_s": 0})
    stub._poll_panel_config()
    assert len(stub.polled) == 1
    url = stub.polled[0]
    assert url.startswith("https://panel.example/quaggasklip/api/v1/"
                          "detector/config?")
    assert "station_id=QUAGGASKLIP" in url


def test_the_poll_is_rate_limited():
    stub = _Stub(answer={"test_mode_s": 0})
    for _ in range(50):
        stub._poll_panel_config()
    assert len(stub.polled) == 1


def test_a_positive_answer_starts_test_mode():
    stub = _Stub(answer={"test_mode": True, "test_mode_s": 600})
    stub._poll_panel_config()
    assert stub._testing is True
    assert 0 < stub._test_mode_until - time.monotonic() <= 600


def test_a_zero_answer_ends_test_mode():
    stub = _Stub(answer={"test_mode": True, "test_mode_s": 600})
    stub._poll_panel_config()
    stub.answer = {"test_mode": False, "test_mode_s": 0}
    stub._last_config_poll = 0.0
    stub._poll_panel_config()
    assert stub._testing is False
    assert stub.sensor.mask_disturber == stub.config.MASK_DISTURBER


def test_an_unreachable_panel_changes_nothing():
    """A failed poll must leave the detector doing what it was already doing.
    The deadline it already holds keeps running down, so losing the panel
    mid-test ends the test rather than stranding the unit in it."""
    stub = _Stub(answer={"test_mode_s": 600})
    stub._poll_panel_config()
    deadline = stub._test_mode_until

    stub.answer = None                    # panel unreachable
    stub._last_config_poll = 0.0
    stub._poll_panel_config()
    assert stub._test_mode_until == deadline
    assert stub._testing is True

    stub._test_mode_until = time.monotonic() - 0.01
    stub._service_test_mode()
    assert stub._testing is False


def test_the_local_ceiling_beats_whatever_the_panel_asks_for():
    """Two independent limits on purpose: a panel-side mistake, or anything else
    that can answer that URL, must not be able to hold this unit open."""
    stub = _Stub(answer={"test_mode_s": 86400})
    stub._poll_panel_config()
    assert stub._test_mode_until - time.monotonic() \
        <= stub.config.TEST_MODE_MAX_S


def test_a_rubbish_answer_reads_as_not_testing():
    for answer in ({}, {"test_mode_s": None}, {"test_mode_s": "soon"},
                   {"test_mode_s": -5}, {"test_mode": True}):
        stub = _Stub(answer=answer)
        stub._poll_panel_config()
        assert stub._testing is False, answer


def test_the_poll_can_be_switched_off():
    stub = _Stub(answer={"test_mode_s": 600}, test_mode_poll_enabled=False)
    stub._poll_panel_config()
    assert stub.polled == []
    assert stub._testing is False


def test_no_poll_without_a_configured_panel():
    stub = _Stub(answer={"test_mode_s": 600}, alert_webhook_enabled=False)
    stub._poll_panel_config()
    assert stub.polled == []


# ---------------------------------------------------------------------------
# The bypasses
# ---------------------------------------------------------------------------

def test_the_interference_guard_stands_aside_while_testing():
    stub = _Stub()
    stub._enter_test_mode(600)
    for _ in range(stub.config.INTERFERENCE_STRIKE_LIMIT * 3):
        assert stub._interference_check() is False


def test_a_bench_burst_does_not_prime_the_rate_window():
    """Counting bench events would leave the window primed when the test ends, so
    the first genuine strike afterwards would be muted as interference. The test
    would have created the failure it was meant to rule out."""
    stub = _Stub()
    stub._enter_test_mode(600)
    for _ in range(stub.config.INTERFERENCE_STRIKE_LIMIT * 3):
        stub._interference_check()
    assert len(stub._recent_strikes) == 0

    stub._exit_test_mode("test")
    assert stub._interference_check() is False


def test_the_validation_buffer_stands_aside_while_testing():
    """The buffer discards runs of 1 km events with no storm geometry, which is
    exactly what a bench test looks like."""
    stub = _Stub()
    stub._enter_test_mode(600)
    assert stub._buffer_strike(1, 100) is False
    assert stub._validation_buffer == []


def test_both_filters_come_back_when_the_window_closes():
    stub = _Stub()
    stub._enter_test_mode(600)
    stub._test_mode_until = time.monotonic() - 0.01
    stub._service_test_mode()

    assert stub._buffer_strike(1, 100) is True      # held again
    muted = [stub._interference_check()
             for _ in range(stub.config.INTERFERENCE_STRIKE_LIMIT)]
    assert muted[-1] is True


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _validator():
    stub = types.SimpleNamespace(
        _CONFIG_VALIDATORS=qd.QuaggasklipDetector._CONFIG_VALIDATORS)
    stub._validate_config_value = types.MethodType(
        qd.QuaggasklipDetector._validate_config_value, stub)
    return stub


def test_the_defaults_are_conservative():
    cfg = qd.Config()
    assert cfg.TEST_MODE_POLL_ENABLED is True
    assert cfg.TEST_MODE_POLL_INTERVAL == 60
    # One hour, matching the panel's own ceiling.
    assert cfg.TEST_MODE_MAX_S == 3600


def test_the_new_settings_are_range_checked():
    v = _validator()
    assert v._validate_config_value("TEST_MODE_MAX_S", 1800) is True
    assert v._validate_config_value("TEST_MODE_MAX_S", 86400) is False
    assert v._validate_config_value("TEST_MODE_MAX_S", 0) is False
    assert v._validate_config_value("TEST_MODE_POLL_INTERVAL", 60) is True
    assert v._validate_config_value("TEST_MODE_POLL_INTERVAL", 1) is False
    assert v._validate_config_value("TEST_MODE_POLL_ENABLED", True) is True
    assert v._validate_config_value("TEST_MODE_POLL_ENABLED", 1) is False


def test_the_ceiling_cannot_be_raised_past_an_hour_from_the_config_file():
    """The config file is on the unit, so it is the one limit a field engineer
    could change. It is capped at the same hour the panel enforces."""
    v = _validator()
    assert v._validate_config_value("TEST_MODE_MAX_S", 3600) is True
    assert v._validate_config_value("TEST_MODE_MAX_S", 3601) is False
