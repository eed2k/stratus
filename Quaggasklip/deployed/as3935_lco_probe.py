#!/usr/bin/env python3
"""AS3935 LCO pin hunt and true antenna resonance measurement.

Purpose
-------
The deployed detector reports an antenna frequency of 0 Hz and then "corrects"
a healthy antenna by stepping tune_cap. This probe establishes the facts:

  1. Which GPIO the AS3935 LCO output actually appears on, measured rather
     than assumed.
  2. The real resonant frequency of the antenna.
  3. The tune_cap value that puts resonance closest to 500 kHz.

Why the deployed measurement reads zero
---------------------------------------
The detector leaves the LCO divider at 16, so the IRQ pin carries roughly
31.25 kHz. It then counts rising edges with RPi.GPIO event detection and a
Python callback, which on an 800 MHz ARMv6 cannot service an edge every 32 us.
This probe raises the divider to 128, bringing the pin down to about 3.9 kHz,
and counts with pigpio, whose callbacks are serviced in the daemon rather than
in the Python interpreter.

The sensor registers touched here (0x03 and 0x08) are saved on entry and
restored on exit. The detector also reprograms them from scratch when it
starts, so nothing is left behind either way.

Property of METRON (PTY) LTD [Inteltronics]
Developer: L.J. Esterhuizen
"""

import re
import sys
import time
from pathlib import Path

try:
    import spidev
except ImportError:
    sys.exit("spidev not available")
try:
    import pigpio
except ImportError:
    sys.exit("pigpio not available")

DETECTOR_SRC = Path("/home/quaggasklip/lightning_detector.py")

REG_INT_MASK_ANT = 0x03   # bits 7:6 LCO_FDIV, bit 5 mask disturber
REG_DISP_IRQ = 0x08       # bit 7 DISP_LCO, bits 3:0 tune cap

TARGET_HZ = 500000
TOLERANCE = 0.035

# Divider we force for the measurement. 500 kHz / 128 = 3906 Hz, which pigpio
# samples comfortably at its default 5 us tick.
MEASURE_FDIV = 128
FDIV_BITS = {16: 0, 32: 1, 64: 2, 128: 3}

# Every GPIO that could plausibly carry a mikroBUS INT line on the Pi 2 Click
# Shield, plus the two pins the detector uses for the Campbell link so their
# state is visible too. Deliberately excluded: 0-3 (ID EEPROM and I2C),
# 8-11 (the SPI bus this probe is using), 14-15 (the serial console).
CANDIDATES = [4, 5, 6, 7, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]

COUNT_SECS = 1.0


def read_detector_default(name, fallback):
    """Pull a numeric default out of the deployed detector source.

    Keeps this probe in step with whatever the service actually uses for the
    SPI link instead of hard coding a second opinion.

    The literal must be parsed with base 0, not a bare digit run. The detector
    writes the SPI mode as ``0b01``, and a ``\\d+`` pattern matches the leading
    zero of that, which silently selects SPI mode 0. Mode 0 samples on the
    wrong clock edge, so every register read comes back shifted one bit right
    and looks like plausible but wrong configuration.
    """
    try:
        src = DETECTOR_SRC.read_text(errors="replace")
    except OSError:
        return fallback
    m = re.search(
        r"self\.%s\s*=\s*(0[bx][0-9a-fA-F]+|\d+)" % re.escape(name), src
    )
    return int(m.group(1), 0) if m else fallback


class As3935:
    """Minimal SPI access, framed exactly as the deployed detector frames it."""

    def __init__(self, bus, dev, speed, mode):
        self.spi = spidev.SpiDev()
        self.spi.open(bus, dev)
        self.spi.max_speed_hz = speed
        self.spi.mode = mode

    def read(self, reg):
        return self.spi.xfer2([(reg & 0x3F) | 0x40, 0x00])[1]

    def write(self, reg, value):
        self.spi.xfer2([reg & 0x3F, value & 0xFF])

    def modify(self, reg, mask, shift, value):
        cur = self.read(reg)
        self.write(reg, (cur & ~(mask << shift)) | ((value & mask) << shift))

    def close(self):
        self.spi.close()


