"""End-to-end check of the Pi -> CR300 record contract.

Uses the detector's REAL formatters, not a copy of them, then models what the
CR300 program does to the resulting bytes:

    SerialInRecord(..., BeginWord 0, NBytes 0, EndWord &H0D0A, ..., 10)
        strips the CR LF, keeps everything before it including the leading letter
    Left(LastRecord, 1)
        record type
    SplitStr(Parsed, LastRecord, ",", 2, 0)
        SplitOption 0 = NUMERIC: pulls numbers out and DISCARDS every
        non-numeric character. Delimiters are any character other than
        + - . 0-9 E. Documented at
        help.campbellsci.com/crbasic/cr300/Content/Instructions/splitstr.htm

The point of the test is the index mapping. The letter does NOT occupy a slot,
so the two values land in Parsed(1) and Parsed(2), not Parsed(2) and Parsed(3).
"""
import importlib.util
import os
import sys
import types

# --- stub the hardware modules so the detector will import on a workstation ---
for name in ("spidev", "serial", "pigpio"):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
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
NUMERIC_CHARS = set("+-.0123456789E")

passed = 0
failed = 0


def ck(label, ok, detail=""):
    global passed, failed
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1


def serial_in_record(wire):
    """Model SerialInRecord with BeginWord 0 and EndWord &H0D0A.

    BytesReturned excludes the EndWord, and with BeginWord 0 nothing is consumed
    from the front, so the leading letter is retained.
    """
    if not wire.endswith("\r\n"):
        return None, 0
    body = wire[:-2]
    return body, len(body)


def split_str_numeric(s, num_split):
    """Model SplitStr with SplitOption 0 (NUMERIC).

    Maximal runs of + - . 0-9 E are values; every other character is a
    delimiter and is discarded. Unfilled destination slots are NAN.
    """
    out, cur = [], ""
    for ch in s:
        if ch in NUMERIC_CHARS:
            cur += ch
        else:
            if cur:
                out.append(cur)
                cur = ""
    if cur:
        out.append(cur)

    vals = []
    for tok in out[:num_split]:
        try:
            vals.append(float(tok))
        except ValueError:
            vals.append(NAN)
    while len(vals) < num_split:
        vals.append(NAN)
    # 1-indexed like CRBasic
    return {i + 1: v for i, v in enumerate(vals)}


def isnan(x):
    return x != x


print("=== the leading letter is discarded, so there are only TWO values ===")
wire = CampbellLink.format_lightning(12, 45)
body, n = serial_in_record(wire)
ck("wire is exactly 'L,12,45\\r\\n'", wire == "L,12,45\r\n", repr(wire))
ck("SerialInRecord strips CR LF", body == "L,12,45", repr(body))
ck("BytesReturned excludes the terminator", n == 7, str(n))
p3 = split_str_numeric(body, 3)
ck("splitting into 3 leaves Parsed(3) as NAN", isnan(p3[3]),
   "Parsed = %s" % {k: v for k, v in p3.items()})
ck("OLD code's guard (Parsed(2) AND Parsed(3)) would FAIL",
   isnan(p3[3]), "this was the bug: nothing ever validated")
p2 = split_str_numeric(body, 2)
ck("NEW code's guard (Parsed(1) AND Parsed(2)) passes",
   not isnan(p2[1]) and not isnan(p2[2]))

print()
print("=== strike records, every value the Pi can emit ===")
cases = [
    # distance_km, energy, expected dist, expected energy, note
    (0, 0, 0.0, 0.0, "zero distance, zero energy"),
    (1, 1, 1.0, 1.0, "minimum sensible"),
    (12, 45, 12.0, 45.0, "typical"),
    (40, 1048575, 40.0, 1048575.0, "max AS3935 distance, large energy"),
    (-1, 500, -1.0, 500.0, "UNRANGEABLE, must stay -1"),
    (None, None, -1.0, 0.0, "None falls back to -1 and 0"),
    ("bad", "bad", -1.0, 0.0, "unparseable falls back to -1 and 0"),
]
for dist_in, eng_in, want_d, want_e, note in cases:
    wire = CampbellLink.format_lightning(dist_in, eng_in)
    body, _ = serial_in_record(wire)
    rtype = body[0]
    p = split_str_numeric(body, 2)
    ok = (rtype == "L" and not isnan(p[1]) and not isnan(p[2])
          and p[1] == want_d and p[2] == want_e)
    ck("L %-28s -> dist=%s energy=%s" % (note, p[1], p[2]), ok, repr(wire))

