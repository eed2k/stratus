#!/bin/bash
# Prove the Pi to CR300 serial path without writing anything to logger storage.
#
# The detector's own transmit code is reproduced here: pigpio wave_add_serial on
# GPIO26 at 9600 baud, CR LF terminated, which is what CampbellUartTx does.
#
# An H record is sent on purpose rather than an L record. The CR300 program
# recognises "H," , increments the live-only HealthRecordCount and stores
# nothing, so the serial path is proven without a fabricated strike ending up in
# LightningEvents. An L record would have written a permanent bogus row.
#
# Two witnesses again:
#   local  : pigpio counts edges on GPIO26 while the waveform is sent
#   logger : HealthRecordCount rises by exactly the number of records sent
#
# The detector is stopped so only one pigpio client drives GPIO26, and restarted
# from a trap.
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

RECORDS=5

restore() {
  echo
  echo "=== RESTARTING lightning-detector ==="
  sudo systemctl start lightning-detector
  sleep 8
  echo -n "  active: "; systemctl is-active lightning-detector
  sudo journalctl -u lightning-detector -n 6 --no-pager | tail -4
}
trap restore EXIT

echo "=== STOPPING lightning-detector ==="
sudo systemctl stop lightning-detector
sleep 3
echo -n "  active: "; systemctl is-active lightning-detector || true

echo
echo "=== TRANSMIT $RECORDS H RECORDS ON GPIO26 ==="
sudo python3 - "$RECORDS" <<'PY'
import sys
import time
import pigpio

count = int(sys.argv[1])
TX_PIN = 26
BAUD = 9600

pi = pigpio.pi()
if not pi.connected:
    sys.exit("  cannot reach pigpiod")

# Watch the line while we drive it. pigpio tallies in the daemon, so this is an
# independent read of what the pin actually did rather than a claim that the
# call returned without error.
edges = {"n": 0}


def _cb(gpio, level, tick):
    edges["n"] += 1


cb = pi.callback(TX_PIN, pigpio.EITHER_EDGE, _cb)

print("  idle level before: %d  (a UART line idles high)" % pi.read(TX_PIN))

sent = 0
for i in range(count):
    record = ("H,42.%d,-30\r\n" % i).encode("ascii")
    wid = -1
    try:
        pi.wave_add_new()
        pi.wave_add_serial(TX_PIN, BAUD, record)
        wid = pi.wave_create()
        if wid < 0:
            print("  wave_create failed (%d)" % wid)
            continue
        pi.wave_send_once(wid)
        started = time.monotonic()
        while pi.wave_tx_busy():
            if time.monotonic() - started > 0.5:
                break
            time.sleep(0.001)
        sent += 1
        print("  sent: %r" % record.decode("ascii"))
    finally:
        if wid >= 0:
            try:
                pi.wave_delete(wid)
            except Exception:
                pass
    time.sleep(0.3)

time.sleep(0.2)
cb.cancel()
print("  idle level after : %d" % pi.read(TX_PIN))
print()
print("  records sent  : %d" % sent)
print("  edges observed: %d" % edges["n"])

# Each 11 bit frame (start, 8 data, stop) produces at least two edges, and a
# realistic byte produces more. Well under one edge per byte would mean the pin
# never actually moved.
min_expected = sent * 11 * 2
print("  a floor for a real transmission is about %d edges" % min_expected)
if edges["n"] >= min_expected:
    print()
    print("  GPIO26 WAS DRIVEN. The Pi side of the serial link works.")
else:
    print()
    print("  GPIO26 did not move as expected. The waveform was not emitted.")
pi.stop()
PY

echo
echo "=== NOW READ THESE ON THE CR300 ==="
echo "  HealthRecordCount  should have risen by $RECORDS"
echo "  ParseErrorCount    should NOT have moved"
echo "  StrikeCount        should NOT have moved"
echo "  LightningEvents    should have no new row"
echo
echo "  HealthRecordCount rising proves the wire, the ground and the baud rate."
echo "  ParseErrorCount rising instead means the line is connected but the"
echo "  framing is wrong. Neither moving means the wire or the ground is open."
