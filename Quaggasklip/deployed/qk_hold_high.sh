#!/bin/bash
# Hold GPIO 14 at a clean idle high and see whether the logger's byte trickle
# stops.
#
# BytesSeenTotal is climbing with BytesWaiting at 1, meaning single bytes arrive
# continuously while nothing is being transmitted. That is the signature of a
# floating receive line framing noise, not of a working link.
#
# The discriminator: a UART input tied to a solid idle high frames nothing. A
# floating one keeps framing rubbish regardless.
#
#   trickle STOPS while this runs   -> C2 is connected and sees the idle level
#   trickle CONTINUES              -> C2 is floating, nothing is driving it
#
# Usage: qk_hold_high.sh [seconds]
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

SECS=${1:-75}

restore() {
  echo
  echo "=== RESTARTING lightning-detector ==="
  sudo systemctl start lightning-detector
  sleep 8
  echo -n "  active: "; systemctl is-active lightning-detector
}
trap restore EXIT

echo "=== PIN STATE BEFORE ==="
python3 - <<'PY'
import pigpio
pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  no pigpiod")
names = {0: "INPUT", 1: "OUTPUT", 2: "ALT5", 3: "ALT4", 4: "ALT0"}
for g in (14, 15, 19):
    m = pi.get_mode(g)
    print("  GPIO %-3d %-7s level=%d" % (g, names.get(m, "ALT?"), pi.read(g)))
pi.stop()
PY

echo
echo "=== STOPPING lightning-detector ==="
sudo systemctl stop lightning-detector
sleep 3

echo
echo "=== HOLDING GPIO 14 HIGH FOR ${SECS}s ==="
echo "    watch BytesSeenTotal on the logger."
echo "    If it keeps climbing while this line is held steady, C2 is floating."
echo
sudo python3 - "$SECS" <<'PY'
import sys
import time
import pigpio

secs = float(sys.argv[1])
pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")

pi.set_mode(14, pigpio.OUTPUT)
pi.write(14, 1)

end = time.monotonic() + secs
while time.monotonic() < end:
    time.sleep(5.0)
    print("  GPIO 14 held HIGH, readback %d, %3.0fs left"
          % (pi.read(14), end - time.monotonic()))
    sys.stdout.flush()

print()
print("  held steady throughout, left HIGH")
pi.stop()
PY
