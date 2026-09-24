#!/usr/bin/env python3
"""Characterise what this site's AS3935 actually hears, and pick thresholds from data.

WHY THIS EXISTS

The site's EMI forced conservative settings (noise_floor 5, watchdog_thresh 5,
min_strikes 5) and those settings then missed a real storm entirely: the unit was
alive and logged nothing. Dropping to noise_floor 2 / watchdog 2 produced
detections immediately, but also disturbers at roughly two a second. Somewhere
between the two is a setting that alerts on real activity inside the radius
without drowning in local noise, and guessing at it has already cost a night.

So this measures instead. It captures every interrupt with precise timing and the
full register set, writes a CSV, and then reports the statistics that actually
separate lightning from machinery.

WHAT THE SENSOR DOES AND DOES NOT GIVE US

The AS3935 is a fully integrated detector. There is no waveform on the SPI bus, so
no amount of DSP or FFT can be applied to the RF: the analogue front end, the
500 kHz band-pass and the pattern recognition are all inside the chip. What comes
out is an interrupt type (0x03), a 21-bit energy figure (0x04 to 0x06) and a 6-bit
distance estimate (0x07).

Energy and distance are only *specified* as valid after a LIGHTNING interrupt.
Whether they hold anything meaningful after a DISTURBER is undocumented, so this
tool reads them on every interrupt and records them rather than assuming. If the
disturber energies turn out to vary with the source, they are useful for
characterising it. If they are constant or zero, that is worth knowing too, and
the CSV will show which.

WHAT DISCRIMINATES, GIVEN NO WAVEFORM

Temporal structure, not amplitude. Site EMI is usually periodic: pumps, VFDs,
compressors, switchgear, mains harmonics. Lightning is close to Poisson, clustered
but not periodic. So the discriminator is an autocorrelation over inter-arrival
times, which is a real use of a transform rather than a decorative one.

Also useful, and all computed below:
  - energy dispersion: a fixed source sits at near-constant energy, a storm does not
  - distance dispersion: both of tonight's detections read exactly 1 km, which is
    the signature of something fixed rather than a cell tracking across the sky
  - inter-arrival distribution: machinery gives tight repeatable gaps

HOW TO USE IT

  sudo systemctl stop lightning-detector
  sudo python3 qk_emi_profile.py --minutes 10 --noise-floor 2 --watchdog 2
  sudo systemctl start lightning-detector

Run it at several settings, ideally with weather present and again without, and
compare. Registers 0x01, 0x02, 0x03 and 0x08 are saved on entry and restored on
exit, and the detector reprograms everything on start anyway.

Property of METRON (PTY) LTD [Inteltronics]
Developer: L.J. Esterhuizen
"""

import argparse
import csv
import json
import math
import os
import statistics
import sys
import time

try:
    import spidev
except ImportError:
    sys.exit("spidev not available")
try:
    import pigpio
except ImportError:
    sys.exit("pigpio not available; is pigpiod running?")

CFG = "/home/quaggasklip/lightning_config.json"

REG_AFE_GAIN = 0x00
REG_THRESHOLD = 0x01      # noise_floor bits 6:4, watchdog bits 3:0
REG_LIGHTNING = 0x02      # min_strikes bits 5:4, spike_reject bits 3:0
REG_INT_MASK_ANT = 0x03   # interrupt bits 3:0, mask_disturber bit 5
REG_ENERGY_L = 0x04
REG_ENERGY_M = 0x05
REG_ENERGY_MM = 0x06
REG_DISTANCE = 0x07
REG_DISP_IRQ = 0x08

INT_NOISE = 0x01
INT_DISTURBER = 0x04
INT_LIGHTNING = 0x08

NAMES = {INT_NOISE: "NOISE", INT_DISTURBER: "DISTURBER", INT_LIGHTNING: "LIGHTNING"}

DISTANCE_OUT_OF_RANGE = 0x3F


