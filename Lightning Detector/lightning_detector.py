"""
=============================================================================
                     WONDERKOP SMELTER LIGHTNING DETECTOR
=============================================================================

  Project:     Lightning Detection System (WONDERKOP-LD-001)
  Client:      Wonderkop Smelter (Environgaka)
  Company:     METRON (PTY) LTD
  Developer:   L.J Esterhuizen
  Date:        2026/03
  Revision:    1.0

=============================================================================

  Hardware:
    Raspberry Pi Zero 2W
    MikroE Pi 2 Click Shield (MIKROE-1879 | MIKROE-1513)
    MikroE Thunder Click (MIKROE-1444) in mikroBUS Socket
    Waveshare Solar Power Manager (D) with 3x 18650 batteries

  Wiring (via Click Shield, no manual wiring needed):
    AS3935 CS   -> Pi GPIO 8  (CE0)
    AS3935 SCK  -> Pi GPIO 11 (SCLK)
    AS3935 MISO -> Pi GPIO 9  (MISO)
    AS3935 MOSI -> Pi GPIO 10 (MOSI)
    AS3935 IRQ  -> Pi GPIO 25 (INT on mikroBUS socket 1)

=============================================================================
"""


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
from datetime import datetime, timezone
from pathlib import Path

try:
    import RPi.GPIO as GPIO
except ImportError:
    print("RPi.GPIO not available. Install with: sudo apt install python3-rpi.gpio")
    sys.exit(1)

