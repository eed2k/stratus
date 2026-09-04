# ===========================================================================
#  Stratus AS3935 Lightning Detection System
#  Developed by L.J. Esterhuizen, Inteltronics
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

try:
    import pigpio
except ImportError:
    pigpio = None


# ===========================================================================
#  TIME ZONE  (South African Standard Time, UTC+2, no DST)
# ===========================================================================
#  The unit is deployed in South Africa, so all logs, CSV timestamps,
#  daily roll-overs and outbound payloads use local SAST rather than UTC.

SAST = timezone(timedelta(hours=2), name="SAST")


def now_sast():
    """Return the current time as a timezone-aware SAST datetime."""
    return datetime.now(SAST)


def _sast_log_time(timestamp):
    """logging.Formatter.converter hook: render record times in SAST."""
    return datetime.fromtimestamp(timestamp, SAST).timetuple()


# All log records (asctime) are emitted in SAST regardless of the host's
# system time zone.
logging.Formatter.converter = staticmethod(_sast_log_time)


# ===========================================================================
#  AS3935 REGISTER MAP
# ===========================================================================

REG_AFE_GAIN       = 0x00  # AFE gain boost / power-down / noise floor
REG_THRESHOLD      = 0x01  # Watchdog and spike rejection
REG_LIGHTNING      = 0x02  # Lightning reg / min strikes / clear stats
REG_INT_MASK_ANT   = 0x03  # Interrupt type / mask disturber / freq div
REG_ENERGY_LSB     = 0x04  # Lightning energy LSB
REG_ENERGY_MSB     = 0x05  # Lightning energy MSB (bits 7:0)
REG_ENERGY_MMSB    = 0x06  # Lightning energy MMSB (bits 4:0)
REG_DISTANCE       = 0x07  # Distance estimation (bits 5:0)
REG_DISP_IRQ       = 0x08  # Display IRQ / tuning caps / freq display
REG_CALIB_TRCO     = 0x3A  # Calibration TRCO
REG_CALIB_SRCO     = 0x3B  # Calibration SRCO
REG_DEFAULT_RESET  = 0x3C  # Reset to defaults
REG_CALIB          = 0x3D  # Calibrate RCO

# Interrupt types (from register 0x03, bits 3:0)
INT_NOISE_HIGH     = 0x01
INT_DISTURBER      = 0x04
INT_LIGHTNING      = 0x08

# AFE mode
AFE_OUTDOOR        = 0x0E  # Outdoor gain (ONLY mode for this deployment)

# Direct command values
DIRECT_COMMAND     = 0x96  # Direct command for calibration
PRESET_DEFAULT     = 0x96  # Preset default command


# ===========================================================================
#  CONFIGURATION
# ===========================================================================

class Config:
    """System configuration with instance-level defaults.

    All defaults are set in __init__ so that setattr from the JSON
    config file creates proper instance attributes rather than
    shadowing class variables.
    """

    def __init__(self):
        # ===========================================================
        #  SPI
        # ===========================================================
        self.SPI_BUS         = 0
        self.SPI_DEVICE      = 0     # CE0
        self.SPI_SPEED_HZ    = 1000000  # 1 MHz (AS3935 max)
        self.SPI_MODE        = 0b01  # SPI Mode 1 (CPOL=0, CPHA=1)

        # ===========================================================
        #  GPIO
        # ===========================================================
        self.IRQ_PIN         = 17    # INT on mikroBUS socket 1 (Pi Click Shield routes INT to GPIO17)
        self.PULSE_MIRROR_ENABLED = True
        self.PULSE_MIRROR_PIN = 19   # Mirror IRQ pulses for CR1000X P1/P2

        # ===========================================================
        #  Campbell Logger UART
        # ===========================================================
        self.CAMPBELL_UART_ENABLED = True
        self.CAMPBELL_UART_TX_PIN = 26   # Accessible pin on lower header
        self.CAMPBELL_UART_BAUD = 9600
        # Periodic status string to the Campbell logger (in addition to the
        # per-strike record). Campbell side is synced to the Stratus dashboard.
        self.CAMPBELL_HEARTBEAT_INTERVAL = 600   # 10 minutes

        # ===========================================================
        #  AS3935 Sensor
        # ===========================================================
        self.AFE_MODE        = AFE_OUTDOOR   # Outdoor industrial deployment
        self.NOISE_FLOOR     = 5     # 0-7, elevated for smelter EMI
        self.WATCHDOG_THRESH = 5     # 0-15, elevated for industrial transients
        self.SPIKE_REJECT    = 5     # 0-15, aggressive non-lightning rejection
        self.MIN_STRIKES     = 5     # 1, 5, 9, or 16
        self.TUNE_CAP        = 0     # 0-15 (x8 pF), set via calibrate_antenna.py
        self.MASK_DISTURBER  = True  # Suppress disturber interrupts
        self.FREQ_DIV_RATIO  = 16    # 16, 32, 64, or 128

        # ===========================================================
        #  Station Identity
        # ===========================================================
        self.STATION_ID      = "GENERIC-LD-001"

        # ===========================================================
        #  Stratus Weather
        # ===========================================================
        self.STRATUS_ENABLED  = True
        self.STRATUS_ENDPOINT = ""   # Set via lightning_config.json (required)
        self.STRATUS_API_KEY  = ""   # Optional
        self.STRATUS_TIMEOUT  = 10   # HTTP timeout in seconds
        self.STRATUS_RETRY_INTERVAL = 300  # Seconds between offline retries

        # ===========================================================
        #  Alert Webhook (posts to admin panel which fans out
        #  to SMS / WhatsApp via Twilio in the background)
        # ===========================================================
        self.ALERT_WEBHOOK_ENABLED   = False
        self.ALERT_WEBHOOK_URL       = ""   # https://panel.example.com/api/v1/lightning
        self.ALERT_WEBHOOK_TOKEN     = ""   # Shared secret sent as X-Auth-Token
        self.ALERT_WEBHOOK_TIMEOUT   = 5    # Short; the IRQ loop must not stall
        self.ALERT_DISTANCE_KM       = 15   # Only POST when distance <= this (km)
        self.ALERT_MIN_DISTANCE_KM   = 0    # 0 = OFF. If >0, drop strikes nearer
                                            # than this (km). NOT advised: hides
                                            # overhead lightning. See _alert_webhook.
        # Hourly liveness ping to the admin panel (POSTs to the /heartbeat
        # endpoint derived from ALERT_WEBHOOK_URL). Independent of Stratus.
        self.HEARTBEAT_WEBHOOK_INTERVAL = 3600   # 1 hour

        # Report auto-calibration activity (RC recalibration and the daily
        # antenna resonance check) to the admin panel /calibration endpoint so
        # the monthly technical report has real calibration history. Best-effort
        # and gated by ALERT_WEBHOOK_ENABLED; on by default.
        self.CALIBRATION_REPORT_ENABLED = True

        # ===========================================================
        #  Interference guard (RF false-trigger suppression)
        # ===========================================================
        #  An implausibly high strike rate is the signature of RF
        #  interference (e.g. the co-located WiFi modem ~4 cm away),
        #  not real lightning. When a burst is detected we log it and
        #  temporarily suppress OUTBOUND alerts (panel / Campbell /
        #  Stratus) so they are not flooded. Strikes are still logged
        #  locally. Genuine, normally-paced strikes are NOT affected -
        #  the limit is set far above any real single-site flash rate.
        self.INTERFERENCE_GUARD_ENABLED = True
        self.INTERFERENCE_STRIKE_LIMIT  = 12    # strikes within window => burst
        self.INTERFERENCE_WINDOW_S      = 10    # rolling window (seconds)
        self.INTERFERENCE_COOLDOWN_S    = 180   # suppress outbound alerts after

        # ===========================================================
        #  Strike validation buffer (EMI pattern filtering)
        # ===========================================================
        #  Holds strikes for a short window before forwarding to the
        #  admin panel webhook. Discards batches that match the EMI
        #  signature: many strikes all at distance=1 km in rapid
        #  succession. Real storms produce varied distances. This
        #  prevents false SMS alerts which cost money.
        self.VALIDATION_BUFFER_ENABLED  = True
        self.VALIDATION_BUFFER_SECS     = 30    # hold window (seconds)
        self.VALIDATION_EMI_MIN_COUNT   = 5     # min strikes to trigger filter
        self.VALIDATION_EMI_DISTANCE_KM = 1     # EMI signature distance
        # Storm corroboration: an all-1km batch is only forwarded if a genuine
        # varied-distance (>1 km, in range) strike was seen within this window.
        # Pure 1km-only activity is the EMI signature and is always filtered.
        # A real storm approaches with distant strikes first, so true overhead
        # lightning remains covered.
        self.STORM_CONTEXT_WINDOW_S     = 900   # 15 minutes

        # ===========================================================
        #  Temperature compensation
        # ===========================================================
        #  The AS3935 internal RC oscillators drift with temperature.
        #  Recalibrate when enclosure temp changes significantly, and
        #  check antenna resonance frequency daily at a stable time
        #  (06:00 SAST, before solar heating).
        self.RECALIBRATE_TEMP_DELTA_C   = 10    # recal if temp changes this much
        self.RECALIBRATE_INTERVAL_S     = 21600 # also recal every 6 hours
        self.ANTENNA_CHECK_ENABLED      = True
        self.ANTENNA_CHECK_HOUR         = 6     # SAST hour for daily check (06:00)
        self.CPU_TEMP_WARN_C            = 70
        self.CPU_TEMP_CRIT_C            = 78

        # ===========================================================
        #  Data Logging
        # ===========================================================
        self.LOG_DIR         = "/home/gwld1/lightning_data"
        self.LOG_LEVEL       = logging.INFO
        self.LOG_RETENTION_DAYS = 90

        # ===========================================================
        #  System
        # ===========================================================
        self.HEARTBEAT_INTERVAL      = 600   # 10 minutes
        self.BOOT_STABILIZE_SECS     = 5
        self.INIT_RETRY_LIMIT        = 10
        self.INIT_RETRY_DELAY        = 5
        self.REGISTER_CHECK_INTERVAL = 86400  # 24 hours (register drift / auto-cal)
        self.MAX_CONSECUTIVE_ERRORS  = 30

        # ===========================================================
        #  Config File
        # ===========================================================
        self.CONFIG_FILE     = "/home/gwld1/lightning_config.json"


