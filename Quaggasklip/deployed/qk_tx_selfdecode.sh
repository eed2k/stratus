#!/bin/bash
# Decode the Pi's own transmitted waveform back into bytes.
#
# WHY THIS AND NOT ANOTHER PERIOD MEASUREMENT
# The bit timing was measured once before: 105 us median against 104.167 nominal.
# That number was then treated as proof the transmit side was sound, which it is
# not. A median says nothing about the first bit, about jitter, or about whether a
# receiver sampling mid-bit would actually recover the byte. The CR300 is now known
# to receive the right NUMBER of bytes with the wrong VALUES, which is exactly what
# a subtly malformed waveform looks like from the far end.
#
# So this does what the CR300 does. It timestamps every edge on the transmit pin,
# reconstructs the line level over time, then samples at the nominal mid-bit
# instants for the configured baud and decodes 8N1 bytes, LSB first. The result is
# compared against what was actually sent.
#
# It also reports the sampling margin: how far each mid-bit sample point sat from
# the nearest edge, as a percentage of a bit. A healthy line is near 50%. Anything
# under about 25% is living dangerously and will fail with a little added slew or
# a receiver whose clock differs slightly.
#
# WHAT THE OUTCOMES MEAN
#   decodes clean, wide margins   transmit is sound. The fault is the cable or the
#                                 CR300 receive path, and no amount of Pi-side
#                                 work will fix it.
#   decodes wrong                 the fault is ours and it is fixable in software.
#   margins narrow but correct    it works on the pad and will not survive a long
#                                 or capacitive run. Drop the baud.
#
# CAVEAT, stated because it matters: this measures the signal at the Pi's own pad,
# through pigpio's notification stream at 1 us tick resolution. It cannot see what
# the cable does to the edges downstream. It can only exonerate or convict the
# transmitter.
#
# Usage: qk_tx_selfdecode.sh [BAUD] [MODE]
#   BAUD  default 9600
#   MODE  record (default) | u | ones | zeros
#
# METRON (PTY) LTD | Inteltronics - L.J Esterhuizen
set -u

BAUD=${1:-9600}
MODE=${2:-record}

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
echo

sudo python3 - "$BAUD" "$MODE" <<'PY'
import json
import sys
import time
import pigpio

baud = int(sys.argv[1])
mode = sys.argv[2]

with open("/home/quaggasklip/lightning_config.json") as f:
    cfg = json.load(f)
TX = int(cfg["campbell_uart_tx_pin"])

PAYLOADS = {
    "record": b"L,40,1234567\r\n",
    "u":      b"\x55" * 8,
    "ones":   b"\xff" * 8,
    "zeros":  b"\x00" * 8,
}
if mode not in PAYLOADS:
    sys.exit("  unknown mode %r" % mode)
payload = PAYLOADS[mode]

bit_us = 1000000.0 / baud

pi = pigpio.pi()
if not pi.connected:
    sys.exit("  cannot reach pigpiod")

print("  pin %d, %d baud, bit = %.3f us" % (TX, baud, bit_us))
print("  payload: %r" % payload)
print()

pi.set_mode(TX, pigpio.OUTPUT)
pi.write(TX, 1)
time.sleep(0.05)

edges = []          # (tick, new_level)


def _cb(gpio, level, tick):
    if level in (0, 1):
        edges.append((tick, level))


cb = pi.callback(TX, pigpio.EITHER_EDGE, _cb)
time.sleep(0.05)
start_mark = pi.get_current_tick()

wid = -1
try:
    pi.wave_add_new()
    pi.wave_add_serial(TX, baud, payload)
    wid = pi.wave_create()
    if wid < 0:
        sys.exit("  wave_create failed (%d)" % wid)
    pi.wave_send_once(wid)
    while pi.wave_tx_busy():
        time.sleep(0.001)
    time.sleep(0.10)
finally:
    if wid >= 0:
        try:
            pi.wave_delete(wid)
        except Exception:
            pass

cb.cancel()
pi.stop()

if not edges:
    sys.exit("  no edges captured at all")

# Normalise ticks to the first edge, handling 32-bit microsecond wraparound.
t0 = edges[0][0]


def rel(t):
    return ((t - t0) & 0xFFFFFFFF)


ev = [(rel(t), lv) for t, lv in edges]
ev.sort(key=lambda x: x[0])

print("  edges captured: %d" % len(ev))
span = ev[-1][0] - ev[0][0]
print("  span: %d us   expected about %d us for %d bytes"
      % (span, int(len(payload) * 10 * bit_us), len(payload)))
print()


def level_at(t):
    """Line level at time t. Idle high before the first edge."""
    lo, hi = 0, len(ev) - 1
    if t < ev[0][0]:
        return 1
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if ev[mid][0] <= t:
            best = mid
            lo = mid + 1
        else:
            hi = mid - 1
    return ev[best][1] if best is not None else 1


def margin_pct(t):
    """Distance from t to the nearest edge, as a percentage of one bit."""
    d = min(abs(t - e[0]) for e in ev)
    return 100.0 * d / bit_us


# Find each start bit: a falling edge that begins a frame. Walk the edge list and
# take a falling edge as a frame start when it is not inside a frame already.
frames = []
next_free = -1
for t, lv in ev:
    if lv == 0 and t >= next_free:
        frames.append(t)
        next_free = t + int(9.5 * bit_us)

print("  frames detected: %d   (payload has %d bytes)"
      % (len(frames), len(payload)))
print()

decoded = bytearray()
worst = 100.0
rows = []
for idx, st in enumerate(frames):
    # Verify the start bit is still low at its own mid point.
    start_ok = level_at(st + bit_us * 0.5) == 0
    val = 0
    bit_margins = []
    for b in range(8):
        t = st + bit_us * (1.5 + b)
        if level_at(t):
            val |= (1 << b)
        bit_margins.append(margin_pct(t))
    stop_t = st + bit_us * 9.5
    stop_ok = level_at(stop_t) == 1
    m = min(bit_margins)
    worst = min(worst, m)
    decoded.append(val)
    exp = payload[idx] if idx < len(payload) else None
    rows.append((idx + 1, val, exp, start_ok, stop_ok, m))

print("   #  got  expected  start  stop  min margin")
for n, val, exp, s_ok, p_ok, m in rows:
    flag = "" if exp is not None and val == exp else "   <== MISMATCH"
    print("  %2d  %3d  %8s  %5s  %4s  %5.1f%%%s"
          % (n, val, "-" if exp is None else exp,
             "ok" if s_ok else "BAD", "ok" if p_ok else "BAD", m, flag))

print()
print("  decoded : %r" % bytes(decoded))
print("  sent    : %r" % payload)
ok = bytes(decoded) == payload
print()
print("  RESULT: %s" % ("waveform self-decodes CORRECTLY"
                        if ok else "waveform DOES NOT self-decode"))
print("  worst sampling margin: %.1f%% of a bit (50%% is ideal, under 25%% is fragile)"
      % worst)
print()
if ok:
    print("  The transmitter is exonerated. The corruption the CR300 sees is")
    print("  introduced after this pad: the cable, or the receiver itself.")
else:
    print("  The fault is on the Pi side and is fixable in software.")
PY
