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

    SerialIn(LastRecord, ComC2_Rx, 1, LF, 48)
        reads to the LF. A numeric TerminationChar is EXCLUDED from the result,
        so the CR before it stays on the end of the string.
    LPos = InStr(1, LastRecord, "L,", 2)
        locates the record instead of assuming it starts at character 1
    Mid(LastRecord, RecLen, 1) = CHR(13)
        a complete record ends in CR; a fragment does not
    Payload = Mid(LastRecord, LPos + 2, 48)
        everything after "L,"
    SplitStr(Parsed, Payload, "", 2, 0)
        SplitOption 0 is NUMERIC: every character except + - . 0-9 E is a
        delimiter and is DISCARDED, so the trailing CR costs nothing and the two
        values land in Parsed(1) and Parsed(2). FilterString is ignored.
        help.campbellsci.com/crbasic/cr300/Content/parameters/splitoption.htm

Four properties matter most:
  1. The field indexing. Reading Parsed(2)/Parsed(3) logged nothing at all, and
     did so silently.
  2. Leading rubbish must not defeat the match. Left(LastRecord,2) = "L," rejected
     all five records of a burst whose 70 bytes were confirmed arriving.
  3. A fragment must never be stored. "L,40,123" from a split record is corrupt
     data that looks perfectly reasonable.
  4. A status record must never be stored, and must not be counted as a fault
     either. Health belongs to the admin panel.

KNOWN LIMIT, accepted deliberately: there is no range guard on the parsed values.
A corruption that put "L," in front of a health record would store its numbers as
a strike. That needs a very specific fault that has never been observed, and the
brief is distance, energy and timestamp with nothing added.
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


def serial_in(wire):
    """SerialIn to a numeric TerminationChar of LF.

    The terminator is excluded, so the CR ahead of it survives. Anything with no
    LF yet is what the logger sees mid-record: returned as-is when TimeOut
    expires, which is exactly the fragment the CR test has to catch.
    """
    if "\n" not in wire:
        return wire, len(wire)
    body = wire[:wire.index("\n")]
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


def logger_outcome(wire):
    """Model the logger's decision, branch for branch.

    Returns (outcome, distance, energy) where outcome is one of:
        "stored"       a row was written to LightningEvents
        "parse_error"  ParseErrorCount incremented, nothing stored
        "health"       recognised as H, dropped, NOT counted
        "ignored"      too short to look at, no counter touched
    """
    body, rec_len = serial_in(wire)
    if rec_len <= 1:                      # If RecLen > 1 Then
        return "ignored", None, None

    l_pos = body.find("L,") + 1           # InStr is 1-indexed, 0 when not found
    complete = body[-1:] == "\r"          # Mid(LastRecord, RecLen, 1) = CHR(13)

    if l_pos > 0 and complete:
        payload = body[l_pos + 1:]        # Mid(LastRecord, LPos + 2, MAX_CHARS)
        p = split_str_numeric(payload, 2)
        if isnan(p[1]) or isnan(p[2]):
            return "parse_error", None, None
        return "stored", p[1], p[2]

    if body[:2] == "H,":                  # ElseIf Left(LastRecord, 2) = "H,"
        return "health", None, None

    return "parse_error", None, None


def logger_accepts(wire):
    """Convenience wrapper: (logged, distance, energy)."""
    outcome, d, e = logger_outcome(wire)
    return outcome == "stored", d, e


print("=== the read keeps the CR and drops the LF ===")
body, n = serial_in(CampbellLink.format_lightning(12, 45))
ck("wire is 'L,12,45\\r\\n'", CampbellLink.format_lightning(12, 45) == "L,12,45\r\n")
ck("LF excluded, CR kept", body == "L,12,45\r", repr(body))
ck("so the record is provably complete", body[-1] == "\r")
ck("RecLen counts the CR", n == 8, str(n))

print()
print("=== the payload, and the field indexing ===")
l_pos = body.find("L,") + 1
ck("InStr finds the record at character 1", l_pos == 1, str(l_pos))
payload = body[l_pos + 1:]
ck("payload is everything after 'L,'", payload == "12,45\r", repr(payload))
p3 = split_str_numeric(payload, 3)
ck("asking for 3 leaves Parsed(3) as NAN", isnan(p3[3]), "Parsed = %s" % p3)
ck("the OLD indexing would have logged nothing, ever", isnan(p3[3]))
p2 = split_str_numeric(payload, 2)
ck("2 slots give 12 and 45", p2[1] == 12.0 and p2[2] == 45.0)
ck("the trailing CR costs no slot", len(split_str_numeric(payload, 2)) == 2)

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
print("=== the -1 unrangeable value survives the wire ===")
_, d, _ = logger_accepts(CampbellLink.format_lightning(-1, 500))
ck("-1 survives as -1, not 1", d == -1.0, str(d))
ck("the minus sign is kept by SplitOption 0", split_str_numeric("-1,500", 2)[1] == -1.0)

