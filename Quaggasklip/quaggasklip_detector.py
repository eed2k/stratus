# ===========================================================================
#  Stratus AS3935 Lightning Detection System
#  Site: QUAGGASKLIP
#  Developer: L.J. Esterhuizen
#  Company: METRON (PTY) LTD
# ===========================================================================
#
#  HARDWARE
#    Raspberry Pi Zero W or Zero 2 W
#    MikroElektronika Pi 2 Click Shield
#      mikroBUS socket 1 : Thunder Click    -> AS3935 lightning sensor (SPI)
#      mikroBUS socket 2 : Terminal 2 Click -> UART to a Campbell CR300/CR1000
#
#  PIN MAP, taken from the shield schematic (full table in README.md)
#    Both sockets share SPI0 - SCK GPIO11, MISO GPIO9, MOSI GPIO10 - and are
#    told apart only by chip select, because CE0/CE1 are the Pi's only hardware
#    CS lines:
#        socket 1 CS  = GPIO8  = CE0 = spidev 0.0     <- the sensor
#        socket 2 CS  = GPIO7  = CE1 = spidev 0.1
#    Interrupt lines are per socket, on a Pi 2 shield:
#        socket 1 INT = GPIO6                         <- the sensor
#        socket 2 INT = GPIO26
#    Do not carry those two numbers over to a Pi 3 shield. That board adds an
#    MCP3204 ADC which takes GPIO19/20/21 for SPI1 and GPIO16 for its chip
#    select, and its socket 2 INT is GPIO12. Set irq_pin for the shield actually
#    fitted and confirm it with find_irq_pin.py.
#
#    GPIO12 is worth calling out: on a Pi 2 shield it is routed to neither
#    socket. It looks like a plausible irq_pin and cannot ever work.
#
#  ONLY SOCKET 2 CAN REACH A WIRE
#    Socket 1 has the Thunder Click seated on it, so socket 1's AN, RST and PWM
#    (GPIO4, 5, 18) dead-end under that board. Anything that must leave the
#    enclosure has to be a socket 2 pin, because socket 2's pins are broken out
#    to the Terminal 2 Click's screw terminals.
#
#  HOW THIS DIFFERS FROM THE GWLD1 UNIT (Lightning Detector/detector)
#    1. Both units run the sensor from CE0, but the interrupt differs with the
#       shield: GPIO6 here, GPIO17 on GWLD1.
#    2. The Campbell link is the Pi's real hardware UART through the Terminal 2
#       Click, not a bit-banged GPIO. GWLD1 had no UART breakout so it clocked
#       bits out of a spare pin with pigpio; bringing the mikroBUS UART out to
#       screw terminals is exactly what the Terminal 2 Click is for, and a
#       hardware UART does not compete with the interrupt handler for CPU on a
#       single-core Zero W. The bit-bang path is kept as a fallback for a Pi
#       whose boot config cannot be changed.
#    3. The strike pulse mirror uses GPIO19, socket 2's RST pin, which lands on
#       the Terminal 2 Click terminal labelled RST: one cable to the logger
#       carries TX, GND and the pulse. It is not GPIO18, even though "socket 1 PWM"
#       sounds
#       like the obvious choice, because socket 1 is occupied and GPIO18 has no
#       terminal to land on.
#
# ===========================================================================


# ===========================================================================
#  VERSION
# ===========================================================================

__version__ = "1.0.0"


# ===========================================================================
#  IMPORTS
# ===========================================================================

import spidev
import time
import json
import logging
import logging.handlers
import csv
import os
import signal
import sys
from collections import deque
from datetime import datetime, timezone, timedelta
from pathlib import Path

try:
    import RPi.GPIO as GPIO
except ImportError:
    print("RPi.GPIO not available. Install with: sudo apt install python3-rpi.gpio")
    sys.exit(1)

import urllib.request
import urllib.error
import socket

# Hardware UART to the Campbell logger. Optional: a missing module disables the
# logger link rather than taking the detector down with it.
try:
    import serial
except ImportError:
    serial = None

# Only needed for the bit-bang fallback transport.
try:
    import pigpio
except ImportError:
    pigpio = None


# ===========================================================================
#  TIME ZONE  (South African Standard Time, UTC+2, no DST)
# ===========================================================================

SAST = timezone(timedelta(hours=2), name="SAST")


def now_sast():
    """Return the current time as a timezone-aware SAST datetime."""
    return datetime.now(SAST)


def _sast_log_time(timestamp):
    """logging.Formatter.converter hook: render record times in SAST."""
    return datetime.fromtimestamp(timestamp, SAST).timetuple()


logging.Formatter.converter = staticmethod(_sast_log_time)


# ===========================================================================
#  AS3935 REGISTER MAP
# ===========================================================================
#  Byte-identical to Lightning Detector/detector/lightning_detector.py. A
#  change there must be mirrored here.

REG_AFE_GAIN       = 0x00  # AFE gain boost / power-down / noise floor
REG_THRESHOLD      = 0x01  # Watchdog and spike rejection
REG_LIGHTNING      = 0x02  # Lightning reg / min strikes / clear stats
REG_INT_MASK_ANT   = 0x03  # Interrupt type / mask disturber / freq div
REG_ENERGY_LSB     = 0x04
REG_ENERGY_MSB     = 0x05
REG_ENERGY_MMSB    = 0x06  # bits 4:0
REG_DISTANCE       = 0x07  # bits 5:0
REG_DISP_IRQ       = 0x08  # Display IRQ / tuning caps / freq display
REG_CALIB_TRCO     = 0x3A
REG_CALIB_SRCO     = 0x3B
REG_DEFAULT_RESET  = 0x3C
REG_CALIB          = 0x3D

# Interrupt sources (register 0x03, bits 3:0)
INT_NOISE_HIGH     = 0x01
INT_DISTURBER      = 0x04
INT_LIGHTNING      = 0x08

AFE_OUTDOOR        = 0x0E  # Outdoor gain: the only mode used outdoors
DIRECT_COMMAND     = 0x96
PRESET_DEFAULT     = 0x96

# REG_DISTANCE value meaning "storm out of range / distance indeterminate".
DISTANCE_OUT_OF_RANGE = 0x3F


# ===========================================================================
#  CONFIGURATION
# ===========================================================================

