#!/usr/bin/env python3
"""AS3935 bench calibration check. Read-only unless asked to commit.

Run this ON the detector Pi, with the AS3935 in its socket:

    sudo systemctl stop lightning-detector      # it owns SPI and the IRQ line
    sudo python3 as3935_bench_cal.py --sweep
    sudo systemctl start lightning-detector

Defaults match the Quaggasklip build: Thunder Click in mikroBUS socket 1 of a
Pi 2 Click Shield, so SPI 0.0 (CE0) and INT on BCM6. Override with --dev and
--irq if the board is wired differently.

What it reports, in order:

  1. SPI link        can we read AND write registers, proven by a round trip
  2. RCO calibration TRCO and SRCO done/fail bits after CALIB_RCO
  3. Registers       every configuration register, decoded
  4. LCO frequency   the antenna resonance, measured three different ways
  5. TUNE_CAP sweep  frequency at each of the 16 capacitor settings

WHY THIS EXISTS
---------------
The in-service daily antenna check has reported freq_hz = 0, in_tolerance =
False, tune_cap 12 -> 11 on every run, on two independent units, on four
different dates. A real mistune varies; a constant zero does not. So the
measurement is suspect, not the antennas, and the detector has been stepping the
tuning capacitor on the strength of a reading it never obtained.

The reason is in how that measurement is taken. In antenna-display mode the
AS3935 drives INT with the resonant frequency divided by FREQ_DIV_RATIO. At the
default divider of 16 that is 500 kHz / 16 = 31.25 kHz. The detector counts
those edges with RPi.GPIO.add_event_detect, which dispatches a PYTHON callback
per edge. A Pi Zero cannot service 31 250 Python callbacks a second; it does not
merely undercount, it collapses. Hence zero.

So this tool measures the same signal three ways and prints all three, which is
how you tell a bad antenna from a bad measurement:

  poll     a tight C-speed loop over /sys or RPi.GPIO input(), no callbacks
  pigpio   hardware-timestamped edge callbacks in the pigpio daemon, if present
  divider  the same measurement at divider 128, giving a countable ~3.9 kHz

If poll and pigpio agree and the divider-128 figure scales, the number is real.
If they disagree wildly, the measurement path is the fault and no tuning
decision should be made from it.

NOTHING IS SAVED. TUNE_CAP and REG_DISP_IRQ are restored on exit, including on
Ctrl+C. Pass --commit <n> only if you have decided on a value and want it written
to the config file.
"""

import argparse
import json
import statistics
import sys
import time

try:
    import spidev
except ImportError:
    sys.exit("spidev missing: apt install python3-spidev")

try:
    import RPi.GPIO as GPIO
except ImportError:
    sys.exit("RPi.GPIO missing: apt install python3-rpi.gpio")


# Mirrors quaggasklip_detector.py. Kept literal rather than imported so this tool
# still runs if the service file is mid-edit.
REG_AFE_GAIN      = 0x00
REG_THRESHOLD     = 0x01
REG_LIGHTNING     = 0x02
REG_INT_MASK_ANT  = 0x03
REG_DISTANCE      = 0x07
REG_DISP_IRQ      = 0x08
REG_CALIB_TRCO    = 0x3A
REG_CALIB_SRCO    = 0x3B
REG_DEFAULT_RESET = 0x3C
REG_CALIB         = 0x3D

DISP_LCO_BIT = 0x80

# Antenna target, from the datasheet and from the detector's own thresholds.
ANTENNA_TARGET_HZ = 500_000
ANTENNA_TOLERANCE_PCT = 3.5

# Quaggasklip wiring: Thunder Click in mikroBUS SOCKET 1 of the Pi 2 Click
# Shield, with the Terminal 2 Click in socket 2. From the shield schematic:
#   socket 1 CS  = GPIO8 = CE0 = spidev 0.0     <- the sensor
#   socket 1 INT = GPIO6
#   socket 2 CS  = GPIO7 = CE1 = spidev 0.1
#   socket 2 INT = GPIO26
# These are Pi 2 shield numbers and do not carry over to a Pi 3 shield. If the
# LCO measurement below reads zero at every divider, the interrupt pin is the
# first thing to doubt: confirm it with find_irq_pin.py rather than guessing.
DEFAULT_SPI_BUS = 0
DEFAULT_SPI_DEV = 0
DEFAULT_IRQ_PIN = 6
SPI_SPEED_HZ = 1_000_000
SPI_MODE = 1

# Written by --commit. Matches quaggasklip_detector.py Config.CONFIG_FILE.
DEFAULT_CONFIG = "/home/quaggasklip/quaggasklip_config.json"
TUNE_CAP_KEY = "tune_cap"