print()
print("=== leading rubbish must not defeat the match ===")
# THE FAULT THIS FIXES: Left(LastRecord,2) = "L," rejected 5 of 5 records while
# BytesSeenTotal confirmed all 70 bytes arriving. A bit-banged line has no UART to
# resynchronise it, so a stray byte ahead of the record is real.
for junk, note in [("\x00", "a null"), ("\r", "a stray CR"), ("\xff", "a framing glitch"),
                   ("?", "one bad character"), ("xy", "two bad characters")]:
    wire = junk + "L,12,45\r\n"
    outcome, d, e = logger_outcome(wire)
    ck("%-20s ahead of the record still stores 12/45" % note,
       outcome == "stored" and d == 12.0 and e == 45.0,
       "%s -> %s d=%s e=%s" % (repr(wire), outcome, d, e))
# And the junk must not be read as the distance.
outcome, d, e = logger_outcome("99L,12,45\r\n")
ck("a digit in the rubbish does not become the distance",
   outcome == "stored" and d == 12.0 and e == 45.0,
   "got %s d=%s e=%s" % (outcome, d, e))

print()
print("=== a fragment must never be stored ===")
# THE FAULT THIS FIXES: a record split across two scans reads as "L,40,123" and
# would store as a real strike at 123 joules. Corrupt, but entirely plausible.
for frag in ["L,40,123", "L,40,1234567", "L,4", "L,"]:
    outcome, d, e = logger_outcome(frag)
    ck("no CR, so rejected: %-16s" % repr(frag), outcome != "stored",
       "outcome %s d=%s" % (outcome, d))
ck("the complete record it came from IS stored",
   logger_outcome("L,40,1234567\r\n")[0] == "stored")

print()
print("=== status records: dropped, and NOT counted as a fault ===")
# Health goes to the admin panel. Counting it would put routine daily traffic in
# the fault counter and hide a real wiring problem.
for cpu, rssi, note in [(48.3, -62, "typical"), (0.0, 0, "zeros"),
                        (None, None, "fallbacks"), (float("nan"), -62, "nan cpu")]:
    wire = CampbellLink.format_heartbeat(cpu, rssi)
    outcome, _, _ = logger_outcome(wire)
    ck("H %-24s dropped uncounted" % note, outcome == "health",
       "%s -> %s" % (repr(wire), outcome))

print()
print("=== anything else on the wire is rejected and counted ===")
for junk, want in [("X,1,2\r\n", "parse_error"), (",1,2\r\n", "parse_error"),
                   ("12,45\r\n", "parse_error"), ("\r\n", "ignored"),
                   ("l,12,45\r\n", "parse_error"), ("L\r\n", "parse_error"),
                   ("L,\r\n", "parse_error"), ("L,abc,def\r\n", "parse_error")]:
    outcome, _, _ = logger_outcome(junk)
    ck("%-14s -> %-12s" % (repr(junk), outcome), outcome == want,
       "expected %s" % want)
# "LL,1,2" is tolerated now and that is the deliberate trade: InStr locates the
# "L," at position 2 and reads 1 and 2. Rejecting it would mean rejecting every
# record with a stray leading byte, which is the fault that cost this link weeks.
outcome, d, e = logger_outcome("LL,1,2\r\n")
ck("'LL,1,2' is accepted as 1/2, the cost of tolerating leading junk",
   outcome == "stored" and d == 1.0 and e == 2.0,
   "got %s d=%s e=%s" % (outcome, d, e))
ck("lowercase 'l,' is still rejected: string functions are case sensitive",
   logger_outcome("l,12,45\r\n")[0] == "parse_error")

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
# The read keeps the CR, so the stored string is wire length minus the LF only.
longest = max(len(CampbellLink.format_lightning(-1, 4294967295)) - 1,
              len(CampbellLink.format_heartbeat(-999.9, -32768)) - 1)
ck("longest record fits MAX_CHARS of 48", longest <= 48, "%d chars" % longest)
ck("and fits String * 64 with room for the null", longest < 64, "%d chars" % longest)
rec = len(CampbellLink.format_lightning(40, 1048575))
ck("256 byte buffer holds many records", 256 >= 2 * rec + 1,
   "%d bytes each, about %d records" % (rec, 256 // rec))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