print()
print("=== the -1 unrangeable guard in the CR300 program ===")
# If LastDistanceKm >= 0 Then ... only then is it a closest-of-day candidate.
body, _ = serial_in_record(CampbellLink.format_lightning(-1, 500))
p = split_str_numeric(body, 2)
ck("-1 survives the split as -1, not 1", p[1] == -1.0, str(p[1]))
ck("-1 is excluded by the >= 0 test", not (p[1] >= 0))

print()
print("=== status records ===")
hcases = [
    (48.3, -62, 48.3, -62.0, "typical"),
    (0.0, 0, 0.0, 0.0, "zeros"),
    # round(55.55, 1) is 55.5, not 55.6: 55.55 has no exact binary
    # representation and the stored value is slightly below the midpoint. The
    # expectation here was wrong, the code was right.
    (55.55, -100, 55.5, -100.0, "cpu rounds to 1 dp"),
    (float("nan"), -62, 0.0, -62.0, "nan cpu must become 0.0, not 'nan'"),
    (float("inf"), -62, 0.0, -62.0, "inf cpu must become 0.0, not 'inf'"),
    (float("-inf"), -62, 0.0, -62.0, "-inf cpu must become 0.0"),
    (None, None, 0.0, 0.0, "None falls back to 0.0 and 0"),
    ("x", "x", 0.0, 0.0, "unparseable falls back"),
    (41.2, 0, 41.2, 0.0, "no wifi, rssi 0"),
]
for cpu_in, rssi_in, want_c, want_r, note in hcases:
    wire = CampbellLink.format_heartbeat(cpu_in, rssi_in)
    body, _ = serial_in_record(wire)
    rtype = body[0]
    p = split_str_numeric(body, 2)
    ok = (rtype == "H" and not isnan(p[1]) and not isnan(p[2])
          and abs(p[1] - want_c) < 1e-9 and p[2] == want_r)
    ck("H %-28s -> cpu=%s rssi=%s" % (note, p[1], p[2]), ok, repr(wire))

print()
print("=== no record the Pi can emit has an empty or non-numeric field ===")
# An empty field would yield only one token and NAN the other, which would make
# the record fail the guard and the detector look dead.
import itertools
weird = [None, "", "bad", float("nan"), float("inf"), float("-inf"),
         -1, 0, 99999, "12", 3.7, True]
bad = []
for a, b in itertools.product(weird, repeat=2):
    for fn, letter in ((CampbellLink.format_lightning, "L"),
                       (CampbellLink.format_heartbeat, "H")):
        try:
            w = fn(a, b)
        except Exception as exc:  # noqa: BLE001
            bad.append("%s(%r,%r) raised %s" % (letter, a, b, exc))
            continue
        body, _ = serial_in_record(w)
        if body is None:
            bad.append("%s(%r,%r) missing CR LF: %r" % (letter, a, b, w))
            continue
        p = split_str_numeric(body, 2)
        if isnan(p[1]) or isnan(p[2]):
            bad.append("%s(%r,%r) -> %r gives NAN" % (letter, a, b, w))
        if body[0] != letter:
            bad.append("%s(%r,%r) -> wrong leading letter %r" % (letter, a, b, body[0]))
ck("all %d formatter input combinations parse to two real numbers"
   % (len(weird) ** 2 * 2), not bad,
   "; ".join(bad[:4]) if bad else "")

print()
print("=== record fits the declared String * 48 ===")
longest = max(len(CampbellLink.format_lightning(-1, 4294967295)),
              len(CampbellLink.format_heartbeat(-999.9, -32768)))
ck("longest record body fits in 48 chars", longest - 2 <= 48,
   "longest body = %d chars" % (longest - 2))

print()
print("=== buffer sizing ===")
# SerialOpen buffer is 256. Campbell advises at least two records plus one byte.
rec = len(CampbellLink.format_lightning(40, 1048575))
ck("256 byte buffer holds many records", 256 >= 2 * rec + 1,
   "record = %d bytes, 256 / %d = %.0f records" % (rec, rec, 256 / rec))

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