# ===========================================================================
#  UTILITY FUNCTIONS
# ===========================================================================

# Cached readings to avoid hitting /sys and /proc on every event
_cached_cpu_temp = (-1.0, 0.0)   # (value, monotonic timestamp)
_cached_wifi     = ({"rssi_dbm": -1, "link_quality": -1}, 0.0)
_CACHE_TTL       = 10.0          # seconds


def sd_notify(state):
    """Send a notification to the systemd watchdog (if active).

    Uses the NOTIFY_SOCKET env var set by systemd. No-op if not running
    under systemd or if the socket is not available.
    """
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
    """Read Raspberry Pi CPU temperature (cached for 10 s)."""
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
    """Read system uptime in seconds from /proc/uptime."""
    try:
        with open("/proc/uptime", "r") as f:
            return float(f.read().split()[0])
    except (IOError, ValueError, IndexError):
        return -1.0


def get_cpu_load_pct():
    """Return 1-minute CPU load as a percentage of available cores.

    On a single-core Pi Zero W this is loadavg_1min * 100. Capped sensibly
    for display. Returns -1.0 if unavailable.
    """
    try:
        with open("/proc/loadavg", "r") as f:
            load1 = float(f.read().split()[0])
        cores = os.cpu_count() or 1
        return round(load1 / cores * 100.0, 1)
    except (IOError, ValueError, IndexError):
        return -1.0


def get_wifi_signal():
    """Read WiFi signal strength (cached for 10 s).

    Returns dict with 'rssi_dbm' and 'link_quality' (-1 if unavailable).
    """
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
                link = int(float(parts[2].rstrip('.')))
                dbm = int(float(parts[3].rstrip('.')))
                result = {"rssi_dbm": dbm, "link_quality": link}
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
        """Read a single register from the AS3935."""
        if self.spi is None:
            raise RuntimeError("SPI not initialized")
        result = self.spi.xfer2([(register & 0x3F) | 0x40, 0x00])
        return result[1]

    def _write_register(self, register, value):
        """Write a single register to the AS3935."""
        if self.spi is None:
            raise RuntimeError("SPI not initialized")
        self.spi.xfer2([register & 0x3F, value & 0xFF])

    def _modify_register(self, register, mask, shift, value):
        """Modify specific bits within a register."""
        current = self._read_register(register)
        cleared = current & ~(mask << shift)
        new_val = cleared | ((value & mask) << shift)
        self._write_register(register, new_val)

    # ===================================================================
    #  Commands
    # ===================================================================

    def reset(self):
        """Reset all registers to default values."""
        self._write_register(REG_DEFAULT_RESET, PRESET_DEFAULT)
        time.sleep(0.002)

    def calibrate(self):
        """Calibrate the internal RC oscillators."""
        self._write_register(REG_CALIB, DIRECT_COMMAND)
        time.sleep(0.002)
        trco = self._read_register(REG_CALIB_TRCO)
        srco = self._read_register(REG_CALIB_SRCO)
        return bool((trco & 0x80) and (srco & 0x80))

    # ===================================================================
    #  Setters
    # ===================================================================

    def set_afe_mode(self, mode):
        """Set the Analog Front End mode (outdoor deployment)."""
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
        """Set minimum number of strikes before interrupt (1, 5, 9, or 16)."""
        mapping = {1: 0, 5: 1, 9: 2, 16: 3}
        if strikes not in mapping:
            raise ValueError("Min strikes must be 1, 5, 9, or 16")
        self._modify_register(REG_LIGHTNING, 0x03, 4, mapping[strikes])

    def set_tune_cap(self, cap_value):
        """Set internal tuning capacitor (0-15, each step = 8 pF)."""
        if not 0 <= cap_value <= 15:
            raise ValueError("Tune cap must be 0-15")
        self._modify_register(REG_DISP_IRQ, 0x0F, 0, cap_value)

    def set_mask_disturber(self, mask):
        """Enable/disable disturber interrupt masking."""
        self._modify_register(REG_INT_MASK_ANT, 0x01, 5, 1 if mask else 0)

    def set_freq_div_ratio(self, ratio):
        """Set the frequency division ratio for antenna tuning."""
        mapping = {16: 0, 32: 1, 64: 2, 128: 3}
        if ratio not in mapping:
            raise ValueError("Division ratio must be 16, 32, 64, or 128")
        self._modify_register(REG_INT_MASK_ANT, 0x03, 6, mapping[ratio])

    # ===================================================================
    #  Getters
    # ===================================================================

    def get_noise_floor(self):
        """Read the current noise floor threshold."""
        reg = self._read_register(REG_AFE_GAIN)
        return (reg >> 4) & 0x07

    def get_interrupt_type(self):
        """Read and return the interrupt type."""
        reg = self._read_register(REG_INT_MASK_ANT)
        return reg & 0x0F

    def get_distance(self):
        """Read estimated distance to the storm front in km."""
        reg = self._read_register(REG_DISTANCE)
        return reg & 0x3F

    def get_energy(self):
        """Read the lightning energy (21-bit value, unitless)."""
        lsb = self._read_register(REG_ENERGY_LSB)
        msb = self._read_register(REG_ENERGY_MSB)
        mmsb = self._read_register(REG_ENERGY_MMSB) & 0x1F
        return (mmsb << 16) | (msb << 8) | lsb

    # ===================================================================
    #  Maintenance
    # ===================================================================

    def clear_statistics(self):
        """Clear distance estimation statistics.

        AS3935 datasheet requires toggling bit 6 of REG_LIGHTNING:
        set -> clear -> set (three writes) to reset the algorithm.
        """
        reg = self._read_register(REG_LIGHTNING)
        self._write_register(REG_LIGHTNING, reg | 0x40)
        self._write_register(REG_LIGHTNING, reg & ~0x40)
        self._write_register(REG_LIGHTNING, reg | 0x40)

    def power_down(self):
        """Put the AS3935 into power-down mode."""
        self._modify_register(REG_AFE_GAIN, 0x01, 0, 1)

    def power_up(self):
        """Wake the AS3935 from power-down mode."""
        self._modify_register(REG_AFE_GAIN, 0x01, 0, 0)
        time.sleep(0.002)
        self.calibrate()

    def verify_registers(self, config):
        """Verify critical registers match expected configuration.

        Returns True if all registers match, False if drift detected.
        EMI from the smelter environment can flip AS3935 config bits.
        """
        afe_reg = self._read_register(REG_AFE_GAIN)
        current_nf = (afe_reg >> 4) & 0x07
        if current_nf != config.NOISE_FLOOR:
            return False
        thr_reg = self._read_register(REG_THRESHOLD)
        current_wd = thr_reg & 0x0F
        if current_wd != config.WATCHDOG_THRESH:
            return False
        return True

    def initialize(self, config):
        """Full initialization sequence with given configuration."""
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
    """Handles CSV logging of lightning events with daily file rotation."""

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

    # ===================================================================
    #  File Management
    # ===================================================================

    def _ensure_file_open(self):
        """Open/rotate the CSV log file based on date."""
        today = now_sast().strftime("%Y-%m-%d")
        if today != self._current_date:
            self._close_file()
            self._current_date = today
            filepath = self.log_dir / f"lightning_{today}.csv"
            file_exists = filepath.exists()
            self._csv_file = open(filepath, "a", newline="", buffering=1)
            self._csv_writer = csv.writer(self._csv_file)
            if not file_exists:
                self._csv_writer.writerow(self.CSV_HEADER)

    def _close_file(self):
        """Flush and close the current CSV file."""
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

    # ===================================================================
    #  Logging
    # ===================================================================

    def log_event(self, event_type, distance_km, energy, noise_floor,
                  watchdog_thresh, spike_rejection):
        """Log a single event to the CSV file."""
        try:
            self._ensure_file_open()
            if self._csv_writer is None:
                raise OSError("CSV writer not available")
            timestamp = now_sast().strftime("%Y-%m-%dT%H:%M:%S%z")
            cpu_temp = get_cpu_temperature()
            wifi = get_wifi_signal()
            self._csv_writer.writerow([
                timestamp, event_type, distance_km, energy,
                noise_floor, watchdog_thresh, spike_rejection,
                cpu_temp, wifi["rssi_dbm"]
            ])
        except OSError as e:
            logging.getLogger("lightning").error("CSV write failed: %s", e)

    def close(self):
        """Close the logger."""
        self._close_file()