class Config:
    """Configuration defaults, overridable from a JSON file.

    Defaults are assigned in __init__ so that setattr from the JSON file
    creates real instance attributes rather than shadowing class variables.
    """

    def __init__(self):
        # ===============================================================
        #  SPI  -  Thunder Click in mikroBUS socket 1
        # ===============================================================
        self.SPI_BUS         = 0
        self.SPI_DEVICE      = 0        # CE0 = socket 1 (socket 2 would be 1)
        self.SPI_SPEED_HZ    = 1000000  # 1 MHz, the AS3935 maximum
        self.SPI_MODE        = 0b01     # Mode 1 (CPOL=0, CPHA=1)

        # ===============================================================
        #  GPIO
        # ===============================================================
        #  Socket 1 INT on a Pi 2 shield = GPIO6. Confirm with find_irq_pin.py
        #  on the assembled unit before trusting it. A wrong value gives a
        #  detector that logs nothing while reporting itself healthy, which is
        #  the worst failure this program can have. Never 12: GPIO12 is routed
        #  to neither socket on a Pi 2 shield.
        self.IRQ_PIN         = 6

        #  Strike pulse for a Campbell pulse-count channel. GPIO19 is socket 2's
        #  RST pin, so it lands on the Terminal 2 Click terminal labelled RST and
        #  one cable carries TX, GND and the pulse. It has to be a socket 2 pin:
        #  socket 1 is under the Thunder Click, so its GPIO18 PWM has no terminal.
        self.PULSE_MIRROR_ENABLED = False
        self.PULSE_MIRROR_PIN = 19
        #  How long the pulse is held high. The CR300 counts switch closures up
        #  to 150 Hz, so it needs a pulse wide enough to see; the main loop
        #  drops the pin this long after the strike rather than immediately.
        self.PULSE_MIRROR_MS  = 25

        # ===============================================================
        #  Campbell logger link  -  Terminal 2 Click in mikroBUS socket 2
        # ===============================================================
        #  The Terminal 2 Click is a passive breakout: it brings its socket's
        #  mikroBUS pins out to screw terminals. Both sockets carry the same
        #  mikroBUS UART, and that UART is the
        #  Pi's own UART (GPIO14 TX / GPIO15 RX), so this is /dev/serial0.
        #
        #  On a Zero W / Zero 2 W, /dev/serial0 is the mini-UART (ttyS0) by
        #  default because Bluetooth holds the PL011, and the mini-UART's baud
        #  rate follows the VPU core clock so it drifts when the clock scales.
        #  install.sh sets enable_uart=1 and dtoverlay=disable-bt, moving
        #  /dev/serial0 onto the PL011. Leave the port as /dev/serial0 and let
        #  the boot config decide which physical UART that is.
        self.CAMPBELL_ENABLED   = True
        self.CAMPBELL_TRANSPORT = "serial"   # "serial" | "bitbang"
        self.CAMPBELL_PORT      = "/dev/serial0"
        self.CAMPBELL_BAUD      = 9600       # 8N1, matches SerialOpen in CRBasic
        self.CAMPBELL_WRITE_TIMEOUT = 0.5    # hard deadline; never block the loop
        #  Status records to the logger are OFF. Health goes to the admin panel
        #  only; the logger records lightning. Interval is kept so the feature
        #  still works if it is ever re-enabled.
        self.CAMPBELL_HEARTBEAT_ENABLED = False
        self.CAMPBELL_HEARTBEAT_INTERVAL = 600
        #  The Terminal 2 Click also breaks out RX. Reading it is diagnostic
        #  only: whatever the logger sends is logged, never acted on. A serial
        #  line into a safety device is not a control channel, and treating it
        #  as one would let anything that reaches those terminals silence the
        #  site.
        self.CAMPBELL_READ_ENABLED  = True
        self.CAMPBELL_READ_MAX_LINE = 120
        self.CAMPBELL_TX_PIN        = 26     # bit-bang fallback only

        # ===============================================================
        #  AS3935 Sensor
        # ===============================================================
        self.AFE_MODE        = AFE_OUTDOOR
        #  Quaggasklip is not a smelter site, so the noise floor and rejection
        #  thresholds need not be raised as far as GWLD1's 5, and sensitivity is
        #  better for it. Raise these if the log fills with NOISE or DISTURBER
        #  events.
        self.NOISE_FLOOR     = 4     # 0-7
        self.WATCHDOG_THRESH = 4     # 0-15
        self.SPIKE_REJECT    = 4     # 0-15
        self.MIN_STRIKES     = 5     # 1, 5, 9 or 16
        self.TUNE_CAP        = 0     # 0-15, 8 pF per step; set by calibration
        self.MASK_DISTURBER  = True
        self.FREQ_DIV_RATIO  = 16    # 16, 32, 64 or 128

        # ===============================================================
        #  Station Identity
        # ===============================================================
        #  STATION_ID is the key the panel files every strike, heartbeat and
        #  calibration record under. It must match the station the admin
        #  assigned to the Quaggasklip tenant, character for character.
        self.STATION_ID      = "QUAGGASKLIP"
        self.SITE_NAME       = "Quaggasklip (Metron)"

        # ===============================================================
        #  Stratus Weather
        # ===============================================================
        self.STRATUS_ENABLED  = False
        self.STRATUS_ENDPOINT = ""
        self.STRATUS_API_KEY  = ""
        self.STRATUS_TIMEOUT  = 10
        self.STRATUS_RETRY_INTERVAL = 300

        # ===============================================================
        #  Admin panel webhooks
        # ===============================================================
        #  One URL is configured; heartbeat and calibration are derived from it
        #  so the three cannot drift apart.
        self.ALERT_WEBHOOK_ENABLED   = False
        self.ALERT_WEBHOOK_URL       = ""   # .../quaggasklip/api/v1/lightning
        self.ALERT_WEBHOOK_TOKEN     = ""   # shared secret, sent as X-Auth-Token
        self.ALERT_WEBHOOK_TIMEOUT   = 5    # short: the IRQ loop must not stall
        self.ALERT_DISTANCE_KM       = 40
        self.ALERT_MIN_DISTANCE_KM   = 0    # 0 = OFF, see _alert_webhook
        #  The panel marks a unit INACTIVE after 130 minutes of silence, so this
        #  has to stay comfortably under that.
        self.HEARTBEAT_WEBHOOK_INTERVAL = 3600
        self.CALIBRATION_REPORT_ENABLED = True

        # ===============================================================
        #  Interference guard (RF false-trigger suppression)
        # ===============================================================
        #  An implausible strike rate is the signature of RF interference, not
        #  lightning. A burst mutes OUTBOUND alerts only; strikes still go to the
        #  local CSV. The limit sits far above any real single-site flash rate,
        #  so genuine storms are untouched.
        self.INTERFERENCE_GUARD_ENABLED = True
        self.INTERFERENCE_STRIKE_LIMIT  = 12
        self.INTERFERENCE_WINDOW_S      = 10
        self.INTERFERENCE_COOLDOWN_S    = 180

        # ===============================================================
        #  Strike validation buffer (EMI pattern filtering)
        # ===============================================================
        #  Holds strikes briefly, then discards batches matching the EMI
        #  signature: many strikes all in the 1 km bin with no corroborating
        #  varied-distance activity. A real storm approaches with distant
        #  strikes first, so genuine overhead lightning still gets through.
        #  This exists because a false alert costs money to send.
        self.VALIDATION_BUFFER_ENABLED  = True
        self.VALIDATION_BUFFER_SECS     = 30
        self.VALIDATION_EMI_MIN_COUNT   = 5
        self.VALIDATION_EMI_DISTANCE_KM = 1
        self.STORM_CONTEXT_WINDOW_S     = 900   # 15 minutes

        # ===============================================================
        #  Temperature compensation
        # ===============================================================
        self.RECALIBRATE_TEMP_DELTA_C   = 10
        self.RECALIBRATE_INTERVAL_S     = 21600   # 6 hours
        self.ANTENNA_CHECK_ENABLED      = True
        self.ANTENNA_CHECK_HOUR         = 6       # 06:00 SAST, before solar gain
        self.CPU_TEMP_WARN_C            = 70
        self.CPU_TEMP_CRIT_C            = 78

        # ===============================================================
        #  Data Logging
        # ===============================================================
        self.LOG_DIR            = "/home/quaggasklip/lightning_data"
        self.LOG_LEVEL          = logging.INFO
        self.LOG_RETENTION_DAYS = 90

        # ===============================================================
        #  System
        # ===============================================================
        self.HEARTBEAT_INTERVAL      = 600
        self.BOOT_STABILIZE_SECS     = 5
        self.INIT_RETRY_LIMIT        = 10
        self.INIT_RETRY_DELAY        = 5
        self.REGISTER_CHECK_INTERVAL = 86400
        self.MAX_CONSECUTIVE_ERRORS  = 30

        # ===============================================================
        #  Config File
        # ===============================================================
        self.CONFIG_FILE = "/home/quaggasklip/quaggasklip_config.json"


# ===========================================================================
#  UTILITY FUNCTIONS
# ===========================================================================
#  /sys and /proc reads are cached: a strike burst would otherwise hit them
#  once per event for figures that change on the order of seconds.

_cached_cpu_temp = (-1.0, 0.0)
_cached_wifi     = ({"rssi_dbm": -1, "link_quality": -1}, 0.0)
_CACHE_TTL       = 10.0