class Sensor:
    def __init__(self, bus, dev):
        self.spi = spidev.SpiDev()
        self.spi.open(bus, dev)
        self.spi.max_speed_hz = SPI_SPEED_HZ
        self.spi.mode = SPI_MODE

    def read(self, reg):
        return self.spi.xfer2([(reg & 0x3F) | 0x40, 0x00])[1]

    def write(self, reg, val):
        self.spi.xfer2([reg & 0x3F, val & 0xFF])

    def close(self):
        self.spi.close()


def check_spi(s):
    """Prove the link both ways.

    A read alone is not proof: a floating MISO reads as a constant, and 0x00 or
    0xFF look like plausible register contents. So write a known pattern to a
    register that holds arbitrary bits and read it back.
    """
    print("1. SPI LINK")
    before = s.read(REG_THRESHOLD)
    ok = False
    for probe in (0x12, 0x25):
        s.write(REG_THRESHOLD, probe)
        time.sleep(0.005)
        back = s.read(REG_THRESHOLD)
        print(f"   wrote 0x{probe:02X} to REG_THRESHOLD, read back 0x{back:02X}"
              f"  {'ok' if back == probe else 'MISMATCH'}")
        ok = ok or (back == probe)
    s.write(REG_THRESHOLD, before)

    allsame = {s.read(r) for r in (0x00, 0x01, 0x02, 0x03, 0x08)}
    if len(allsame) == 1:
        print(f"   every register reads 0x{allsame.pop():02X}: MISO is probably "
              "floating, or the wrong chip select is being driven")
        ok = False
    print(f"   verdict: {'SPI is working' if ok else 'SPI IS NOT PROVEN'}")
    return ok


def calibrate_rco(s):
    """Run CALIB_RCO and read the done/fail bits."""
    print("\n2. RC OSCILLATOR CALIBRATION")
    s.write(REG_CALIB, 0x96)          # CALIB_RCO
    time.sleep(0.005)

    # Expose the timer oscillator on INT while it settles, as the datasheet asks.
    reg08 = s.read(REG_DISP_IRQ)
    s.write(REG_DISP_IRQ, reg08 | 0x20)   # DISP_TRCO
    time.sleep(0.003)
    s.write(REG_DISP_IRQ, reg08)

    trco = s.read(REG_CALIB_TRCO)
    srco = s.read(REG_CALIB_SRCO)
    trco_done, trco_fail = bool(trco & 0x80), bool(trco & 0x40)
    srco_done, srco_fail = bool(srco & 0x80), bool(srco & 0x40)
    print(f"   TRCO 0x{trco:02X}  done={trco_done} fail={trco_fail}")
    print(f"   SRCO 0x{srco:02X}  done={srco_done} fail={srco_fail}")
    good = trco_done and srco_done and not trco_fail and not srco_fail
    print(f"   verdict: {'RCO calibration PASSED' if good else 'RCO CALIBRATION FAILED'}")
    return good


def dump_registers(s):
    print("\n3. REGISTERS")
    r0, r1, r2, r3, r8 = (s.read(x) for x in (0x00, 0x01, 0x02, 0x03, 0x08))
    indoor = (r0 >> 1) & 0x3F
    print(f"   0x00 AFE      0x{r0:02X}  gain={indoor} "
          f"({'indoor 18' if indoor == 18 else 'outdoor 14' if indoor == 14 else 'non-standard'})"
          f" powerdown={bool(r0 & 0x01)}")
    print(f"   0x01 THRESH   0x{r1:02X}  noise_floor={(r1 >> 4) & 0x07} "
          f"watchdog={r1 & 0x0F}")
    print(f"   0x02 LIGHTN   0x{r2:02X}  spike_reject={r2 & 0x0F} "
          f"min_strikes={(r2 >> 4) & 0x03}")
    div = {0: 16, 1: 32, 2: 64, 3: 128}[(r3 >> 6) & 0x03]
    print(f"   0x03 INT/ANT  0x{r3:02X}  mask_disturber={bool(r3 & 0x20)} "
          f"freq_div={div} int={r3 & 0x0F}")
    print(f"   0x08 DISP/CAP 0x{r8:02X}  tune_cap={r8 & 0x0F} "
          f"({(r8 & 0x0F) * 8} pF) disp_lco={bool(r8 & 0x80)}")
    return {"tune_cap": r8 & 0x0F, "freq_div": div, "reg08": r8, "reg03": r3}


def set_freq_div(s, ratio):
    bits = {16: 0, 32: 1, 64: 2, 128: 3}[ratio]
    r3 = s.read(REG_INT_MASK_ANT)
    s.write(REG_INT_MASK_ANT, (r3 & 0x3F) | (bits << 6))
    time.sleep(0.005)