class CampbellUartTx:
    """Bit-bang UART TX to Campbell logger via pigpio."""

    def __init__(self, enabled, tx_pin, baud, logger):
        self.enabled = bool(enabled)
        self.tx_pin = int(tx_pin)
        self.baud = int(baud)
        self.logger = logger
        self._pi = None
        self._active = False

    def open(self):
        """Initialize pigpio connection and configure TX pin."""
        if not self.enabled:
            return
        if pigpio is None:
            self.logger.error(
                "Campbell UART enabled but pigpio module not installed; "
                "UART TX disabled"
            )
            return
        try:
            self._pi = pigpio.pi()
            if not self._pi.connected:
                self.logger.error(
                    "Campbell UART enabled but pigpio daemon not reachable; "
                    "UART TX disabled"
                )
                self._pi = None
                return
            self._pi.set_mode(self.tx_pin, pigpio.OUTPUT)
            self._pi.write(self.tx_pin, 1)  # UART idle line high
            self._active = True
            self.logger.info(
                "Campbell UART TX enabled on GPIO %d @ %d baud",
                self.tx_pin, self.baud
            )
        except Exception as e:
            self.logger.error("Campbell UART init failed: %s", e)
            self._active = False

    def send_lightning(self, distance_km, energy):
        """Send a single lightning event record to the Campbell logger."""
        if not self._active or self._pi is None:
            return
        pi = self._pi
        record = f"L,{distance_km},{energy}\r\n".encode("ascii", "replace")
        wid = -1
        try:
            pi.wave_add_new()
            pi.wave_add_serial(self.tx_pin, self.baud, record)  # bytes must end with real CR LF
            wid = pi.wave_create()
            if wid < 0:
                raise RuntimeError(f"wave_create failed ({wid})")
            pi.wave_send_once(wid)
            started = time.monotonic()
            while pi.wave_tx_busy():
                if time.monotonic() - started > 0.5:
                    break
                time.sleep(0.001)
        except Exception as e:
            self.logger.error("Campbell UART TX failed: %s", e)
        finally:
            if wid >= 0:
                try:
                    pi.wave_delete(wid)
                except Exception:
                    pass

    def send_heartbeat(self, cpu_temp_c, rssi_dbm):
        """Send a periodic status string to the Campbell logger.

        Format: ``H,<cpu_temp_c>,<rssi_dbm>`` terminated by CR LF. This lets
        the Campbell program (synced to the Stratus dashboard) confirm the
        unit is alive between strikes.
        """
        if not self._active or self._pi is None:
            return
        pi = self._pi
        try:
            cpu = round(float(cpu_temp_c), 1)
        except (TypeError, ValueError):
            cpu = 0.0
        try:
            rssi = int(rssi_dbm)
        except (TypeError, ValueError):
            rssi = 0
        record = f"H,{cpu},{rssi}\r\n".encode("ascii", "replace")
        wid = -1
        try:
            pi.wave_add_new()
            pi.wave_add_serial(self.tx_pin, self.baud, record)
            wid = pi.wave_create()
            if wid < 0:
                raise RuntimeError(f"wave_create failed ({wid})")
            pi.wave_send_once(wid)
            started = time.monotonic()
            while pi.wave_tx_busy():
                if time.monotonic() - started > 0.5:
                    break
                time.sleep(0.001)
        except Exception as e:
            self.logger.error("Campbell UART heartbeat failed: %s", e)
        finally:
            if wid >= 0:
                try:
                    pi.wave_delete(wid)
                except Exception:
                    pass

    def close(self):
        """Release pigpio resources."""
        self._active = False
        if self._pi is not None:
            pi = self._pi
            try:
                pi.wave_tx_stop()
            except Exception:
                pass
            try:
                pi.stop()
            except Exception:
                pass
            self._pi = None


# ===========================================================================
#  LIGHTNING DETECTION SYSTEM
# ===========================================================================

_detector_instance = None  # Module-level ref for signal handler


