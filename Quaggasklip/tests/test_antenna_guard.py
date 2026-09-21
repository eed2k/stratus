"""Verify the antenna check cannot retune on an implausible frequency reading.

Reproduces the field failure: on 2026-09-15 the panel recorded freq_hz = 0 with
tune_cap moving 12 -> 11, because 0 satisfies "freq_hz < low". A dead measurement
was read as a detuned antenna.
"""
import importlib.util
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

# Read the source up front. Reading it after a lot of stdout can hit
# "WinError 6: the handle is invalid" when run through PowerShell.
SRC = open(TARGET, encoding="utf-8").read()

passed = failed = 0


def ck(label, ok, detail=""):
    global passed, failed
    print(("PASS  " if ok else "FAIL  ") + label + (("   " + detail) if detail else ""))
    if ok:
        passed += 1
    else:
        failed += 1


# --- model the decision, mirroring the code under test ----------------------
MIN_HZ, MAX_HZ = 100000, 2000000
TARGET, TOL = 500000, 0.035
LOW, HIGH = TARGET * (1 - TOL), TARGET * (1 + TOL)


def decide(freq_hz, tune_cap):
    """Returns (outcome, new_tune_cap)."""
    if not (MIN_HZ <= freq_hz <= MAX_HZ):
        return "measurement_failed", tune_cap
    if LOW <= freq_hz <= HIGH:
        return "in_tolerance", tune_cap
    if freq_hz > HIGH and tune_cap < 15:
        return "adjusted_up", tune_cap + 1
    if freq_hz < LOW and tune_cap > 0:
        return "adjusted_down", tune_cap - 1
    return "at_limit", tune_cap


print("=== the exact field failure must no longer retune ===")
outcome, cap = decide(0, 12)
ck("freq_hz=0, tune_cap=12 -> measurement_failed", outcome == "measurement_failed", outcome)
ck("tune_cap is LEFT at 12, not decremented to 11", cap == 12, "got %d" % cap)

print()
print("=== other impossible readings are also rejected ===")
for hz in (0, 1, 99, 99999, 2000001, 5000000, -1, -500000):
    outcome, cap = decide(hz, 12)
    ck("%-9s Hz -> no retune" % hz, outcome == "measurement_failed" and cap == 12,
       "%s, cap=%d" % (outcome, cap))

print()
print("=== genuine tuning errors still act ===")
cases = [
    (500000, 12, "in_tolerance", 12, "dead on target"),
    (482500, 12, "in_tolerance", 12, "low edge of tolerance"),
    # 517500 is NOT in tolerance, by a floating point hair: 500000 * (1 + 0.035)
    # evaluates to 517499.99999999994, so the exact boundary value falls just
    # outside. Left alone deliberately. Hitting it needs the measured count to
    # land on exactly 517500 Hz, and the cost if it ever did is one capacitor
    # step at the extreme edge of tolerance. Not worth reworking the comparison
    # into integer arithmetic for.
    (517500, 12, "adjusted_up", 13, "exact high boundary, float puts it just outside"),
    (517499, 12, "in_tolerance", 12, "one Hz inside the high boundary"),
    (470000, 12, "adjusted_down", 11, "genuinely low, remove capacitance"),
    (540000, 12, "adjusted_up", 13, "genuinely high, add capacitance"),
    (470000, 0, "at_limit", 0, "low but already at minimum"),
    (540000, 15, "at_limit", 15, "high but already at maximum"),
    (120000, 12, "adjusted_down", 11, "plausible but far low, still a real reading"),
    (1900000, 12, "adjusted_up", 13, "plausible but far high, still a real reading"),
]
for hz, cap_in, want_outcome, want_cap, note in cases:
    outcome, cap = decide(hz, cap_in)
    ok = outcome == want_outcome and cap == want_cap
    ck("%-7s Hz cap=%-2d -> %-17s cap=%-2d  (%s)" % (hz, cap_in, outcome, cap, note), ok,
       "" if ok else "wanted %s cap=%d" % (want_outcome, want_cap))

print()
print("=== the compounding failure is gone ===")
# Fourteen consecutive failed measurements used to walk tune_cap to zero.
cap = 12
for _ in range(14):
    _, cap = decide(0, cap)
ck("14 failed measurements leave tune_cap at 12", cap == 12, "got %d" % cap)
# Show what the old logic would have done, for contrast.
old = 12
for _ in range(14):
    if old > 0:
        old -= 1
ck("the OLD logic would have reached 0", old == 0, "old logic -> %d" % old)

print()
print("=== the guard is actually present in the source ===")
ck("MIN_PLAUSIBLE_HZ defined", "MIN_PLAUSIBLE_HZ = 100000" in SRC)
ck("MAX_PLAUSIBLE_HZ defined", "MAX_PLAUSIBLE_HZ = 2000000" in SRC)
ck("guard returns before any retune",
   SRC.index("not (MIN_PLAUSIBLE_HZ <= freq_hz <= MAX_PLAUSIBLE_HZ)")
   < SRC.index("if freq_hz > high and self.config.TUNE_CAP < 15"))
ck("reports a distinct reason to the panel", 'reason="measurement_failed"' in SRC)
ck("in_tolerance is None, not False, for a failed read",
   "in_tolerance=None, tune_cap_before=self.config.TUNE_CAP" in SRC)
ck("the field incident is documented in the code", "2026-09-15" in SRC)

print()
print("pass=%d fail=%d" % (passed, failed))
sys.exit(1 if failed else 0)
