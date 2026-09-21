# =========================================================================
#
#  Stratus AS3935 Lightning Detection System
#  Pi to CR300 record contract test.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
"""Verify the Pi -> CR300 record contract without any hardware.

Uses the detector's REAL formatters, then models what the logger does:

    SerialInRecord(..., BeginWord 0, NBytes 0, EndWord &H0D0A, ..., 10)
        strips CR LF, keeps the leading letter
    Left(LastRecord, 1) = "L"
        only lightning is accepted
    SplitStr(Parsed, LastRecord, ",", 2, 0)
        SplitOption 0 is NUMERIC: numbers are kept, every other character is a
        delimiter and is DISCARDED. So the leading letter takes no slot and the
        two values land in Parsed(1) and Parsed(2).
        help.campbellsci.com/crbasic/cr300/Content/Instructions/splitstr.htm

Two properties matter most:
  1. The field indexing. Reading Parsed(2)/Parsed(3) logged nothing at all, and
     did so silently.
  2. A status record must never be logged. Health belongs to the admin panel.
"""
import importlib.util
import itertools
import os
import sys
import types

for name in ("spidev", "serial", "pigpio"):
    sys.modules.setdefault(name, types.ModuleType(name))
if "RPi" not in sys.modules:
    rpi = types.ModuleType("RPi")
    gpio = types.ModuleType("RPi.GPIO")
    rpi.GPIO = gpio
    sys.modules["RPi"] = rpi
    sys.modules["RPi.GPIO"] = gpio

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.normpath(os.path.join(HERE, "..", "quaggasklip_detector.py"))
spec = importlib.util.spec_from_file_location("qkdet", TARGET)
qk = importlib.util.module_from_spec(spec)
sys.modules["qkdet"] = qk
spec.loader.exec_module(qk)

CampbellLink = qk.CampbellLink
NAN = float("nan")
NUMERIC = set("+-.0123456789E")

passed = failed = 0


def ck(label, ok, detail=""):
    global passed, failed
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1


def serial_in_record(wire):
    """BeginWord 0, EndWord &H0D0A. BytesReturned excludes the EndWord."""
    if not wire.endswith("\r\n"):
        return None, 0
    body = wire[:-2]
    return body, len(body)


def split_str_numeric(s, n):
    """SplitStr SplitOption 0. Unfilled slots are NAN. 1-indexed like CRBasic."""
    out, cur = [], ""
    for ch in s:
        if ch in NUMERIC:
            cur += ch
        else:
            if cur:
                out.append(cur)
                cur = ""
    if cur:
        out.append(cur)
    vals = []
    for tok in out[:n]:
        try:
            vals.append(float(tok))
        except ValueError:
            vals.append(NAN)
    while len(vals) < n:
        vals.append(NAN)
    return {i + 1: v for i, v in enumerate(vals)}


def isnan(x):
    return x != x


def logger_accepts(wire):
    """Model the logger's decision. Returns (logged, distance, energy)."""
    body, n = serial_in_record(wire)
    if body is None or n <= 0:
        return False, None, None
    # Left(LastRecord, 2) = "L," checks the shape, not just the first byte.
    if body[:2] != "L,":
        return False, None, None          # counted as an error, never stored
    p = split_str_numeric(body, 2)
    if isnan(p[1]) or isnan(p[2]):
        return False, None, None
    return True, p[1], p[2]


print("=== the leading letter takes no slot ===")
body, n = serial_in_record(CampbellLink.format_lightning(12, 45))
ck("wire is 'L,12,45\\r\\n'", CampbellLink.format_lightning(12, 45) == "L,12,45\r\n")
ck("CR LF stripped, letter kept", body == "L,12,45", repr(body))
ck("BytesReturned excludes the terminator", n == 7, str(n))
p3 = split_str_numeric(body, 3)
ck("asking for 3 leaves Parsed(3) as NAN", isnan(p3[3]),
   "Parsed = %s" % p3)
ck("the OLD indexing would have logged nothing, ever", isnan(p3[3]))
p2 = split_str_numeric(body, 2)
ck("the NEW indexing gives 12 and 45", p2[1] == 12.0 and p2[2] == 45.0)

