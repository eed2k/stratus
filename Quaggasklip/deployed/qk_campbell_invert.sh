#!/bin/bash
# Send the same record with INVERTED serial polarity, to test whether the CR300
# control port expects RS-232 logic rather than TTL.
#
# WHY
# Everything measurable on this link has passed: the Pi emits 105 us bits against
# 104.167 nominal, the CR300 specification puts C1/C2 input at 3.3 V which is what
# the Pi drives, the port opens, and the ground is proven by pulses arriving on
# P_SW. Yet a raw SerialInBlock read sees zero bytes.
#
# Campbell describe the SerialOpen Format parameter as being for data exchanged
# "using RS-232 logic". RS-232 is inverted with respect to TTL: idle is the
# negative level and the start bit is positive. If the port expects that, an
# idle-high TTL line reads as a permanent break, nothing ever frames, and the byte
# count is exactly zero. Which is what we see.
#
# HOW
# pigpio's wave_add_serial only emits standard TTL, so the inverted waveform is
# built by hand with wave_add_generic: idle LOW, start bit HIGH, each data bit
# sent as its complement, stop bit LOW.
#
# Bit timing is accumulated in floating point and rounded per edge rather than
# rounding each bit, so the error cannot compound across a frame.
#
# Pass 1 sends normal TTL as the control. Pass 2 sends inverted.
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
BIT_US = 1e6 / BAUD

pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")

RECORD = b"L,40,1234567\r\n"


def bits_for(data, invert):
    """8N1 bit levels, LSB first, as a list of line levels."""
    out = []
    for byte in data:
        out.append(0 if not invert else 1)          # start bit
        for i in range(8):
            b = (byte >> i) & 1
            out.append(b if not invert else 1 - b)  # data, LSB first
        out.append(1 if not invert else 0)          # stop bit
    return out


def send_bits(levels, idle):
    """Emit a level sequence as a pigpio waveform, coalescing equal runs.

    Edge times are computed from a running float so rounding cannot accumulate
    across the frame, which is what would smear the last bits of a long record.
    """
    pi.set_mode(TX, pigpio.OUTPUT)
    pi.write(TX, idle)
    time.sleep(0.02)

    pulses = []
    i = 0
    n = len(levels)
    elapsed = 0.0
    while i < n:
        lvl = levels[i]
        j = i
        while j < n and levels[j] == lvl:
            j += 1
        start_us = round(elapsed)
        elapsed += (j - i) * BIT_US
        dur = round(elapsed) - start_us
        on = 1 << TX if lvl else 0
        off = 0 if lvl else 1 << TX
        pulses.append(pigpio.pulse(on, off, dur))
        i = j
    # Return the line to idle and hold it there briefly.
    on = 1 << TX if idle else 0
    off = 0 if idle else 1 << TX
    pulses.append(pigpio.pulse(on, off, 2000))

    wid = -1
    try:
        pi.wave_add_new()
        pi.wave_add_generic(pulses)
        wid = pi.wave_create()
        if wid < 0:
            print("      wave_create failed (%d)" % wid)
            return False
        pi.wave_send_once(wid)
        started = time.monotonic()
        while pi.wave_tx_busy():
            if time.monotonic() - started > 2.0:
                break
            time.sleep(0.001)
        time.sleep(0.02)
        return True
    finally:
        if wid >= 0:
            try:
                pi.wave_delete(wid)
            except Exception:
                pass
        pi.write(TX, idle)


print("  GPIO %d, %d baud, %.3f us per bit" % (TX, BAUD, BIT_US))
print("  record: %r" % RECORD.decode("ascii"))

print()
print("=== PASS 1: NORMAL TTL, idle high, 3 records ===")
print("    the control. This is what has been failing all day.")
lv = bits_for(RECORD, invert=False)
for k in range(3):
    ok = send_bits(lv, idle=1)
    print("    %d  %d bits  %s" % (k + 1, len(lv), "ok" if ok else "FAILED"))
    time.sleep(1.0)

print()
print("    --- pause 8 s, note the counters before pass 2 ---")
time.sleep(8.0)

print()
print("=== PASS 2: INVERTED, RS-232 polarity, idle LOW, 3 records ===")
print("    start bit HIGH, data complemented, stop bit LOW")
lv = bits_for(RECORD, invert=True)
for k in range(3):
    ok = send_bits(lv, idle=0)
    print("    %d  %d bits  %s" % (k + 1, len(lv), "ok" if ok else "FAILED"))
    time.sleep(1.0)

# Leave the line idling high, which is where the detector expects it.
pi.set_mode(TX, pigpio.OUTPUT)
pi.write(TX, 1)
print()
print("  line left idling HIGH for the detector")
pi.stop()
PY

echo
echo "=== HOW TO READ IT ==="
echo "  TotalBytesSeen moved only after pass 2  -> the port wants RS-232 polarity."
echo "     Fix: invert on the Pi permanently, or add an inverter in the wire."
echo "  TotalBytesSeen moved after pass 1 too   -> polarity is not the issue."
echo "  Neither moved                           -> not polarity either, and the"
echo "     remaining suspect is the copper between BCM 14 and C2."
