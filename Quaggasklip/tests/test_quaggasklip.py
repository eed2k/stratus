"""Quaggasklip detector logic tests.

Focused on the parts that would silently do the wrong thing in the field:
the on-wire record format the CR300 parses, the socket-2 pin defaults, config
validation, panel URL derivation, and the two filters that decide whether an
alert is sent at all.
"""
import types

import pytest

import quaggasklip_detector as qd
from conftest import FakeSerial


# ---------------------------------------------------------------------------
# Campbell record format - the CR300 program parses these byte for byte
# ---------------------------------------------------------------------------

def test_lightning_record_matches_the_crbasic_format():
    """SerialInRecord uses BeginWord 'L' and EndWord CRLF, and SplitStr on ','."""
    assert qd.CampbellLink.format_lightning(7, 850000) == "L,7,850000\r\n"


def test_heartbeat_record_matches_the_crbasic_format():
    assert qd.CampbellLink.format_heartbeat(44.5, -61) == "H,44.5,-61\r\n"


def test_records_end_with_real_cr_lf():
    """A missing CR would leave the logger waiting for its EndWord forever."""
    for record in (qd.CampbellLink.format_lightning(1, 2),
                   qd.CampbellLink.format_heartbeat(1.0, -1)):
        assert record.endswith("\r\n")
        assert record.count("\r") == 1 and record.count("\n") == 1


def test_out_of_range_distance_is_minus_one_on_the_wire():
    """The sensor's 0x3F becomes -1 for the logger, as on the GWLD1 unit."""
    assert qd.CampbellLink.format_lightning(-1, 500) == "L,-1,500\r\n"


def test_heartbeat_rounds_cpu_temperature_to_one_decimal():
    assert qd.CampbellLink.format_heartbeat(44.4567, -61) == "H,44.5,-61\r\n"


@pytest.mark.parametrize("bad", [None, "", "abc", object()])
def test_record_formatting_survives_rubbish_input(bad):
    """A malformed record would desynchronize the logger's parser, so coerce."""
    lightning = qd.CampbellLink.format_lightning(bad, bad)
    heartbeat = qd.CampbellLink.format_heartbeat(bad, bad)
    assert lightning.startswith("L,") and lightning.endswith("\r\n")
    assert heartbeat.startswith("H,") and heartbeat.endswith("\r\n")
    for record in (lightning, heartbeat):
        assert len(record.split(",")) == 3


# ---------------------------------------------------------------------------
# Campbell link behavior
# ---------------------------------------------------------------------------

def _link(**overrides):
    """A CampbellLink over the FakeSerial stub."""
    cfg = qd.Config()
    for k, v in overrides.items():
        setattr(cfg, k.upper(), v)
    link = qd.CampbellLink(cfg, _NullLogger())
    link.open()
    return link


class _NullLogger:
    """Swallows log calls, and records warnings for assertions."""

    def __init__(self):
        self.warnings = []
        self.errors = []

    def info(self, *a, **k):
        pass

    def debug(self, *a, **k):
        pass

    def warning(self, msg, *a, **k):
        self.warnings.append(msg % a if a else msg)

    def error(self, msg, *a, **k):
        self.errors.append(msg % a if a else msg)


def test_link_opens_the_configured_port_with_8n1():
    link = _link()
    assert link.active
    assert link._ser.kwargs["baudrate"] == 9600
    assert link._ser.kwargs["bytesize"] == 8
    assert link._ser.kwargs["parity"] == "N"
    assert link._ser.kwargs["stopbits"] == 1
    # Reads must not block the detection loop.
    assert link._ser.kwargs["timeout"] == 0
    assert link._ser.kwargs["write_timeout"] == 0.5


def test_link_writes_and_flushes_each_record():
    """Unflushed bytes can sit in the OS buffer past the logger's scan window."""
    link = _link()
    link.send_lightning(12, 999)
    assert link._ser.text() == "L,12,999\r\n"
    assert link._ser.flushed == 1
    assert link.records_sent == 1