print()
print("=== strike records: every value the Pi can emit ===")
cases = [
    (0, 0, 0.0, 0.0, "zero distance and energy"),
    (1, 1, 1.0, 1.0, "minimum"),
    (12, 45, 12.0, 45.0, "typical"),
    (40, 1048575, 40.0, 1048575.0, "max range, large energy"),
    (-1, 500, -1.0, 500.0, "UNRANGEABLE, must stay -1"),
    (None, None, -1.0, 0.0, "None falls back"),
    ("bad", "bad", -1.0, 0.0, "unparseable falls back"),
    (float("inf"), 5, -1.0, 5.0, "inf must not reach the wire"),
    (float("nan"), 5, -1.0, 5.0, "nan must not reach the wire"),
]
for d_in, e_in, want_d, want_e, note in cases:
    wire = CampbellLink.format_lightning(d_in, e_in)
    logged, d, e = logger_accepts(wire)
    ok = logged and d == want_d and e == want_e
    ck("L %-30s -> logged d=%s e=%s" % (note, d, e), ok, repr(wire))

print()
print("=== the -1 unrangeable guard ===")
_, d, _ = logger_accepts(CampbellLink.format_lightning(-1, 500))
ck("-1 survives as -1, not 1", d == -1.0, str(d))
ck("-1 fails the >= 0 closest-of-day test", not (d >= 0))

print()
print("=== status records must NEVER be logged ===")
# Health goes to the admin panel. Even if a status record reaches the logger,
# it must be discarded rather than stored.
for cpu, rssi, note in [(48.3, -62, "typical"), (0.0, 0, "zeros"),
                        (None, None, "fallbacks"), (float("nan"), -62, "nan cpu")]:
    wire = CampbellLink.format_heartbeat(cpu, rssi)
    logged, _, _ = logger_accepts(wire)
    ck("H %-24s is REJECTED by the logger" % note, not logged, repr(wire))

print()
print("=== anything else on the wire is also rejected ===")
for junk in ["X,1,2\r\n", ",1,2\r\n", "12,45\r\n", "\r\n", "L,12,45",
             "l,12,45\r\n", "LL,1,2\r\n", "L\r\n", "L,\r\n", "L,abc,def\r\n"]:
    logged, _, _ = logger_accepts(junk)
    ck("rejected: %-18s" % repr(junk), not logged)

print()
print("=== the Pi does not send a status record at all by default ===")
cfg = qk.Config()
ck("CAMPBELL_HEARTBEAT_ENABLED exists", hasattr(cfg, "CAMPBELL_HEARTBEAT_ENABLED"))
ck("and defaults to False", getattr(cfg, "CAMPBELL_HEARTBEAT_ENABLED", None) is False,
   str(getattr(cfg, "CAMPBELL_HEARTBEAT_ENABLED", "missing")))
src = open(TARGET, encoding="utf-8").read()
ck("the send is gated on the flag",
   "campbell_due and self.config.CAMPBELL_HEARTBEAT_ENABLED" in src)
ck("the panel heartbeat is NOT gated on it",
   "if panel_due:" in src)
ck("the flag is validated as a bool",
   '"CAMPBELL_HEARTBEAT_ENABLED":  (bool, None, None)' in src)

print()
print("=== no formatter input can produce an unparseable field ===")
weird = [None, "", "bad", float("nan"), float("inf"), float("-inf"),
         -1, 0, 99999, "12", 3.7, True]
bad = []
for a, b in itertools.product(weird, repeat=2):
    wire = CampbellLink.format_lightning(a, b)
    logged, d, e = logger_accepts(wire)
    if not logged:
        bad.append("format_lightning(%r,%r) -> %r was rejected" % (a, b, wire))
ck("all %d strike-formatter combinations parse and log"
   % (len(weird) ** 2), not bad, "; ".join(bad[:3]))

print()
print("=== sizing ===")
longest = max(len(CampbellLink.format_lightning(-1, 4294967295)) - 2,
              len(CampbellLink.format_heartbeat(-999.9, -32768)) - 2)
ck("longest record fits String * 48", longest <= 48, "%d chars" % longest)
rec = len(CampbellLink.format_lightning(40, 1048575))
ck("256 byte buffer holds many records", 256 >= 2 * rec + 1,
   "%d bytes each, about %d records" % (rec, 256 // rec))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