class LightningDetector:
    """Main lightning detection system controller.

    Designed for unattended outdoor operation with automatic recovery
    after power loss (flat batteries / solar charge restoration).
    """

    def __init__(self, config):
        self.config = config
        self._running = False
        self._interrupt_flag = False
        self._last_heartbeat = 0.0
        self._last_panel_heartbeat = 0.0
        self._last_campbell_heartbeat = 0.0
        self._last_register_check = 0.0
        self._consecutive_errors = 0

        # Storm statistics (reset daily)
        self._strike_count_today = 0
        self._closest_today_km = 999
        self._last_reset_date = now_sast().strftime("%Y-%m-%d")

        # Interference guard state
        self._recent_strikes = deque()       # monotonic timestamps of strikes
        self._interference_until = 0.0       # monotonic time alerts stay muted
        self._interference_logged = False    # one log line per burst

        # Strike validation buffer state
        self._validation_buffer = []         # list of (monotonic_time, distance, energy)
        self._validation_flush_time = 0.0    # when to evaluate the buffer
        self._last_varied_distance_ts = 0.0  # monotonic time of last >1km in-range strike

        # Temperature compensation state
        self._last_recalibrate_temp = -999.0  # CPU temp at last RC recalibration
        self._last_recalibrate_time = 0.0     # monotonic time of last recal
        self._last_antenna_check_date = ""    # date string of last antenna check

        # Stratus connection state
        self._stratus_online = True
        self._stratus_last_retry = 0.0
        self._stratus_buffer_path = Path(config.LOG_DIR) / "stratus_buffer.jsonl"
        self._stratus_buffer_file = None

        # Load config file overrides
        self._load_config_file()

        # Set up logging with rotation
        log_dir = Path(config.LOG_DIR)
        log_dir.mkdir(parents=True, exist_ok=True)

        root_logger = logging.getLogger()
        root_logger.setLevel(config.LOG_LEVEL)
        if not root_logger.handlers:
            file_handler = logging.handlers.RotatingFileHandler(
                log_dir / "system.log",
                maxBytes=5 * 1024 * 1024,   # 5 MB
                backupCount=3
            )
            file_handler.setFormatter(
                logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
            )
            root_logger.addHandler(file_handler)

            stream_handler = logging.StreamHandler(sys.stdout)
            stream_handler.setFormatter(
                logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
            )
            root_logger.addHandler(stream_handler)

        self.logger = logging.getLogger("lightning")

        # Initialize data logger
        self.data_logger = DataLogger(config.LOG_DIR)

        # Campbell UART TX output (to logger serial input)
        self.campbell_uart = CampbellUartTx(
            config.CAMPBELL_UART_ENABLED,
            config.CAMPBELL_UART_TX_PIN,
            config.CAMPBELL_UART_BAUD,
            self.logger
        )

        # AS3935 instance (opened during start)
        self.sensor = AS3935()

    # ===================================================================
    #  Configuration
    # ===================================================================

    # Config validation rules: {key: (type, min, max) or (type, None, None)}
    _CONFIG_VALIDATORS = {
        "NOISE_FLOOR":          (int, 0, 7),
        "WATCHDOG_THRESH":      (int, 0, 15),
        "SPIKE_REJECT":         (int, 0, 15),
        "MIN_STRIKES":          (int, [1, 5, 9, 16]),
        "TUNE_CAP":             (int, 0, 15),
        "MASK_DISTURBER":       (bool, None, None),
        "FREQ_DIV_RATIO":       (int, [16, 32, 64, 128]),
        "HEARTBEAT_INTERVAL":   (int, 10, 86400),
        "STRATUS_ENABLED":      (bool, None, None),
        "STRATUS_TIMEOUT":      (int, 1, 120),
        "STRATUS_RETRY_INTERVAL": (int, 10, 86400),
        "ALERT_WEBHOOK_ENABLED": (bool, None, None),
        "ALERT_WEBHOOK_TIMEOUT": (int, 1, 30),
        "ALERT_DISTANCE_KM":     (int, 1, 40),
        "ALERT_MIN_DISTANCE_KM": (int, 0, 40),
        "INTERFERENCE_GUARD_ENABLED": (bool, None, None),
        "INTERFERENCE_STRIKE_LIMIT":  (int, 3, 1000),
        "INTERFERENCE_WINDOW_S":      (int, 1, 600),
        "INTERFERENCE_COOLDOWN_S":    (int, 0, 3600),
        "VALIDATION_BUFFER_ENABLED":  (bool, None, None),
        "VALIDATION_BUFFER_SECS":     (int, 5, 300),
        "VALIDATION_EMI_MIN_COUNT":   (int, 2, 100),
        "VALIDATION_EMI_DISTANCE_KM": (int, 1, 10),
        "STORM_CONTEXT_WINDOW_S":     (int, 60, 7200),
        "RECALIBRATE_TEMP_DELTA_C":   (int, 3, 30),
        "RECALIBRATE_INTERVAL_S":     (int, 3600, 86400),
        "ANTENNA_CHECK_ENABLED":      (bool, None, None),
        "ANTENNA_CHECK_HOUR":         (int, 0, 23),
        "CPU_TEMP_WARN_C":            (int, 40, 85),
        "CPU_TEMP_CRIT_C":            (int, 50, 90),
        "HEARTBEAT_WEBHOOK_INTERVAL": (int, 60, 86400),
        "CAMPBELL_HEARTBEAT_INTERVAL": (int, 60, 86400),
        "REGISTER_CHECK_INTERVAL": (int, 60, 604800),
        "LOG_RETENTION_DAYS":   (int, 1, 3650),
        "MAX_CONSECUTIVE_ERRORS": (int, 1, 1000),
        "BOOT_STABILIZE_SECS":  (int, 0, 60),
        "INIT_RETRY_LIMIT":     (int, 1, 100),
        "INIT_RETRY_DELAY":     (int, 1, 300),
        "PULSE_MIRROR_ENABLED": (bool, None, None),
        "PULSE_MIRROR_PIN":     (int, 0, 27),
        "CAMPBELL_UART_ENABLED": (bool, None, None),
        "CAMPBELL_UART_TX_PIN": (int, 0, 27),
        "CAMPBELL_UART_BAUD":   (int, 300, 115200),
        "SPI_BUS":              (int, 0, 1),
        "SPI_DEVICE":           (int, 0, 1),
        "IRQ_PIN":              (int, 0, 27),
    }

    def _load_config_file(self):
        """Load and validate configuration overrides from JSON file."""
        config_path = Path(self.config.CONFIG_FILE)
        if not config_path.exists():
            return
        try:
            with open(config_path, "r") as f:
                overrides = json.load(f)
            for key, value in overrides.items():
                key_upper = key.upper()
                if not hasattr(self.config, key_upper):
                    logging.getLogger("lightning").warning(
                        "Config: unknown key '%s', skipping", key
                    )
                    continue
                if not self._validate_config_value(key_upper, value):
                    continue
                setattr(self.config, key_upper, value)
        except (json.JSONDecodeError, IOError) as e:
            logging.getLogger("lightning").warning(
                "Config file load failed (%s), using defaults", e
            )

    def _validate_config_value(self, key, value):
        """Validate a single config value. Returns True if valid."""
        rule = self._CONFIG_VALIDATORS.get(key)
        if rule is None:
            # No rule defined - accept strings/lists without range check
            return True
        expected_type = rule[0]
        if not isinstance(value, expected_type):
            logging.getLogger("lightning").warning(
                "Config: '%s' expects %s, got %s - skipping",
                key, expected_type.__name__, type(value).__name__
            )
            return False
        if expected_type == bool:
            return True
        constraint = rule[1]
        if isinstance(constraint, list):
            # Allowed values list
            if value not in constraint:
                logging.getLogger("lightning").warning(
                    "Config: '%s' value %s not in %s - skipping",
                    key, value, constraint
                )
                return False
        elif constraint is not None:
            lo, hi = rule[1], rule[2]
            if not (lo <= value <= hi):
                logging.getLogger("lightning").warning(
                    "Config: '%s' value %s out of range [%s..%s] - skipping",
                    key, value, lo, hi
                )
                return False
        return True

    # ===================================================================
    #  Hardware Initialization
    # ===================================================================

    def _init_hardware(self):
        """Initialize GPIO and AS3935 with retry logic for cold boot.

        After a power loss the SPI bus or sensor may not be ready
        immediately.  This method retries up to INIT_RETRY_LIMIT times
        with INIT_RETRY_DELAY seconds between attempts.
        """
        # Boot stabilization delay
        self.logger.info(
            "[1/4] Boot stabilization delay (%d s)...",
            self.config.BOOT_STABILIZE_SECS
        )
        time.sleep(self.config.BOOT_STABILIZE_SECS)

        # GPIO setup
        self.logger.info("[2/4] Configuring GPIO...")
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.config.IRQ_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
        if self.config.PULSE_MIRROR_ENABLED:
            if self.config.PULSE_MIRROR_PIN == self.config.IRQ_PIN:
                self.logger.warning(
                    "Pulse mirror pin equals IRQ pin (%d) - disabling mirror",
                    self.config.IRQ_PIN
                )
                self.config.PULSE_MIRROR_ENABLED = False
            else:
                GPIO.setup(
                    self.config.PULSE_MIRROR_PIN,
                    GPIO.OUT,
                    initial=GPIO.LOW
                )

        # SPI + AS3935 init with retries
        self.logger.info("[3/4] Initializing AS3935 sensor...")
        last_err = None
        for attempt in range(1, self.config.INIT_RETRY_LIMIT + 1):
            try:
                self.sensor.open(
                    self.config.SPI_BUS,
                    self.config.SPI_DEVICE,
                    self.config.SPI_SPEED_HZ,
                    self.config.SPI_MODE
                )
                cal_ok = self.sensor.initialize(self.config)
                if cal_ok:
                    self.logger.info(
                        "AS3935 calibration PASSED (attempt %d/%d)",
                        attempt, self.config.INIT_RETRY_LIMIT
                    )
                else:
                    self.logger.warning(
                        "AS3935 calibration FAILED on attempt %d/%d "
                        "(sensor may still function)",
                        attempt, self.config.INIT_RETRY_LIMIT
                    )
                return cal_ok
            except Exception as e:
                last_err = e
                self.logger.error(
                    "Hardware init attempt %d/%d failed: %s",
                    attempt, self.config.INIT_RETRY_LIMIT, e
                )
                self.sensor.close()
                if attempt < self.config.INIT_RETRY_LIMIT:
                    time.sleep(self.config.INIT_RETRY_DELAY)

        self.logger.critical(
            "Hardware init failed after %d attempts: %s",
            self.config.INIT_RETRY_LIMIT, last_err
        )
        raise RuntimeError(
            "AS3935 sensor init failed after %d attempts"
            % self.config.INIT_RETRY_LIMIT
        )

    # ===================================================================
    #  Stratus Weather
    # ===================================================================

    def _stratus_post(self, data):
        """POST a data payload to the Stratus Weather ingest endpoint.

        When the connection fails the payload is buffered to a local
        JSONL file and retried automatically when connectivity returns.
        """
        if not self.config.STRATUS_ENABLED:
            return

        # If offline, buffer immediately (no network attempt)
        if not self._stratus_online:
            self._stratus_buffer(data)
            return

        if not self._stratus_send(data):
            # First failure - go offline, buffer this payload
            self._stratus_online = False
            self._stratus_last_retry = time.monotonic()
            self._stratus_buffer(data)
            self.logger.warning(
                "Stratus offline - buffering payloads to %s",
                self._stratus_buffer_path.name
            )

    def _stratus_send(self, data):
        """Attempt a single HTTP POST to Stratus.  Returns True on success."""
        try:
            body = json.dumps({"data": data}).encode("utf-8")
            req = urllib.request.Request(
                self.config.STRATUS_ENDPOINT,
                data=body,
                method="POST"
            )
            req.add_header("Content-Type", "application/json")
            if self.config.STRATUS_API_KEY:
                req.add_header("X-API-Key", self.config.STRATUS_API_KEY)

            with urllib.request.urlopen(
                req, timeout=self.config.STRATUS_TIMEOUT
            ) as resp:
                if 200 <= resp.status < 300:
                    return True
                self.logger.warning(
                    "Stratus POST returned HTTP %d", resp.status
                )
                return False
        except urllib.error.HTTPError as e:
            self.logger.error(
                "Stratus POST HTTP error %d: %s", e.code, e.reason
            )
        except urllib.error.URLError as e:
            self.logger.error("Stratus POST connection error: %s", e.reason)
        except Exception as e:
            self.logger.error("Stratus POST failed: %s", e)
        return False

    # ===================================================================
    #  Alert Webhook (posts to the admin panel)
    # ===================================================================

    def _alert_webhook(self, distance_km, energy):
        """Best-effort POST to the admin panel alert ingest endpoint.

        The admin panel (running on a VPS) handles all recipient routing,
        channel selection, throttling and delivery via Twilio. Errors here
        are swallowed; the IRQ loop must never be delayed by alerting.
        """
        if not self.config.ALERT_WEBHOOK_ENABLED:
            return
        if not self.config.ALERT_WEBHOOK_URL:
            return
        try:
            dist = int(distance_km) if distance_km not in (None, "") else 99
        except (TypeError, ValueError):
            dist = 99
        # Out-of-range strikes (>40 km, sensor reports -1) are never a local
        # threat - do not alert on them.
        if dist < 0:
            return
        # Optional near-field floor (default 0 = OFF). WARNING: not recommended
        # for a safety system - the AS3935 "overhead" (1 km) bin is where a
        # storm directly above the site appears, so enabling this can hide
        # genuine overhead lightning. Use the rate-based interference guard
        # instead. Provided only for sites with known, constant near-field RFI.
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
        try:
            req = urllib.request.Request(
                self.config.ALERT_WEBHOOK_URL,
                data=json.dumps(payload).encode("utf-8"),
                method="POST",
            )
            req.add_header("Content-Type", "application/json")
            if self.config.ALERT_WEBHOOK_TOKEN:
                req.add_header("X-Auth-Token", self.config.ALERT_WEBHOOK_TOKEN)
            with urllib.request.urlopen(req, timeout=self.config.ALERT_WEBHOOK_TIMEOUT) as resp:
                if 200 <= resp.status < 300:
                    self.logger.info("Alert webhook sent (dist=%d km)", dist)
                else:
                    self.logger.warning("Alert webhook HTTP %d", resp.status)
        except Exception as e:
            self.logger.warning("Alert webhook failed: %s", e)

    def _heartbeat_url(self):
        """Derive the panel heartbeat endpoint from the alert webhook URL.

        e.g. https://panel/api/v1/lightning -> https://panel/api/v1/heartbeat
        """
        base = (self.config.ALERT_WEBHOOK_URL or "").strip()
        if not base:
            return ""
        return base.rsplit("/", 1)[0] + "/heartbeat"

    def _heartbeat_webhook(self, cpu_temp, uptime, wifi, noise):
        """Best-effort hourly liveness POST to the admin panel.

        Independent of Stratus. Errors are swallowed so the IRQ loop is
        never delayed by panel connectivity issues.
        """
        if not self.config.ALERT_WEBHOOK_ENABLED:
            return
        url = self._heartbeat_url()
        if not url:
            return
        # WiFi RSSI is intentionally NOT sent to the admin panel: the dongle
        # sits ~4 cm from the Pi so the figure reads misleadingly "hot" and is
        # not operationally useful on the panel. CPU temperature only.
        load_pct = get_cpu_load_pct()
        payload = {
            "station_id":    self.config.STATION_ID,
            "timestamp":     now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"),
            "cpu_temp_c":    round(cpu_temp, 1),
            "uptime_s":      round(uptime, 0),
            "noise_floor":   noise,
            "strikes_today": self._strike_count_today,
            # Send null (not the -1 sentinel) when load is unavailable so the
            # panel stores NULL and the chart shows "awaiting update".
            "cpu_load_pct":  load_pct if load_pct is not None and load_pct >= 0 else None,
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                method="POST",
            )
            req.add_header("Content-Type", "application/json")
            if self.config.ALERT_WEBHOOK_TOKEN:
                req.add_header("X-Auth-Token", self.config.ALERT_WEBHOOK_TOKEN)
            with urllib.request.urlopen(req, timeout=self.config.ALERT_WEBHOOK_TIMEOUT) as resp:
                if 200 <= resp.status < 300:
                    self.logger.info("Heartbeat webhook sent")
                else:
                    self.logger.warning("Heartbeat webhook HTTP %d", resp.status)
        except Exception as e:
            self.logger.warning("Heartbeat webhook failed: %s", e)

    def _calibration_url(self):
        """Derive the panel calibration endpoint from the alert webhook URL.

        e.g. https://panel/api/v1/lightning -> https://panel/api/v1/calibration
        """
        base = (self.config.ALERT_WEBHOOK_URL or "").strip()
        if not base:
            return ""
        return base.rsplit("/", 1)[0] + "/calibration"

    def _calibration_webhook(self, kind, reason=None, cpu_temp_c=None,
                             freq_hz=None, in_tolerance=None,
                             tune_cap_before=None, tune_cap_after=None):
        """Best-effort POST of a calibration event to the admin panel.

        Fire-and-forget: any failure is logged and swallowed so the detector
        loop is never delayed by panel connectivity. Gated by the alert webhook
        being enabled and the calibration-report flag.
        """
        if not (self.config.ALERT_WEBHOOK_ENABLED
                and self.config.CALIBRATION_REPORT_ENABLED):
            return
        url = self._calibration_url()
        if not url:
            return
        payload = {
            "station_id":      self.config.STATION_ID,
            "timestamp":       now_sast().strftime("%Y-%m-%dT%H:%M:%S%z"),
            "kind":            kind,
            "reason":          reason,
            "cpu_temp_c":      round(cpu_temp_c, 1) if cpu_temp_c is not None else None,
            "freq_hz":         int(freq_hz) if freq_hz is not None else None,
            "in_tolerance":    in_tolerance,
            "tune_cap_before": tune_cap_before,
            "tune_cap_after":  tune_cap_after,
        }
        try:
            req = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                method="POST",
            )
            req.add_header("Content-Type", "application/json")
            if self.config.ALERT_WEBHOOK_TOKEN:
                req.add_header("X-Auth-Token", self.config.ALERT_WEBHOOK_TOKEN)
            with urllib.request.urlopen(req, timeout=self.config.ALERT_WEBHOOK_TIMEOUT) as resp:
                if not (200 <= resp.status < 300):
                    self.logger.warning("Calibration webhook HTTP %d", resp.status)
        except Exception as e:
            self.logger.warning("Calibration webhook failed: %s", e)

    def _stratus_buffer(self, data):
        """Append a payload to the local JSONL buffer file (persistent handle)."""
        try:
            if self._stratus_buffer_file is None or self._stratus_buffer_file.closed:
                self._stratus_buffer_file = open(
                    self._stratus_buffer_path, "a", buffering=1
                )
            ts = now_sast().strftime("%Y-%m-%dT%H:%M:%S%z")
            record = json.dumps({"ts": ts, "data": data})
            self._stratus_buffer_file.write(record + "\n")
            self._stratus_buffer_file.flush()
        except OSError as e:
            self.logger.error("Buffer write failed: %s", e)

    def _stratus_retry(self):
        """Retry Stratus connection and flush buffered payloads."""
        self._stratus_last_retry = time.monotonic()

        self.logger.info("Retrying Stratus connection...")
        probe = {"status": "RECONNECT", "station": self.config.STATION_ID}
        if not self._stratus_send(probe):
            self.logger.info(
                "Stratus still unreachable, next retry in %d s",
                self.config.STRATUS_RETRY_INTERVAL
            )
            return

        self._stratus_online = True
        self.logger.info("Stratus connection restored - flushing buffer")
        self._stratus_flush_buffer()

    def _stratus_flush_buffer(self):
        """Send buffered payloads to Stratus, keeping unsent lines on failure."""
        if not self._stratus_buffer_path.exists():
            return

        # Close persistent handle before reading/rewriting the file
        if self._stratus_buffer_file is not None:
            try:
                self._stratus_buffer_file.close()
            except OSError:
                pass
            self._stratus_buffer_file = None

        sent = 0
        failed = 0
        unsent_lines = []
        try:
            with open(self._stratus_buffer_path, "r") as f:
                lines = f.readlines()
        except OSError as e:
            self.logger.error("Buffer read failed: %s", e)
            return

        for raw_line in lines:
            stripped = raw_line.strip()
            if not stripped:
                continue
            try:
                record = json.loads(stripped)
                if self._stratus_send(record.get("data", {})):
                    sent += 1
                else:
                    # Connection lost mid-flush - keep this and remaining lines
                    unsent_lines.append(raw_line)
                    self._stratus_online = False
                    self._stratus_last_retry = time.monotonic()
                    self.logger.warning(
                        "Flush interrupted (%d sent, keeping %d unsent)",
                        sent, 1
                    )
                    break
            except (json.JSONDecodeError, KeyError):
                failed += 1
        else:
            # Loop completed without break - all lines processed
            unsent_lines = []

        # Collect remaining unprocessed lines after a mid-flush break
        if unsent_lines:
            idx = lines.index(unsent_lines[0])
            unsent_lines = lines[idx:]

        # Rewrite buffer with only unsent lines, or delete if empty
        try:
            if unsent_lines:
                with open(self._stratus_buffer_path, "w") as f:
                    f.writelines(unsent_lines)
            else:
                self._stratus_buffer_path.unlink(missing_ok=True)
                self.logger.info(
                    "Buffer flushed: %d sent, %d skipped", sent, failed
                )
        except OSError:
            pass

    # ===================================================================
    #  Daily Stats
    # ===================================================================

    def _reset_daily_stats(self):
        """Reset daily strike statistics at midnight SAST."""
        today = now_sast().strftime("%Y-%m-%d")
        if today != self._last_reset_date:
            self.logger.info(
                "Date rollover %s -> %s | Yesterday: %d strikes, "
                "closest %s km",
                self._last_reset_date, today,
                self._strike_count_today,
                str(self._closest_today_km)
                if self._closest_today_km < 999 else "N/A"
            )
            self._strike_count_today = 0
            self._closest_today_km = 999
            self._last_reset_date = today
            # Purge old CSV files on date rollover
            self.data_logger.purge_old_files(self.config.LOG_RETENTION_DAYS)

    # ===================================================================
    #  Interrupt Handling
    # ===================================================================

    def _irq_callback(self, channel):
        """GPIO interrupt callback - set flag for main loop processing."""
        if self.config.PULSE_MIRROR_ENABLED:
            try:
                GPIO.output(self.config.PULSE_MIRROR_PIN, GPIO.HIGH)
            except RuntimeError:
                pass
        self._interrupt_flag = True

    def _interference_check(self):
        """Detect RF-interference bursts by strike rate.

        Returns True when outbound alerts should be suppressed: either an
        implausibly high strike rate was just seen, or we are still inside
        the post-burst cool-down. Strikes are always logged locally either
        way - this only gates the outbound POST/UART so the panel and
        Campbell logger are not flooded by interference. Genuine,
        normally-paced lightning never reaches the limit and is unaffected.
        """
        if not self.config.INTERFERENCE_GUARD_ENABLED:
            return False
        now = time.monotonic()
        self._recent_strikes.append(now)
        window = self.config.INTERFERENCE_WINDOW_S
        while self._recent_strikes and now - self._recent_strikes[0] > window:
            self._recent_strikes.popleft()

        if now < self._interference_until:
            return True  # still cooling down from a detected burst

        if len(self._recent_strikes) >= self.config.INTERFERENCE_STRIKE_LIMIT:
            self._interference_until = now + self.config.INTERFERENCE_COOLDOWN_S
            self.logger.warning(
                "Suspected RF interference: %d strikes in %ds (limit %d) - "
                "outbound alerts muted for %ds; strikes still logged locally",
                len(self._recent_strikes), window,
                self.config.INTERFERENCE_STRIKE_LIMIT,
                self.config.INTERFERENCE_COOLDOWN_S,
            )
            self._interference_logged = True
            return True
        return False

    # ===================================================================
    #  Strike Validation Buffer
    # ===================================================================

    def _buffer_strike(self, distance_km, energy):
        """Add a strike to the validation buffer instead of posting immediately.

        Returns True if the strike was buffered (caller should NOT post).
        Returns False if buffering is disabled (caller should post normally).
        """
        if not self.config.VALIDATION_BUFFER_ENABLED:
            return False
        now = time.monotonic()
        self._validation_buffer.append((now, distance_km, energy))
        # Set flush time on first entry in a new batch
        if len(self._validation_buffer) == 1:
            self._validation_flush_time = now + self.config.VALIDATION_BUFFER_SECS
        return True

    def _flush_validation_buffer(self):
        """Check if the validation buffer is ready to evaluate and flush.

        Called from the main loop. When the buffer window expires, decide
        whether the batch looks like real lightning or EMI, then either
        forward to the webhook or discard.

        Discriminator (tuned for the co-located modem/solar-switcher EMI,
        which always reports the AS3935 "indeterminate" 1 km bin):
          - A batch containing ANY varied-distance strike (>1 km, in range)
            is a real storm signature -> forward all, and remember the time.
          - An all-1km batch is only forwarded if a varied-distance strike
            was seen within STORM_CONTEXT_WINDOW_S (the approach/overhead
            phase of a corroborated storm). Otherwise it is EMI -> discard.
            This holds regardless of count, so small bursts cannot leak.
        """
        if not self._validation_buffer:
            return
        now = time.monotonic()
        if now < self._validation_flush_time:
            return

        batch = self._validation_buffer
        self._validation_buffer = []

        count = len(batch)
        emi_dist = self.config.VALIDATION_EMI_DISTANCE_KM
        has_varied = any(d != emi_dist for _, d, _ in batch)

        if has_varied:
            # Genuine storm geometry (varied distances). Forward everything
            # and mark the storm-context timestamp.
            self._last_varied_distance_ts = now
            self.logger.info(
                "Validation buffer releasing %d strike(s) to webhook "
                "(varied-distance storm)", count
            )
            for _, dist, energy in batch:
                self._alert_webhook(dist, energy)
            return

        # All strikes at the EMI distance (1 km). Forward ONLY if a genuine
        # varied-distance strike was seen recently (real storm now overhead).
        within_storm = (
            self._last_varied_distance_ts > 0 and
            (now - self._last_varied_distance_ts) <= self.config.STORM_CONTEXT_WINDOW_S
        )
        if within_storm:
            self.logger.info(
                "Validation buffer releasing %d overhead strike(s) "
                "(storm-corroborated)", count
            )
            for _, dist, energy in batch:
                self._alert_webhook(dist, energy)
            return

        # Uncorroborated 1 km activity = EMI. Discard (logged locally only).
        self.logger.warning(
            "[FILTERED-EMI] Discarded %d strike(s) (all at %d km, no storm "
            "context within %ds) - not forwarded to panel",
            count, emi_dist, self.config.STORM_CONTEXT_WINDOW_S
        )
        self.data_logger.log_event(
            "FILTERED_EMI", emi_dist, 0,
            self.sensor.get_noise_floor(),
            self.config.WATCHDOG_THRESH, self.config.SPIKE_REJECT
        )

    # ===================================================================
    #  Temperature Compensation
    # ===================================================================

    def _temperature_compensation(self):
        """Recalibrate AS3935 RC oscillators when temperature drifts.

        The TRCO and SRCO oscillators drift with temperature. This
        method triggers recalibration when the enclosure temperature
        (approximated by CPU temp) changes significantly, or on a
        fixed interval as a safety net.
        """
        now = time.monotonic()
        cpu_temp = get_cpu_temperature()

        # Periodic recalibration (every RECALIBRATE_INTERVAL_S)
        time_due = (now - self._last_recalibrate_time
                    >= self.config.RECALIBRATE_INTERVAL_S)

        # Temperature-delta recalibration
        temp_due = (self._last_recalibrate_temp > -900 and
                    abs(cpu_temp - self._last_recalibrate_temp)
                    >= self.config.RECALIBRATE_TEMP_DELTA_C)

        if time_due or temp_due:
            reason = "temp delta" if temp_due else "periodic"
            self.logger.info(
                "RC oscillator recalibration (%s): CPU %.1f C "
                "(last cal at %.1f C)",
                reason, cpu_temp, self._last_recalibrate_temp
            )
            cal_ok = self.sensor.calibrate()
            if cal_ok:
                self.logger.info("RC recalibration PASSED")
            else:
                self.logger.warning("RC recalibration reported FAIL "
                                    "(sensor may still function)")
            self._last_recalibrate_temp = cpu_temp
            self._last_recalibrate_time = now
            # Report the recalibration to the panel for the monthly report.
            self._calibration_webhook(
                kind="rc_recal",
                reason="temp_delta" if temp_due else "interval",
                cpu_temp_c=cpu_temp,
            )

        # Thermal warnings
        if cpu_temp >= self.config.CPU_TEMP_CRIT_C:
            self.logger.error(
                "CPU temperature CRITICAL: %.1f C (threshold %d C)",
                cpu_temp, self.config.CPU_TEMP_CRIT_C
            )
        elif cpu_temp >= self.config.CPU_TEMP_WARN_C:
            self.logger.warning(
                "CPU temperature HIGH: %.1f C (threshold %d C)",
                cpu_temp, self.config.CPU_TEMP_WARN_C
            )

    def _antenna_frequency_check(self):
        """Daily antenna resonance check at a fixed SAST hour.

        Measures the LCO frequency by enabling DISP_LCO on the IRQ pin
        and counting pulses. If outside the 3.5% tolerance of 500 kHz,
        adjusts tune_cap by one step. Runs once per day at the configured
        hour (default 06:00 SAST) when temperature is most stable.
        """
        if not self.config.ANTENNA_CHECK_ENABLED:
            return

        current = now_sast()
        today_str = current.strftime("%Y-%m-%d")

        # Only run once per day, at the configured hour
        if today_str == self._last_antenna_check_date:
            return
        if current.hour != self.config.ANTENNA_CHECK_HOUR:
            return

        self._last_antenna_check_date = today_str
        self.logger.info("Daily antenna frequency check starting (06:00 SAST)")

        try:
            freq_hz = self._measure_antenna_frequency()
        except Exception as e:
            self.logger.error("Antenna frequency measurement failed: %s", e)
            return

        target_hz = 500000
        tolerance = 0.035  # 3.5% per datasheet
        low = target_hz * (1 - tolerance)
        high = target_hz * (1 + tolerance)

        self.logger.info(
            "Antenna frequency: %d Hz (target %d Hz, "
            "tolerance %.1f%%, range %d-%d Hz)",
            freq_hz, target_hz, tolerance * 100, int(low), int(high)
        )

        if low <= freq_hz <= high:
            self.logger.info(
                "Antenna frequency WITHIN tolerance - tune_cap=%d OK",
                self.config.TUNE_CAP
            )
            self._calibration_webhook(
                kind="antenna_check", reason="scheduled",
                cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
                in_tolerance=True,
                tune_cap_before=self.config.TUNE_CAP,
                tune_cap_after=self.config.TUNE_CAP,
            )
            return

        # Adjust tune_cap by one step in the correct direction
        if freq_hz > high and self.config.TUNE_CAP < 15:
            new_cap = self.config.TUNE_CAP + 1
            direction = "up"
        elif freq_hz < low and self.config.TUNE_CAP > 0:
            new_cap = self.config.TUNE_CAP - 1
            direction = "down"
        else:
            self.logger.warning(
                "Antenna freq out of range but tune_cap at limit (%d) "
                "- cannot adjust further",
                self.config.TUNE_CAP
            )
            self._calibration_webhook(
                kind="antenna_check", reason="scheduled",
                cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
                in_tolerance=False,
                tune_cap_before=self.config.TUNE_CAP,
                tune_cap_after=self.config.TUNE_CAP,
            )
            return

        self.logger.warning(
            "Antenna freq %d Hz outside tolerance - adjusting "
            "tune_cap %d -> %d (%s)",
            freq_hz, self.config.TUNE_CAP, new_cap, direction
        )
        old_cap = self.config.TUNE_CAP
        self.config.TUNE_CAP = new_cap
        self.sensor.set_tune_cap(new_cap)

        # Verify after adjustment
        time.sleep(0.01)
        verify_hz = self._measure_antenna_frequency()
        self.logger.info(
            "After adjustment: antenna freq = %d Hz (tune_cap=%d)",
            verify_hz, new_cap
        )
        self._calibration_webhook(
            kind="antenna_check", reason="scheduled",
            cpu_temp_c=get_cpu_temperature(), freq_hz=freq_hz,
            in_tolerance=False,
            tune_cap_before=old_cap, tune_cap_after=new_cap,
        )

    def _measure_antenna_frequency(self):
        """Measure the LCO frequency using DISP_LCO and GPIO pulse counting.

        Enables the antenna frequency display on the IRQ pin, counts
        rising edges for a measurement window, then restores normal
        IRQ operation. The frequency division ratio is accounted for.

        Returns the estimated antenna frequency in Hz.
        """
        # Remove normal IRQ detection temporarily
        GPIO.remove_event_detect(self.config.IRQ_PIN)
        time.sleep(0.01)

        # Enable LCO display on IRQ pin (REG 0x08, bit 7)
        reg08 = self.sensor._read_register(0x08)
        self.sensor._write_register(0x08, reg08 | 0x80)
        time.sleep(0.05)  # Allow oscillator to stabilize

        # Count pulses over measurement window
        measure_ms = 200  # 200 ms measurement window
        count = [0]

        def _count_pulse(channel):
            count[0] += 1

        GPIO.add_event_detect(
            self.config.IRQ_PIN, GPIO.RISING, callback=_count_pulse
        )
        time.sleep(measure_ms / 1000.0)
        GPIO.remove_event_detect(self.config.IRQ_PIN)

        # Disable LCO display (restore normal interrupt)
        self.sensor._write_register(0x08, reg08 & ~0x80)
        time.sleep(0.01)

        # Restore normal IRQ detection
        GPIO.add_event_detect(
            self.config.IRQ_PIN,
            GPIO.RISING,
            callback=self._irq_callback,
            bouncetime=5
        )

        # Calculate actual antenna frequency
        # The displayed frequency is divided by FREQ_DIV_RATIO
        measured_divided = count[0] / (measure_ms / 1000.0)
        actual_freq = measured_divided * self.config.FREQ_DIV_RATIO

        return int(actual_freq)

    def _process_interrupt(self):
        """Process an AS3935 interrupt event."""
        try:
            time.sleep(0.002)  # AS3935 requires 2 ms after IRQ

            int_type = self.sensor.get_interrupt_type()
            self._reset_daily_stats()

            if int_type == INT_LIGHTNING:
                distance = self.sensor.get_distance()
                energy = self.sensor.get_energy()
                noise = self.sensor.get_noise_floor()

                self._strike_count_today += 1
                if distance != 0x3F and distance < self._closest_today_km:
                    self._closest_today_km = distance

                if distance == 0x3F:
                    dist_str = "OUT_OF_RANGE"
                    dist_val = -1
                    self.logger.info(
                        "LIGHTNING detected - Distance: OUT OF RANGE, "
                        "Energy: %d", energy
                    )
                else:
                    dist_str = str(distance)
                    dist_val = distance
                    self.logger.info(
                        "LIGHTNING detected - Distance: %d km, Energy: %d",
                        distance, energy
                    )

                # Interference guard: suppress OUTBOUND alerts during an
                # implausible strike burst, but always keep the local record.
                muted = self._interference_check()

                self.data_logger.log_event(
                    "LIGHTNING", dist_str, energy, noise,
                    self.config.WATCHDOG_THRESH, self.config.SPIKE_REJECT
                )
                if muted:
                    self.logger.warning(
                        "Strike muted (interference window) - "
                        "logged locally, not alerted"
                    )
                else:
                    self._stratus_post({
                        "lightning": 1,
                        "lightningDistance": dist_val,
                        "lightningEnergy": energy
                    })
                    self.campbell_uart.send_lightning(dist_val, energy)
                    # Route through validation buffer if enabled;
                    # otherwise post directly to the webhook.
                    if not self._buffer_strike(dist_val, energy):
                        self._alert_webhook(dist_val, energy)

            elif int_type == INT_DISTURBER:
                self.logger.debug("Disturber detected (man-made signal rejected)")
                self.data_logger.log_event(
                    "DISTURBER", 0, 0, self.sensor.get_noise_floor(),
                    self.config.WATCHDOG_THRESH, self.config.SPIKE_REJECT
                )

            elif int_type == INT_NOISE_HIGH:
                noise = self.sensor.get_noise_floor()
                self.logger.warning(
                    "Noise level too high (current floor: %d)", noise
                )
                self.data_logger.log_event(
                    "NOISE", 0, 0, noise,
                    self.config.WATCHDOG_THRESH, self.config.SPIKE_REJECT
                )

            else:
                self.logger.debug("Unknown interrupt type: 0x%02X", int_type)
        finally:
            if self.config.PULSE_MIRROR_ENABLED:
                try:
                    GPIO.output(self.config.PULSE_MIRROR_PIN, GPIO.LOW)
                except RuntimeError:
                    pass

    # ===================================================================
    #  Health Monitoring
    # ===================================================================

    def _heartbeat(self):
        """Drive periodic health tasks: local log, Campbell status string
        (every 10 min) and the hourly admin-panel liveness webhook."""
        now = time.monotonic()
        log_due = (now - self._last_heartbeat
                   >= self.config.HEARTBEAT_INTERVAL)
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
                "WiFi: %d dBm (Q:%d), "
                "Strikes today: %d, Closest: %s km",
                cpu_temp, uptime, noise,
                wifi["rssi_dbm"], wifi["link_quality"],
                self._strike_count_today,
                str(self._closest_today_km)
                if self._closest_today_km < 999 else "N/A"
            )
            self._stratus_post({
                "cpuTemperature": cpu_temp,
                "rssi": wifi["rssi_dbm"]
            })

        if campbell_due:
            self._last_campbell_heartbeat = now
            self.campbell_uart.send_heartbeat(cpu_temp, wifi["rssi_dbm"])

        if panel_due:
            self._last_panel_heartbeat = now
            self._heartbeat_webhook(cpu_temp, uptime, wifi, noise)

    def _check_sensor_registers(self):
        """Periodically verify sensor registers have not drifted."""
        now = time.monotonic()
        if now - self._last_register_check >= self.config.REGISTER_CHECK_INTERVAL:
            self._last_register_check = now
            if not self.sensor.verify_registers(self.config):
                self.logger.warning(
                    "Register drift detected - re-initializing AS3935"
                )
                self.sensor.initialize(self.config)

    # ===================================================================
    #  Main Loop
    # ===================================================================

    def start(self):
        """Initialize the sensor and start the detection loop."""
        global _detector_instance
        _detector_instance = self

        self.logger.info("=" * 60)
        self.logger.info(
            "Lightning Detection System v%s Starting", __version__
        )
        self.logger.info("=" * 60)

        # Hardware init with retry
        self._init_hardware()

        # Warn if Stratus is enabled but no endpoint configured
        if self.config.STRATUS_ENABLED and not self.config.STRATUS_ENDPOINT:
            self.logger.warning(
                "Stratus enabled but no endpoint set - "
                "add stratus_endpoint to %s", self.config.CONFIG_FILE
            )
            self.config.STRATUS_ENABLED = False

        # Log configuration
        self.logger.info("[4/4] Active configuration:")
        self.logger.info("  AFE Mode:       OUTDOOR")
        self.logger.info("  Noise Floor:    %d", self.config.NOISE_FLOOR)
        self.logger.info("  Watchdog:       %d", self.config.WATCHDOG_THRESH)
        self.logger.info("  Spike Reject:   %d", self.config.SPIKE_REJECT)
        self.logger.info("  Min Strikes:    %d", self.config.MIN_STRIKES)
        self.logger.info(
            "  Tune Cap:       %d (%d pF)",
            self.config.TUNE_CAP, self.config.TUNE_CAP * 8
        )
        self.logger.info("  Mask Disturber: %s", self.config.MASK_DISTURBER)
        self.logger.info("  IRQ Pin:        GPIO %d", self.config.IRQ_PIN)
        self.logger.info(
            "  Pulse Mirror:   %s",
            (
                f"enabled (GPIO {self.config.PULSE_MIRROR_PIN})"
                if self.config.PULSE_MIRROR_ENABLED else "disabled"
            )
        )
        self.logger.info(
            "  Campbell UART:  %s",
            (
                "enabled (GPIO %d @ %d baud)" % (
                    self.config.CAMPBELL_UART_TX_PIN,
                    self.config.CAMPBELL_UART_BAUD
                )
                if self.config.CAMPBELL_UART_ENABLED else "disabled"
            )
        )
        self.logger.info("  Station ID:     %s", self.config.STATION_ID)
        self.logger.info(
            "  Stratus:        %s",
            "enabled" if self.config.STRATUS_ENABLED else "disabled"
        )
        if self.config.STRATUS_ENABLED:
            self.logger.info(
                "  Endpoint:       %s", self.config.STRATUS_ENDPOINT
            )
            self.logger.info(
                "  Retry interval: %d s", self.config.STRATUS_RETRY_INTERVAL
            )
        self.logger.info("  Log Directory:  %s", self.config.LOG_DIR)
        self.logger.info(
            "  Log Retention:  %d days", self.config.LOG_RETENTION_DAYS
        )


        # Register GPIO interrupt
        GPIO.add_event_detect(
            self.config.IRQ_PIN,
            GPIO.RISING,
            callback=self._irq_callback,
            bouncetime=5
        )

        # Send boot notification to Stratus
        self._stratus_post({
            "status": "BOOT",
            "version": __version__,
            "uptime": get_uptime_seconds()
        })

        # Bring up UART TX path after hardware init completes
        self.campbell_uart.open()

        self.logger.info("System ready - listening for lightning events...")
        sd_notify("READY=1")
        self._running = True
        self._last_heartbeat = time.monotonic()
        self._last_campbell_heartbeat = time.monotonic()
        # Make the panel heartbeat due on the first loop iteration so the unit
        # shows ACTIVE promptly after boot/restart (independent of uptime).
        self._last_panel_heartbeat = (
            time.monotonic() - self.config.HEARTBEAT_WEBHOOK_INTERVAL
        )
        self._last_register_check = time.monotonic()

        # Temperature compensation: record initial state
        self._last_recalibrate_temp = get_cpu_temperature()
        self._last_recalibrate_time = time.monotonic()

        # Main loop with inner exception recovery
        try:
            while self._running:
                try:
                    if self._interrupt_flag:
                        self._interrupt_flag = False
                        self._process_interrupt()

                    self._heartbeat()
                    self._check_sensor_registers()
                    self._flush_validation_buffer()
                    self._temperature_compensation()
                    self._antenna_frequency_check()

                    # Only attempt Stratus retry when interval has elapsed
                    if (not self._stratus_online
                            and self.config.STRATUS_ENABLED
                            and (time.monotonic() - self._stratus_last_retry
                                 >= self.config.STRATUS_RETRY_INTERVAL)):
                        self._stratus_retry()

                    self._consecutive_errors = 0
                    sd_notify("WATCHDOG=1")
                    time.sleep(0.1)

                except Exception as e:
                    self._consecutive_errors += 1
                    self.logger.error(
                        "Main loop error %d/%d (recovering): %s",
                        self._consecutive_errors,
                        self.config.MAX_CONSECUTIVE_ERRORS,
                        e, exc_info=True
                    )
                    if self._consecutive_errors >= self.config.MAX_CONSECUTIVE_ERRORS:
                        self.logger.critical(
                            "Too many consecutive errors (%d), "
                            "exiting for systemd restart",
                            self._consecutive_errors
                        )
                        break
                    time.sleep(1)

        except KeyboardInterrupt:
            self.logger.info("Shutdown requested by user")
        finally:
            self.stop()

    def stop(self):
        """Clean shutdown."""
        self._running = False
        self.logger.info("Shutting down lightning detection system...")
        # Close buffer file handle
        if self._stratus_buffer_file is not None:
            try:
                self._stratus_buffer_file.close()
            except OSError:
                pass
            self._stratus_buffer_file = None
        self.campbell_uart.close()
        self.data_logger.close()
        self.sensor.close()
        try:
            GPIO.cleanup()
        except Exception:
            pass
        self.logger.info("System stopped cleanly")


# ===========================================================================
#  SIGNAL HANDLERS
# ===========================================================================

def signal_handler(signum, frame):
    """Handle termination signals gracefully."""
    if _detector_instance is not None:
        _detector_instance._running = False
    else:
        sys.exit(0)


# ===========================================================================
#  MAIN ENTRY POINT
# ===========================================================================

def main():
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    config = Config()
    detector = LightningDetector(config)
    detector.start()


if __name__ == "__main__":
    main()
# ===========================================================================
#  END OF PROGRAM
# ===========================================================================