import urllib.request
import urllib.error
import urllib.parse
import socket
import smtplib
import base64
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders


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
        # ── SPI ────────────────────────────────────────────────────────
        self.SPI_BUS         = 0
        self.SPI_DEVICE      = 0     # CE0
        self.SPI_SPEED_HZ    = 1000000  # 1 MHz (AS3935 max)
        self.SPI_MODE        = 0b01  # SPI Mode 1 (CPOL=0, CPHA=1)

        # ── GPIO ───────────────────────────────────────────────────────
        self.IRQ_PIN         = 25    # INT on mikroBUS socket 1

        # ── AS3935 Sensor ──────────────────────────────────────────────
        self.AFE_MODE        = AFE_OUTDOOR   # Outdoor industrial deployment
        self.NOISE_FLOOR     = 5     # 0-7, elevated for smelter EMI
        self.WATCHDOG_THRESH = 5     # 0-15, elevated for industrial transients
        self.SPIKE_REJECT    = 5     # 0-15, aggressive non-lightning rejection
        self.MIN_STRIKES     = 5     # 1, 5, 9, or 16
        self.TUNE_CAP        = 0     # 0-15 (x8 pF), set via calibrate_antenna.py
        self.MASK_DISTURBER  = True  # Suppress disturber interrupts
        self.FREQ_DIV_RATIO  = 16    # 16, 32, 64, or 128

        # ── Station Identity ───────────────────────────────────────────
        self.STATION_ID      = "WONDERKOP-LD-001"

        # ── Stratus Weather ────────────────────────────────────────────
        self.STRATUS_ENABLED  = True
        self.STRATUS_ENDPOINT = ""   # Set via lightning_config.json (required)
        self.STRATUS_API_KEY  = ""   # Optional
        self.STRATUS_TIMEOUT  = 10   # HTTP timeout in seconds
        self.STRATUS_RETRY_INTERVAL = 300  # Seconds between offline retries

        # ── Data Logging ───────────────────────────────────────────────
        self.LOG_DIR         = "/home/pi/lightning_data"
        self.LOG_LEVEL       = logging.INFO
        self.LOG_RETENTION_DAYS = 90

        # ── System ─────────────────────────────────────────────────────
        self.HEARTBEAT_INTERVAL      = 600   # 10 minutes
        self.BOOT_STABILISE_SECS     = 5
        self.INIT_RETRY_LIMIT        = 10
        self.INIT_RETRY_DELAY        = 5
        self.REGISTER_CHECK_INTERVAL = 3600  # 1 hour
        self.MAX_CONSECUTIVE_ERRORS  = 30

        # ── Proximity Alerts (SMS & WhatsApp) ──────────────────────────
        self.ALERT_ENABLED       = True
        self.ALERT_DISTANCE_KM   = 10
        self.ALERT_COOLDOWN_SECS = 3600  # 1 hour

        self.WHATSAPP_ENABLED    = False
        self.WHATSAPP_NUMBERS    = []

        self.SMS_ENABLED         = False
        self.SMS_API_URL         = ""
        self.SMS_API_TOKEN       = ""
        self.SMS_RECIPIENTS      = []

        # ── Weekly Email Report ────────────────────────────────────────
        self.EMAIL_REPORT_ENABLED = False
        self.EMAIL_SMTP_HOST      = ""
        self.EMAIL_SMTP_PORT      = 587
        self.EMAIL_SMTP_USER      = ""
        self.EMAIL_SMTP_PASS      = ""
        self.EMAIL_FROM           = ""
        self.EMAIL_RECIPIENTS     = []
        self.EMAIL_REPORT_DAY     = 0   # 0=Monday
        self.EMAIL_REPORT_HOUR    = 7   # UTC

        # ── Config File ───────────────────────────────────────────────
        self.CONFIG_FILE     = "/home/pi/lightning_config.json"


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
    if addr[0] == "@":
        addr = "\0" + addr[1:]
    try:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
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

    # ── SPI Transport ──────────────────────────────────────────────────────

    def open(self, spi_bus, spi_device, spi_speed, spi_mode):
        """Open the SPI connection to the AS3935."""
        self.spi = spidev.SpiDev()
        self.spi.open(spi_bus, spi_device)
        self.spi.max_speed_hz = spi_speed
        self.spi.mode = spi_mode

    def _read_register(self, register):
        """Read a single register from the AS3935."""
        result = self.spi.xfer2([(register & 0x3F) | 0x40, 0x00])
        return result[1]

    def _write_register(self, register, value):
        """Write a single register to the AS3935."""
        self.spi.xfer2([register & 0x3F, value & 0xFF])

    def _modify_register(self, register, mask, shift, value):
        """Modify specific bits within a register."""
        current = self._read_register(register)
        cleared = current & ~(mask << shift)
        new_val = cleared | ((value & mask) << shift)
        self._write_register(register, new_val)

    # ── Commands ───────────────────────────────────────────────────────────

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

    # ── Setters ────────────────────────────────────────────────────────────

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

    # ── Getters ────────────────────────────────────────────────────────────

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

    # ── Maintenance ────────────────────────────────────────────────────────

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

    def initialise(self, config):
        """Full initialisation sequence with given configuration."""
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
        "datetime_utc", "event_type", "distance_km", "energy",
        "noise_floor", "watchdog_thresh", "spike_rejection",
        "cpu_temp_c", "wifi_rssi_dbm"
    ]

    def __init__(self, log_dir):
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)
        self._current_date = None
        self._csv_file = None
        self._csv_writer = None

    # ── File Management ────────────────────────────────────────────────────

    def _ensure_file_open(self):
        """Open/rotate the CSV log file based on date."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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

    # ── Logging ────────────────────────────────────────────────────────────

    def log_event(self, event_type, distance_km, energy, noise_floor,
                  watchdog_thresh, spike_rejection):
        """Log a single event to the CSV file."""
        try:
            self._ensure_file_open()
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
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


# ===========================================================================
#  ALERT MANAGER (SMS & WhatsApp)
# ===========================================================================

class AlertManager:
    """Sends proximity alerts via SMS and WhatsApp with cooldown."""

    def __init__(self, config):
        self.config = config
        self._last_alert_time = 0.0  # monotonic
        self.logger = logging.getLogger("lightning.alerts")

    def check_and_alert(self, distance_km, energy):
        """Send an alert if lightning is within threshold and cooldown expired.

        Returns True if an alert was sent, False otherwise.
        """
        if not self.config.ALERT_ENABLED:
            return False
        if distance_km <= 0 or distance_km > self.config.ALERT_DISTANCE_KM:
            return False

        now = time.monotonic()
        elapsed = now - self._last_alert_time
        if elapsed < self.config.ALERT_COOLDOWN_SECS:
            remaining = int(self.config.ALERT_COOLDOWN_SECS - elapsed)
            self.logger.debug(
                "Alert cooldown active (%d s remaining), suppressing",
                remaining
            )
            return False

        self._last_alert_time = now
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        message = (
            "\u26a1 LIGHTNING ALERT - %s\n"
            "Distance: %d km\n"
            "Energy: %d\n"
            "Time: %s\n"
            "Station: %s"
            % (
                self.config.STATION_ID, distance_km, energy,
                timestamp, self.config.STATION_ID
            )
        )

        self.logger.info(
            "Proximity alert triggered (distance: %d km)", distance_km
        )

        if self.config.WHATSAPP_ENABLED:
            self._send_whatsapp(message)
        if self.config.SMS_ENABLED:
            self._send_sms(message)

        return True

    def _send_whatsapp(self, message):
        """Send WhatsApp message via CallMeBot API."""
        for recipient in self.config.WHATSAPP_NUMBERS:
            phone = recipient.get("phone", "")
            apikey = recipient.get("apikey", "")
            if not phone or not apikey:
                continue
            try:
                params = urllib.parse.urlencode({
                    "phone": phone,
                    "text": message,
                    "apikey": apikey
                })
                url = "https://api.callmebot.com/whatsapp.php?" + params
                req = urllib.request.Request(url)
                with urllib.request.urlopen(req, timeout=15) as resp:
                    if resp.status == 200:
                        self.logger.info(
                            "WhatsApp alert sent to %s",
                            phone[:6] + "****"
                        )
                    else:
                        self.logger.warning(
                            "WhatsApp API returned HTTP %d for %s",
                            resp.status, phone[:6] + "****"
                        )
            except Exception as e:
                self.logger.error(
                    "WhatsApp alert failed for %s: %s",
                    phone[:6] + "****", e
                )

    def _send_sms(self, message):
        """Send SMS via configurable HTTP API (e.g. BulkSMS.co.za)."""
        if not self.config.SMS_API_URL or not self.config.SMS_RECIPIENTS:
            return
        for phone in self.config.SMS_RECIPIENTS:
            try:
                body = json.dumps({
                    "to": phone,
                    "body": message
                }).encode("utf-8")
                req = urllib.request.Request(
                    self.config.SMS_API_URL,
                    data=body,
                    method="POST"
                )
                req.add_header("Content-Type", "application/json")
                req.add_header(
                    "Authorization",
                    "Basic " + self.config.SMS_API_TOKEN
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    if 200 <= resp.status < 300:
                        self.logger.info(
                            "SMS alert sent to %s",
                            phone[:6] + "****"
                        )
                    else:
                        self.logger.warning(
                            "SMS API returned HTTP %d for %s",
                            resp.status, phone[:6] + "****"
                        )
            except Exception as e:
                self.logger.error(
                    "SMS alert failed for %s: %s",
                    phone[:6] + "****", e
                )


# ===========================================================================
#  WEEKLY EMAIL REPORT
# ===========================================================================

class WeeklyReporter:
    """Generates and sends a weekly lightning activity email report."""

    def __init__(self, config):
        self.config = config
        self.logger = logging.getLogger("lightning.report")
        self._last_report_check = 0.0  # monotonic
        self._last_report_date = ""    # ISO date of last sent report
        self._state_path = Path(config.LOG_DIR) / "weekly_report_state.json"

        # Weekly accumulators
        self._weekly_strikes = 0
        self._weekly_closest_km = 999
        self._weekly_alerts_sent = 0
        self._daily_breakdown = {}  # {"2026-03-20": {"strikes": N, "closest": M}}

        # Restore state from disk if available
        self._load_state()

    def _load_state(self):
        """Restore weekly accumulators from disk after a restart."""
        if not self._state_path.exists():
            return
        try:
            with open(self._state_path, "r") as f:
                state = json.load(f)
            self._weekly_strikes = state.get("strikes", 0)
            self._weekly_closest_km = state.get("closest_km", 999)
            self._weekly_alerts_sent = state.get("alerts_sent", 0)
            self._daily_breakdown = state.get("daily", {})
            self._last_report_date = state.get("last_report_date", "")
            self.logger.info("Weekly report state restored from disk")
        except (json.JSONDecodeError, IOError, KeyError):
            self.logger.warning("Could not restore weekly report state")

    def _save_state(self):
        """Persist weekly accumulators to disk."""
        state = {
            "strikes": self._weekly_strikes,
            "closest_km": self._weekly_closest_km,
            "alerts_sent": self._weekly_alerts_sent,
            "daily": self._daily_breakdown,
            "last_report_date": self._last_report_date,
        }
        try:
            with open(self._state_path, "w") as f:
                json.dump(state, f)
        except OSError:
            pass

    def record_strike(self, distance_km):
        """Record a strike for the weekly report and persist to disk."""
        self._weekly_strikes += 1
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if today not in self._daily_breakdown:
            self._daily_breakdown[today] = {"strikes": 0, "closest": 999}
        self._daily_breakdown[today]["strikes"] += 1
        if 0 < distance_km < 63:
            if distance_km < self._weekly_closest_km:
                self._weekly_closest_km = distance_km
            if distance_km < self._daily_breakdown[today]["closest"]:
                self._daily_breakdown[today]["closest"] = distance_km
        self._save_state()

    def record_alert(self):
        """Record that a proximity alert was sent and persist to disk."""
        self._weekly_alerts_sent += 1
        self._save_state()

    def check_and_send(self):
        """Check if it's time to send the weekly report."""
        if not self.config.EMAIL_REPORT_ENABLED:
            return

        # Only check once per minute to avoid overhead
        now = time.monotonic()
        if now - self._last_report_check < 60:
            return
        self._last_report_check = now

        utc_now = datetime.now(timezone.utc)
        today = utc_now.strftime("%Y-%m-%d")

        # Check: correct day of week, correct hour, not already sent today
        if utc_now.weekday() != self.config.EMAIL_REPORT_DAY:
            return
        if utc_now.hour != self.config.EMAIL_REPORT_HOUR:
            return
        if self._last_report_date == today:
            return

        self._last_report_date = today
        self._send_report(utc_now)
        self._reset_weekly()

    def _build_report_body(self, report_time):
        """Build the plain-text weekly report."""
        closest_str = (
            "%d km" % self._weekly_closest_km
            if self._weekly_closest_km < 999 else "None detected"
        )

        lines = [
            "=" * 60,
            "  WEEKLY LIGHTNING ACTIVITY REPORT",
            "  Station: %s" % self.config.STATION_ID,
            "  Report generated: %s" % report_time.strftime(
                "%Y-%m-%d %H:%M UTC"
            ),
            "=" * 60,
            "",
            "SUMMARY",
            "-" * 40,
            "  Total strikes detected:  %d" % self._weekly_strikes,
            "  Closest strike:          %s" % closest_str,
            "  Proximity alerts sent:   %d" % self._weekly_alerts_sent,
            "",
            "DAILY BREAKDOWN",
            "-" * 40,
        ]

        if self._daily_breakdown:
            for date in sorted(self._daily_breakdown.keys()):
                day = self._daily_breakdown[date]
                day_closest = (
                    "%d km" % day["closest"]
                    if day["closest"] < 999 else "N/A"
                )
                lines.append(
                    "  %s:  %3d strikes,  closest: %s"
                    % (date, day["strikes"], day_closest)
                )
        else:
            lines.append("  No lightning activity this week.")

        lines.extend([
            "",
            "=" * 60,
            "  Wonderkop Smelter Lightning Detection System",
            "  METRON (PTY) LTD",
            "=" * 60,
        ])

        return "\n".join(lines)

    def _generate_pdf(self, report_text):
        """Generate a simple PDF document from plain text (stdlib only).

        Uses Courier (monospaced) font on A4 pages.  Objects are sorted
        by number so the cross-reference table is valid.
        """
        lines = report_text.split("\n")
        font_size = 10
        leading = 14
        margin_left = 50
        margin_top = 50
        page_width = 595
        page_height = 842
        max_y = page_height - margin_top
        min_y = margin_top

        usable_height = max_y - min_y
        lines_per_page = int(usable_height / leading)
        pages_lines = []
        for i in range(0, len(lines), lines_per_page):
            pages_lines.append(lines[i:i + lines_per_page])
        if not pages_lines:
            pages_lines = [[""]]

        # obj_dict: {obj_number: bytes}
        obj_dict = {}

        # Object 1: Catalog
        obj_dict[1] = b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj"

        # Reserve object 2 for Pages (built after we know page refs)
        # Object 3: Font (Courier, monospaced for report formatting)
        obj_dict[3] = (
            b"3 0 obj\n"
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>\n"
            b"endobj"
        )

        page_obj_numbers = []
        next_obj = 4

        for page_lines in pages_lines:
            page_num = next_obj
            content_num = next_obj + 1
            next_obj += 2
            page_obj_numbers.append(page_num)

            # Content stream with Tj operator per line
            stream_parts = [
                "BT",
                "/F1 %d Tf" % font_size,
                "%d %d Td" % (margin_left, max_y),
                "%d TL" % leading,
            ]
            for line in page_lines:
                safe = (
                    line.replace("\\", "\\\\")
                    .replace("(", "\\(")
                    .replace(")", "\\)")
                )
                stream_parts.append("(%s) Tj T*" % safe)
            stream_parts.append("ET")
            stream_data = "\n".join(stream_parts).encode("latin-1")

            obj_dict[content_num] = (
                ("%d 0 obj\n<< /Length %d >>\nstream\n"
                 % (content_num, len(stream_data))).encode("latin-1")
                + stream_data
                + b"\nendstream\nendobj"
            )

            obj_dict[page_num] = (
                "%d 0 obj\n"
                "<< /Type /Page /Parent 2 0 R "
                "/MediaBox [0 0 %d %d] "
                "/Contents %d 0 R "
                "/Resources << /Font << /F1 3 0 R >> >> "
                ">>\nendobj"
                % (page_num, page_width, page_height, content_num)
            ).encode("latin-1")

        # Object 2: Pages
        kids = " ".join("%d 0 R" % n for n in page_obj_numbers)
        obj_dict[2] = (
            "2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj"
            % (kids, len(page_obj_numbers))
        ).encode("latin-1")

        # Write PDF with objects in numerical order
        sorted_nums = sorted(obj_dict.keys())
        max_obj = sorted_nums[-1]

        pdf = bytearray(b"%PDF-1.4\n")
        offsets = {}
        for num in sorted_nums:
            offsets[num] = len(pdf)
            pdf.extend(obj_dict[num])
            pdf.extend(b"\n")

        # Cross-reference table
        xref_offset = len(pdf)
        pdf.extend(b"xref\n")
        pdf.extend(("0 %d\n" % (max_obj + 1)).encode("latin-1"))
        pdf.extend(b"0000000000 65535 f \n")
        for n in range(1, max_obj + 1):
            pdf.extend(
                ("%010d 00000 n \n" % offsets[n]).encode("latin-1")
            )

        pdf.extend(b"trailer\n")
        pdf.extend(
            ("<< /Size %d /Root 1 0 R >>\n"
             % (max_obj + 1)).encode("latin-1")
        )
        pdf.extend(b"startxref\n")
        pdf.extend(("%d\n" % xref_offset).encode("latin-1"))
        pdf.extend(b"%%EOF\n")

        return bytes(pdf)

    def _send_report(self, report_time):
        """Send the weekly report via SMTP email with attached PDF."""
        if not self.config.EMAIL_RECIPIENTS:
            return

        week_end = report_time.strftime("%Y-%m-%d")
        subject = "Lightning Report - %s - Week ending %s" % (
            self.config.STATION_ID, week_end
        )
        report_text = self._build_report_body(report_time)

        # Plain text email body
        email_body = (
            "Weekly lightning activity report for station %s.\n"
            "Week ending: %s\n\n"
            "Please see the attached PDF for the full report.\n\n"
            "--\n"
            "Wonderkop Smelter Lightning Detection System\n"
            "METRON (PTY) LTD"
            % (self.config.STATION_ID, week_end)
        )

        msg = MIMEMultipart()
        msg["From"] = self.config.EMAIL_FROM
        msg["To"] = ", ".join(self.config.EMAIL_RECIPIENTS)
        msg["Subject"] = subject
        msg.attach(MIMEText(email_body, "plain"))

        # Generate and attach PDF
        pdf_data = self._generate_pdf(report_text)
        pdf_filename = "lightning_report_%s_%s.pdf" % (
            self.config.STATION_ID, week_end
        )
        attachment = MIMEBase("application", "pdf")
        attachment.set_payload(pdf_data)
        encoders.encode_base64(attachment)
        attachment.add_header(
            "Content-Disposition",
            "attachment",
            filename=pdf_filename
        )
        msg.attach(attachment)

        server = None
        try:
            if self.config.EMAIL_SMTP_PORT == 465:
                server = smtplib.SMTP_SSL(
                    self.config.EMAIL_SMTP_HOST,
                    self.config.EMAIL_SMTP_PORT,
                    timeout=30
                )
            else:
                server = smtplib.SMTP(
                    self.config.EMAIL_SMTP_HOST,
                    self.config.EMAIL_SMTP_PORT,
                    timeout=30
                )
                server.starttls()

            server.login(
                self.config.EMAIL_SMTP_USER,
                self.config.EMAIL_SMTP_PASS
            )
            server.sendmail(
                self.config.EMAIL_FROM,
                self.config.EMAIL_RECIPIENTS,
                msg.as_string()
            )
            self.logger.info(
                "Weekly report sent to %d recipients",
                len(self.config.EMAIL_RECIPIENTS)
            )
        except Exception as e:
            self.logger.error("Weekly report email failed: %s", e)
        finally:
            if server is not None:
                try:
                    server.quit()
                except Exception:
                    pass

    def _reset_weekly(self):
        """Reset weekly accumulators and remove persisted state."""
        self._weekly_strikes = 0
        self._weekly_closest_km = 999
        self._weekly_alerts_sent = 0
        self._daily_breakdown = {}
        try:
            self._state_path.unlink(missing_ok=True)
        except OSError:
            pass


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
        self._last_register_check = 0.0
        self._consecutive_errors = 0

        # Storm statistics (reset daily)
        self._strike_count_today = 0
        self._closest_today_km = 999
        self._last_reset_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

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

        # Initialise data logger
        self.data_logger = DataLogger(config.LOG_DIR)

        # AS3935 instance (opened during start)
        self.sensor = AS3935()

        # Alert manager and weekly reporter
        self.alert_manager = AlertManager(config)
        self.weekly_reporter = WeeklyReporter(config)

    # ── Configuration ──────────────────────────────────────────────────────

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
        "LOG_RETENTION_DAYS":   (int, 1, 3650),
        "ALERT_ENABLED":        (bool, None, None),
        "ALERT_DISTANCE_KM":    (int, 1, 63),
        "ALERT_COOLDOWN_SECS":  (int, 0, 86400),
        "MAX_CONSECUTIVE_ERRORS": (int, 1, 1000),
        "BOOT_STABILISE_SECS":  (int, 0, 60),
        "INIT_RETRY_LIMIT":     (int, 1, 100),
        "INIT_RETRY_DELAY":     (int, 1, 300),
        "SPI_BUS":              (int, 0, 1),
        "SPI_DEVICE":           (int, 0, 1),
        "IRQ_PIN":              (int, 0, 27),
        "EMAIL_SMTP_PORT":      (int, 1, 65535),
        "EMAIL_REPORT_DAY":     (int, 0, 6),
        "EMAIL_REPORT_HOUR":    (int, 0, 23),
        "WHATSAPP_ENABLED":     (bool, None, None),
        "SMS_ENABLED":          (bool, None, None),
        "EMAIL_REPORT_ENABLED": (bool, None, None),
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
            # No rule defined — accept strings/lists without range check
            return True
        expected_type = rule[0]
        if not isinstance(value, expected_type):
            logging.getLogger("lightning").warning(
                "Config: '%s' expects %s, got %s — skipping",
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
                    "Config: '%s' value %s not in %s — skipping",
                    key, value, constraint
                )
                return False
        elif constraint is not None:
            lo, hi = rule[1], rule[2]
            if not (lo <= value <= hi):
                logging.getLogger("lightning").warning(
                    "Config: '%s' value %s out of range [%s..%s] — skipping",
                    key, value, lo, hi
                )
                return False
        return True

    # ── Hardware Initialisation ────────────────────────────────────────────

    def _init_hardware(self):
        """Initialise GPIO and AS3935 with retry logic for cold boot.

        After a power loss the SPI bus or sensor may not be ready
        immediately.  This method retries up to INIT_RETRY_LIMIT times
        with INIT_RETRY_DELAY seconds between attempts.
        """
        # Boot stabilisation delay
        self.logger.info(
            "[1/4] Boot stabilisation delay (%d s)...",
            self.config.BOOT_STABILISE_SECS
        )
        time.sleep(self.config.BOOT_STABILISE_SECS)

        # GPIO setup
        self.logger.info("[2/4] Configuring GPIO...")
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(self.config.IRQ_PIN, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)

        # SPI + AS3935 init with retries
        self.logger.info("[3/4] Initialising AS3935 sensor...")
        last_err = None
        for attempt in range(1, self.config.INIT_RETRY_LIMIT + 1):
            try:
                self.sensor.open(
                    self.config.SPI_BUS,
                    self.config.SPI_DEVICE,
                    self.config.SPI_SPEED_HZ,
                    self.config.SPI_MODE
                )
                cal_ok = self.sensor.initialise(self.config)
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

    # ── Stratus Weather ────────────────────────────────────────────────────

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
            # First failure — go offline, buffer this payload
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

    def _stratus_buffer(self, data):
        """Append a payload to the local JSONL buffer file (persistent handle)."""
        try:
            if self._stratus_buffer_file is None or self._stratus_buffer_file.closed:
                self._stratus_buffer_file = open(
                    self._stratus_buffer_path, "a", buffering=1
                )
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
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
                    # Connection lost mid-flush — keep this and remaining lines
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
            # Loop completed without break — all lines processed
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

    # ── Daily Stats ────────────────────────────────────────────────────────

    def _reset_daily_stats(self):
        """Reset daily strike statistics at midnight UTC."""
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
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

    # ── Interrupt Handling ─────────────────────────────────────────────────

    def _irq_callback(self, channel):
        """GPIO interrupt callback - set flag for main loop processing."""
        self._interrupt_flag = True

    def _process_interrupt(self):
        """Process an AS3935 interrupt event."""
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

            self.data_logger.log_event(
                "LIGHTNING", dist_str, energy, noise,
                self.config.WATCHDOG_THRESH, self.config.SPIKE_REJECT
            )
            self._stratus_post({
                "lightning": 1,
                "lightningDistance": dist_val,
                "lightningEnergy": energy
            })

            # Proximity alert and weekly recording
            self.weekly_reporter.record_strike(dist_val)
            if dist_val > 0:
                if self.alert_manager.check_and_alert(dist_val, energy):
                    self.weekly_reporter.record_alert()

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

    # ── Health Monitoring ──────────────────────────────────────────────────

    def _heartbeat(self):
        """Log periodic heartbeat for system health monitoring."""
        now = time.monotonic()
        if now - self._last_heartbeat >= self.config.HEARTBEAT_INTERVAL:
            self._last_heartbeat = now
            self._reset_daily_stats()
            cpu_temp = get_cpu_temperature()
            uptime = get_uptime_seconds()
            wifi = get_wifi_signal()
            noise = self.sensor.get_noise_floor()
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

    def _check_sensor_registers(self):
        """Periodically verify sensor registers have not drifted."""
        now = time.monotonic()
        if now - self._last_register_check >= self.config.REGISTER_CHECK_INTERVAL:
            self._last_register_check = now
            if not self.sensor.verify_registers(self.config):
                self.logger.warning(
                    "Register drift detected - re-initialising AS3935"
                )
                self.sensor.initialise(self.config)

    # ── Main Loop ──────────────────────────────────────────────────────────

    def start(self):
        """Initialise the sensor and start the detection loop."""
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
                "Stratus enabled but no endpoint set — "
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
        self.logger.info(
            "  Alerts:         %s (<%d km, %ds cooldown)",
            "enabled" if self.config.ALERT_ENABLED else "disabled",
            self.config.ALERT_DISTANCE_KM,
            self.config.ALERT_COOLDOWN_SECS
        )
        self.logger.info(
            "  WhatsApp:       %s (%d numbers)",
            "enabled" if self.config.WHATSAPP_ENABLED else "disabled",
            len(self.config.WHATSAPP_NUMBERS)
        )
        self.logger.info(
            "  SMS:            %s (%d numbers)",
            "enabled" if self.config.SMS_ENABLED else "disabled",
            len(self.config.SMS_RECIPIENTS)
        )
        self.logger.info(
            "  Weekly Report:  %s",
            "enabled" if self.config.EMAIL_REPORT_ENABLED else "disabled"
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

        self.logger.info("System ready - listening for lightning events...")
        sd_notify("READY=1")
        self._running = True
        self._last_heartbeat = time.monotonic()
        self._last_register_check = time.monotonic()

        # Main loop with inner exception recovery
        try:
            while self._running:
                try:
                    if self._interrupt_flag:
                        self._interrupt_flag = False
                        self._process_interrupt()

                    self._heartbeat()
                    self._check_sensor_registers()

                    # Only attempt Stratus retry when interval has elapsed
                    if (not self._stratus_online
                            and self.config.STRATUS_ENABLED
                            and (time.monotonic() - self._stratus_last_retry
                                 >= self.config.STRATUS_RETRY_INTERVAL)):
                        self._stratus_retry()

                    self.weekly_reporter.check_and_send()
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
