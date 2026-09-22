#!/bin/bash
# Send a test pattern to the CR300 at an arbitrary baud rate.
#
# WHY
# The link delivers the right number of bytes and the wrong values. That is the
# signature of a timing or slew problem rather than a wiring fault: the 50 ms
# pulse on the mirror pin counts perfectly, and a 9600 baud bit is 104 us, about
# 500 times faster. If the edges are being rounded off or sampled at the wrong
# instant, a slower baud has correspondingly more margin and should come through
# clean. If a slow baud is just as corrupt, the fault is not slew and we look at
# polarity and format instead.
#
# The baud is passed in rather than read from lightning_config.json, so sweeping
# does not mean editing the detector's configuration over and over. Set BaudSet in
# the CR300 Public table to the same value first: the logger reopens its port by
# itself, no recompile needed.
#
# Usage: qk_send_at_baud.sh BAUD [COUNT] [MODE]
#   BAUD   300 1200 2400 4800 9600 19200 38400 57600 115200
#   COUNT  records to send, default 1
#   MODE   record  L,40,1234567 CR LF          (default)
#          u       0x55 repeated, 01010101, worst case for slew
#          ones    0xFF repeated, one edge per byte, best case
#          zeros   0x00 repeated, all data bits low
#
# MODE u is the useful one for bit timing: alternating bits mean every bit cell
# has an edge, so any rounding or mis-sampling shows up immediately as something
# other than 85 in RxCode.
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

BAUD=${1:-9600}
COUNT=${2:-1}
MODE=${3:-record}

case "$BAUD" in
  300|1200|2400|4800|9600|19200|38400|57600|115200) ;;
  *) echo "  refusing: $BAUD is not a baud the CR300 supports"; exit 1 ;;
esac

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
echo "=== SENDING $COUNT x '$MODE' AT $BAUD BAUD ==="
echo "    set BaudSet = $BAUD in the CR300 Public table before reading RxCode"
echo

sudo python3 - "$BAUD" "$COUNT" "$MODE" <<'PY'
import json
import sys
import time
import pigpio

baud = int(sys.argv[1])
count = int(sys.argv[2])
mode = sys.argv[3]

with open("/home/quaggasklip/lightning_config.json") as f:
    cfg = json.load(f)
TX_PIN = int(cfg["campbell_uart_tx_pin"])

PAYLOADS = {
    "record": b"L,40,1234567\r\n",
    "u":      b"\x55" * 12 + b"\r\n",
    "ones":   b"\xff" * 12 + b"\r\n",
    "zeros":  b"\x00" * 12 + b"\r\n",
}
if mode not in PAYLOADS:
    sys.exit("  unknown mode %r, expected one of %s"
             % (mode, ", ".join(sorted(PAYLOADS))))
payload = PAYLOADS[mode]

pi = pigpio.pi()
if not pi.connected:
    sys.exit("  cannot reach pigpiod")

print("  serial : GPIO %d @ %d baud" % (TX_PIN, baud))
print("  payload: %r  (%d bytes)" % (payload, len(payload)))
print("  expect : RxCode = %s"
      % " ".join(str(b) for b in payload[:16]))
print("  bit    : %.2f us" % (1000000.0 / baud))
print()

pi.set_mode(TX_PIN, pigpio.OUTPUT)
pi.write(TX_PIN, 1)              # idle high
time.sleep(0.05)

edges = {"n": 0}


def _cb(gpio, level, tick):
    edges["n"] += 1


cb = pi.callback(TX_PIN, pigpio.EITHER_EDGE, _cb)

for i in range(1, count + 1):
    before = edges["n"]
    wid = -1
    try:
        pi.wave_add_new()
        pi.wave_add_serial(TX_PIN, baud, payload)
        wid = pi.wave_create()
        if wid < 0:
            print("  %d  wave_create failed (%d)" % (i, wid))
            continue
        pi.wave_send_once(wid)
        started = time.monotonic()
        while pi.wave_tx_busy():
            if time.monotonic() - started > 5.0:
                break
            time.sleep(0.001)
        time.sleep(0.05)
        print("  %d  sent, edges %d" % (i, edges["n"] - before))
    finally:
        if wid >= 0:
            try:
                pi.wave_delete(wid)
            except Exception:
                pass
    time.sleep(1.5)

cb.cancel()
print()
print("  total edges  : %d" % edges["n"])
print("  TX idle level: %d" % pi.read(TX_PIN))
pi.stop()
PY

echo
echo "=== READ ON THE CR300 ==="
echo "  RxCodeLen        how many bytes were captured"
echo "  RxCode(1..16)    the byte values. This is the measurement."
echo "  RecordsRead      how many reads framed"
echo "  BytesSeenTotal   how many bytes reached C2"
echo
echo "  Set ReArm true before each new attempt to clear the capture."