def sd_notify(state):
    """Notify the systemd watchdog. No-op when not running under systemd."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    af_unix = getattr(socket, "AF_UNIX", None)
    if af_unix is None:
        return
    if addr[0] == "@":
        addr = "\0" + addr[1:]
    try:
        sock = socket.socket(af_unix, socket.SOCK_DGRAM)
        sock.sendto(state.encode(), addr)
        sock.close()
    except OSError:
        pass


def get_cpu_temperature():
    """CPU temperature in degrees C, cached 10 s. -1.0 when unavailable."""
    global _cached_cpu_temp
    now = time.monotonic()
    if now - _cached_cpu_temp[1] < _CACHE_TTL:
        return _cached_cpu_temp[0]
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            val = round(int(f.read().strip()) / 1000.0, 1)
    except (IOError, ValueError):
        val = -1.0
    _cached_cpu_temp = (val, now)
    return val


def get_uptime_seconds():
    """System uptime in seconds, or -1.0."""
    try:
        with open("/proc/uptime", "r") as f:
            return float(f.read().split()[0])
    except (IOError, ValueError, IndexError):
        return -1.0


def get_cpu_load_pct():
    """1-minute load as a percentage of available cores, or -1.0.

    Divided by core count so a Zero W and a Zero 2 W report on the same scale;
    the panel charts both against one axis.
    """
    try:
        with open("/proc/loadavg", "r") as f:
            load1 = float(f.read().split()[0])
        cores = os.cpu_count() or 1
        return round(load1 / cores * 100.0, 1)
    except (IOError, ValueError, IndexError):
        return -1.0


def get_wifi_signal():
    """WiFi RSSI and link quality, cached 10 s. -1 when unavailable."""
    global _cached_wifi
    now = time.monotonic()
    if now - _cached_wifi[1] < _CACHE_TTL:
        return _cached_wifi[0]
    result = {"rssi_dbm": -1, "link_quality": -1}
    try:
        with open("/proc/net/wireless", "r") as f:
            lines = f.readlines()
        for line in lines[2:]:
            parts = line.split()
            if len(parts) >= 4:
                result = {"link_quality": int(float(parts[2].rstrip("."))),
                          "rssi_dbm": int(float(parts[3].rstrip(".")))}
                break
    except (IOError, ValueError, IndexError):
        pass
    _cached_wifi = (result, now)
    return result


# ===========================================================================
#  AS3935 DRIVER
# ===========================================================================

class AS3935:
    """Driver for the ScioSense AS3935 Franklin Lightning Sensor IC."""

    def __init__(self):
        self.spi = None

    # ===================================================================
    #  SPI Transport
    # ===================================================================

    def open(self, spi_bus, spi_device, spi_speed, spi_mode):
        """Open the SPI connection to the AS3935."""
        self.spi = spidev.SpiDev()
        self.spi.open(spi_bus, spi_device)
        self.spi.max_speed_hz = spi_speed
        self.spi.mode = spi_mode

    def _read_register(self, register):
        """Read one register. Bit 6 of the address marks a read."""
        if self.spi is None:
            raise RuntimeError("SPI not initialized")
        return self.spi.xfer2([(register & 0x3F) | 0x40, 0x00])[1]

    def _write_register(self, register, value):
        """Write one register."""
        if self.spi is None:
            raise RuntimeError("SPI not initialized")
        self.spi.xfer2([register & 0x3F, value & 0xFF])

    def _modify_register(self, register, mask, shift, value):
        """Read-modify-write specific bits of a register."""
        current = self._read_register(register)
        cleared = current & ~(mask << shift)
        self._write_register(register, cleared | ((value & mask) << shift))

    # ===================================================================
    #  Commands
    # ===================================================================

    def reset(self):
        """Reset all registers to defaults."""
        self._write_register(REG_DEFAULT_RESET, PRESET_DEFAULT)
        time.sleep(0.002)

    def calibrate(self):
        """Calibrate the RC oscillators. True when both report complete."""
        self._write_register(REG_CALIB, DIRECT_COMMAND)
        time.sleep(0.002)
        trco = self._read_register(REG_CALIB_TRCO)
        srco = self._read_register(REG_CALIB_SRCO)
        return bool((trco & 0x80) and (srco & 0x80))

    # ===================================================================
    #  Setters
    # ===================================================================

    def set_afe_mode(self, mode):
        """Set the analog front-end gain mode."""
        self._modify_register(REG_AFE_GAIN, 0x3F, 1, mode >> 1)

    def set_noise_floor(self, level):
        """Set the noise floor threshold (0-7)."""
        if not 0 <= level <= 7:
            raise ValueError("Noise floor must be 0-7")
        self._modify_register(REG_AFE_GAIN, 0x07, 4, level)

    def set_watchdog_threshold(self, threshold):
        """Set the watchdog threshold (0-15)."""
        if not 0 <= threshold <= 15:
            raise ValueError("Watchdog threshold must be 0-15")
        self._modify_register(REG_THRESHOLD, 0x0F, 0, threshold)

    def set_spike_rejection(self, rejection):
        """Set the spike rejection level (0-15)."""
        if not 0 <= rejection <= 15:
            raise ValueError("Spike rejection must be 0-15")
        self._modify_register(REG_THRESHOLD, 0x0F, 4, rejection)

    def set_min_strikes(self, strikes):
        """Set minimum strikes before an interrupt (1, 5, 9 or 16)."""
        mapping = {1: 0, 5: 1, 9: 2, 16: 3}
        if strikes not in mapping:
            raise ValueError("Min strikes must be 1, 5, 9, or 16")
        self._modify_register(REG_LIGHTNING, 0x03, 4, mapping[strikes])

    def set_tune_cap(self, cap_value):
        """Set the antenna tuning capacitor (0-15, 8 pF per step)."""
        if not 0 <= cap_value <= 15:
            raise ValueError("Tune cap must be 0-15")
        self._modify_register(REG_DISP_IRQ, 0x0F, 0, cap_value)

    def set_mask_disturber(self, mask):
        """Enable or disable disturber interrupt masking."""
        self._modify_register(REG_INT_MASK_ANT, 0x01, 5, 1 if mask else 0)

    def set_freq_div_ratio(self, ratio):
        """Set the antenna frequency division ratio (16, 32, 64 or 128)."""
        mapping = {16: 0, 32: 1, 64: 2, 128: 3}
        if ratio not in mapping:
            raise ValueError("Division ratio must be 16, 32, 64, or 128")
        self._modify_register(REG_INT_MASK_ANT, 0x03, 6, mapping[ratio])

    # ===================================================================
    #  Getters
    # ===================================================================

    def get_noise_floor(self):
        """Read back the noise floor threshold."""
        return (self._read_register(REG_AFE_GAIN) >> 4) & 0x07

    def get_interrupt_type(self):
        """Read the interrupt source bits."""
        return self._read_register(REG_INT_MASK_ANT) & 0x0F

    def get_distance(self):
        """Distance to the storm front in km, or 0x3F when indeterminate."""
        return self._read_register(REG_DISTANCE) & 0x3F

    def get_energy(self):
        """Raw 21-bit energy value. A comparative figure, not joules."""
        lsb = self._read_register(REG_ENERGY_LSB)
        msb = self._read_register(REG_ENERGY_MSB)
        mmsb = self._read_register(REG_ENERGY_MMSB) & 0x1F
        return (mmsb << 16) | (msb << 8) | lsb

    # ===================================================================
    #  Maintenance
    # ===================================================================

    def clear_statistics(self):
        """Clear distance estimation statistics.

        The datasheet requires toggling bit 6 of REG_LIGHTNING
        set -> clear -> set to reset the algorithm.
        """
        reg = self._read_register(REG_LIGHTNING)
        self._write_register(REG_LIGHTNING, reg | 0x40)
        self._write_register(REG_LIGHTNING, reg & ~0x40)
        self._write_register(REG_LIGHTNING, reg | 0x40)

    def power_down(self):
        """Put the AS3935 into power-down mode."""
        self._modify_register(REG_AFE_GAIN, 0x01, 0, 1)

    def power_up(self):
        """Wake the AS3935 and recalibrate its oscillators."""
        self._modify_register(REG_AFE_GAIN, 0x01, 0, 0)
        time.sleep(0.002)
        self.calibrate()

    def verify_registers(self, config):
        """True when the critical registers still match the configuration.

        Nearby switching supplies and radios can flip AS3935 configuration bits,
        and a sensor silently running at defaults looks healthy while being far
        less useful. Cheap to check, so it is checked daily.
        """
        if ((self._read_register(REG_AFE_GAIN) >> 4) & 0x07) != config.NOISE_FLOOR:
            return False
        if (self._read_register(REG_THRESHOLD) & 0x0F) != config.WATCHDOG_THRESH:
            return False
        return True

    def initialize(self, config):
        """Full initialization sequence. Returns the calibration result."""
        self.reset()
        time.sleep(0.010)
        cal_ok = self.calibrate()
        self.set_afe_mode(config.AFE_MODE)
        self.set_noise_floor(config.NOISE_FLOOR)
        self.set_watchdog_threshold(config.WATCHDOG_THRESH)
        self.set_spike_rejection(config.SPIKE_REJECT)
        self.set_min_strikes(config.MIN_STRIKES)
        self.set_tune_cap(config.TUNE_CAP)
        self.set_mask_disturber(config.MASK_DISTURBER)
        self.set_freq_div_ratio(config.FREQ_DIV_RATIO)
        return cal_ok

    def close(self):
        """Release SPI resources."""
        if self.spi is not None:
            try:
                self.spi.close()
            except Exception:
                pass
            self.spi = None


# ===========================================================================
#  DATA LOGGER
# ===========================================================================

class DataLogger:
    """CSV event log with daily file rotation.

    This is the durable record. The panel POST is best-effort and the logger
    cable can be unplugged, but a strike must never be lost because a network
    was down, so it is written here first and unconditionally.
    """

    CSV_HEADER = [
        "datetime_sast", "event_type", "distance_km", "energy",
        "noise_floor", "watchdog_thresh", "spike_rejection",
        "cpu_temp_c", "wifi_rssi_dbm"
    ]

    def __init__(self, log_dir):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._current_date = None
        self._csv_file = None
        self._csv_writer = None

    def _ensure_file_open(self):
        """Open or roll over to today's file."""
        today = now_sast().strftime("%Y-%m-%d")
        if today != self._current_date:
            self._close_file()
            self._current_date = today
            path = self.log_dir / f"lightning_{today}.csv"
            existed = path.exists()
            self._csv_file = open(path, "a", newline="", buffering=1)
            self._csv_writer = csv.writer(self._csv_file)
            if not existed:
                self._csv_writer.writerow(self.CSV_HEADER)

    def _close_file(self):
        """Flush, fsync and close the current file.

        fsync because the usual way this unit stops is the battery going flat,
        not a clean shutdown.
        """
        if self._csv_file is not None:
            try:
                self._csv_file.flush()
                os.fsync(self._csv_file.fileno())
                self._csv_file.close()
            except OSError:
                pass
            self._csv_file = None
            self._csv_writer = None

    def purge_old_files(self, retention_days):
        """Delete CSV files older than retention_days."""
        cutoff = time.time() - (retention_days * 86400)
        try:
            for f in self.log_dir.glob("lightning_*.csv"):
                if f.stat().st_mtime < cutoff:
                    f.unlink()
        except OSError:
            pass

    def log_event(self, event_type, distance_km, energy, noise_floor,
                  watchdog_thresh, spike_rejection):
        """Append one event row."""
        try:
            self._ensure_file_open()
            if self._csv_writer is None:
                raise OSError("CSV writer not available")
            wifi = get_wifi_signal()
            self._csv_writer.writerow([
                now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"), event_type,
                distance_km, energy, noise_floor, watchdog_thresh,
                spike_rejection, get_cpu_temperature(), wifi["rssi_dbm"]
            ])
        except OSError as e:
            logging.getLogger("lightning").error("CSV write failed: %s", e)

    def close(self):
        """Close the logger."""
        self._close_file()


# ===========================================================================
#  CAMPBELL LOGGER LINK  (Terminal 2 Click, mikroBUS socket 2)
# ===========================================================================

