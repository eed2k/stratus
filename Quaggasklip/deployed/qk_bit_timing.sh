#!/bin/bash
# Measure the bit timing of the waveform the Pi actually emits.
#
# Fragments are reaching C2 and never framing into a record, which is the
# signature of bad bit timing rather than a bad wire. pigpiod runs at its default
# 5 us sample rate and wave_add_serial timing is quantised to that tick, while a
# 9600 baud bit is 104.167 us. This measures the result instead of assuming it.
#
# METHOD
# Send 0x55, which is 01010101. With the start and stop bits that gives a clean
# alternating pattern, so every interval between edges is exactly one bit period.
# pigpio timestamps edges in microseconds, so the intervals are the measurement.
#
# WHAT TO CONCLUDE
#   median near 104 us, tight spread   timing is good, look elsewhere
#   median off, or a wide spread       the frame drifts and the receiver loses
#                                      sync part way through, which produces
#                                      exactly the stray bytes we are seeing
#
# A UART resamples from each start bit, so error accumulates only within one
# 10 bit frame. Roughly 5 percent total is the usual tolerance.
#
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

echo "=== pigpiod configuration ==="
pgrep -a pigpiod
echo "  no -s flag means the default 5 us sample rate"

echo
echo "=== STOPPING lightning-detector ==="
sudo systemctl stop lightning-detector
sleep 3

sudo python3 - <<'PY'
import json
import statistics
import time
import pigpio

with open("/home/quaggasklip/lightning_config.json") as f:
    cfg = json.load(f)
TX = int(cfg["campbell_uart_tx_pin"])
BAUD = int(cfg["campbell_uart_baud"])
NOMINAL = 1e6 / BAUD

pi = pigpio.pi()
if not pi.connected:
    raise SystemExit("  cannot reach pigpiod")

print()
print("=== TARGET ===")
print("  GPIO %d, %d baud" % (TX, BAUD))
print("  nominal bit period %.3f us" % NOMINAL)

pi.set_mode(TX, pigpio.OUTPUT)
pi.write(TX, 1)
time.sleep(0.05)

ticks = []


def cb(gpio, level, tick):
    ticks.append(tick)


c = pi.callback(TX, pigpio.EITHER_EDGE, cb)

# 0x55 alternates every bit, so each edge is one bit period apart.
payload = bytes([0x55] * 12)
wid = -1
try:
    pi.wave_add_new()
    pi.wave_add_serial(TX, BAUD, payload)
    wid = pi.wave_create()
    if wid < 0:
        raise SystemExit("  wave_create failed (%d)" % wid)
    pi.wave_send_once(wid)
    started = time.monotonic()
    while pi.wave_tx_busy():
        if time.monotonic() - started > 2.0:
            break
        time.sleep(0.001)
    time.sleep(0.05)
finally:
    c.cancel()
    if wid >= 0:
        try:
            pi.wave_delete(wid)
        except Exception:
            pass

print()
print("=== RESULT ===")
print("  edges captured: %d" % len(ticks))
if len(ticks) < 20:
    print("  too few edges to judge")
    pi.stop()
    raise SystemExit

# pigpio ticks wrap at 2^32 us, about 72 minutes.
gaps = []
for a, b in zip(ticks, ticks[1:]):
    d = (b - a) & 0xFFFFFFFF
    if d < 10000:                 # ignore the idle gaps between frames
        gaps.append(d)

if not gaps:
    print("  no usable intervals")
    pi.stop()
    raise SystemExit

gaps.sort()
med = statistics.median(gaps)
print("  intervals measured : %d" % len(gaps))
print("  min / median / max : %d / %.1f / %d us" % (gaps[0], med, gaps[-1]))
print("  mean               : %.2f us" % statistics.fmean(gaps))
if len(gaps) > 1:
    print("  stdev              : %.2f us" % statistics.stdev(gaps))
print("  nominal            : %.3f us" % NOMINAL)
print("  median error       : %+.2f us  (%+.2f%%)"
      % (med - NOMINAL, 100.0 * (med - NOMINAL) / NOMINAL))

# Histogram of what a bit period actually measures.
from collections import Counter
print()
print("  interval distribution:")
for val, n in sorted(Counter(gaps).items()):
    bar = "#" * min(n, 50)
    mult = val / NOMINAL
    print("    %4d us  x%-4d  %.2f bits  %s" % (val, n, mult, bar))

err = abs(med - NOMINAL) / NOMINAL
spread = (gaps[-1] - gaps[0]) / NOMINAL
print()
if err < 0.02 and spread < 0.5:
    print("  TIMING IS GOOD. The waveform is not the problem.")
else:
    print("  TIMING IS OFF. median error %.2f%%, spread %.2f of a bit."
          % (err * 100, spread))
    print("  Restarting pigpiod with -s 1 gives 1 us granularity instead of 5.")
pi.stop()
PY
