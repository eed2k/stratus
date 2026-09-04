#!/usr/bin/env python3
# ===========================================================================
#  Which GPIO is the Thunder Click's interrupt on?
# ===========================================================================
#
#  WHY THIS EXISTS
#    The Pi 3 and Pi 2 Click Shields route mikroBUS socket 2's INT to different
#    GPIOs - 12 and 19 respectively - because the Pi 3 shield's onboard MCP3204
#    ADC claims GPIO19/20/21 for SPI1. Getting it wrong produces a detector that
#    starts cleanly, logs nothing, and reports itself healthy for as long as
#    nobody looks, which is the worst way for a safety device to fail.
#
#  HOW IT WORKS
#    The AS3935 has an antenna-display mode: setting bit 7 of register 0x08
#    drives its IRQ pin with the resonant frequency divided by the division
#    ratio, roughly 31 kHz at the default divide-by-16. That is a signal no
#    other pin on the board is producing, so the pin carrying it is the INT pin.
#
#    Every candidate GPIO is sampled with display mode OFF and then ON. The one
#    that is quiet in the first pass and busy in the second is the answer. This
#    tests the actual assembled hardware rather than trusting a schematic, and it
#    also proves the sensor is alive and talking over SPI.
#
#  USAGE
#      python3 find_irq_pin.py                 # sensor in socket 2 (CE1)
#      python3 find_irq_pin.py --spi-device 0  # sensor in socket 1 (CE0)
#
#  Read-only apart from the display-mode bit, which is restored before exit.
#  It sends nothing anywhere.
# ===========================================================================

import argparse
import sys
import time

try:
    import spidev
except ImportError:
    sys.exit("spidev not available. Install with: sudo apt install python3-spidev")

try:
    import RPi.GPIO as GPIO
except ImportError:
    sys.exit("RPi.GPIO not available. Install with: sudo apt install python3-rpi.gpio")

REG_DISP_IRQ = 0x08
REG_CALIB    = 0x3D
REG_CALIB_TRCO = 0x3A
REG_CALIB_SRCO = 0x3B

# Every GPIO that either shield routes to a mikroBUS INT, plus the documented
# alternatives, so a mis-seated board or an unexpected shield revision still
# turns up rather than reporting "not found".
#
# Excluded on purpose:
#   2, 3    I2C, pulled up on the shield
#   7, 8    SPI chip selects
#   9,10,11 SPI0
#   14, 15  the UART going to the Terminal 2 Click
CANDIDATES = [4, 5, 6, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]

KNOWN = {
    17: "mikroBUS socket 1 INT (both shields)",
    12: "mikroBUS socket 2 INT (Pi 3 shield)",
    19: "mikroBUS socket 2 INT (Pi 2 shield) / SPI1-MISO on the Pi 3 shield",
    18: "mikroBUS socket 1 PWM",
    13: "mikroBUS socket 2 PWM",
    4:  "mikroBUS socket 1 AN",
    5:  "mikroBUS socket 1 RST",
    6:  "mikroBUS socket 2 RST",
    16: "SPI1-CE2 on the Pi 3 shield (onboard ADC)",
}


def read_register(spi, register):
    """Read one AS3935 register."""
    return spi.xfer2([(register & 0x3F) | 0x40, 0x00])[1]


def write_register(spi, register, value):
    """Write one AS3935 register."""
    spi.xfer2([register & 0x3F, value & 0xFF])


def sample(pins, seconds):
    """Count level changes on each pin over `seconds`.

    Polled rather than interrupt-driven: at ~31 kHz the point is not an accurate
    count but telling a toggling pin from a static one, and polling avoids
    registering seventeen edge callbacks at once on a single-core Pi.
    """
    counts = {p: 0 for p in pins}
    last = {}
    for p in pins:
        try:
            last[p] = GPIO.input(p)
        except Exception:
            last[p] = 0
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        for p in pins:
            try:
                now = GPIO.input(p)
            except Exception:
                continue
            if now != last[p]:
                counts[p] += 1
                last[p] = now
    return counts