class CampbellLink:
    r"""ASCII line link to a Campbell CR300 / CR1000 series datalogger.

    RECORD FORMAT - unchanged from the GWLD1 unit, on purpose
        L,<distance_km>,<energy>\r\n     one per forwarded strike
        H,<cpu_temp_c>,<rssi_dbm>\r\n    periodic "still alive"
    A CRBasic program written for GWLD1 reads this unit without modification,
    which is why the format was not "improved".

    TWO TRANSPORTS
        "serial"  the Pi's hardware UART through the Terminal 2 Click. Default.
                  Costs no CPU and is indifferent to what else the Pi is doing.
        "bitbang" pigpio waveforms on a spare GPIO, as GWLD1 does. Kept for a Pi
                  whose /boot config cannot be changed to free the UART.
                  Transmit only.

    A write must never block strike detection, so the port carries a write
    timeout and a stalled write is abandoned and counted rather than retried.
    An unplugged logger then costs nothing but a log line.
    """

    def __init__(self, config, logger):
        self.enabled = bool(config.CAMPBELL_ENABLED)
        self.transport = str(config.CAMPBELL_TRANSPORT or "serial").lower()
        self.port = config.CAMPBELL_PORT
        self.baud = int(config.CAMPBELL_BAUD)
        self.write_timeout = float(config.CAMPBELL_WRITE_TIMEOUT)
        self.read_enabled = bool(config.CAMPBELL_READ_ENABLED)
        self.read_max_line = int(config.CAMPBELL_READ_MAX_LINE)
        self.tx_pin = int(config.CAMPBELL_TX_PIN)
        self.logger = logger
        self._ser = None
        self._pi = None
        self._active = False
        self._rx = bytearray()
        self._write_failures = 0
        self.records_sent = 0

    # ===================================================================
    #  Lifecycle
    # ===================================================================

    def open(self):
        """Bring the link up. Never raises: a missing logger is not fatal."""
        if not self.enabled:
            self.logger.info("Campbell link disabled by configuration")
            return
        if self.transport == "bitbang":
            self._open_bitbang()
        else:
            self._open_serial()

    def _open_serial(self):
        """Open the hardware UART."""
        if serial is None:
            self.logger.error(
                "Campbell transport is 'serial' but pyserial is not installed; "
                "link disabled. Install with: sudo apt install python3-serial")
            return
        try:
            self._ser = serial.Serial(
                port=self.port, baudrate=self.baud,
                bytesize=serial.EIGHTBITS, parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                # Non-blocking reads: the detector polls, it never waits on the
                # logger.
                timeout=0,
                write_timeout=self.write_timeout)
            # Discard whatever arrived while nobody was listening, so the first
            # read is not a fragment from a previous run.
            for reset in (self._ser.reset_input_buffer,
                          self._ser.reset_output_buffer):
                try:
                    reset()
                except Exception:
                    pass
            self._active = True
            self.logger.info("Campbell link on %s @ %d baud 8N1 (hardware UART)",
                             self.port, self.baud)
        except Exception as e:
            # Usually the serial console still holding the port, or the service
            # user not being in the dialout group.
            self.logger.error(
                "Campbell serial open failed on %s: %s. Check that the serial "
                "console is disabled and enable_uart=1 is set in /boot.",
                self.port, e)
            self._ser = None
            self._active = False

    def _open_bitbang(self):
        """Open the pigpio bit-bang fallback."""
        if pigpio is None:
            self.logger.error(
                "Campbell transport is 'bitbang' but the pigpio module is not "
                "installed; link disabled")
            return
        try:
            self._pi = pigpio.pi()
            if not self._pi.connected:
                self.logger.error(
                    "Campbell transport is 'bitbang' but the pigpio daemon is "
                    "not reachable; link disabled. Start it with: "
                    "sudo systemctl enable --now pigpiod")
                self._pi = None
                return
            self._pi.set_mode(self.tx_pin, pigpio.OUTPUT)
            self._pi.write(self.tx_pin, 1)      # UART idles high
            self._active = True
            self.logger.info(
                "Campbell link on GPIO %d @ %d baud (bit-bang, transmit only)",
                self.tx_pin, self.baud)
        except Exception as e:
            self.logger.error("Campbell bit-bang init failed: %s", e)
            self._active = False

    def close(self):
        """Release the port or the pigpio connection."""
        self._active = False
        if self._ser is not None:
            for fn in (self._ser.flush, self._ser.close):
                try:
                    fn()
                except Exception:
                    pass
            self._ser = None
        if self._pi is not None:
            for fn in (self._pi.wave_tx_stop, self._pi.stop):
                try:
                    fn()
                except Exception:
                    pass
            self._pi = None

    @property
    def active(self):
        """True when a transport is open and usable."""
        return self._active

    # ===================================================================
    #  Record formatting  (static, so it is testable off-target)
    # ===================================================================

    # Every field on the wire MUST be a finite number.
    #
    # The CR300 parses these records with SplitStr SplitOption 0, which keeps
    # only + - . 0-9 E and discards everything else as a delimiter. So "nan" or
    # "inf" in a field does not arrive as a bad number, it vanishes entirely and
    # the record arrives one value short. The logger's NAN guard then rejects the
    # whole record, increments ParseErrorCount and, for a status record, lets the
    # detector age out to offline while it is in fact running. A malformed field
    # therefore costs far more than a wrong value, which is why both formatters
    # below substitute rather than pass anything through.
    @staticmethod
    def _finite_int(value, default):
        """int(value), or default if that is not a finite number.

        OverflowError is caught deliberately: int(float("inf")) raises it, and it
        is neither a TypeError nor a ValueError, so the original two-exception
        tuple let it escape and propagate out of the send path.
        """
        try:
            return int(value)
        except (TypeError, ValueError, OverflowError):
            return default

    @staticmethod
    def format_lightning(distance_km, energy):
        r"""Build ``L,<dist>,<energy>\r\n``."""
        dist = CampbellLink._finite_int(distance_km, -1)
        eng = CampbellLink._finite_int(energy, 0)
        return f"L,{dist},{eng}\r\n"

    @staticmethod
    def format_heartbeat(cpu_temp_c, rssi_dbm):
        r"""Build ``H,<cpu_temp_c>,<rssi_dbm>\r\n``."""
        try:
            cpu = round(float(cpu_temp_c), 1)
        except (TypeError, ValueError, OverflowError):
            cpu = 0.0
        # round() does NOT raise on nan or inf, it returns them unchanged, so the
        # try above cannot catch this case and it has to be tested for. The
        # comparison is false for nan (every comparison against nan is) and for
        # both infinities, which is exactly the set to reject, and it avoids
        # importing math just for isfinite.
        if not (float("-inf") < cpu < float("inf")):
            cpu = 0.0
        rssi = CampbellLink._finite_int(rssi_dbm, 0)
        return f"H,{cpu},{rssi}\r\n"

    # ===================================================================
    #  Transmit
    # ===================================================================

    def send_lightning(self, distance_km, energy):
        """Send one strike record."""
        self._send(self.format_lightning(distance_km, energy), "strike")

    def send_heartbeat(self, cpu_temp_c, rssi_dbm):
        """Send one status record."""
        self._send(self.format_heartbeat(cpu_temp_c, rssi_dbm), "heartbeat")

    def _send(self, record, what):
        """Write one record. Logs and returns on any failure."""
        if not self._active:
            return
        data = record.encode("ascii", "replace")
        try:
            if self._ser is not None:
                self._ser.write(data)
                # Without this the bytes can sit in the OS buffer past the
                # logger's scan window and be read a scan late.
                self._ser.flush()
            elif self._pi is not None:
                self._send_bitbang(data)
            self.records_sent += 1
            self._write_failures = 0
        except Exception as e:
            self._write_failures += 1
            # First failure, then every 50th. An unplugged logger would
            # otherwise emit one line per strike and bury everything else.
            if self._write_failures == 1 or self._write_failures % 50 == 0:
                self.logger.warning("Campbell %s write failed (%d consecutive): %s",
                                    what, self._write_failures, e)

    def _send_bitbang(self, data):
        """Clock one record out with pigpio waveforms."""
        pi = self._pi
        wid = -1
        try:
            pi.wave_add_new()
            pi.wave_add_serial(self.tx_pin, self.baud, data)
            wid = pi.wave_create()
            if wid < 0:
                raise RuntimeError(f"wave_create failed ({wid})")
            pi.wave_send_once(wid)
            started = time.monotonic()
            while pi.wave_tx_busy():
                if time.monotonic() - started > self.write_timeout:
                    break
                time.sleep(0.001)
        finally:
            if wid >= 0:
                try:
                    pi.wave_delete(wid)
                except Exception:
                    pass

    # ===================================================================
    #  Receive  (diagnostic only)
    # ===================================================================

    def poll(self):
        """Drain anything the logger sent and return complete lines.

        Diagnostic only. Nothing the logger says changes what this detector
        does: a serial line into a safety device is not a control channel, and
        treating it as one would let anything able to reach those screw
        terminals silence the site.
        """
        if not self._active or self._ser is None or not self.read_enabled:
            return []
        try:
            waiting = self._ser.in_waiting
            if not waiting:
                return []
            self._rx.extend(self._ser.read(waiting))
        except Exception as e:
            self.logger.debug("Campbell read failed: %s", e)
            return []

        lines = []
        while True:
            idx = self._rx.find(b"\n")
            if idx < 0:
                break
            raw = bytes(self._rx[:idx])
            del self._rx[:idx + 1]
            text = raw.decode("ascii", "replace").strip()
            if text:
                lines.append(text)
        # A logger babbling without newlines must not grow the buffer forever.
        if len(self._rx) > self.read_max_line:
            del self._rx[:-self.read_max_line]
        return lines


# ===========================================================================
#  LIGHTNING DETECTION SYSTEM
# ===========================================================================

_detector_instance = None   # module-level reference for the signal handler