def test_disabled_link_writes_nothing():
    link = _link(campbell_enabled=False)
    assert not link.active
    link.send_lightning(5, 100)          # must not raise
    assert link.records_sent == 0


def test_write_failure_does_not_raise_and_is_counted():
    """An unplugged logger must never cost a strike."""
    link = _link()
    link._ser.fail_writes = True
    for _ in range(3):
        link.send_lightning(5, 100)      # no exception escapes
    assert link.records_sent == 0
    assert link._write_failures == 3
    # First failure logged, the next two suppressed so a storm cannot flood it.
    assert len(link.logger.warnings) == 1


def test_write_failures_are_logged_again_every_fiftieth():
    link = _link()
    link._ser.fail_writes = True
    for _ in range(50):
        link.send_lightning(5, 100)
    assert len(link.logger.warnings) == 2      # the 1st and the 50th


def test_poll_returns_complete_lines_only():
    link = _link()
    link._ser.feed("HELLO\r\npartial")
    assert link.poll() == ["HELLO"]
    # The fragment is held until its newline arrives.
    link._ser.feed("-rest\n")
    assert link.poll() == ["partial-rest"]


def test_poll_bounds_the_buffer_when_no_newline_ever_arrives():
    """A babbling logger must not grow memory without limit."""
    link = _link(campbell_read_max_line=32)
    link._ser.feed("x" * 500)
    assert link.poll() == []
    assert len(link._rx) <= 32


def test_poll_is_silent_when_reading_is_disabled():
    link = _link(campbell_read_enabled=False)
    link._ser.feed("SOMETHING\r\n")
    assert link.poll() == []


# ---------------------------------------------------------------------------
# Socket 2 wiring - the whole point of this variant
# ---------------------------------------------------------------------------

def test_sensor_defaults_to_socket_one_chip_select():
    """The Thunder Click is in socket 1, whose CS is CE0, so spidev device 0.

    Measured on the assembled unit, not inferred: the AS3935 answers on SPI 0.0
    and its interrupt was found on GPIO6, which is socket 1 INT on a Pi 2 shield.
    Socket 2 holds the Terminal 2 Click that carries the serial line to the CR300.
    """
    cfg = qd.Config()
    assert cfg.SPI_BUS == 0
    assert cfg.SPI_DEVICE == 0


def test_irq_is_the_pin_the_interrupt_was_measured_on():
    """GPIO6, socket 1 INT on a Pi 2 shield, established by measurement.

    THE FAULT THIS LOCKS OUT: the unit ran with irq_pin 17 and had never detected
    a single strike in its life. It reported itself healthy throughout, because
    nothing in the program can tell a silent interrupt line from a quiet sky. The
    pin was found by driving the sensor's LCO and counting edges across every
    candidate GPIO; only GPIO6 carried the clock.

    17 is socket 1 INT on a Pi 3 shield and 12 is routed to neither socket on a
    Pi 2 shield, so both look plausible in a datasheet and neither can ever work
    on this unit.
    """
    cfg = qd.Config()
    assert cfg.IRQ_PIN == 6
    assert cfg.IRQ_PIN != 17
    assert cfg.IRQ_PIN != 12


def test_pulse_mirror_is_the_socket_two_rst_terminal_that_is_wired():
    """GPIO19 is socket 2 RST, the terminal actually landed on the CR300 P_SW.

    The earlier rule here was to avoid GPIO19/20/21 because a Pi 3 shield uses
    them for its MCP3204 ADC over SPI1. This is a Pi 2 shield with no ADC, so
    those pins are free, and 19 is the one brought out to a screw terminal next to
    the serial line. Avoiding it would mean no pulse wire at all.
    """
    cfg = qd.Config()
    assert cfg.PULSE_MIRROR_PIN == 19


def test_pulse_mirror_and_serial_do_not_share_a_pin():
    """Both come off socket 2: serial on INT/GPIO26, pulse on RST/GPIO19."""
    cfg = qd.Config()
    assert cfg.PULSE_MIRROR_PIN != cfg.CAMPBELL_TX_PIN
    assert cfg.PULSE_MIRROR_PIN != cfg.IRQ_PIN
    assert cfg.CAMPBELL_TX_PIN != cfg.IRQ_PIN


