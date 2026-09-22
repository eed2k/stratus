#!/bin/bash
# Send real L records so the result is visible in stored data, not only in a live
# variable.
#
# Every previous test used H records on purpose, so nothing reached storage. That
# makes LightningEvents and LightningDaily stay empty even when the link is
# perfect, which is indistinguishable from a dead link if you are watching the
# data tables. This sends L records instead.
#
# WHAT THIS WRITES TO THE LOGGER: three rows in LightningEvents with distance
# 40 km and energy 1234567. Those values are deliberately unmistakable so the
# rows can be recognised as commissioning artefacts and cleared later.
#
# A pulse is also emitted on the pulse mirror pin. If that wire is connected it
# will move PulseCountTotal; if it is not, nothing happens and that is itself
# useful to know.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

COUNT=${1:-3}
TEST_DIST=40
TEST_ENERGY=1234567

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
echo "=== SENDING $COUNT STRIKE RECORDS ==="
echo "    L,$TEST_DIST,$TEST_ENERGY   plus a pulse on the mirror pin"
echo
sudo python3 - "$COUNT" "$TEST_DIST" "$TEST_ENERGY" <<'PY'
import json
import sys
import time
import pigpio

count = int(sys.argv[1])
dist = int(sys.argv[2])
energy = int(sys.argv[3])

with open("/home/quaggasklip/lightning_config.json") as f:
    cfg = json.load(f)
TX_PIN = int(cfg["campbell_uart_tx_pin"])
BAUD = int(cfg["campbell_uart_baud"])
PULSE_PIN = int(cfg["pulse_mirror_pin"])
PULSE_MS = int(cfg["pulse_mirror_width_ms"])

pi = pigpio.pi()
if not pi.connected:
    sys.exit("  cannot reach pigpiod")

print("  serial : GPIO %d @ %d baud" % (TX_PIN, BAUD))
print("  pulse  : GPIO %d, %d ms" % (PULSE_PIN, PULSE_MS))

pi.set_mode(TX_PIN, pigpio.OUTPUT)
pi.write(TX_PIN, 1)              # UART idle high
pi.set_mode(PULSE_PIN, pigpio.OUTPUT)
pi.write(PULSE_PIN, 0)
time.sleep(0.05)

edges = {"tx": 0}


def _cb(gpio, level, tick):
    edges["tx"] += 1


cb = pi.callback(TX_PIN, pigpio.EITHER_EDGE, _cb)

for i in range(1, count + 1):
    record = ("L,%d,%d\r\n" % (dist, energy)).encode("ascii")
    before = edges["tx"]
    wid = -1
    try:
        pi.wave_add_new()
        pi.wave_add_serial(TX_PIN, BAUD, record)
        wid = pi.wave_create()
        if wid < 0:
            print("  %d  wave_create failed (%d)" % (i, wid))
            continue
        pi.wave_send_once(wid)
        started = time.monotonic()
        while pi.wave_tx_busy():
            if time.monotonic() - started > 0.5:
                break
            time.sleep(0.001)
        time.sleep(0.02)
        print("  %d  sent %-20r edges %d"
              % (i, record.decode("ascii"), edges["tx"] - before))
    finally:
        if wid >= 0:
            try:
                pi.wave_delete(wid)
            except Exception:
                pass

    # Strike pulse, same shape the detector emits.
    pi.write(PULSE_PIN, 1)
    time.sleep(PULSE_MS / 1000.0)
    pi.write(PULSE_PIN, 0)
    print("     pulsed GPIO %d for %d ms" % (PULSE_PIN, PULSE_MS))
    time.sleep(1.0)

cb.cancel()
print()
print("  total TX edges: %d" % edges["tx"])
print("  TX idle level : %d" % pi.read(TX_PIN))
pi.stop()
PY

echo
echo "=== READ ON THE CR300 ==="
echo "  Public table:"
echo "    StrikeCount      up by $COUNT"
echo "    LastDistanceKm   $TEST_DIST"
echo "    LastEnergy       $TEST_ENERGY"
echo "    BytesReturned    non-zero"
echo "    LastRecord       L,$TEST_DIST,$TEST_ENERGY"
echo "    PulseCountTotal  up by $COUNT if the pulse wire is connected"
echo
echo "  LightningEvents table:"
echo "    $COUNT new rows, distance $TEST_DIST, energy $TEST_ENERGY"
echo
echo "  These rows are commissioning artefacts. Reset the data tables when the"
echo "  site goes live so they are not mistaken for real strikes."