class Sensor:
    def __init__(self, bus=0, dev=0, speed=1000000, mode=0b01):
        self.spi = spidev.SpiDev()
        self.spi.open(bus, dev)
        self.spi.max_speed_hz = speed
        self.spi.mode = mode

    def read(self, reg):
        return self.spi.xfer2([(reg & 0x3F) | 0x40, 0x00])[1]

    def write(self, reg, val):
        self.spi.xfer2([reg & 0x3F, val & 0xFF])

    def modify(self, reg, mask, shift, value):
        cur = self.read(reg)
        cur &= ~(mask << shift) & 0xFF
        cur |= (value & mask) << shift
        self.write(reg, cur)

    def close(self):
        self.spi.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=10.0)
    ap.add_argument("--noise-floor", type=int, default=None, choices=range(0, 8))
    ap.add_argument("--watchdog", type=int, default=None, choices=range(0, 16))
    ap.add_argument("--min-strikes", type=int, default=1, choices=[1, 5, 9, 16])
    ap.add_argument("--irq-pin", type=int, default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    cfg = {}
    if os.path.exists(CFG):
        with open(CFG, encoding="utf-8") as f:
            cfg = json.load(f)
    irq = args.irq_pin if args.irq_pin is not None else int(cfg.get("irq_pin", 6))
    nf = args.noise_floor if args.noise_floor is not None else int(cfg.get("noise_floor", 2))
    wd = args.watchdog if args.watchdog is not None else int(cfg.get("watchdog_thresh", 2))

    out = args.out or ("/home/quaggasklip/lightning_data/emi_profile_%s.csv"
                       % time.strftime("%Y%m%d-%H%M%S"))

    pi = pigpio.pi()
    if not pi.connected:
        sys.exit("cannot reach pigpiod")

    s = Sensor()
    saved = {r: s.read(r) for r in (REG_THRESHOLD, REG_LIGHTNING,
                                   REG_INT_MASK_ANT, REG_DISP_IRQ)}
    print("saved registers: %s" % {hex(k): hex(v) for k, v in saved.items()})

    # Disturbers must be UNMASKED or the interrupt we most want to study is never
    # raised at all, and silence becomes indistinguishable from rejection.
    s.modify(REG_THRESHOLD, 0x07, 4, nf)
    s.modify(REG_THRESHOLD, 0x0F, 0, wd)
    s.modify(REG_LIGHTNING, 0x03, 4, {1: 0, 5: 1, 9: 2, 16: 3}[args.min_strikes])
    s.modify(REG_INT_MASK_ANT, 0x01, 5, 0)
    time.sleep(0.05)

    print("capturing %.1f min at noise_floor=%d watchdog=%d min_strikes=%d, IRQ GPIO%d"
          % (args.minutes, nf, wd, args.min_strikes, irq))
    print("writing %s" % out)

    events = []

    pi.set_mode(irq, pigpio.INPUT)
    pi.set_pull_up_down(irq, pigpio.PUD_DOWN)

    def on_edge(gpio, level, tick):
        # The interrupt register must be read to clear it, and the datasheet asks
        # for a short settle before it is valid.
        t = time.time()
        time.sleep(0.002)
        try:
            src = s.read(REG_INT_MASK_ANT) & 0x0F
            e = (((s.read(REG_ENERGY_MM) & 0x1F) << 16)
                 | (s.read(REG_ENERGY_M) << 8)
                 | s.read(REG_ENERGY_L))
            d = s.read(REG_DISTANCE) & 0x3F
        except Exception as exc:                      # noqa: BLE001
            print("  register read failed: %s" % exc)
            return
        events.append({"t": t, "src": src, "energy": e, "dist_raw": d})

    cb = pi.callback(irq, pigpio.RISING_EDGE, on_edge)

    started = time.time()
    try:
        while time.time() - started < args.minutes * 60:
            time.sleep(1.0)
            n = len(events)
            if n and n % 50 == 0:
                print("  %d events, %.0fs elapsed" % (n, time.time() - started))
    except KeyboardInterrupt:
        print("  interrupted")
    finally:
        cb.cancel()
        for r, v in saved.items():
            s.write(r, v)
        s.close()
        pi.stop()
        print("registers restored")

    if not events:
        print("NO events captured. Either nothing is arriving, or the IRQ pin is "
              "wrong. GPIO%d was used; the LCO probe established 6 on this unit."
              % irq)
        return

    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["epoch", "iso", "type", "int_raw", "energy", "distance_km",
                    "noise_floor", "watchdog", "gap_s"])
        prev = None
        for ev in events:
            gap = "" if prev is None else "%.4f" % (ev["t"] - prev)
            prev = ev["t"]
            dist = -1 if ev["dist_raw"] == DISTANCE_OUT_OF_RANGE else ev["dist_raw"]
            w.writerow([
                "%.4f" % ev["t"],
                time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ev["t"])),
                NAMES.get(ev["src"], "OTHER_0x%02X" % ev["src"]),
                ev["src"], ev["energy"], dist, nf, wd, gap,
            ])
    print("wrote %d events to %s" % (len(events), out))

    report(events, nf, wd)