def test_serial_does_not_use_the_contended_hardware_uart_pin():
    """BCM14 is shared with the USB HUB HAT's CP2102 bridge.

    Records transmitted on BCM14 never reached the logger, through three separate
    transmit methods, while BCM26 delivered every byte of a five record burst.
    """
    cfg = qd.Config()
    assert cfg.CAMPBELL_TX_PIN == 26
    assert cfg.CAMPBELL_TX_PIN != 14


def test_campbell_defaults_to_the_hardware_uart():
    cfg = qd.Config()
    assert cfg.CAMPBELL_TRANSPORT == "serial"
    assert cfg.CAMPBELL_PORT == "/dev/serial0"
    assert cfg.CAMPBELL_BAUD == 9600


def test_station_identity_is_set_for_this_site():
    cfg = qd.Config()
    assert cfg.STATION_ID == "QUAGGASKLIP"
    assert "Quaggasklip" in cfg.SITE_NAME


# ---------------------------------------------------------------------------
# Config validation
# ---------------------------------------------------------------------------

def _validator():
    """A detector stub carrying just enough to run the validator."""
    stub = types.SimpleNamespace(
        _CONFIG_VALIDATORS=qd.QuaggasklipDetector._CONFIG_VALIDATORS)
    stub._validate_config_value = types.MethodType(
        qd.QuaggasklipDetector._validate_config_value, stub)
    return stub


@pytest.mark.parametrize("key,value", [
    ("IRQ_PIN", 12),
    ("SPI_DEVICE", 1),
    ("CAMPBELL_TRANSPORT", "serial"),
    ("CAMPBELL_TRANSPORT", "bitbang"),
    ("CAMPBELL_WRITE_TIMEOUT", 0.5),
    ("CAMPBELL_WRITE_TIMEOUT", 1),        # a whole number is a valid float
    ("MIN_STRIKES", 5),
    ("FREQ_DIV_RATIO", 16),
    ("MASK_DISTURBER", True),
])
def test_valid_config_values_are_accepted(key, value):
    assert _validator()._validate_config_value(key, value) is True


@pytest.mark.parametrize("key,value", [
    ("IRQ_PIN", 99),                      # out of range
    ("IRQ_PIN", "12"),                    # a string, not an int
    ("SPI_DEVICE", 2),                    # only CE0 and CE1 exist
    ("CAMPBELL_TRANSPORT", "usb"),        # not a supported transport
    ("MIN_STRIKES", 3),                   # not one of 1/5/9/16
    ("FREQ_DIV_RATIO", 24),               # not one of 16/32/64/128
    ("NOISE_FLOOR", 8),                   # 0-7 only
    ("CAMPBELL_WRITE_TIMEOUT", 99.0),     # would stall the loop
])
def test_invalid_config_values_are_rejected(key, value):
    assert _validator()._validate_config_value(key, value) is False


def test_a_boolean_is_not_accepted_where_a_number_is_expected():
    """bool subclasses int in Python, so `true` would otherwise become 1."""
    assert _validator()._validate_config_value("IRQ_PIN", True) is False


def test_unknown_keys_carry_no_range_rule():
    """Strings, paths and URLs are accepted as-is."""
    assert _validator()._validate_config_value("STATION_ID", "ANYTHING") is True


# ---------------------------------------------------------------------------
# Panel URL derivation - one configured URL must drive all three endpoints
# ---------------------------------------------------------------------------

def _detector_stub(url="", token="", enabled=True):
    cfg = qd.Config()
    cfg.ALERT_WEBHOOK_URL = url
    cfg.ALERT_WEBHOOK_TOKEN = token
    cfg.ALERT_WEBHOOK_ENABLED = enabled
    stub = types.SimpleNamespace(config=cfg, logger=_NullLogger())
    stub._panel_url = types.MethodType(qd.QuaggasklipDetector._panel_url, stub)
    return stub


