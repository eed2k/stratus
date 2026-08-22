#!/usr/bin/env python3
# ===========================================================================
#  Stratus Lightning Detection System - Secondary Beacon Controller
#  Developed by L.J. Esterhuizen, Inteltronics
# ===========================================================================
#  Runs on a secondary Pi (with a relay HAT) at the client site. It polls the
#  cloud panel's /api/v1/beacon/state endpoint over outbound HTTPS and drives
#  three relay channels:
#
#    CH1 (SPDT)  GREEN = detector ONLINE / RED = OFFLINE (fail-safe)
#    CH2         AMBER lamp  - flashes at 1 Hz for 25 s on a close strike
#    CH3         BUZZER      - sounds for 5 s at the start of that sequence
#
#  ALARM SEQUENCE
#  --------------
#  When the cloud reports a fresh strike within the alarm radius (<= 10 km),
#  and we are not inside the 1-hour cool-down, the beacon runs a one-shot
#  sequence: amber flickers once per second for 25 s and the buzzer rings for
#  the first 5 s. Further strikes in the next hour do not re-trigger it.
#
#  FAIL-SAFE DESIGN
#  ----------------
#  CH1 is wired as a change-over (SPDT):  COM->12V+ , NO->GREEN , NC->RED.
#  The relay is energised ONLY while the cloud confirms the unit online, so a
#  power loss, crash, or loss of cloud contact drops it to RED automatically.
#  A dead beacon can never falsely show GREEN.
# ===========================================================================

import json
import os
import signal
import sys
import time
import logging
import urllib.request
import urllib.error

try:
    import RPi.GPIO as GPIO
except ImportError:
    print("RPi.GPIO not available. Install: sudo apt install python3-rpi.gpio")
    sys.exit(1)


# ---------------------------------------------------------------------------
#  Configuration (overridable via beacon_config.json next to this file)
# ---------------------------------------------------------------------------
DEFAULTS = {
    # The panel moved off its own VPS (gwld1-admin.dynv6.net no longer resolves
    # to a live host) and now runs alongside Stratus. The /gwld1 segment selects
    # this client's panel; the tenant middleware strips it before routing, so the
    # endpoint path itself is unchanged.
    "state_url":        "https://adminpanel.stratusweather.co.za/gwld1/api/v1/beacon/state",
    "auth_token":       "",          # same shared secret as the detector webhook
    "poll_interval_s":  4,           # how often to query the cloud
    "fail_timeout_s":   30,          # no successful poll for this long => OFFLINE
    "http_timeout_s":   8,           # per-request timeout
    "loop_period_s":    0.1,         # main loop tick (drives flashing/timing)

    # Relay board
    "relay_active_high": True,       # True: GPIO HIGH energises relay (Waveshare)
    "gpio_online":      26,          # CH1 - SPDT: NO=green, NC=red
    "gpio_amber":       20,          # CH2 - amber lamp
    "gpio_buzzer":      21,          # CH3 - 12V buzzer

    # Alarm sequence (on a close strike)
    "lightning_fresh_window_s": 120, # only fire if the strike is this fresh
    "lightning_cooldown_s":     3600,# 1-hour cool-down between alarm sequences
    "amber_seconds":    25,          # amber flicker duration
    "amber_flash_hz":   1,           # 1 = once per second
    "buzzer_seconds":   5,           # buzzer ring duration
}

HERE = os.path.dirname(os.path.abspath(__file__))


def load_config():
    cfg = dict(DEFAULTS)
    path = os.path.join(HERE, "beacon_config.json")
    try:
        with open(path) as f:
            cfg.update(json.load(f))
    except FileNotFoundError:
        pass
    except (json.JSONDecodeError, IOError) as e:
        logging.warning("config load failed (%s); using defaults", e)
    return cfg


# ---------------------------------------------------------------------------
#  Relay control
# ---------------------------------------------------------------------------
class Relays:
    def __init__(self, cfg):
        self.active_high = bool(cfg["relay_active_high"])
        self.pin_online = int(cfg["gpio_online"])
        self.pin_amber = int(cfg["gpio_amber"])
        self.pin_buzzer = int(cfg["gpio_buzzer"])
        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        # All relays start de-energised -> fail-safe RED, no amber, no buzzer
        for pin in (self.pin_online, self.pin_amber, self.pin_buzzer):
            GPIO.setup(pin, GPIO.OUT, initial=self._level(False))

    def _level(self, energised):
        on = GPIO.HIGH if self.active_high else GPIO.LOW
        off = GPIO.LOW if self.active_high else GPIO.HIGH
        return on if energised else off

    def set(self, pin, energised):
        GPIO.output(pin, self._level(bool(energised)))

    def set_online(self, e):  self.set(self.pin_online, e)
    def set_amber(self, e):   self.set(self.pin_amber, e)
    def set_buzzer(self, e):  self.set(self.pin_buzzer, e)

    def cleanup(self):
        try:
            self.set_online(False)   # -> RED
            self.set_amber(False)
            self.set_buzzer(False)
            GPIO.cleanup()
        except Exception:
            pass