def main():
    ap = argparse.ArgumentParser(
        description="Identify the GPIO carrying the AS3935 interrupt line.")
    ap.add_argument("--spi-bus", type=int, default=0)
    ap.add_argument("--spi-device", type=int, default=1,
                    help="1 = CE1 = mikroBUS socket 2 (default), 0 = CE0 = socket 1")
    ap.add_argument("--seconds", type=float, default=0.4,
                    help="sampling window per pass (default 0.4)")
    args = ap.parse_args()

    print("AS3935 interrupt pin finder")
    print("  SPI %d.%d (CE%d, mikroBUS socket %d)"
          % (args.spi_bus, args.spi_device, args.spi_device,
             args.spi_device + 1))
    print()

    spi = spidev.SpiDev()
    try:
        spi.open(args.spi_bus, args.spi_device)
    except Exception as e:
        sys.exit("Could not open SPI %d.%d: %s\nIs SPI enabled "
                 "(raspi-config > Interface Options > SPI)?"
                 % (args.spi_bus, args.spi_device, e))
    spi.max_speed_hz = 1000000
    spi.mode = 0b01

    # Prove the sensor is actually there before blaming a pin. A calibration
    # that reports done means SPI reads and writes are both working.
    write_register(spi, REG_CALIB, 0x96)
    time.sleep(0.002)
    trco = read_register(spi, REG_CALIB_TRCO)
    srco = read_register(spi, REG_CALIB_SRCO)
    if not ((trco & 0x80) and (srco & 0x80)):
        print("WARNING: the sensor did not confirm RC calibration "
              "(TRCO=0x%02X SRCO=0x%02X)." % (trco, srco))
        print("         Check the Click is seated in socket %d and that "
              "--spi-device matches it." % (args.spi_device + 1))
        print()
    else:
        print("Sensor responded over SPI: RC calibration confirmed.")
        print()

    GPIO.setmode(GPIO.BCM)
    GPIO.setwarnings(False)
    usable = []
    for p in CANDIDATES:
        try:
            GPIO.setup(p, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
            usable.append(p)
        except Exception as e:
            print("  skipping GPIO%-2d (%s)" % (p, e))

    reg08 = read_register(spi, REG_DISP_IRQ)
    try:
        print("Pass 1 of 2: antenna display OFF, looking for a quiet baseline...")
        before = sample(usable, args.seconds)

        write_register(spi, REG_DISP_IRQ, reg08 | 0x80)
        time.sleep(0.05)                     # let the oscillator settle
        print("Pass 2 of 2: antenna display ON, looking for the ~31 kHz signal...")
        after = sample(usable, args.seconds)
    finally:
        # Always put the register back, so the sensor is left as it was found.
        write_register(spi, REG_DISP_IRQ, reg08)
        time.sleep(0.01)

    print()
    print("  %-8s %10s %10s   %s" % ("GPIO", "off", "on", "note"))
    print("  " + "-" * 62)
    hits = []
    for p in usable:
        b, a = before[p], after[p]
        # Quiet before, clearly busy after. The thresholds are deliberately
        # loose: we are separating a toggling pin from a static one, not
        # measuring frequency.
        hit = a > 200 and a > b * 10
        if hit:
            hits.append((p, a))
        print("  GPIO%-4d %10d %10d   %s%s"
              % (p, b, a, "<== INT " if hit else "", KNOWN.get(p, "")))

    print()
    spi.close()
    GPIO.cleanup()

    if len(hits) == 1:
        pin = hits[0][0]
        print("Interrupt line found on GPIO%d." % pin)
        print()
        print("Set it in the config file:")
        print('    "irq_pin": %d' % pin)
        if pin == 17:
            print()
            print("Note: GPIO17 is socket 1's INT. If the Thunder Click is meant")
            print("to be in socket 2, it is in the wrong socket, or")
            print("--spi-device does not match where it actually is.")
        return 0

    if not hits:
        print("No pin showed the display signal.")
        print("Things to check, in order:")
        print("  1. The Thunder Click is fully seated in mikroBUS socket %d."
              % (args.spi_device + 1))
        print("  2. --spi-device matches that socket (0 = socket 1, 1 = socket 2).")
        print("  3. SPI is enabled and no other process is holding the bus.")
        print("  4. The shield is powered: the Click needs 3.3V from the socket.")
        return 1

    print("More than one pin toggled, so the result is ambiguous:")
    for p, a in hits:
        print("  GPIO%d (%d changes)  %s" % (p, a, KNOWN.get(p, "")))
    print("Re-run with a longer window, e.g. --seconds 1.0, and with nothing")
    print("else driving the header.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