def test_heartbeat_and_calibration_urls_are_derived_from_the_alert_url():
    stub = _detector_stub(
        "https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/lightning")
    base = "https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/"
    assert stub._panel_url("heartbeat") == base + "heartbeat"
    assert stub._panel_url("calibration") == base + "calibration"


def test_derived_urls_keep_the_tenant_prefix():
    """Dropping /quaggasklip/ would file this site's data under another tenant."""
    stub = _detector_stub(
        "https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/lightning")
    assert "/quaggasklip/" in stub._panel_url("heartbeat")


def test_no_alert_url_yields_no_derived_urls():
    stub = _detector_stub("")
    assert stub._panel_url("heartbeat") == ""
    assert stub._panel_url("calibration") == ""


# ---------------------------------------------------------------------------
# Alert gating - what reaches the panel, and what must not
# ---------------------------------------------------------------------------

def _alerting_detector(**cfg_overrides):
    """A stub whose _alert_webhook is real but whose POST is captured."""
    cfg = qd.Config()
    cfg.ALERT_WEBHOOK_ENABLED = True
    cfg.ALERT_WEBHOOK_URL = "https://panel.example/quaggasklip/api/v1/lightning"
    cfg.ALERT_WEBHOOK_TOKEN = "t"
    for k, v in cfg_overrides.items():
        setattr(cfg, k.upper(), v)
    posted = []
    stub = types.SimpleNamespace(config=cfg, logger=_NullLogger())
    stub._post_panel = lambda url, payload, what: posted.append(payload) or True
    stub._alert_webhook = types.MethodType(
        qd.QuaggasklipDetector._alert_webhook, stub)
    return stub, posted


def test_an_in_range_strike_is_posted_with_the_expected_fields():
    stub, posted = _alerting_detector()
    stub._alert_webhook(9, 123456)
    assert len(posted) == 1
    payload = posted[0]
    assert payload["station_id"] == "QUAGGASKLIP"
    assert payload["distance_km"] == 9
    assert payload["energy"] == 123456
    assert payload["timestamp"].endswith("+0200")     # SAST, never UTC


def test_an_out_of_range_strike_is_never_posted():
    """The panel rejects a negative distance, and it is no local threat anyway."""
    stub, posted = _alerting_detector()
    stub._alert_webhook(-1, 500)
    assert posted == []


def test_a_strike_beyond_the_alert_radius_is_not_posted():
    stub, posted = _alerting_detector(alert_distance_km=20)
    stub._alert_webhook(25, 500)
    assert posted == []
    stub._alert_webhook(20, 500)                       # the boundary is included
    assert len(posted) == 1


def test_the_near_field_floor_is_off_by_default():
    """Default 0 must not hide overhead lightning, which is the 1 km bin."""
    stub, posted = _alerting_detector()
    assert stub.config.ALERT_MIN_DISTANCE_KM == 0
    stub._alert_webhook(1, 500)
    assert len(posted) == 1


def test_nothing_is_posted_when_the_webhook_is_disabled():
    stub, posted = _alerting_detector(alert_webhook_enabled=False)
    stub._alert_webhook(5, 500)
    assert posted == []


# ---------------------------------------------------------------------------
# EMI validation buffer - the filter that decides whether an alert costs money
# ---------------------------------------------------------------------------

def _buffering_detector():
    cfg = qd.Config()
    forwarded = []
    stub = types.SimpleNamespace(
        config=cfg, logger=_NullLogger(),
        _validation_buffer=[], _validation_flush_time=0.0,
        _last_varied_distance_ts=0.0,
        sensor=types.SimpleNamespace(get_noise_floor=lambda: 4),
        data_logger=types.SimpleNamespace(log_event=lambda *a, **k: None))
    stub._alert_webhook = lambda d, e: forwarded.append((d, e))
    for name in ("_buffer_strike", "_flush_validation_buffer"):
        setattr(stub, name, types.MethodType(
            getattr(qd.QuaggasklipDetector, name), stub))
    return stub, forwarded


