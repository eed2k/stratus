# ===========================================================================
#  AS3935 LIGHTNING DETECTION UNIT
# ===========================================================================


# ===========================================================================
#  IMPORTS
# ===========================================================================

import spidev
import time
import sys

try:
    import RPi.GPIO as GPIO
except ImportError:
    print("RPi.GPIO not available.")
    sys.exit(1)


# ===========================================================================
#  AS3935 REGISTER MAP (subset — see lightning_detector.py for full map)
# ===========================================================================

REG_AFE_GAIN       = 0x00
REG_DISP_IRQ       = 0x08
REG_DEFAULT_RESET  = 0x3C
REG_CALIB          = 0x3D
REG_INT_MASK_ANT   = 0x03


# ===========================================================================
#  CONFIGURATION
# ===========================================================================

SPI_BUS    = 0
SPI_DEVICE = 0
SPI_SPEED  = 1000000
SPI_MODE   = 0b01
IRQ_PIN    = 25
DIV_RATIO  = 16
TARGET_FREQ = 500000  # 500 kHz
TOLERANCE  = 0.035    # 3.5%


# ===========================================================================
#  SPI HELPERS
# ===========================================================================


def spi_read(spi, register):
    result = spi.xfer2([(register & 0x3F) | 0x40, 0x00])
    return result[1]

def spi_write(spi, register, value):
    spi.xfer2([register & 0x3F, value & 0xFF])

def modify_register(spi, register, mask, shift, value):
    current = spi_read(spi, register)
    cleared = current & ~(mask << shift)
    new_val = cleared | ((value & mask) << shift)
    spi_write(spi, register, new_val)


# ===========================================================================
#  FREQUENCY MEASUREMENT
# ===========================================================================


def measure_frequency(sample_time=1.0):
    """Measure frequency on IRQ pin by counting rising edges."""
    edge_count = 0

    def count_edge(channel):
        nonlocal edge_count
        edge_count += 1

    GPIO.add_event_detect(IRQ_PIN, GPIO.RISING, callback=count_edge)
    time.sleep(sample_time)
    GPIO.remove_event_detect(IRQ_PIN)

    measured_freq = edge_count / sample_time
    antenna_freq = measured_freq * DIV_RATIO
    return antenna_freq


# ===========================================================================
#  MAIN ENTRY POINT
# ===========================================================================


def main():
    print("=" * 60)
    print("AS3935 Antenna Calibration Utility")
    print("=" * 60)
    print()
    print(f"Target frequency: {TARGET_FREQ} Hz")
    print(f"Tolerance: +/- {TOLERANCE * 100}%")
    print(f"Acceptable range: {TARGET_FREQ * (1 - TOLERANCE):.0f} - {TARGET_FREQ * (1 + TOLERANCE):.0f} Hz")
    print(f"Division ratio: {DIV_RATIO}")
    print()

    GPIO.setmode(GPIO.BCM)
    GPIO.setup(IRQ_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

    spi = spidev.SpiDev()
    spi.open(SPI_BUS, SPI_DEVICE)
    spi.max_speed_hz = SPI_SPEED
    spi.mode = SPI_MODE

    try:
        # Reset the AS3935
        spi_write(spi, REG_DEFAULT_RESET, 0x96)
        time.sleep(0.010)

        # Calibrate RCO
        spi_write(spi, REG_CALIB, 0x96)
        time.sleep(0.002)

        # Set division ratio
        div_map = {16: 0, 32: 1, 64: 2, 128: 3}
        modify_register(spi, REG_INT_MASK_ANT, 0x03, 6, div_map[DIV_RATIO])

        # Enable antenna frequency display on IRQ pin
        # Set bit 7 of register 0x08 (DISP_LCO)
        reg08 = spi_read(spi, REG_DISP_IRQ)
        spi_write(spi, REG_DISP_IRQ, reg08 | 0x80)
        time.sleep(0.010)

        print(f"{'Cap Value':>10} {'Cap (pF)':>10} {'Freq (Hz)':>12} {'Error (%)':>10} {'Status':>10}")
        print("-" * 60)

        results = []

        for cap in range(16):
            # Set tuning capacitor
            modify_register(spi, REG_DISP_IRQ, 0x0F, 0, cap)
            time.sleep(0.050)

            # Measure frequency
            freq = measure_frequency(sample_time=1.0)
            error_pct = abs(freq - TARGET_FREQ) / TARGET_FREQ * 100

            if freq == 0:
                status = "NO SIGNAL"
            elif abs(freq - TARGET_FREQ) / TARGET_FREQ <= TOLERANCE:
                status = "OK"
            else:
                status = "OUT"

            results.append((cap, cap * 8, freq, error_pct, status))
            print(f"{cap:>10} {cap * 8:>10} {freq:>12.0f} {error_pct:>10.2f} {status:>10}")

        # Disable antenna frequency display
        reg08 = spi_read(spi, REG_DISP_IRQ)
        spi_write(spi, REG_DISP_IRQ, reg08 & ~0x80)

        # Find best result
        valid = [(cap, pf, freq, err, st) for cap, pf, freq, err, st in results if freq > 0]
        if valid:
            best = min(valid, key=lambda x: x[3])
            print()
            print("=" * 60)
            print(f"BEST SETTING: TUNE_CAP = {best[0]} ({best[1]} pF)")
            print(f"  Frequency: {best[2]:.0f} Hz")
            print(f"  Error: {best[3]:.2f}%")
            print(f"  Status: {best[4]}")
            print()
            print("To use this value, set in lightning_detector.py Config class:")
            print(f"  TUNE_CAP = {best[0]}")
            print()
            if best[4] != "OK":
                print("WARNING: Best setting is still outside 3.5% tolerance.")
                print("The antenna or external capacitors may need inspection.")
        else:
            print()
            print("ERROR: No frequency detected on any setting.")
            print("Check wiring and ensure the Thunder Click is properly seated.")

    finally:
        spi.close()
        GPIO.cleanup()


if __name__ == "__main__":
    main()
