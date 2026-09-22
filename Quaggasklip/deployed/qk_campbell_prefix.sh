#!/bin/bash
# Test whether the logger is losing the first byte of each transmission.
#
# EVIDENCE SO FAR
#   PulseCountTotal 16   the GPIO19 wire and the ground are good
#   SerialOpenOK true    the port is open
#   BytesWaiting 13      bytes arrive and are never consumed
#   StrikeBytes 0, ParseErrorCount 0
#
# The record L,40,1234567 plus CR LF is 14 bytes. 13 are in the buffer. The one
# missing is the leading L, which is the BeginWord both reads hunt for, so nothing
# ever matches and nothing is flagged as an error either. ",40,1234567" plus CR LF
# is exactly 13 characters.
#
# Campbell warn about this: an idle port can lose the first characters of a
# transmission while it wakes. Building the read around the first byte was my
# mistake, because that is the one byte that cannot be trusted.
#
# THE TEST
# Send the same record three ways and see which lands:
#   pass 1   no prefix, the control, expected to fail as before
#   pass 2   two byte prefix, CR LF
#   pass 3   four byte prefix, CR LF CR LF
#
# A prefix is free. SerialInRecord scans for its BeginWord and discards everything
# before it, so leading padding costs nothing and a leading CR LF also flushes any
# partial line left in the buffer.
#
# Read StrikeCount and StrikeBody on the logger after each pass.
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

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

sudo python3 - <<'PY'
import json
import time
import pigpio

with open("/home/quaggasklip/lightning_config.json") as f:
    cfg = json.load(f)
TX = int(cfg["campbell_uart_tx_pin"])
BAUD = int(cfg["campbell_uart_baud"])

pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")

pi.set_mode(TX, pigpio.OUTPUT)
pi.write(TX, 1)
time.sleep(0.1)


def send(payload):
    wid = -1
    try:
        pi.wave_add_new()
        pi.wave_add_serial(TX, BAUD, payload)
        wid = pi.wave_create()
        if wid < 0:
            print("      wave_create failed (%d)" % wid)
            return False
        pi.wave_send_once(wid)
        started = time.monotonic()
        while pi.wave_tx_busy():
            if time.monotonic() - started > 1.0:
                break
            time.sleep(0.001)
        time.sleep(0.03)
        return True
    finally:
        if wid >= 0:
            try:
                pi.wave_delete(wid)
            except Exception:
                pass


RECORD = b"L,40,1234567\r\n"

passes = [
    ("1", b"", "control, no prefix"),
    ("2", b"\r\n", "two byte prefix"),
    ("3", b"\r\n\r\n", "four byte prefix"),
]

for tag, prefix, label in passes:
    print()
    print("=== PASS %s: %s, %d prefix bytes ===" % (tag, label, len(prefix)))
    for i in range(3):
        ok = send(prefix + RECORD)
        print("    sent %d prefix + %d record = %d bytes  %s"
              % (len(prefix), len(RECORD), len(prefix) + len(RECORD),
                 "ok" if ok else "FAILED"))
        time.sleep(1.0)
    print("    --- read StrikeCount now, then continue ---")
    time.sleep(4.0)

pi.write(TX, 1)
pi.stop()
PY

echo
echo "=== HOW TO READ IT ==="
echo "  StrikeCount 9   every pass landed, the prefix was not needed after all"
echo "  StrikeCount 6   passes 2 and 3 landed, so one lost byte was the fault"
echo "  StrikeCount 3   only pass 3 landed, so more than one byte is being lost"
echo "  StrikeCount 0   the first byte is not the problem, look elsewhere"
echo
echo "  StrikeBody should read ,40,1234567 with the leading comma, because the L"
echo "  is consumed as the BeginWord."
