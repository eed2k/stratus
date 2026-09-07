# =========================================================================
#
#  Stratus Lightning Beacon
#  Lamp-state logic tests. Run on a workstation, not on the board.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================

"""Exercise the beacon's logic without a Pi, a panel, or any GPIO.

The parts worth proving: the strike identity is stable across polls and distinct
between strikes, the lamps never show green on an unknown state, and the flicker
is a real square wave that ends on time.
"""
import sys
import time
from datetime import datetime, timedelta, timezone

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# Resolve beacon.py relative to this file, so the test runs from anywhere.
import os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ["BEACON_DRY_RUN"] = "true"
os.environ["BEACON_FLICKER_SECONDS"] = "10"
os.environ["BEACON_FLICKER_PERIOD"] = "1"

import beacon as B

SAST = timezone(timedelta(hours=2))
fails = []


def check(ok, label, detail=""):
    print(f"  {'PASS' if ok else 'FAIL':<5} {label:<52} {detail}")
    if not ok:
        fails.append(label)


def state(age_s, km=5.0, online=True, when=None):
    when = when or datetime(2026, 8, 22, 22, 41, 9, tzinfo=SAST)
    return {
        "unit_online": online,
        "last_strike_age_s": age_s,
        "last_strike_km": km,
        "alerts_enabled": False,
        "lightning_radius_km": 10,
        "lightning_window_min": 30,
        "server_time": when.isoformat(),
    }


print("1. strike identity")
t0 = datetime(2026, 8, 22, 22, 41, 9, tzinfo=SAST)
a = B.strike_key(state(60, when=t0))
# Same strike seen 30 s later: age grew by 30, server_time advanced by 30.
b = B.strike_key(state(90, when=t0 + timedelta(seconds=30)))
check(a == b, "same strike keeps one identity across polls", f"{a} == {b}")

# A new strike: age resets while the clock keeps moving.
c = B.strike_key(state(2, when=t0 + timedelta(seconds=120)))
check(c != a, "a newer strike gets a different identity", f"{c} != {a}")

check(B.strike_key(state(None)) is None, "no strike -> None")
check(B.strike_key({"last_strike_age_s": 5}) is None, "missing server_time -> None")
check(B.strike_key({"last_strike_age_s": "x", "server_time": t0.isoformat()}) is None,
      "non-numeric age -> None")
check(B.strike_key({"last_strike_age_s": 5, "server_time": "not a date"}) is None,
      "unparseable server_time -> None")

print()
print("2. lamp policy: never green on unknown")
cfg = B.Config()
lamps = B.Lamps(cfg)
bk = B.Beacon(cfg, lamps)

bk.apply_online(True)
check(lamps._state["green"] and not lamps._state["red"], "online -> green only")
bk.apply_online(False)
check(lamps._state["red"] and not lamps._state["green"], "offline -> red only")
bk.apply_online(None)
check(not lamps._state["green"], "unknown -> green is OFF (fail safe)")
check(lamps._state["red"], "unknown -> red is ON with fail_state=red")

os.environ["BEACON_FAIL_STATE"] = "dark"
cfg2 = B.Config()
l2 = B.Lamps(cfg2)
b2 = B.Beacon(cfg2, l2)
b2.apply_online(None)
check(not l2._state["green"] and not l2._state["red"],
      "unknown -> both off with fail_state=dark")
check(B.Config().fail_state in ("red", "dark"), "fail_state is constrained")
os.environ["BEACON_FAIL_STATE"] = "green"       # must not be honored
check(B.Config().fail_state == "red", "fail_state=green is refused, falls back to red")
os.environ["BEACON_FAIL_STATE"] = "red"

print()
print("3. flicker is a square wave that ends on time")
cfg3 = B.Config()
l3 = B.Lamps(cfg3)
b3 = B.Beacon(cfg3, l3)
now = 1000.0
b3.arm_flicker(now, 5.0, 12345)
pattern = []
for i in range(12):
    b3.service_flicker(now + i)             # sample once a second
    pattern.append(1 if l3._state["orange"] else 0)