def set_tune_cap(s, cap):
    r8 = s.read(REG_DISP_IRQ)
    s.write(REG_DISP_IRQ, (r8 & 0xF0) | (cap & 0x0F))
    time.sleep(0.005)


def measure_poll(pin, s, window_s=0.30):
    """Count edges in a tight polling loop. No Python callback per edge.

    This is the method the detector should have used. It samples the pin as fast
    as the interpreter allows and counts transitions, so a 31 kHz signal degrades
    into an undercount rather than into nothing at all. Still not a frequency
    counter, but it cannot silently return zero on a live signal.
    """
    r8 = s.read(REG_DISP_IRQ)
    s.write(REG_DISP_IRQ, r8 | DISP_LCO_BIT)
    time.sleep(0.05)

    edges = 0
    last = GPIO.input(pin)
    t_end = time.perf_counter() + window_s
    while time.perf_counter() < t_end:
        now = GPIO.input(pin)
        if now != last:
            edges += 1
            last = now

    s.write(REG_DISP_IRQ, r8)
    time.sleep(0.01)
    # Two transitions per cycle.
    return (edges / 2.0) / window_s


def measure_pigpio(pin, s, window_s=0.30):
    """Hardware-timestamped edge count via the pigpio daemon, if available."""
    try:
        import pigpio
    except ImportError:
        return None, "pigpio module not installed (apt install python3-pigpio)"
    pi = pigpio.pi()
    if not pi.connected:
        return None, "pigpiod not running (sudo systemctl start pigpiod)"

    count = [0]

    def cb_fn(gpio, level, tick):
        count[0] += 1

    r8 = s.read(REG_DISP_IRQ)
    s.write(REG_DISP_IRQ, r8 | DISP_LCO_BIT)
    time.sleep(0.05)
    cb = pi.callback(pin, pigpio.RISING_EDGE, cb_fn)
    time.sleep(window_s)
    cb.cancel()
    s.write(REG_DISP_IRQ, r8)
    pi.stop()
    return count[0] / window_s, None


def report_freq(label, divided_hz, divider):
    if divided_hz is None:
        print(f"   {label:<26} unavailable")
        return None
    actual = divided_hz * divider
    pct = (actual - ANTENNA_TARGET_HZ) / ANTENNA_TARGET_HZ * 100.0
    print(f"   {label:<26} {divided_hz:>9.0f} Hz on INT "
          f"x{divider:<3} = {actual:>9.0f} Hz  ({pct:+.1f}% of 500 kHz)")
    return actual


def measure_all(s, pin, divider):
    set_freq_div(s, divider)
    poll = measure_poll(pin, s)
    pig, pig_err = measure_pigpio(pin, s)
    a = report_freq(f"poll loop (div {divider})", poll, divider)
    if pig_err:
        print(f"   {'pigpio':<26} {pig_err}")
        b = None
    else:
        b = report_freq(f"pigpio (div {divider})", pig, divider)
    return a, b


