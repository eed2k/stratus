#!/bin/bash
# Prove or disprove a DC connection to the CR300's C2, using the receiver itself
# as the instrument. No scope, no rewiring, no new program.
#
# WHY THIS IS THE RIGHT TEST NOW
# The Pi's waveform has been measured at its own pad and self-decodes perfectly:
# all 14 bytes correct, every start and stop bit valid, 46% sampling margin. So the
# corruption is introduced after the pad. Two candidates remain, and they call for
# opposite fixes:
#
#   a) The wire is connected and the fast edges are being mangled. Fix: slow the
#      baud, or improve the cable.
#   b) The wire is NOT connected and C2 is floating, framing crosstalk from the
#      transmitting conductor into garbage bytes. Fix: fix the connection. No
#      amount of baud reduction will help, and time spent on the cable is wasted.
#
# Both produce "bytes arrive, values are wrong", which is why counters could not
# separate them. This can, because it uses DC instead of edges.
#
# HOW
# A UART receive line held LOW continuously looks like an endless start bit
# followed by eight zero data bits and a missing stop bit. The receiver frames it
# as a stream of nulls and framing errors, about one byte every ten bit times: at
# 9600 baud that is roughly 960 bytes a second. Held HIGH it is simply idle and
# produces nothing at all.
#
# Neither case depends on edge speed, so cable capacitance is irrelevant. This is
# a pure continuity test through the real receive path.
#
# READ BytesSeenTotal ON THE CR300 BEFORE AND AFTER EACH RUN
#
#   high, 15 s  ->  BytesSeenTotal must NOT move. If it climbs, C2 is picking up
#                   noise and the input is not being held by our driver at all.
#   low,  5 s   ->  BytesSeenTotal must climb by THOUSANDS. If it does not move,
#                   there is no DC path to C2 and every byte seen so far was
#                   crosstalk, not data.
#
# Run "high" first. It is the control, and a control that fails invalidates the
# other result.
#
# This works with either the production program or QK_CR300_RxProbe, since both
# publish BytesSeenTotal.
#
# Usage: qk_line_dc.sh high|low [SECONDS]
#
# Safe: this only drives a 3.3 V logic input to a valid level and restores idle
# high afterwards, which is the state the line rests at between records anyway.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

MODE=${1:-}
SECS=${2:-}

case "$MODE" in
  high) : "${SECS:=15}" ;;
  low)  : "${SECS:=5}" ;;
  *) echo "usage: qk_line_dc.sh high|low [seconds]"; exit 1 ;;
esac

restore() {
  echo
  echo "=== RESTORING idle high and RESTARTING lightning-detector ==="
  sudo python3 -c "
import json, pigpio
cfg = json.load(open('/home/quaggasklip/lightning_config.json'))
pi = pigpio.pi()
if pi.connected:
    pin = int(cfg['campbell_uart_tx_pin'])
    pi.set_mode(pin, pigpio.OUTPUT)
    pi.write(pin, 1)
    print('  GPIO%d restored to %d' % (pin, pi.read(pin)))
    pi.stop()
" || true
  sudo systemctl start lightning-detector
  sleep 8
  echo -n "  active: "; systemctl is-active lightning-detector
}
trap restore EXIT

echo "=== STOPPING lightning-detector ==="
sudo systemctl stop lightning-detector
sleep 3
echo
echo "############################################################"
echo "#  READ BytesSeenTotal ON THE CR300 NOW, BEFORE THE HOLD   #"
echo "############################################################"
echo
sleep 6

sudo python3 - "$MODE" "$SECS" <<'PY'
import json
import sys
import time
import pigpio

mode = sys.argv[1]
secs = float(sys.argv[2])
level = 1 if mode == "high" else 0

with open("/home/quaggasklip/lightning_config.json") as f:
    cfg = json.load(f)
TX = int(cfg["campbell_uart_tx_pin"])
BAUD = int(cfg["campbell_uart_baud"])

pi = pigpio.pi()
if not pi.connected:
    sys.exit("  cannot reach pigpiod")

pi.set_mode(TX, pigpio.OUTPUT)
pi.write(TX, level)
readback = pi.read(TX)

print("  holding GPIO%d %s for %.0f s" % (TX, mode.upper(), secs))
print("  readback at the pad: %d" % readback)
if readback != level:
    print("  WARNING: the pad did not take the level. Something else owns this pin.")
print()
if level == 0:
    frames = int(secs * BAUD / 10.0)
    print("  a connected line should frame roughly %d bytes in this time" % frames)
    print("  (%d baud / 10 bits per frame)" % BAUD)
else:
    print("  a connected line should frame ZERO bytes: this is just idle")
print()

for i in range(int(secs), 0, -1):
    print("   %2d" % i, end="\r", flush=True)
    time.sleep(1.0)

pi.write(TX, 1)
print("  done, line returned to idle high (%d)" % pi.read(TX))
pi.stop()
PY

echo
echo "############################################################"
echo "#  READ BytesSeenTotal ON THE CR300 AGAIN, NOW             #"
echo "############################################################"
echo
echo "  Interpretation:"
if [ "$MODE" = "low" ]; then
  echo "    climbed by thousands  -> C2 IS connected. The fault is edge"
  echo "                             corruption, so drop BaudSet to 1200 next."
  echo "    did not move          -> there is NO DC path to C2. Every byte seen"
  echo "                             so far was crosstalk. Fix the wiring; the"
  echo "                             cable and the baud are irrelevant."
else
  echo "    did not move          -> good, the control passes. Now run 'low'."
  echo "    climbed               -> C2 is floating or noisy and is not under our"
  echo "                             control at all. That invalidates the 'low'"
  echo "                             test, so fix this first."
fi