# ---------------------------------------------------------------------------
#  Cloud polling
# ---------------------------------------------------------------------------
def fetch_state(cfg):
    """Return the parsed state dict, or None on a non-2xx response."""
    req = urllib.request.Request(cfg["state_url"], method="GET")
    if cfg.get("auth_token"):
        req.add_header("X-Auth-Token", cfg["auth_token"])
    with urllib.request.urlopen(req, timeout=cfg["http_timeout_s"]) as resp:
        if 200 <= resp.status < 300:
            return json.loads(resp.read().decode("utf-8"))
    return None


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------
_running = True


def _stop(signum, frame):
    global _running
    _running = False


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        stream=sys.stdout,
    )
    log = logging.getLogger("beacon")
    cfg = load_config()
    relays = Relays(cfg)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    half_period = 1.0 / (2.0 * max(0.1, float(cfg["amber_flash_hz"])))

    last_poll = 0.0
    last_success = 0.0
    started = time.monotonic()
    online = False

    # Alarm-sequence state (monotonic deadlines)
    amber_until = 0.0
    buzzer_until = 0.0
    cooldown_until = 0.0
    flash_on = False
    last_flash = 0.0

    log.info("Beacon started. Poll %s every %ss. Alarm: amber %ss @ %sHz + "
             "buzzer %ss on strike <= radius, %ss cool-down. Fail-safe OFFLINE "
             "after %ss.",
             cfg["state_url"], cfg["poll_interval_s"], cfg["amber_seconds"],
             cfg["amber_flash_hz"], cfg["buzzer_seconds"],
             cfg["lightning_cooldown_s"], cfg["fail_timeout_s"])

    try:
        while _running:
            now = time.monotonic()

            # ---- Poll the cloud on schedule ----
            if now - last_poll >= cfg["poll_interval_s"]:
                last_poll = now
                try:
                    state = fetch_state(cfg)
                    if state is not None:
                        last_success = now
                        online = bool(state.get("unit_online"))
                        age = state.get("last_strike_age_s")
                        km = state.get("last_strike_km")

                        # Fire the alarm sequence on a fresh close strike,
                        # unless we are still inside the cool-down.
                        if (age is not None
                                and age <= cfg["lightning_fresh_window_s"]
                                and now >= cooldown_until):
                            amber_until = now + cfg["amber_seconds"]
                            buzzer_until = now + cfg["buzzer_seconds"]
                            cooldown_until = now + cfg["lightning_cooldown_s"]
                            log.warning("CLOSE STRIKE %s km (%ss ago) -> alarm: "
                                        "amber %ss + buzzer %ss; cool-down %ss",
                                        km, age, cfg["amber_seconds"],
                                        cfg["buzzer_seconds"],
                                        cfg["lightning_cooldown_s"])
                        else:
                            log.info("state: online=%s last_strike=%s km age=%ss",
                                     online, km, age)
                except (urllib.error.URLError, urllib.error.HTTPError,
                        TimeoutError, OSError, ValueError) as e:
                    log.warning("poll failed: %s", e)

            # ---- Fail-safe: no successful contact for too long => OFFLINE ----
            stale = (now - last_success > cfg["fail_timeout_s"]
                     if last_success > 0.0
                     else now - started > cfg["fail_timeout_s"])

            # ---- CH1: GREEN when online, else RED (also on stale) ----
            relays.set_online(online and not stale)

            # ---- CH2: amber flicker during the sequence (suppressed if stale) ----
            if now < amber_until and not stale:
                if now - last_flash >= half_period:
                    last_flash = now
                    flash_on = not flash_on
                relays.set_amber(flash_on)
            else:
                flash_on = False
                relays.set_amber(False)

            # ---- CH3: buzzer during its (shorter) window ----
            relays.set_buzzer(now < buzzer_until and not stale)

            time.sleep(cfg["loop_period_s"])
    finally:
        relays.cleanup()
        log.info("Beacon stopped; relays de-energised (RED, amber/buzzer off).")


if __name__ == "__main__":
    main()