def report(events, nf, wd):
    """Print the statistics that actually separate machinery from weather."""
    print()
    print("=== SUMMARY  noise_floor=%d watchdog=%d ===" % (nf, wd))
    by_type = {}
    for ev in events:
        by_type.setdefault(NAMES.get(ev["src"], "OTHER"), []).append(ev)
    span = events[-1]["t"] - events[0]["t"] or 1.0
    for name, group in sorted(by_type.items()):
        print("  %-10s %5d   %6.2f per minute" % (name, len(group),
                                                 len(group) * 60.0 / span))

    for name in ("DISTURBER", "LIGHTNING"):
        group = by_type.get(name)
        if not group or len(group) < 4:
            continue
        print()
        print("  --- %s, %d events over %.0fs ---" % (name, len(group), span))

        energies = [g["energy"] for g in group]
        dists = [g["dist_raw"] for g in group]
        gaps = [group[i]["t"] - group[i - 1]["t"] for i in range(1, len(group))]

        # A fixed source sits at near-constant energy; a storm does not. The
        # coefficient of variation makes that comparable across magnitudes.
        mean_e = statistics.mean(energies)
        cv_e = (statistics.pstdev(energies) / mean_e) if mean_e else 0.0
        print("    energy    mean %10.0f  cv %.3f  min %d  max %d"
              % (mean_e, cv_e, min(energies), max(energies)))
        print("    distance  unique values %s" % sorted(set(dists))[:12])
        print("    gaps      mean %.3fs  median %.3fs  min %.3fs  max %.3fs"
              % (statistics.mean(gaps), statistics.median(gaps),
                 min(gaps), max(gaps)))
        cv_g = (statistics.pstdev(gaps) / statistics.mean(gaps)) if gaps else 0
        print("    gap cv    %.3f   (near 0 = metronomic, ~1 = Poisson, >1 = bursty)"
              % cv_g)

        period, strength = dominant_period(group)
        if period:
            print("    periodicity  strongest at %.3fs, strength %.2f" % (period, strength))
            if strength > 0.35:
                print("      -> strongly periodic. This is machinery, not weather.")
            else:
                print("      -> no convincing periodicity.")

        if cv_e < 0.15:
            print("    VERDICT: energy almost constant. Consistent with a single")
            print("             fixed emitter rather than lightning.")
        elif cv_g > 1.2:
            print("    VERDICT: bursty with wide energy spread. Consistent with")
            print("             genuine lightning activity.")

    print()
    print("  Choosing thresholds from this: the costly error is a MISSED strike, so")
    print("  take the most sensitive setting whose disturber rate the validation")
    print("  buffer and interference guard can still absorb. Compare runs at")
    print("  several noise_floor values before deciding, and if possible compare a")
    print("  run with weather against one without.")


def dominant_period(group):
    """Strongest periodic component in the arrival series, by autocorrelation.

    Autocorrelation rather than an FFT because the series is short and unevenly
    sampled, where a periodogram is easy to misread. Returns (period_s, strength)
    with strength normalised to 0..1.
    """
    times = [g["t"] for g in group]
    span = times[-1] - times[0]
    if span <= 0 or len(times) < 8:
        return None, 0.0

    # Bin into a uniform series so lags are comparable.
    bin_s = max(0.05, span / 2000.0)
    nbins = int(span / bin_s) + 1
    series = [0.0] * nbins
    for t in times:
        series[min(nbins - 1, int((t - times[0]) / bin_s))] += 1.0
    mean = sum(series) / nbins
    series = [v - mean for v in series]
    denom = sum(v * v for v in series)
    if denom <= 0:
        return None, 0.0

    best_lag, best = 0, 0.0
    # Ignore very short lags: they reflect the binning, not real periodicity.
    for lag in range(max(2, int(0.2 / bin_s)), nbins // 2):
        acc = 0.0
        for i in range(nbins - lag):
            acc += series[i] * series[i + lag]
        r = acc / denom
        if r > best:
            best, best_lag = r, lag
    if best_lag == 0:
        return None, 0.0
    return best_lag * bin_s, min(1.0, max(0.0, best))


if __name__ == "__main__":
    if os.geteuid() != 0:
        print("note: run with sudo, SPI and pigpio both want it")
    main()