print("     seconds 0..11:", pattern)
check(pattern[:10].count(1) == 5 and pattern[:10].count(0) == 5,
      "10 s burst is 5 on and 5 off", str(pattern[:10]))
check(pattern[0] == 1, "burst starts lit")
check(pattern[10] == 0 and pattern[11] == 0, "lamp is off after the burst ends")
transitions = sum(1 for i in range(1, 10) if pattern[i] != pattern[i - 1])
check(transitions == 9, "alternates every second", f"{transitions} transitions")

print()
print("4. one burst per strike, restarted by a new one")
cfg4 = B.Config()
l4 = B.Lamps(cfg4)
b4 = B.Beacon(cfg4, l4)
b4.seen_strike = 111                        # pretend we are already running
b4.arm_flicker(500.0, 3.0, 222)
first_deadline = b4.flicker_until
b4.arm_flicker(505.0, 2.0, 333)             # new strike mid-burst
check(b4.flicker_until > first_deadline, "a new strike extends the burst",
      f"{first_deadline} -> {b4.flicker_until}")
check(b4.flicker_until == 515.0, "deadline is restart + duration",
      str(b4.flicker_until))

print()
print("5. start-up does not replay an old strike")
cfg5 = B.Config()
l5 = B.Lamps(cfg5)
b5 = B.Beacon(cfg5, l5)
B.fetch_state = lambda c: state(3600)       # a strike from an hour ago
b5.poll_once()
check(not l5._state["orange"], "an hour-old strike does not fire on start-up")
check(b5.seen_strike is not None, "but it is recorded as seen")

cfg6 = B.Config()
l6 = B.Lamps(cfg6)
b6 = B.Beacon(cfg6, l6)
B.fetch_state = lambda c: state(2)          # fresh strike
b6.poll_once()
check(l6._state["orange"], "a fresh strike does fire on start-up")

print()
print("6. an unreachable panel drops to the fail state")
cfg7 = B.Config()
l7 = B.Lamps(cfg7)
b7 = B.Beacon(cfg7, l7)
b7.apply_online(True)                       # start green
def boom(c):
    raise B.PanelError("unreachable: test")
B.fetch_state = boom
b7.poll_once()
check(not l7._state["green"], "green is dropped when the panel goes away")
check(l7._state["red"], "red is raised instead")
check(b7.consecutive_failures == 1, "failure counted")

print()
print("7. config clamping keeps bad input from crashing the service")
os.environ["BEACON_POLL_SECONDS"] = "0"
check(B.Config().poll_s == 2, "poll interval clamped up to the floor")
os.environ["BEACON_POLL_SECONDS"] = "99999"
check(B.Config().poll_s == 600, "poll interval clamped down to the ceiling")
os.environ["BEACON_POLL_SECONDS"] = "abc"
check(B.Config().poll_s == 10, "non-numeric poll interval falls back to default")
os.environ["BEACON_POLL_SECONDS"] = "10"

# --- regression: the burst must start lit for ANY duration ------------------
# Phasing from the deadline instead of the start made the first period depend on
# whether the duration divided evenly by the period, so an odd duration began
# the burst dark.
print()
print("8. burst starts lit regardless of duration")
for dur in (5, 7, 9, 10, 11, 13, 20):
    os.environ["BEACON_FLICKER_SECONDS"] = str(dur)
    c = B.Config()
    l = B.Lamps(c)
    bb = B.Beacon(c, l)
    bb.arm_flicker(0.0, 1.0, dur)
    bb.service_flicker(0.0)
    lit_at_start = l._state["orange"]
    bb.service_flicker(float(dur) + 0.01)          # just past the deadline
    off_after = not l._state["orange"]
    check(lit_at_start and off_after,
          f"duration {dur}s: starts lit, ends off",
          f"start={'ON' if lit_at_start else 'off'}")
os.environ["BEACON_FLICKER_SECONDS"] = "10"

print()
print(f"{'ALL CHECKS PASSED' if not fails else str(len(fails)) + ' FAILED'}")
for f in fails:
    print("  FAIL", f)
sys.exit(1 if fails else 0)
