#!/bin/bash
# Hold a GPIO as a slow square wave so it can be followed on a multimeter.
#
# Usage: qk_pin_toggle.sh [gpio] [seconds] [half_period_s]
#
# Why this and not another logger test: the logger's counters have given
# inconsistent answers, so this measures the wire itself rather than inferring
# from what the logger reports. A DC voltmeter will swing between 0 V and about
# 3.3 V once per half period, slowly enough to read off the display.
#
# PROBE IN THIS ORDER, black lead on the Pi GND, or on the CR300 G for the
# second reading:
#
#   1. The Terminal 2 Click "TX" screw terminal
#        toggling      the shield routes the pin to the terminal correctly
#        steady        the pin is not bonded to that terminal, or the Click board
#                      is not fully seated in its socket
#
#   2. The CR300 C2 terminal
#        toggling      the cable is good and the fault is in the logger program
#        steady        the cable between the terminal and C2 is the fault, or the
#                      screw is clamping insulation instead of copper
#
# A reading that sits near 1.6 V rather than swinging is the signature of a
# voltmeter on a floating pin, which means no connection at all.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

GPIO=${1:-14}
SECS=${2:-90}
HALF=${3:-3.0}

restore() {
  echo
  echo "=== RESTARTING lightning-detector ==="
  sudo systemctl start lightning-detector
  sleep 8
  echo -n "  active: "; systemctl is-active lightning-detector
}
trap restore EXIT

echo "=== STOPPING lightning-detector ==="
sudo systemctl stop lightning-detector
sleep 3
echo -n "  active: "; systemctl is-active lightning-detector || true

echo
echo "=== TOGGLING GPIO $GPIO FOR ${SECS}s, ${HALF}s PER STATE ==="
echo "    put a voltmeter on the Terminal 2 Click TX terminal first,"
echo "    then on the CR300 C2 terminal"
echo
sudo python3 - "$GPIO" "$SECS" "$HALF" <<'PY'
import sys
import time
import pigpio

gpio = int(sys.argv[1])
secs = float(sys.argv[2])
half = float(sys.argv[3])

pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")

pi.set_mode(gpio, pigpio.OUTPUT)

deadline = time.monotonic() + secs
level = 1
while time.monotonic() < deadline:
    pi.write(gpio, level)
    readback = pi.read(gpio)
    remaining = deadline - time.monotonic()
    print("  GPIO %-3d driven %s   readback %d   %4.0fs left"
          % (gpio, "HIGH  3.3 V" if level else "LOW   0 V ",
             readback, remaining))
    sys.stdout.flush()
    if readback != level:
        print("    WARNING: the pin did not follow the write. Something else is")
        print("    holding this line.")
    time.sleep(half)
    level = 0 if level else 1

# Leave it idling high, which is where a UART line belongs.
pi.write(gpio, 1)
print()
print("  left idling HIGH, which is the correct resting state for a UART line")
pi.stop()
PY
