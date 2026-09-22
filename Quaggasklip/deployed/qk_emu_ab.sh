#!/bin/bash
# Decide whether the emulator's RF is reaching the sensor, controlling for site
# noise.
#
# Usage: qk_emu_ab.sh [phase_seconds]
#
# This site is electrically noisy: with disturbers unmasked it produced 47 events
# in 90 seconds. So counting events during a press window proves nothing on its
# own, because ambient EMI would fill it anyway. This runs two windows of equal
# length instead:
#
#   PHASE A   baseline, nobody touches anything
#   PHASE B   press CLOSE repeatedly
#
# A clear rise from A to B is the emulator. Similar counts mean the emulator is
# contributing nothing and the RF is not reaching the antenna.
#
# Disturbers are unmasked for both phases, because with masking on the sensor
# suppresses the interrupt for anything it judges man-made, and a rejected burst
# becomes indistinguishable from no burst. Restored from the trap afterwards.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

PH=${1:-30}
CFG=/home/quaggasklip/lightning_config.json

restore() {
  echo
  echo "=== RESTORING mask_disturber ==="
  python3 - <<'PY'
import json
path = "/home/quaggasklip/lightning_config.json"
with open(path) as f:
    cfg = json.load(f)
cfg["mask_disturber"] = True
with open(path, "w") as f:
    json.dump(cfg, f, indent=2, sort_keys=True)
    f.write("\n")
print("  mask_disturber -> True")
PY
  sudo systemctl restart lightning-detector
  sleep 10
  echo -n "  active: "; systemctl is-active lightning-detector
}
trap restore EXIT

echo "=== UNMASKING DISTURBERS for both phases ==="
python3 - <<'PY'
import json
path = "/home/quaggasklip/lightning_config.json"
with open(path) as f:
    cfg = json.load(f)
print("  mask_disturber %s -> False" % cfg.get("mask_disturber"))
cfg["mask_disturber"] = False
with open(path, "w") as f:
    json.dump(cfg, f, indent=2, sort_keys=True)
    f.write("\n")
PY
sudo systemctl restart lightning-detector
sleep 12
echo -n "  active: "; systemctl is-active lightning-detector

sudo python3 - "$PH" <<'PY'
import sys
import time
import pigpio

ph = float(sys.argv[1])
pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")

counts = {"n": 0}


def cb(gpio, level, tick):
    counts["n"] += 1


c = pi.callback(6, pigpio.RISING_EDGE, cb)


def window(label, secs):
    counts["n"] = 0
    start = time.monotonic()
    while time.monotonic() - start < secs:
        time.sleep(2.0)
        print("    %s  %.0fs  edges %d"
              % (label, time.monotonic() - start, counts["n"]))
        sys.stdout.flush()
    return counts["n"]


print()
print("#" * 62)
print("#  PHASE A, BASELINE: do NOT touch the emulator for %.0f s" % ph)
print("#" * 62)
a = window("A", ph)

print()
print("#" * 62)
print("#  PHASE B: PRESS CLOSE NOW, REPEATEDLY, FOR %.0f s" % ph)
print("#  Leave about a second between presses.")
print("#  Note whether the thunder LED flashes each time.")
print("#" * 62)
b = window("B", ph)

c.cancel()
pi.stop()

print()
print("=== RESULT ===")
print("  Phase A, baseline  : %d edges in %.0f s  (%.2f/s)" % (a, ph, a / ph))
print("  Phase B, pressing  : %d edges in %.0f s  (%.2f/s)" % (b, ph, b / ph))
print()
if b > a * 2 and b - a >= 3:
    print("  THE EMULATOR IS REACHING THE SENSOR. Phase B is clearly above the")
    print("  noise floor, so the RF is coupling and the sensor is responding.")
elif b > a:
    print("  Marginal. Phase B is higher but not decisively so. Move the coil")
    print("  closer, within the 5 to 15 cm window, and repeat.")
else:
    print("  NO CONTRIBUTION from the emulator: Phase B is no busier than the")
    print("  baseline. Check the thunder LED. If it flashes, the emulator fires")
    print("  and the RF is not coupling, so change the coil gap and orientation.")
    print("  If it does not flash, the press is not reaching the emulator.")
PY

echo
echo "=== CSV, this boot ==="
CSV=/home/quaggasklip/lightning_data/lightning_$(date +%F).csv
echo -n "  LIGHTNING rows: "; grep -c LIGHTNING "$CSV" 2>/dev/null || echo 0
echo -n "  DISTURBER rows: "; grep -c DISTURBER "$CSV" 2>/dev/null || echo 0
echo "  last 8 rows:"
tail -8 "$CSV" 2>/dev/null
