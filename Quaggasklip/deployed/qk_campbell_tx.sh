#!/bin/bash
# Send a watchable burst of records from the Pi to the CR300 so the counter can
# be seen moving live in the Public table.
#
# Usage: qk_campbell_tx2.sh [count] [gap_seconds]
#
# H records are used, not L records. The CR300 program recognises "H," ,
# increments the live-only HealthRecordCount and stores nothing, so the serial
# path is proven without a fabricated strike landing in LightningEvents.
#
# Transmit is pigpio wave_add_serial, exactly as the detector's CampbellUartTx
# does it. The pin and baud are read from lightning_config.json rather than
# hard coded, so this cannot drift out of step with the detector. The detector is
# stopped so only one pigpio client drives the pin, and restarted from a trap.
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

COUNT=${1:-20}
GAP=${2:-1.0}

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

TX_PIN=$(python3 -c "import json;print(json.load(open('/home/quaggasklip/lightning_config.json'))['campbell_uart_tx_pin'])")

echo
echo "=== SENDING $COUNT RECORDS ON GPIO$TX_PIN, ${GAP}s APART ==="
echo "    watch HealthRecordCount in the CR300 Public table"
echo
sudo python3 - "$COUNT" "$GAP" <<'PY'
import json
import sys
import time
import pigpio

count = int(sys.argv[1])
gap = float(sys.argv[2])

# Read the pin and baud from the live config so this can never drift out of step
# with what the detector itself transmits on.
with open("/home/quaggasklip/lightning_config.json") as f:
    _cfg = json.load(f)
TX_PIN = int(_cfg["campbell_uart_tx_pin"])
BAUD = int(_cfg["campbell_uart_baud"])
print("  from config: GPIO %d @ %d baud" % (TX_PIN, BAUD))

pi = pigpio.pi()
if not pi.connected:
    sys.exit("  cannot reach pigpiod")

edges = {"n": 0}


def _cb(gpio, level, tick):
    edges["n"] += 1


cb = pi.callback(TX_PIN, pigpio.EITHER_EDGE, _cb)

idle_before = pi.read(TX_PIN)
print("  GPIO%d idle level before: %d   (a UART line idles high)" % (TX_PIN, idle_before))
if idle_before != 1:
    print("  WARNING: the line is not idling high. A receiver will see a break.")
print()

sent = 0
for i in range(1, count + 1):
    # A counter inside the record so LastRecord visibly changes on the logger and
    # a stalled display is obvious.
    record = ("H,%d,-30\r\n" % i).encode("ascii")
    before = edges["n"]
    wid = -1
    try:
        pi.wave_add_new()
        pi.wave_add_serial(TX_PIN, BAUD, record)
        wid = pi.wave_create()
        if wid < 0:
            print("  %2d  wave_create failed (%d)" % (i, wid))
            continue
        pi.wave_send_once(wid)
        started = time.monotonic()
        while pi.wave_tx_busy():
            if time.monotonic() - started > 0.5:
                break
            time.sleep(0.001)
        time.sleep(0.02)
        sent += 1
        print("  %2d  sent %-14r  edges %d"
              % (i, record.decode("ascii"), edges["n"] - before))
    finally:
        if wid >= 0:
            try:
                pi.wave_delete(wid)
            except Exception:
                pass
    if i < count:
        time.sleep(gap)

time.sleep(0.2)
cb.cancel()
print()
print("  GPIO%d idle level after : %d" % (TX_PIN, pi.read(TX_PIN)))
print("  records sent            : %d" % sent)
print("  total edges observed    : %d" % edges["n"])

# Each 11 bit frame (start, 8 data, stop) yields at least two edges. Well under
# that floor would mean the pin never actually moved.
floor = sent * 11 * 2
print("  floor for a real send   : about %d" % floor)
print()
if edges["n"] >= floor:
    print("  GPIO%d WAS DRIVEN. The Pi side of the link works." % TX_PIN)
else:
    print("  GPIO%d did not move as expected. The waveform was not emitted." % TX_PIN)
pi.stop()
PY

echo
echo "=== READ ON THE CR300 ==="
echo "  HealthRecordCount  up by $COUNT            -> wire, ground and baud all good"
echo "  ParseErrorCount    up by $COUNT instead    -> link fine, older program loaded"
echo "  LastRecord         H,$COUNT,-30"
echo "  StrikeCount        unchanged"
echo "  neither moved                              -> signal or ground is open"