def main():
    ap = argparse.ArgumentParser(description="AS3935 bench calibration check")
    ap.add_argument("--bus", type=int, default=DEFAULT_SPI_BUS)
    ap.add_argument("--dev", type=int, default=DEFAULT_SPI_DEV,
                    help="SPI device: 0 for socket 1 (CE0, the sensor on this "
                         "build), 1 for socket 2 (CE1)")
    ap.add_argument("--irq", type=int, default=DEFAULT_IRQ_PIN,
                    help="BCM pin the sensor INT is wired to. Pi 2 shield: 6 "
                         "for socket 1, 26 for socket 2")
    ap.add_argument("--sweep", action="store_true",
                    help="measure at all 16 TUNE_CAP settings")
    ap.add_argument("--commit", type=int, metavar="CAP",
                    help=f"write this value as {TUNE_CAP_KEY!r} into the config")
    ap.add_argument("--config", default=DEFAULT_CONFIG,
                    help=f"config file to write with --commit "
                         f"(default {DEFAULT_CONFIG})")
    args = ap.parse_args()

    print("AS3935 BENCH CALIBRATION CHECK")
    print(f"   SPI {args.bus}.{args.dev}, INT on BCM{args.irq}")
    print("   nothing is written to the sensor permanently; state is restored\n")

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(args.irq, GPIO.IN)
    s = Sensor(args.bus, args.dev)

    saved_r8 = s.read(REG_DISP_IRQ)
    saved_r3 = s.read(REG_INT_MASK_ANT)

    try:
        spi_ok = check_spi(s)
        if not spi_ok:
            print("\nStopping: without a proven SPI link every number below would")
            print("be fiction. Check, in order:")
            print(f"  1. --dev {args.dev} matches the socket the Thunder Click is "
                  "in. On this build")
            print("     it is socket 1, which is CE0 = spidev 0.0, so --dev 0.")
            print("  2. SPI is enabled (dtparam=spi=on in the boot config).")
            print("  3. The service is stopped, so it is not holding the bus:")
            print("     sudo systemctl stop lightning-detector")
            return 1

        calibrate_rco(s)
        regs = dump_registers(s)

        print("\n4. ANTENNA RESONANCE")
        print("   Three measurements of the same signal. They should agree. If they")
        print("   do not, the measurement is the fault and no tuning decision")
        print("   should be taken from it.")
        measure_all(s, args.irq, 16)
        measure_all(s, args.irq, 128)

        lo = ANTENNA_TARGET_HZ * (1 - ANTENNA_TOLERANCE_PCT / 100)
        hi = ANTENNA_TARGET_HZ * (1 + ANTENNA_TOLERANCE_PCT / 100)
        print(f"   in tolerance means {lo:,.0f} to {hi:,.0f} Hz "
              f"({ANTENNA_TOLERANCE_PCT}% of {ANTENNA_TARGET_HZ:,})")

        if args.sweep:
            print("\n5. TUNE_CAP SWEEP")
            print("   Divider 128 so the rate is countable. The best setting is the")
            print("   one closest to 500 kHz, not necessarily the current one.")
            set_freq_div(s, 128)
            results = []
            for cap in range(16):
                set_tune_cap(s, cap)
                time.sleep(0.05)
                reads = [measure_poll(args.irq, s, 0.15) * 128 for _ in range(3)]
                med = statistics.median(reads)
                err = abs(med - ANTENNA_TARGET_HZ)
                results.append((cap, med, err))
                flag = "  <-- current" if cap == regs["tune_cap"] else ""
                print(f"   cap {cap:>2} ({cap * 8:>3} pF)  {med:>9.0f} Hz  "
                      f"error {med - ANTENNA_TARGET_HZ:>+9.0f}{flag}")
            live = [r for r in results if r[1] > 1000]
            if not live:
                print("\n   Every setting read at or near zero. That is not sixteen")
                print("   mistuned antennas, it is no signal on INT at all, so the")
                print(f"   antenna was never measured. BCM{args.irq} is the pin this")
                print("   run watched. Confirm the real one:")
                print("     sudo python3 find_irq_pin.py --spi-device "
                      f"{args.dev}")
                print("   If that names a different pin, the in-service daily check")
                print("   has the same wrong pin, which is why it reports 0 Hz and")
                print("   then steps TUNE_CAP on the strength of it.")
            else:
                best = min(live, key=lambda r: r[2])
                print(f"\n   closest to 500 kHz: cap {best[0]} at {best[1]:,.0f} Hz "
                      f"({(best[1] - ANTENNA_TARGET_HZ) / ANTENNA_TARGET_HZ * 100:+.1f}%)")
                print(f"   currently configured: cap {regs['tune_cap']}")

        if args.commit is not None:
            if not 0 <= args.commit <= 15:
                print("\n   --commit must be 0 to 15")
                return 2
            try:
                with open(args.config) as fh:
                    cfg = json.load(fh)
            except Exception as e:
                print(f"\n   could not read {args.config}: {e}")
                print("   nothing was written")
                return 3
            if TUNE_CAP_KEY not in cfg:
                # Refuse rather than add a key the detector may not read. A
                # silently ignored setting is worse than a failed write.
                print(f"\n   {args.config} has no {TUNE_CAP_KEY!r} key.")
                print("   That is not the config this detector reads, so nothing "
                      "was written.")
                print(f"   Expected {DEFAULT_CONFIG}")
                return 3
            was = cfg[TUNE_CAP_KEY]
            cfg[TUNE_CAP_KEY] = args.commit
            try:
                # Truncate in place so the 0600 mode and service-user ownership
                # set by install.sh survive.
                with open(args.config, "w") as fh:
                    json.dump(cfg, fh, indent=2)
                    fh.write("\n")
            except Exception as e:
                print(f"\n   could not write {args.config}: {e}")
                return 3
            print(f"\n   {args.config}")
            print(f"   {TUNE_CAP_KEY}: {was} -> {args.commit}")
            print("   restart the service for it to take effect:")
            print("     sudo systemctl restart lightning-detector")
        return 0

    finally:
        # Always put the sensor back, including on Ctrl+C.
        s.write(REG_DISP_IRQ, saved_r8)
        s.write(REG_INT_MASK_ANT, saved_r3)
        s.close()
        GPIO.cleanup()
        print("\n   sensor state restored")


if __name__ == "__main__":
    sys.exit(main())