def test_a_varied_distance_batch_is_forwarded():
    """Varied distances are real storm geometry."""
    stub, forwarded = _buffering_detector()
    for dist in (12, 8, 5):
        stub._buffer_strike(dist, 900000)
    stub._validation_flush_time = 0.0            # window has expired
    stub._flush_validation_buffer()
    assert forwarded == [(12, 900000), (8, 900000), (5, 900000)]


def test_an_uncorroborated_all_one_km_batch_is_discarded():
    """The EMI signature: everything in the 1 km bin, no storm context."""
    stub, forwarded = _buffering_detector()
    for _ in range(8):
        stub._buffer_strike(1, 100)
    stub._validation_flush_time = 0.0
    stub._flush_validation_buffer()
    assert forwarded == []


def test_a_small_all_one_km_batch_is_also_discarded():
    """Count must not be a way through: two strikes at 1 km is still EMI."""
    stub, forwarded = _buffering_detector()
    stub._buffer_strike(1, 100)
    stub._buffer_strike(1, 100)
    stub._validation_flush_time = 0.0
    stub._flush_validation_buffer()
    assert forwarded == []


def test_overhead_strikes_are_forwarded_once_a_storm_is_corroborated():
    """A real storm arrives with distant strikes first, then overhead."""
    stub, forwarded = _buffering_detector()
    stub._buffer_strike(15, 800000)              # the approach
    stub._validation_flush_time = 0.0
    stub._flush_validation_buffer()
    assert forwarded == [(15, 800000)]

    for _ in range(4):                           # now overhead
        stub._buffer_strike(1, 900000)
    stub._validation_flush_time = 0.0
    stub._flush_validation_buffer()
    assert len(forwarded) == 5


def test_disabled_buffer_tells_the_caller_to_post_directly():
    stub, _forwarded = _buffering_detector()
    stub.config.VALIDATION_BUFFER_ENABLED = False
    assert stub._buffer_strike(5, 100) is False
    assert stub._validation_buffer == []


# ---------------------------------------------------------------------------
# Interference guard
# ---------------------------------------------------------------------------

def _guarded_detector():
    from collections import deque
    cfg = qd.Config()
    stub = types.SimpleNamespace(config=cfg, logger=_NullLogger(),
                                 _recent_strikes=deque(),
                                 _interference_until=0.0)
    stub._interference_check = types.MethodType(
        qd.QuaggasklipDetector._interference_check, stub)
    return stub


def test_a_normal_strike_rate_is_never_muted():
    stub = _guarded_detector()
    for _ in range(stub.config.INTERFERENCE_STRIKE_LIMIT - 1):
        assert stub._interference_check() is False


def test_an_implausible_strike_rate_mutes_outbound_alerts():
    stub = _guarded_detector()
    muted = [stub._interference_check()
             for _ in range(stub.config.INTERFERENCE_STRIKE_LIMIT)]
    assert muted[-1] is True
    # And it stays muted through the cool-down.
    assert stub._interference_check() is True


def test_the_guard_can_be_switched_off():
    stub = _guarded_detector()
    stub.config.INTERFERENCE_GUARD_ENABLED = False
    for _ in range(100):
        assert stub._interference_check() is False


# ---------------------------------------------------------------------------
# Telemetry helpers
# ---------------------------------------------------------------------------

def test_cpu_load_is_scaled_by_core_count(monkeypatch):
    """A Zero W and a Zero 2 W must report on the same scale."""
    import io
    monkeypatch.setattr(qd, "open", lambda *a, **k: io.StringIO("2.00 1.0 1.0 1/1 1"),
                        raising=False)
    monkeypatch.setattr(qd.os, "cpu_count", lambda: 4)
    assert qd.get_cpu_load_pct() == 50.0


def test_cpu_load_returns_minus_one_when_unreadable(monkeypatch):
    def boom(*a, **k):
        raise IOError("nope")
    monkeypatch.setattr(qd, "open", boom, raising=False)
    assert qd.get_cpu_load_pct() == -1.0


def test_timestamps_are_sast_not_utc():
    assert qd.now_sast().strftime("%z") == "+0200"