class EdgeTally:
    """Rising-edge counters on many GPIOs at once, tallied inside pigpiod."""

    def __init__(self, pi, pins):
        self.pi = pi
        self.counts = {p: 0 for p in pins}
        self._cbs = []
        for p in pins:
            self._cbs.append(
                pi.callback(p, pigpio.RISING_EDGE, self._make(p))
            )

    def _make(self, pin):
        def _handler(gpio, level, tick):
            self.counts[pin] += 1
        return _handler

    def reset(self):
        for p in self.counts:
            self.counts[p] = 0

    def snapshot(self):
        return dict(self.counts)

    def cancel(self):
        for cb in self._cbs:
            try:
                cb.cancel()
            except Exception:
                pass
        self._cbs = []


def measure(sensor, tally, secs=COUNT_SECS):
    """Count edges on every candidate pin with DISP_LCO asserted."""
    reg08 = sensor.read(REG_DISP_IRQ)
    sensor.write(REG_DISP_IRQ, reg08 | 0x80)
    time.sleep(0.05)                      # let the oscillator settle
    tally.reset()
    time.sleep(secs)
    counts = tally.snapshot()
    sensor.write(REG_DISP_IRQ, reg08 & ~0x80)
    time.sleep(0.01)
    return counts


def main():
    spi_speed = read_detector_default("SPI_SPEED_HZ", 1000000)
    spi_mode = read_detector_default("SPI_MODE", 1)
    print("SPI: bus 0 device 0, speed %d Hz, mode %d" % (spi_speed, spi_mode))

    pi = pigpio.pi()
    if not pi.connected:
        sys.exit("cannot reach pigpiod")

    sensor = As3935(0, 0, spi_speed, spi_mode)

    saved_03 = sensor.read(REG_INT_MASK_ANT)
    saved_08 = sensor.read(REG_DISP_IRQ)

    print()
    print("=== REGISTER DUMP (sensor liveness) ===")
    regs = {r: sensor.read(r) for r in range(0x00, 0x09)}
    for r, v in regs.items():
        print("  0x%02X = 0x%02X  %s" % (r, v, format(v, "08b")))
    if all(v == 0x00 for v in regs.values()) or all(
        v == 0xFF for v in regs.values()
    ):
        sensor.close()
        pi.stop()
        sys.exit("SPI reads are all 0x00/0xFF: the sensor is not responding")
    print("  tune_cap now  : %d" % (saved_08 & 0x0F))
    print("  LCO_FDIV now  : %d" % [16, 32, 64, 128][(saved_03 >> 6) & 0x03])
    print("  mask disturber: %d" % ((saved_03 >> 5) & 0x01))

    # Clock-phase sanity check. With watchdog and spike rejection both at 5 the
    # deployed detector leaves register 0x01 at 0x55. If this instead reads
    # 0x2A, the whole dump is one bit right of the truth and the SPI mode is
    # wrong, so nothing below can be trusted.
    reg01 = regs[0x01]
    if reg01 == 0x55:
        print("  SPI framing   : OK (0x01 = 0x55 as expected)")
    elif reg01 == 0x2A:
        sensor.close()
        pi.stop()
        sys.exit("SPI framing WRONG: 0x01 = 0x2A, one bit right of 0x55. "
                 "Reads are shifted, aborting.")
    else:
        print("  SPI framing   : 0x01 = 0x%02X, expected 0x55, treat the "
              "register dump with caution" % reg01)

    tally = EdgeTally(pi, CANDIDATES)
    try:
        # Baseline with the LCO output off, to expose pins that are simply
        # noisy or being driven by something else.
        print()
        print("=== PHASE 1: baseline, DISP_LCO OFF (%.1f s) ===" % COUNT_SECS)
        tally.reset()
        time.sleep(COUNT_SECS)
        baseline = tally.snapshot()
        noisy = {p: c for p, c in baseline.items() if c > 0}
        print("  active pins: %s" % (noisy if noisy else "none, all quiet"))

        # Force the divider down so the pin frequency is countable.
        sensor.modify(REG_INT_MASK_ANT, 0x03, 6, FDIV_BITS[MEASURE_FDIV])
        print()
        print("=== PHASE 2: LCO pin hunt, FDIV=%d (%.1f s) ==="
              % (MEASURE_FDIV, COUNT_SECS))
        counts = measure(sensor, tally)

        found = []
        for p in CANDIDATES:
            delta = counts[p] - baseline.get(p, 0)
            if delta > 100:               # a real clock, not stray noise
                hz_pin = delta / COUNT_SECS
                hz_ant = hz_pin * MEASURE_FDIV
                found.append((p, hz_pin, hz_ant))
        if not found:
            print("  NO pin carried a clock. Raw counts:")
            for p in CANDIDATES:
                print("    GPIO %-2d : %d" % (p, counts[p]))
        else:
            print("  %-8s %-14s %s" % ("GPIO", "pin freq (Hz)", "implied antenna (Hz)"))
            for p, hz_pin, hz_ant in found:
                print("  GPIO %-3d %-14.1f %.0f" % (p, hz_pin, hz_ant))

        if not found:
            print()
            print("CONCLUSION: the LCO output is not reaching any monitored")
            print("GPIO. Either the Thunder Click INT line is not connected to")
            print("the Pi header, or the antenna is not oscillating.")
            return

        # Take the strongest pin as the LCO line and sweep tune_cap on it.
        lco_pin = max(found, key=lambda t: t[1])[0]
        print()
        print("=== PHASE 3: tune_cap sweep on GPIO %d ===" % lco_pin)
        low = TARGET_HZ * (1 - TOLERANCE)
        high = TARGET_HZ * (1 + TOLERANCE)
        print("  target %d Hz, in-tolerance band %.0f to %.0f Hz"
              % (TARGET_HZ, low, high))
        print()
        print("  %-9s %-8s %-13s %-11s %s"
              % ("tune_cap", "pF", "antenna (Hz)", "error (Hz)", "verdict"))
        results = []
        # A 1.0 s window gives 128 Hz of resolution at this divider. Half a
        # second would quantise to 256 Hz and make adjacent caps look identical.
        for cap in range(16):
            sensor.modify(REG_DISP_IRQ, 0x0F, 0, cap)
            time.sleep(0.10)
            c = measure(sensor, tally, secs=1.0)
            delta = c[lco_pin] - baseline.get(lco_pin, 0)
            hz_ant = (delta / 1.0) * MEASURE_FDIV
            err = hz_ant - TARGET_HZ
            verdict = "IN TOLERANCE" if low <= hz_ant <= high else ""
            results.append((cap, hz_ant, abs(err)))
            print("  %-9d %-8d %-13.0f %-+11.0f %s"
                  % (cap, cap * 8, hz_ant, err, verdict))

        best = min(results, key=lambda t: t[2])
        print()
        print("=== RESULT ===")
        print("  LCO pin            : GPIO %d" % lco_pin)
        print("  configured irq_pin : %d" % (
            17 if lco_pin == 17 else lco_pin))
        print("  best tune_cap      : %d  (%d pF)" % (best[0], best[0] * 8))
        print("  frequency there    : %.0f Hz  (error %+.0f Hz, %.2f%%)"
              % (best[1], best[1] - TARGET_HZ,
                 100.0 * (best[1] - TARGET_HZ) / TARGET_HZ))
        print("  within 3.5%%        : %s"
              % ("YES" if low <= best[1] <= high else "NO"))
    finally:
        tally.cancel()
        # Put the sensor back exactly as it was found.
        sensor.write(REG_INT_MASK_ANT, saved_03)
        sensor.write(REG_DISP_IRQ, saved_08)
        sensor.close()
        pi.stop()
        print()
        print("registers restored: 0x03=0x%02X 0x08=0x%02X"
              % (saved_03, saved_08))


if __name__ == "__main__":
    main()
