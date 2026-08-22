"""AS3935 antenna calibration scan (pigpio edge counting).

Scans all 16 internal tuning-capacitor settings, measures the antenna LC
oscillator frequency via the IRQ pin (DISP_LCO) using the AS3935's /128
divider so pigpio can count edges accurately, and reports the error vs the
500 kHz target. Matches the commissioning method for the GLENCORE WONDERKOP
unit (IRQ on GPIO17).
"""
import time
import sys
import spidev
import pigpio

SPI_BUS = 0
SPI_DEVICE = 0
SPI_SPEED = 1000000
SPI_MODE = 0b01
IRQ_PIN = 17
DIV_RATIO = 128
TARGET_FREQ = 500000
TOLERANCE = 0.035
SAMPLE_TIME = 1.0

REG_DISP_IRQ = 0x08      # bit7 DISP_LCO, bits0-3 TUN_CAP
REG_DEFAULT_RESET = 0x3C
REG_CALIB = 0x3D
REG_INT_MASK_ANT = 0x03  # bits6-7 LCO_FDIV


def spi_read(spi, reg):
    return spi.xfer2([(reg & 0x3F) | 0x40, 0x00])[1]


def spi_write(spi, reg, val):
    spi.xfer2([reg & 0x3F, val & 0xFF])


def modify(spi, reg, mask, shift, value):
    cur = spi_read(spi, reg)
    cur &= ~(mask << shift)
    spi_write(spi, reg, cur | ((value & mask) << shift))


def main():
    pi = pigpio.pi()
    if not pi.connected:
        print("ERROR: pigpio daemon not reachable")
        sys.exit(1)
    pi.set_mode(IRQ_PIN, pigpio.INPUT)
    pi.set_pull_up_down(IRQ_PIN, pigpio.PUD_DOWN)

    spi = spidev.SpiDev()
    spi.open(SPI_BUS, SPI_DEVICE)
    spi.max_speed_hz = SPI_SPEED
    spi.mode = SPI_MODE

    print("=" * 64)
    print("AS3935 Antenna Calibration Scan  (GLENCORE WONDERKOP)")
    print("=" * 64)
    print("Target: %d Hz   Tolerance: +/-%.1f%%   Divider: /%d   IRQ: GPIO%d"
          % (TARGET_FREQ, TOLERANCE * 100, DIV_RATIO, IRQ_PIN))
    acc_lo = TARGET_FREQ * (1 - TOLERANCE)
    acc_hi = TARGET_FREQ * (1 + TOLERANCE)
    print("Acceptable antenna range: %.0f - %.0f Hz" % (acc_lo, acc_hi))
    print("-" * 64)

    cb = pi.callback(IRQ_PIN, pigpio.RISING_EDGE)
    results = []
    try:
        spi_write(spi, REG_DEFAULT_RESET, 0x96)
        time.sleep(0.01)
        spi_write(spi, REG_CALIB, 0x96)
        time.sleep(0.002)
        div_map = {16: 0, 32: 1, 64: 2, 128: 3}
        modify(spi, REG_INT_MASK_ANT, 0x03, 6, div_map[DIV_RATIO])
        spi_write(spi, REG_DISP_IRQ, spi_read(spi, REG_DISP_IRQ) | 0x80)
        time.sleep(0.01)

        print("%9s %9s %12s %10s %8s" %
              ("Cap", "Cap(pF)", "Freq(Hz)", "Error(%)", "Status"))
        print("-" * 64)
        for cap in range(16):
            modify(spi, REG_DISP_IRQ, 0x0F, 0, cap)
            time.sleep(0.05)
            start = cb.tally()
            time.sleep(SAMPLE_TIME)
            edges = cb.tally() - start
            freq = (edges / SAMPLE_TIME) * DIV_RATIO
            err = abs(freq - TARGET_FREQ) / TARGET_FREQ * 100
            if freq == 0:
                status = "NO SIG"
            elif abs(freq - TARGET_FREQ) / TARGET_FREQ <= TOLERANCE:
                status = "OK"
            else:
                status = "OUT"
            results.append((cap, cap * 8, freq, err, status))
            print("%9d %9d %12.0f %10.2f %8s"
                  % (cap, cap * 8, freq, err, status))

        spi_write(spi, REG_DISP_IRQ, spi_read(spi, REG_DISP_IRQ) & ~0x80)

        valid = [r for r in results if r[2] > 0]
        print("-" * 64)
        if valid:
            best = min(valid, key=lambda x: x[3])
            print("BEST: TUNE_CAP=%d  (%d pF)  Freq=%.0f Hz  Error=%.2f%%  [%s]"
                  % (best[0], best[1], best[2], best[3], best[4]))
        else:
            print("ERROR: no signal on any cap setting")
    finally:
        cb.cancel()
        spi.close()
        pi.stop()


if __name__ == "__main__":
    main()