class QuaggasklipDetector:
    """Main controller for the Quaggasklip (Metron) detector.

    Built for unattended outdoor operation and unassisted recovery after a power
    loss, which on solar is a routine event rather than a fault.
    """

    # Config values are type- and range-checked before they are applied, so a
    # typo in the JSON degrades to a warning and a default rather than a
    # detector running with a nonsensical setting.
    _CONFIG_VALIDATORS = {
        "SPI_BUS":                     (int, 0, 1),
        "SPI_DEVICE":                  (int, 0, 1),
        "SPI_SPEED_HZ":                (int, 100000, 2000000),
        "IRQ_PIN":                     (int, 0, 27),
        "PULSE_MIRROR_ENABLED":        (bool, None, None),
        "PULSE_MIRROR_PIN":            (int, 0, 27),
        "PULSE_MIRROR_MS":             (int, 1, 500),
        "CAMPBELL_ENABLED":            (bool, None, None),
        "CAMPBELL_TRANSPORT":          (str, ["serial", "bitbang"], None),
        "CAMPBELL_BAUD":               (int, 300, 115200),
        "CAMPBELL_WRITE_TIMEOUT":      (float, 0.05, 5.0),
        "CAMPBELL_HEARTBEAT_ENABLED":  (bool, None, None),
        "CAMPBELL_HEARTBEAT_INTERVAL": (int, 60, 86400),
        "CAMPBELL_READ_ENABLED":       (bool, None, None),
        "CAMPBELL_READ_MAX_LINE":      (int, 16, 4096),
        "CAMPBELL_TX_PIN":             (int, 0, 27),
        "NOISE_FLOOR":                 (int, 0, 7),
        "WATCHDOG_THRESH":             (int, 0, 15),
        "SPIKE_REJECT":                (int, 0, 15),
        "MIN_STRIKES":                 (int, [1, 5, 9, 16], None),
        "TUNE_CAP":                    (int, 0, 15),
        "MASK_DISTURBER":              (bool, None, None),
        "FREQ_DIV_RATIO":              (int, [16, 32, 64, 128], None),
        "STRATUS_ENABLED":             (bool, None, None),
        "STRATUS_TIMEOUT":             (int, 1, 120),
        "STRATUS_RETRY_INTERVAL":      (int, 30, 86400),
        "ALERT_WEBHOOK_ENABLED":       (bool, None, None),
        "ALERT_WEBHOOK_TIMEOUT":       (int, 1, 60),
        "ALERT_DISTANCE_KM":           (int, 1, 40),
        "ALERT_MIN_DISTANCE_KM":       (int, 0, 40),
        "HEARTBEAT_WEBHOOK_INTERVAL":  (int, 60, 86400),
        "CALIBRATION_REPORT_ENABLED":  (bool, None, None),
        "INTERFERENCE_GUARD_ENABLED":  (bool, None, None),
        "INTERFERENCE_STRIKE_LIMIT":   (int, 3, 1000),
        "INTERFERENCE_WINDOW_S":       (int, 1, 600),
        "INTERFERENCE_COOLDOWN_S":     (int, 0, 3600),
        "VALIDATION_BUFFER_ENABLED":   (bool, None, None),
        "VALIDATION_BUFFER_SECS":      (int, 5, 300),
        "VALIDATION_EMI_MIN_COUNT":    (int, 2, 100),
        "VALIDATION_EMI_DISTANCE_KM":  (int, 1, 10),
        "STORM_CONTEXT_WINDOW_S":      (int, 60, 7200),
        "RECALIBRATE_TEMP_DELTA_C":    (int, 3, 30),
        "RECALIBRATE_INTERVAL_S":      (int, 3600, 86400),
        "ANTENNA_CHECK_ENABLED":       (bool, None, None),
        "ANTENNA_CHECK_HOUR":          (int, 0, 23),
        "CPU_TEMP_WARN_C":             (int, 40, 85),
        "CPU_TEMP_CRIT_C":             (int, 50, 90),
        "HEARTBEAT_INTERVAL":          (int, 60, 86400),
        "BOOT_STABILIZE_SECS":         (int, 0, 60),
        "INIT_RETRY_LIMIT":            (int, 1, 100),
        "INIT_RETRY_DELAY":            (int, 1, 300),
        "REGISTER_CHECK_INTERVAL":     (int, 60, 604800),
        "LOG_RETENTION_DAYS":          (int, 1, 3650),
        "MAX_CONSECUTIVE_ERRORS":      (int, 1, 1000),
    }

    def __init__(self, config):
        self.config = config
        self._running = False
        self._interrupt_flag = False
        self._last_heartbeat = 0.0
        self._last_panel_heartbeat = 0.0
        self._last_campbell_heartbeat = 0.0
        self._last_register_check = 0.0
        self._consecutive_errors = 0

        # Daily statistics, reset at midnight SAST
        self._strike_count_today = 0
        self._closest_today_km = 999
        self._last_reset_date = now_sast().strftime("%Y-%m-%d")

        # Interference guard
        self._recent_strikes = deque()
        self._interference_until = 0.0

        # Strike validation buffer
        self._validation_buffer = []
        self._validation_flush_time = 0.0
        self._last_varied_distance_ts = 0.0

        # Pulse mirror: set high by the IRQ callback, dropped by the main loop
        # once the pulse has been wide enough for the logger to count.
        self._pulse_until = 0.0

        # Temperature compensation
        self._last_recalibrate_temp = -999.0
        self._last_recalibrate_time = 0.0
        self._last_antenna_check_date = ""

        # Stratus connection state
        self._stratus_online = True
        self._stratus_last_retry = 0.0

        self._load_config_file()
        self._setup_logging()

        self._stratus_buffer_path = Path(self.config.LOG_DIR) / "stratus_buffer.jsonl"
        self._stratus_buffer_file = None

        self.sensor = AS3935()
        self.data_logger = DataLogger(self.config.LOG_DIR)
        self.campbell = CampbellLink(self.config, self.logger)

    # ===================================================================
    #  Configuration
    # ===================================================================

    def _load_config_file(self):
        """Apply validated overrides from the JSON config file."""
        path = Path(self.config.CONFIG_FILE)
        if not path.exists():
            return
        log = logging.getLogger("lightning")
        try:
            with open(path, "r") as f:
                overrides = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            log.warning("Config file load failed (%s), using defaults", e)
            return
        for key, value in overrides.items():
            key_upper = key.upper()
            if not hasattr(self.config, key_upper):
                log.warning("Config: unknown key '%s', skipping", key)
                continue
            if not self._validate_config_value(key_upper, value):
                continue
            setattr(self.config, key_upper, value)

    def _validate_config_value(self, key, value):
        """True when `value` is acceptable for `key`."""
        rule = self._CONFIG_VALIDATORS.get(key)
        if rule is None:
            return True          # strings, paths and URLs carry no range rule
        log = logging.getLogger("lightning")
        expected_type = rule[0]
        # A whole number is a valid float setting; the reverse is not true.
        if expected_type is float and isinstance(value, int) \
                and not isinstance(value, bool):
            value = float(value)
        # bool is a subclass of int in Python, so `true` would sail through an
        # int check and become 1. Reject it explicitly.
        if not isinstance(value, expected_type) or \
                (expected_type is not bool and isinstance(value, bool)):
            log.warning("Config: '%s' expects %s, got %s - skipping",
                        key, expected_type.__name__, type(value).__name__)
            return False
        if expected_type is bool:
            return True
        constraint = rule[1]
        if isinstance(constraint, list):
            if value not in constraint:
                log.warning("Config: '%s' value %s not in %s - skipping",
                            key, value, constraint)
                return False
        elif constraint is not None:
            lo, hi = rule[1], rule[2]
            if not lo <= value <= hi:
                log.warning("Config: '%s' value %s out of range [%s..%s] - skipping",
                            key, value, lo, hi)
                return False
        return True

    def _setup_logging(self):
        """Rotating file log plus stdout, so journalctl shows the same lines."""
        Path(self.config.LOG_DIR).mkdir(parents=True, exist_ok=True)
        self.logger = logging.getLogger("lightning")
        self.logger.setLevel(self.config.LOG_LEVEL)
        if self.logger.handlers:
            return
        fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s",
                                datefmt="%Y-%m-%dT%H:%M:%S%z")
        fh = logging.handlers.RotatingFileHandler(
            Path(self.config.LOG_DIR) / "quaggasklip.log",
            maxBytes=2 * 1024 * 1024, backupCount=5)
        fh.setFormatter(fmt)
        self.logger.addHandler(fh)
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        self.logger.addHandler(sh)

    # ===================================================================
    #  Hardware Initialization
    # ===================================================================

    def _init_hardware(self):
        """Set up GPIO and the AS3935, retrying through a cold boot.

        After a power loss on solar, the SPI bus and the sensor may not be ready
        at the moment systemd starts us. This retries rather than exiting and
        leaving the site unmonitored until somebody notices.
        """
        self.logger.info("[1/4] Boot stabilization delay (%d s)...",
                         self.config.BOOT_STABILIZE_SECS)
        time.sleep(self.config.BOOT_STABILIZE_SECS)

        # Derived, not hardcoded: chip select is what decides the socket, so the
        # log cannot drift out of step with the configuration.
        socket_no = self.config.SPI_DEVICE + 1
        self.logger.info("[2/4] Configuring GPIO (IRQ on GPIO%d, mikroBUS "
                         "socket %d INT)...", self.config.IRQ_PIN, socket_no)
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        GPIO.setup(self.config.IRQ_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
        if self.config.PULSE_MIRROR_ENABLED:
            if self.config.PULSE_MIRROR_PIN == self.config.IRQ_PIN:
                self.logger.warning(
                    "Pulse mirror pin equals IRQ pin (%d) - disabling mirror",
                    self.config.IRQ_PIN)
                self.config.PULSE_MIRROR_ENABLED = False
            else:
                GPIO.setup(self.config.PULSE_MIRROR_PIN, GPIO.OUT,
                           initial=GPIO.LOW)

        self.logger.info("[3/4] Initializing AS3935 on SPI %d.%d (CE%d, "
                         "mikroBUS socket %d)...",
                         self.config.SPI_BUS, self.config.SPI_DEVICE,
                         self.config.SPI_DEVICE, socket_no)
        last_err = None
        for attempt in range(1, self.config.INIT_RETRY_LIMIT + 1):
            try:
                self.sensor.open(self.config.SPI_BUS, self.config.SPI_DEVICE,
                                 self.config.SPI_SPEED_HZ, self.config.SPI_MODE)
                cal_ok = self.sensor.initialize(self.config)
                if cal_ok:
                    self.logger.info("AS3935 calibration PASSED (attempt %d/%d)",
                                     attempt, self.config.INIT_RETRY_LIMIT)
                else:
                    self.logger.warning(
                        "AS3935 calibration FAILED on attempt %d/%d "
                        "(sensor may still function)",
                        attempt, self.config.INIT_RETRY_LIMIT)
                return cal_ok
            except Exception as e:
                last_err = e
                self.logger.error("Hardware init attempt %d/%d failed: %s",
                                  attempt, self.config.INIT_RETRY_LIMIT, e)
                self.sensor.close()
                if attempt < self.config.INIT_RETRY_LIMIT:
                    time.sleep(self.config.INIT_RETRY_DELAY)

        self.logger.critical("Hardware init failed after %d attempts: %s",
                             self.config.INIT_RETRY_LIMIT, last_err)
        raise RuntimeError("AS3935 init failed after %d attempts"
                           % self.config.INIT_RETRY_LIMIT)

    # ===================================================================
    #  Stratus Weather
    # ===================================================================

    def _stratus_post(self, data):
        """POST to the Stratus ingest endpoint, buffering while offline.

        Unlike the panel webhooks, Stratus data is a time series worth keeping,
        so a failure is buffered to disk and replayed rather than dropped.
        """
        if not self.config.STRATUS_ENABLED:
            return
        if not self._stratus_online:
            self._stratus_buffer(data)
            return
        if not self._stratus_send(data):
            self._stratus_online = False
            self._stratus_last_retry = time.monotonic()
            self._stratus_buffer(data)
            self.logger.warning("Stratus offline - buffering to %s",
                                self._stratus_buffer_path.name)

    def _stratus_send(self, data):
        """One HTTP POST to Stratus. True on success."""
        try:
            body = json.dumps({"data": data}).encode("utf-8")
            req = urllib.request.Request(self.config.STRATUS_ENDPOINT,
                                         data=body, method="POST")
            req.add_header("Content-Type", "application/json")
            if self.config.STRATUS_API_KEY:
                req.add_header("X-API-Key", self.config.STRATUS_API_KEY)
            with urllib.request.urlopen(
                    req, timeout=self.config.STRATUS_TIMEOUT) as resp:
                if 200 <= resp.status < 300:
                    return True
                self.logger.warning("Stratus POST returned HTTP %d", resp.status)
                return False
        except urllib.error.HTTPError as e:
            self.logger.error("Stratus POST HTTP error %d: %s", e.code, e.reason)
        except urllib.error.URLError as e:
            self.logger.error("Stratus POST connection error: %s", e.reason)
        except Exception as e:
            self.logger.error("Stratus POST failed: %s", e)
        return False

    def _stratus_buffer(self, data):
        """Append one payload to the local JSONL buffer."""
        try:
            if self._stratus_buffer_file is None or self._stratus_buffer_file.closed:
                self._stratus_buffer_file = open(self._stratus_buffer_path, "a",
                                                 buffering=1)
            record = json.dumps({"ts": now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"),
                                 "data": data})
            self._stratus_buffer_file.write(record + "\n")
            self._stratus_buffer_file.flush()
        except OSError as e:
            self.logger.error("Buffer write failed: %s", e)

    def _stratus_retry(self):
        """Probe Stratus and flush the buffer when it answers."""
        self._stratus_last_retry = time.monotonic()
        self.logger.info("Retrying Stratus connection...")
        probe = {"status": "RECONNECT", "station": self.config.STATION_ID}
        if not self._stratus_send(probe):
            self.logger.info("Stratus still unreachable, next retry in %d s",
                             self.config.STRATUS_RETRY_INTERVAL)
            return
        self._stratus_online = True
        self.logger.info("Stratus connection restored - flushing buffer")
        self._stratus_flush_buffer()

    def _stratus_flush_buffer(self):
        """Replay the buffer, keeping anything that did not get through."""
        if not self._stratus_buffer_path.exists():
            return
        if self._stratus_buffer_file is not None:
            try:
                self._stratus_buffer_file.close()
            except OSError:
                pass
            self._stratus_buffer_file = None
        try:
            with open(self._stratus_buffer_path, "r") as f:
                lines = f.readlines()
        except OSError as e:
            self.logger.error("Buffer read failed: %s", e)
            return

        sent = skipped = 0
        remaining = []
        for idx, raw in enumerate(lines):
            stripped = raw.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
            except json.JSONDecodeError:
                skipped += 1          # unparseable line: drop it, not retryable
                continue
            if self._stratus_send(record.get("data", {})):
                sent += 1
                continue
            # Connection lost mid-flush: keep this line and every one after it,
            # so ordering is preserved on the next attempt.
            remaining = lines[idx:]
            self._stratus_online = False
            self._stratus_last_retry = time.monotonic()
            self.logger.warning("Flush interrupted after %d sent, keeping %d",
                                sent, len(remaining))
            break

        try:
            if remaining:
                with open(self._stratus_buffer_path, "w") as f:
                    f.writelines(remaining)
            else:
                self._stratus_buffer_path.unlink(missing_ok=True)
                self.logger.info("Buffer flushed: %d sent, %d skipped",
                                 sent, skipped)
        except OSError:
            pass

    # ===================================================================
    #  Admin panel webhooks
    # ===================================================================
    #  All three are fire-and-forget. Errors are logged and swallowed: the
    #  interrupt loop must never be delayed by panel connectivity, and the CSV
    #  is the durable record if the panel is unreachable.

    def _panel_url(self, endpoint):
        """Derive a sibling panel endpoint from the configured alert URL.

        .../api/v1/lightning -> .../api/v1/<endpoint>. One configured URL then
        drives all three, so they cannot be pointed at different panels.
        """
        base = (self.config.ALERT_WEBHOOK_URL or "").strip()
        if not base:
            return ""
        return base.rsplit("/", 1)[0] + "/" + endpoint

    def _post_panel(self, url, payload, what):
        """POST one JSON payload to the panel. Returns True on a 2xx."""
        try:
            req = urllib.request.Request(
                url, data=json.dumps(payload).encode("utf-8"), method="POST")
            req.add_header("Content-Type", "application/json")
            if self.config.ALERT_WEBHOOK_TOKEN:
                req.add_header("X-Auth-Token", self.config.ALERT_WEBHOOK_TOKEN)
            with urllib.request.urlopen(
                    req, timeout=self.config.ALERT_WEBHOOK_TIMEOUT) as resp:
                if 200 <= resp.status < 300:
                    return True
                self.logger.warning("%s webhook HTTP %d", what, resp.status)
        except Exception as e:
            self.logger.warning("%s webhook failed: %s", what, e)
        return False

    def _alert_webhook(self, distance_km, energy):
        """Best-effort POST of one strike to the panel.

        The panel owns recipient routing, throttling and delivery. This program
        never contacts a recipient itself.
        """
        if not (self.config.ALERT_WEBHOOK_ENABLED and self.config.ALERT_WEBHOOK_URL):
            return
        try:
            dist = int(distance_km) if distance_km not in (None, "") else 99
        except (TypeError, ValueError):
            dist = 99
        # An out-of-range strike (sensor reports -1 here) is never a local
        # threat, and the panel rejects a negative distance anyway.
        if dist < 0:
            return
        # Optional near-field floor, default 0 = OFF. Not advised on a safety
        # system: the 1 km bin is exactly where a storm directly overhead
        # appears, so raising this can hide the strikes that matter most. Use
        # the rate-based interference guard instead. Kept only for sites with
        # known, constant near-field RFI.
        if 0 < dist < self.config.ALERT_MIN_DISTANCE_KM:
            self.logger.warning(
                "Strike at %d km below alert_min_distance_km=%d - not alerted",
                dist, self.config.ALERT_MIN_DISTANCE_KM)
            return
        if dist > self.config.ALERT_DISTANCE_KM:
            return
        payload = {
            "station_id":  self.config.STATION_ID,
            "distance_km": dist,
            "energy":      energy,
            "timestamp":   now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"),
        }
        if self._post_panel(self.config.ALERT_WEBHOOK_URL, payload, "Alert"):
            self.logger.info("Alert webhook sent (dist=%d km)", dist)

    def _heartbeat_webhook(self, cpu_temp, uptime, noise):
        """Periodic liveness POST, so the panel can tell quiet from dead."""
        if not self.config.ALERT_WEBHOOK_ENABLED:
            return
        url = self._panel_url("heartbeat")
        if not url:
            return
        # WiFi RSSI is deliberately not sent: on these units the radio sits
        # centimeters from the Pi, so the figure reads misleadingly hot and is
        # not operationally useful on the panel. CPU temperature only.
        load = get_cpu_load_pct()
        payload = {
            "station_id":    self.config.STATION_ID,
            "timestamp":     now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"),
            "cpu_temp_c":    round(cpu_temp, 1),
            "uptime_s":      round(uptime, 0),
            "noise_floor":   noise,
            "strikes_today": self._strike_count_today,
            # null rather than the -1 sentinel, so the panel stores NULL and
            # the chart shows "awaiting update" instead of a load of -1%.
            "cpu_load_pct":  load if load is not None and load >= 0 else None,
        }
        if self._post_panel(url, payload, "Heartbeat"):
            self.logger.info("Heartbeat webhook sent")

    def _calibration_webhook(self, kind, reason=None, cpu_temp_c=None,
                             freq_hz=None, in_tolerance=None,
                             tune_cap_before=None, tune_cap_after=None):
        """Report a calibration action, so the monthly report has real history."""
        if not (self.config.ALERT_WEBHOOK_ENABLED
                and self.config.CALIBRATION_REPORT_ENABLED):
            return
        url = self._panel_url("calibration")
        if not url:
            return
        self._post_panel(url, {
            "station_id":      self.config.STATION_ID,
            "timestamp":       now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"),
            "kind":            kind,
            "reason":          reason,
            "cpu_temp_c":      round(cpu_temp_c, 1) if cpu_temp_c is not None else None,
            "freq_hz":         int(freq_hz) if freq_hz is not None else None,
            "in_tolerance":    in_tolerance,
            "tune_cap_before": tune_cap_before,
            "tune_cap_after":  tune_cap_after,
        }, "Calibration")


    # ===================================================================
    #  Daily Stats
    # ===================================================================

    def _reset_daily_stats(self):
        """Roll the daily counters over at midnight SAST."""
        today = now_sast().strftime("%Y-%m-%d")
        if today == self._last_reset_date:
            return
        self.logger.info(
            "Date rollover %s -> %s | Yesterday: %d strikes, closest %s km",
            self._last_reset_date, today, self._strike_count_today,
            str(self._closest_today_km) if self._closest_today_km < 999 else "N/A")
        self._strike_count_today = 0
        self._closest_today_km = 999
        self._last_reset_date = today
        self.data_logger.purge_old_files(self.config.LOG_RETENTION_DAYS)

    # ===================================================================
    #  Interrupt Handling
    # ===================================================================

    def _irq_callback(self, channel):
        """GPIO edge handler. Sets a flag; all real work is on the main loop.

        Kept to almost nothing on purpose: this runs on RPi.GPIO's callback
        thread, and the AS3935 must not be touched over SPI for 2 ms after the
        interrupt anyway.
        """
        if self.config.PULSE_MIRROR_ENABLED:
            try:
                GPIO.output(self.config.PULSE_MIRROR_PIN, GPIO.HIGH)
                self._pulse_until = time.monotonic() + \
                    (self.config.PULSE_MIRROR_MS / 1000.0)
            except RuntimeError:
                pass
        self._interrupt_flag = True

    def _service_pulse_mirror(self):
        """Drop the mirror pin once the pulse has been wide enough to count."""
        if not self.config.PULSE_MIRROR_ENABLED or not self._pulse_until:
            return
        if time.monotonic() < self._pulse_until:
            return
        self._pulse_until = 0.0
        try:
            GPIO.output(self.config.PULSE_MIRROR_PIN, GPIO.LOW)
        except RuntimeError:
            pass

    def _interference_check(self):
        """True when outbound alerts should be suppressed.

        An implausibly high strike rate is the signature of RF interference, so
        a burst mutes the outbound paths for a cool-down period. Strikes are
        always logged locally either way; this only gates the panel POST, the
        Campbell record and Stratus so they are not flooded. Genuine lightning
        never approaches the limit.
        """
        if not self.config.INTERFERENCE_GUARD_ENABLED:
            return False
        now = time.monotonic()
        self._recent_strikes.append(now)
        window = self.config.INTERFERENCE_WINDOW_S
        while self._recent_strikes and now - self._recent_strikes[0] > window:
            self._recent_strikes.popleft()

        if now < self._interference_until:
            return True                      # still cooling down
        if len(self._recent_strikes) >= self.config.INTERFERENCE_STRIKE_LIMIT:
            self._interference_until = now + self.config.INTERFERENCE_COOLDOWN_S
            self.logger.warning(
                "Suspected RF interference: %d strikes in %ds (limit %d) - "
                "outbound alerts muted for %ds; strikes still logged locally",
                len(self._recent_strikes), window,
                self.config.INTERFERENCE_STRIKE_LIMIT,
                self.config.INTERFERENCE_COOLDOWN_S)
            return True
        return False

    # ===================================================================
    #  Strike Validation Buffer
    # ===================================================================

    def _buffer_strike(self, distance_km, energy):
        """Hold a strike for evaluation. True when the caller must not post."""
        if not self.config.VALIDATION_BUFFER_ENABLED:
            return False
        now = time.monotonic()
        self._validation_buffer.append((now, distance_km, energy))
        if len(self._validation_buffer) == 1:
            self._validation_flush_time = now + self.config.VALIDATION_BUFFER_SECS
        return True

    def _flush_validation_buffer(self):
        """Decide whether a held batch is lightning or EMI, then act.

        The discriminator, tuned on the EMI seen at these installations, which
        always lands in the AS3935's indeterminate 1 km bin:
          - A batch containing any varied-distance strike (>1 km, in range) has
            real storm geometry: forward all of it and remember when.
          - An all-1 km batch is forwarded only if a varied-distance strike was
            seen within STORM_CONTEXT_WINDOW_S, i.e. a corroborated storm has
            arrived overhead. Otherwise it is EMI and is discarded.
        A real storm approaches with distant strikes first, so genuine overhead
        lightning is still covered. Uncorroborated 1 km-only activity never is,
        regardless of how many strikes it contains, so a small burst cannot leak
        through by staying under a count threshold.
        """
        if not self._validation_buffer:
            return
        if time.monotonic() < self._validation_flush_time:
            return

        batch = self._validation_buffer
        self._validation_buffer = []
        now = time.monotonic()
        emi_dist = self.config.VALIDATION_EMI_DISTANCE_KM
        has_varied = any(d != emi_dist for _t, d, _e in batch)

        if has_varied:
            self._last_varied_distance_ts = now
            self.logger.info("Validation buffer releasing %d strike(s) "
                             "(varied-distance storm)", len(batch))
            for _t, dist, energy in batch:
                self._alert_webhook(dist, energy)
            return

        within_storm = (self._last_varied_distance_ts > 0 and
                        (now - self._last_varied_distance_ts)
                        <= self.config.STORM_CONTEXT_WINDOW_S)
        if within_storm:
            self.logger.info("Validation buffer releasing %d overhead strike(s) "
                             "(storm-corroborated)", len(batch))
            for _t, dist, energy in batch:
                self._alert_webhook(dist, energy)
            return

        self.logger.warning(
            "[FILTERED-EMI] Discarded %d strike(s) (all at %d km, no storm "
            "context within %ds) - not forwarded to the panel",
            len(batch), emi_dist, self.config.STORM_CONTEXT_WINDOW_S)
        self.data_logger.log_event("FILTERED_EMI", emi_dist, 0,
                                   self.sensor.get_noise_floor(),
                                   self.config.WATCHDOG_THRESH,
                                   self.config.SPIKE_REJECT)

    # ===================================================================
    #  Temperature Compensation
    # ===================================================================

    def _temperature_compensation(self):
        """Recalibrate the RC oscillators as temperature drifts.

        The TRCO and SRCO oscillators drift with temperature, and CPU
        temperature is a usable proxy for the enclosure. Recalibrate on a
        significant change, and on a fixed interval as a safety net.
        """
        now = time.monotonic()
        cpu_temp = get_cpu_temperature()
        time_due = (now - self._last_recalibrate_time
                    >= self.config.RECALIBRATE_INTERVAL_S)
        temp_due = (self._last_recalibrate_temp > -900 and
                    abs(cpu_temp - self._last_recalibrate_temp)
                    >= self.config.RECALIBRATE_TEMP_DELTA_C)

        if time_due or temp_due:
            self.logger.info(
                "RC oscillator recalibration (%s): CPU %.1f C (last cal at %.1f C)",
                "temp delta" if temp_due else "periodic",
                cpu_temp, self._last_recalibrate_temp)
            if self.sensor.calibrate():
                self.logger.info("RC recalibration PASSED")
            else:
                self.logger.warning("RC recalibration reported FAIL "
                                    "(sensor may still function)")
            self._last_recalibrate_temp = cpu_temp
            self._last_recalibrate_time = now
            self._calibration_webhook(
                kind="rc_recal",
                reason="temp_delta" if temp_due else "interval",
                cpu_temp_c=cpu_temp)

        if cpu_temp >= self.config.CPU_TEMP_CRIT_C:
            self.logger.error("CPU temperature CRITICAL: %.1f C (threshold %d C)",
                              cpu_temp, self.config.CPU_TEMP_CRIT_C)
        elif cpu_temp >= self.config.CPU_TEMP_WARN_C:
            self.logger.warning("CPU temperature HIGH: %.1f C (threshold %d C)",
                                cpu_temp, self.config.CPU_TEMP_WARN_C)

    def _measure_antenna_frequency(self):
        """Measure the LCO frequency by counting edges on the IRQ pin.

        Puts the sensor into antenna-display mode, which drives INT with the
        resonant frequency divided by FREQ_DIV_RATIO, counts rising edges over a
        fixed window, then restores normal interrupt handling.

        The detector is deaf for roughly the measurement window plus settling,
        which is why this runs once a day at a quiet hour and not on demand.
        """
        GPIO.remove_event_detect(self.config.IRQ_PIN)
        time.sleep(0.01)

        reg08 = self.sensor._read_register(REG_DISP_IRQ)
        self.sensor._write_register(REG_DISP_IRQ, reg08 | 0x80)   # DISP_LCO
        time.sleep(0.05)                                          # let it settle

        measure_ms = 200
        count = [0]

        def _count_pulse(channel):
            count[0] += 1

        GPIO.add_event_detect(self.config.IRQ_PIN, GPIO.RISING,
                              callback=_count_pulse)
        time.sleep(measure_ms / 1000.0)
        GPIO.remove_event_detect(self.config.IRQ_PIN)

        self.sensor._write_register(REG_DISP_IRQ, reg08 & ~0x80)
        time.sleep(0.01)
        GPIO.add_event_detect(self.config.IRQ_PIN, GPIO.RISING,
                              callback=self._irq_callback, bouncetime=5)

        divided = count[0] / (measure_ms / 1000.0)
        return int(divided * self.config.FREQ_DIV_RATIO)

    def _antenna_frequency_check(self):
        """Daily antenna resonance check at a fixed SAST hour.

        The antenna must sit within 3.5% of 500 kHz for the distance estimate to
        mean anything. Runs at a fixed early hour, when the enclosure is at its
        most thermally stable, and nudges the tuning capacitor one step at a
        time rather than chasing the reading.
        """
        if not self.config.ANTENNA_CHECK_ENABLED:
            return
        current = now_sast()
        today = current.strftime("%Y-%m-%d")
        if today == self._last_antenna_check_date:
            return
        if current.hour != self.config.ANTENNA_CHECK_HOUR:
            return

        self._last_antenna_check_date = today
        self.logger.info("Daily antenna frequency check starting (%02d:00 SAST)",
                         self.config.ANTENNA_CHECK_HOUR)
        try:
            freq_hz = self._measure_antenna_frequency()
        except Exception as e:
            self.logger.error("Antenna frequency measurement failed: %s", e)
            return

        target_hz = 500000
        tolerance = 0.035                    # 3.5% per the datasheet
        low, high = target_hz * (1 - tolerance), target_hz * (1 + tolerance)

        # A failed measurement is NOT a detuned antenna, and telling them apart
        # matters because the two need opposite responses.
        #
        # This unit shipped without the distinction and the field record shows the
        # cost. On 2026-09-15 the scheduled check recorded freq_hz = 0 and still
        # moved tune_cap from 12 to 11, because 0 satisfies "freq_hz < low" and so
        # fell into the "frequency too low, add less capacitance" branch. A
        # resonant LC tank cannot oscillate at 0 Hz, so that reading could only
        # ever have meant the measurement itself failed.
        #
        # Left alone it compounds: every daily check that fails to read decrements
        # tune_cap again, so under a fortnight of failed measurements would walk a
        # correctly tuned antenna from 12 down to 0 and then start warning that
        # the antenna needs physical attention. The logs would show a tuning
        # problem that the checker itself created.
        #
        # The AS3935 LCO sits near 500 kHz and tune_cap shifts it by roughly
        # +/-15%, so anything outside this band is an instrumentation fault:
        # a dead divider setting, a missed interrupt, or a zero counter.
        MIN_PLAUSIBLE_HZ = 100000
        MAX_PLAUSIBLE_HZ = 2000000
        if not (MIN_PLAUSIBLE_HZ <= freq_hz <= MAX_PLAUSIBLE_HZ):
            self.logger.error(
                "Antenna frequency reading of %d Hz is not physically plausible "
                "(expected %d-%d Hz). Treating this as a FAILED MEASUREMENT, not "
                "a tuning error, and leaving tune_cap at %d. Check the LCO "
                "divider and the IRQ line before trusting the next check.",
                freq_hz, MIN_PLAUSIBLE_HZ, MAX_PLAUSIBLE_HZ, self.config.TUNE_CAP)
            self._calibration_webhook(
                kind="antenna_check", reason="measurement_failed",
                cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
                in_tolerance=None, tune_cap_before=self.config.TUNE_CAP,
                tune_cap_after=self.config.TUNE_CAP)
            return

        self.logger.info("Antenna frequency: %d Hz (target %d Hz, %.1f%%, "
                         "range %d-%d Hz)", freq_hz, target_hz, tolerance * 100,
                         int(low), int(high))

        if low <= freq_hz <= high:
            self.logger.info("Antenna frequency WITHIN tolerance - tune_cap=%d OK",
                             self.config.TUNE_CAP)
            self._calibration_webhook(
                kind="antenna_check", reason="scheduled",
                cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
                in_tolerance=True, tune_cap_before=self.config.TUNE_CAP,
                tune_cap_after=self.config.TUNE_CAP)
            return

        if freq_hz > high and self.config.TUNE_CAP < 15:
            new_cap, direction = self.config.TUNE_CAP + 1, "up"
        elif freq_hz < low and self.config.TUNE_CAP > 0:
            new_cap, direction = self.config.TUNE_CAP - 1, "down"
        else:
            self.logger.warning(
                "Antenna freq out of range but tune_cap at limit (%d) - cannot "
                "adjust further; the antenna may need physical attention",
                self.config.TUNE_CAP)
            self._calibration_webhook(
                kind="antenna_check", reason="scheduled",
                cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
                in_tolerance=False, tune_cap_before=self.config.TUNE_CAP,
                tune_cap_after=self.config.TUNE_CAP)
            return

        self.logger.warning("Antenna freq %d Hz outside tolerance - adjusting "
                            "tune_cap %d -> %d (%s)", freq_hz,
                            self.config.TUNE_CAP, new_cap, direction)
        old_cap = self.config.TUNE_CAP
        self.config.TUNE_CAP = new_cap
        self.sensor.set_tune_cap(new_cap)
        time.sleep(0.01)
        verify_hz = self._measure_antenna_frequency()
        self.logger.info("After adjustment: antenna freq = %d Hz (tune_cap=%d)",
                         verify_hz, new_cap)
        self._calibration_webhook(
            kind="antenna_check", reason="scheduled",
            cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
            in_tolerance=False, tune_cap_before=old_cap, tune_cap_after=new_cap)

    # ===================================================================
    #  Event Processing
    # ===================================================================

    def _process_interrupt(self):
        """Read and act on one AS3935 interrupt."""
        time.sleep(0.002)          # the AS3935 needs 2 ms after the IRQ
        int_type = self.sensor.get_interrupt_type()
        self._reset_daily_stats()

        if int_type == INT_LIGHTNING:
            distance = self.sensor.get_distance()
            energy = self.sensor.get_energy()
            noise = self.sensor.get_noise_floor()

            self._strike_count_today += 1
            if distance != DISTANCE_OUT_OF_RANGE and distance < self._closest_today_km:
                self._closest_today_km = distance

            if distance == DISTANCE_OUT_OF_RANGE:
                dist_str, dist_val = "OUT_OF_RANGE", -1
                self.logger.info("LIGHTNING detected - Distance: OUT OF RANGE, "
                                 "Energy: %d", energy)
            else:
                dist_str, dist_val = str(distance), distance
                self.logger.info("LIGHTNING detected - Distance: %d km, Energy: %d",
                                 distance, energy)

            muted = self._interference_check()
            # The local record is written first and always.
            self.data_logger.log_event("LIGHTNING", dist_str, energy, noise,
                                       self.config.WATCHDOG_THRESH,
                                       self.config.SPIKE_REJECT)
            if muted:
                self.logger.warning("Strike muted (interference window) - "
                                    "logged locally, not alerted")
                return
            self._stratus_post({"lightning": 1,
                                "lightningDistance": dist_val,
                                "lightningEnergy": energy})
            self.campbell.send_lightning(dist_val, energy)
            # The logger sees every strike immediately; only the panel POST goes
            # through the validation buffer, because that is the path that costs
            # money when it is wrong.
            if not self._buffer_strike(dist_val, energy):
                self._alert_webhook(dist_val, energy)

        elif int_type == INT_DISTURBER:
            self.logger.debug("Disturber detected (man-made signal rejected)")
            self.data_logger.log_event("DISTURBER", 0, 0,
                                       self.sensor.get_noise_floor(),
                                       self.config.WATCHDOG_THRESH,
                                       self.config.SPIKE_REJECT)

        elif int_type == INT_NOISE_HIGH:
            noise = self.sensor.get_noise_floor()
            self.logger.warning("Noise level too high (current floor: %d)", noise)
            self.data_logger.log_event("NOISE", 0, 0, noise,
                                       self.config.WATCHDOG_THRESH,
                                       self.config.SPIKE_REJECT)
        else:
            self.logger.debug("Unknown interrupt type: 0x%02X", int_type)

    # ===================================================================
    #  Health Monitoring
    # ===================================================================

    def _heartbeat(self):
        """Local log line, Campbell status record and panel liveness POST."""
        now = time.monotonic()
        log_due = now - self._last_heartbeat >= self.config.HEARTBEAT_INTERVAL
        campbell_due = (now - self._last_campbell_heartbeat
                        >= self.config.CAMPBELL_HEARTBEAT_INTERVAL)
        panel_due = (now - self._last_panel_heartbeat
                     >= self.config.HEARTBEAT_WEBHOOK_INTERVAL)
        if not (log_due or campbell_due or panel_due):
            return

        self._reset_daily_stats()
        cpu_temp = get_cpu_temperature()
        uptime = get_uptime_seconds()
        wifi = get_wifi_signal()
        noise = self.sensor.get_noise_floor()

        if log_due:
            self._last_heartbeat = now
            self.logger.info(
                "HEARTBEAT - CPU: %.1f C, Uptime: %.0f s, Noise: %d, "
                "WiFi: %d dBm (Q:%d), Campbell: %s (%d sent), "
                "Strikes today: %d, Closest: %s km",
                cpu_temp, uptime, noise, wifi["rssi_dbm"], wifi["link_quality"],
                "up" if self.campbell.active else "down",
                self.campbell.records_sent, self._strike_count_today,
                str(self._closest_today_km)
                if self._closest_today_km < 999 else "N/A")
            self._stratus_post({"cpuTemperature": cpu_temp,
                                "rssi": wifi["rssi_dbm"]})

        # The status record is OFF by default. Detector health belongs to the
        # admin panel, which already receives it on the panel heartbeat below and
        # is the system of record for whether a unit is alive. The logger's job is
        # lightning: distance and energy. Sending health to both put the same fact
        # in two places, which is how they end up disagreeing.
        #
        # The cost of turning it off, stated plainly: the logger can no longer tell
        # "no lightning" apart from "detector dead", because both look like zero L
        # records. That question is now answered by the panel alone.
        if campbell_due and self.config.CAMPBELL_HEARTBEAT_ENABLED:
            self._last_campbell_heartbeat = now
            self.campbell.send_heartbeat(cpu_temp, wifi["rssi_dbm"])

        if panel_due:
            self._last_panel_heartbeat = now
            self._heartbeat_webhook(cpu_temp, uptime, noise)

    def _check_sensor_registers(self):
        """Re-apply the configuration if the sensor's registers have drifted."""
        now = time.monotonic()
        if now - self._last_register_check < self.config.REGISTER_CHECK_INTERVAL:
            return
        self._last_register_check = now
        if not self.sensor.verify_registers(self.config):
            self.logger.warning("Register drift detected - re-initializing AS3935")
            self.sensor.initialize(self.config)


    # ===================================================================
    #  Main Loop
    # ===================================================================

    def start(self):
        """Initialize everything and run until stopped."""
        global _detector_instance
        _detector_instance = self

        self.logger.info("=" * 60)
        self.logger.info("Quaggasklip (Metron) Lightning Detector v%s starting",
                         __version__)
        self.logger.info("=" * 60)

        cal_ok = self._init_hardware()

        if self.config.STRATUS_ENABLED and not self.config.STRATUS_ENDPOINT:
            self.logger.warning("Stratus enabled but no endpoint set - add "
                                "stratus_endpoint to %s", self.config.CONFIG_FILE)
            self.config.STRATUS_ENABLED = False
        if self.config.ALERT_WEBHOOK_ENABLED and not self.config.ALERT_WEBHOOK_URL:
            self.logger.warning("Alert webhook enabled but no URL set - add "
                                "alert_webhook_url to %s", self.config.CONFIG_FILE)
            self.config.ALERT_WEBHOOK_ENABLED = False
        # A token-less POST to a configured panel would be rejected with 401 on
        # every strike, so say so once at boot rather than in the storm.
        if self.config.ALERT_WEBHOOK_ENABLED and not self.config.ALERT_WEBHOOK_TOKEN:
            self.logger.warning("Alert webhook has no token set - the panel will "
                                "reject these posts unless its own token is unset")

        self.campbell.open()

        self.logger.info("[4/4] Active configuration:")
        self.logger.info("  Station:        %s (%s)", self.config.STATION_ID,
                         self.config.SITE_NAME)
        self.logger.info("  Sensor:         SPI %d.%d, IRQ GPIO%d (socket %d)",
                         self.config.SPI_BUS, self.config.SPI_DEVICE,
                         self.config.IRQ_PIN, self.config.SPI_DEVICE + 1)
        self.logger.info("  AFE Mode:       OUTDOOR")
        self.logger.info("  Noise Floor:    %d", self.config.NOISE_FLOOR)
        self.logger.info("  Watchdog:       %d", self.config.WATCHDOG_THRESH)
        self.logger.info("  Spike Reject:   %d", self.config.SPIKE_REJECT)
        self.logger.info("  Min Strikes:    %d", self.config.MIN_STRIKES)
        self.logger.info("  Tune Cap:       %d (%d pF)", self.config.TUNE_CAP,
                         self.config.TUNE_CAP * 8)
        self.logger.info("  RC calibration: %s", "PASSED" if cal_ok else "FAILED")
        self.logger.info("  Campbell:       %s",
                         ("%s @ %d baud" % (self.config.CAMPBELL_PORT
                                            if self.config.CAMPBELL_TRANSPORT
                                            == "serial"
                                            else "GPIO%d" % self.config.CAMPBELL_TX_PIN,
                                            self.config.CAMPBELL_BAUD))
                         if self.campbell.active else "not available")
        self.logger.info("  Panel:          %s",
                         self.config.ALERT_WEBHOOK_URL or "disabled")

        # Arm the interrupt only now that everything it touches exists.
        GPIO.add_event_detect(self.config.IRQ_PIN, GPIO.RISING,
                              callback=self._irq_callback, bouncetime=5)

        self._last_recalibrate_temp = get_cpu_temperature()
        self._last_recalibrate_time = time.monotonic()
        self._last_register_check = time.monotonic()

        self._running = True
        sd_notify("READY=1")
        self.logger.info("Detector armed and running")
        self._loop()

    def _loop(self):
        """The detection loop.

        Deliberately a polled loop around a flag rather than work inside the
        GPIO callback: SPI reads, HTTP posts and file writes all belong on one
        thread, and this way a slow network can never re-enter the sensor.
        """
        while self._running:
            try:
                if self._interrupt_flag:
                    self._interrupt_flag = False
                    self._process_interrupt()

                self._service_pulse_mirror()
                self._flush_validation_buffer()
                self._heartbeat()
                self._temperature_compensation()
                self._antenna_frequency_check()
                self._check_sensor_registers()

                if self.config.STRATUS_ENABLED and not self._stratus_online and \
                        (time.monotonic() - self._stratus_last_retry
                         >= self.config.STRATUS_RETRY_INTERVAL):
                    self._stratus_retry()

                for line in self.campbell.poll():
                    # Logged, never obeyed. See CampbellLink.poll.
                    self.logger.info("Campbell says: %s", line)

                sd_notify("WATCHDOG=1")
                self._consecutive_errors = 0
                # 50 ms: fast enough that a strike is handled well inside the
                # sensor's own timing, cheap enough to leave the Zero W idle.
                time.sleep(0.05)

            except Exception as e:
                self._consecutive_errors += 1
                self.logger.error("Main loop error %d/%d: %s",
                                  self._consecutive_errors,
                                  self.config.MAX_CONSECUTIVE_ERRORS, e,
                                  exc_info=True)
                if self._consecutive_errors >= self.config.MAX_CONSECUTIVE_ERRORS:
                    # Give up and let systemd restart us clean. A detector stuck
                    # in a failing loop is worse than one that restarts, because
                    # it still looks alive.
                    self.logger.critical(
                        "Too many consecutive errors - exiting for a restart")
                    self._running = False
                    break
                time.sleep(1)

        self.stop()

    def stop(self):
        """Release everything. Safe to call more than once."""
        if not self._running and getattr(self, "_stopped", False):
            return
        self._stopped = True
        self._running = False
        self.logger.info("Shutting down...")

        # Flush anything still held, so a clean stop does not silently discard
        # strikes the buffer was still evaluating.
        try:
            self._validation_flush_time = 0.0
            self._flush_validation_buffer()
        except Exception:
            pass

        try:
            GPIO.remove_event_detect(self.config.IRQ_PIN)
        except Exception:
            pass
        for closer in (self.campbell.close, self.sensor.close,
                       self.data_logger.close):
            try:
                closer()
            except Exception:
                pass
        if self._stratus_buffer_file is not None:
            try:
                self._stratus_buffer_file.close()
            except Exception:
                pass
            self._stratus_buffer_file = None
        try:
            if self.config.PULSE_MIRROR_ENABLED:
                GPIO.output(self.config.PULSE_MIRROR_PIN, GPIO.LOW)
            GPIO.cleanup()
        except Exception:
            pass
        self.logger.info("Stopped")


# ===========================================================================
#  ENTRY POINT
# ===========================================================================

def _signal_handler(signum, frame):
    """Ask the loop to stop, so shutdown runs on the main thread."""
    if _detector_instance is not None:
        _detector_instance.logger.info("Signal %d received - stopping", signum)
        _detector_instance._running = False


def main():
    """Build the detector and run it. Returns a process exit code."""
    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    detector = QuaggasklipDetector(Config())
    try:
        detector.start()
    except KeyboardInterrupt:
        detector.stop()
    except Exception:
        detector.logger.critical("Fatal error", exc_info=True)
        detector.stop()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
