#!/usr/bin/env python3
"""Lightning beacon: three 12 V indicator lamps driven from the admin panel.

Runs on a Raspberry Pi Zero W or Zero 2 W with a relay HAT.

    GREEN   detector is reporting in
    RED     detector is not reporting in, or the panel cannot be reached
    ORANGE  flickers for a fixed burst when a new strike lands inside the
            configured alert distance

Polls GET /api/v1/beacon/state on the panel over outbound HTTPS. Nothing needs to
reach the Pi, so it sits behind NAT with no port forwarding and no inbound rules.

TWO DESIGN DECISIONS WORTH READING
----------------------------------

1. It fails to RED, never to GREEN.

   If the panel is unreachable we do not know whether the detector is alive.
   Showing green would assert something we cannot support, and on a lamp whose
   whole purpose is to say "the lightning warning system is working" a false
   green is the one failure that actually endangers somebody. Unknown is
   therefore treated as not-online: red on, green off. Set BEACON_FAIL_STATE=dark
   if you would rather show nothing at all, which is at least honestly ambiguous.
   There is deliberately no option to fail to green.

2. The orange burst fires on a NEW strike, not for the whole alert window.

   The endpoint's `lightning_active` flag stays true for the panel's all-clear
   window (30 minutes by default), which is the right semantics for "conditions
   are dangerous" but would leave a lamp flickering for half an hour. So this
   derives each strike's absolute timestamp from `server_time - last_strike_age_s`
   and fires one burst per newly seen timestamp. A further strike during a burst
   restarts it, so continuous activity keeps the lamp going without the bursts
   overlapping or drifting.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

LOG = logging.getLogger("beacon")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _env_int(name: str, default: int, lo: int, hi: int) -> int:
    """Read an int from the environment, clamped to a sane range.

    Clamped rather than rejected: a typo in a unit file should not stop the
    lamps from working, and an out-of-range poll interval is recoverable in a
    way that a crash loop is not.
    """
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(float(raw))
    except ValueError:
        LOG.warning("%s=%r is not a number, using %s", name, raw, default)
        return default
    if value < lo or value > hi:
        LOG.warning("%s=%s out of range %s..%s, clamping", name, value, lo, hi)
    return max(lo, min(hi, value))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")


class Config:
    def __init__(self) -> None:
        self.base_url = os.environ.get(
            "BEACON_PANEL_URL", "https://adminpanel.stratusweather.co.za"
        ).rstrip("/")
        self.token = os.environ.get("BEACON_TOKEN", "")
        # Naming the station scopes the reply to that detector's client. Leaving
        # it blank answers across every unit, which is only correct while a
        # single client is live.
        self.station_id = os.environ.get("BEACON_STATION_ID", "").strip()

        self.poll_s = _env_int("BEACON_POLL_SECONDS", 10, 2, 600)
        self.timeout_s = _env_int("BEACON_HTTP_TIMEOUT", 10, 2, 60)

        # Orange burst: flicker period and total duration.
        self.flicker_period_s = _env_int("BEACON_FLICKER_PERIOD", 1, 1, 30)
        self.flicker_duration_s = _env_int("BEACON_FLICKER_SECONDS", 10, 1, 600)

        # Relay HAT wiring. BCM numbering.
        self.pin_green = _env_int("BEACON_PIN_GREEN", 17, 0, 27)
        self.pin_red = _env_int("BEACON_PIN_RED", 27, 0, 27)
        self.pin_orange = _env_int("BEACON_PIN_ORANGE", 22, 0, 27)
        # Most opto-isolated relay HATs energise on a LOW output.
        self.active_low = _env_bool("BEACON_RELAY_ACTIVE_LOW", True)

        # What to show when the panel cannot be reached: "red" or "dark".
        state = os.environ.get("BEACON_FAIL_STATE", "red").strip().lower()
        self.fail_state = state if state in ("red", "dark") else "red"

        # Dry run drives no GPIO at all, so the poller can be tested on a laptop.
        self.dry_run = _env_bool("BEACON_DRY_RUN", False)

    def describe(self) -> str:
        return (
            f"panel={self.base_url} station={self.station_id or '(all)'} "
            f"poll={self.poll_s}s timeout={self.timeout_s}s "
            f"flicker={self.flicker_duration_s}s/{self.flicker_period_s}s "
            f"pins green={self.pin_green} red={self.pin_red} "
            f"orange={self.pin_orange} active_low={self.active_low} "
            f"fail={self.fail_state} dry_run={self.dry_run} "
            f"token={'set' if self.token else 'MISSING'}"
        )


# ---------------------------------------------------------------------------
# Lamps
# ---------------------------------------------------------------------------

class Lamps:
    """The three relay outputs.

    gpiozero is used rather than RPi.GPIO because it picks a working pin factory
    on both older Pi OS and Bookworm, where RPi.GPIO no longer works on all
    kernels. In dry-run mode nothing is imported, so this module can be
    exercised off-Pi.
    """

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self._devices: dict[str, object] = {}
        self._state = {"green": False, "red": False, "orange": False}

        if cfg.dry_run:
            LOG.info("dry run: no GPIO will be touched")
            return

        from gpiozero import DigitalOutputDevice  # noqa: WPS433 (optional dep)

        for name, pin in (("green", cfg.pin_green), ("red", cfg.pin_red),
                          ("orange", cfg.pin_orange)):
            # active_high mirrors the relay board's polarity; initial_value=False
            # means "lamp off" whichever way round that is, so no lamp flashes
            # during start-up.
            self._devices[name] = DigitalOutputDevice(
                pin, active_high=not cfg.active_low, initial_value=False
            )

    def set(self, name: str, on: bool) -> None:
        if self._state.get(name) == on:
            return                          # avoid pointless relay chatter
        self._state[name] = on
        dev = self._devices.get(name)
        if dev is not None:
            if on:
                dev.on()
            else:
                dev.off()
        LOG.debug("lamp %s -> %s", name, "ON" if on else "off")

    def all_off(self) -> None:
        for name in ("green", "red", "orange"):
            self.set(name, False)

    def close(self) -> None:
        """Park every lamp off and release the pins.

        Leaving a lamp lit after the service stops would keep asserting a status
        nothing is maintaining any more, which is worse than showing nothing.
        """
        try:
            self.all_off()
        finally:
            for dev in self._devices.values():
                try:
                    dev.close()             # type: ignore[attr-defined]
                except Exception:           # noqa: BLE001 - shutdown must not raise
                    pass


# ---------------------------------------------------------------------------
# Panel client
# ---------------------------------------------------------------------------

class PanelError(Exception):
    """The panel could not be reached, or answered with something unusable."""


def fetch_state(cfg: Config) -> dict:
    query = {}
    if cfg.station_id:
        query["station_id"] = cfg.station_id
    url = f"{cfg.base_url}/api/v1/beacon/state"
    if query:
        url += "?" + urllib.parse.urlencode(query)

    req = urllib.request.Request(url, method="GET")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "stratus-beacon/1.0")
    if cfg.token:
        req.add_header("X-Auth-Token", cfg.token)

    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
            if resp.status != 200:
                raise PanelError(f"HTTP {resp.status}")
            body = resp.read()
    except urllib.error.HTTPError as exc:
        # 401 is worth naming explicitly: it is the single most likely setup
        # mistake and it looks identical to an outage on the lamps.
        if exc.code == 401:
            raise PanelError("HTTP 401: X-Auth-Token rejected") from exc
        raise PanelError(f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PanelError(f"unreachable: {exc}") from exc

    try:
        data = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PanelError(f"bad JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise PanelError("expected a JSON object")
    return data


def strike_key(state: dict):
    """A stable identity for the most recent in-range strike, or None.

    Derived as server_time minus last_strike_age_s. The age alone is useless as
    an identity because it changes on every poll, and two separate strikes can
    easily share a distance and an energy. The derived absolute second does not
    move once a strike is in the past, which is exactly the property needed to
    fire one burst per strike.
    """
    age = state.get("last_strike_age_s")
    if age is None:
        return None
    try:
        age = float(age)
    except (TypeError, ValueError):
        return None

    raw = state.get("server_time")
    if not raw:
        return None
    try:
        # fromisoformat handles the panel's "+02:00" offset.
        served = datetime.fromisoformat(str(raw))
    except ValueError:
        return None
    return int(served.timestamp() - age)


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

class Beacon:
    def __init__(self, cfg: Config, lamps: Lamps) -> None:
        self.cfg = cfg
        self.lamps = lamps
        self.running = True
        self.seen_strike = None            # last strike we already reacted to
        self.flicker_until = 0.0           # monotonic deadline for the burst
        self.consecutive_failures = 0

    def stop(self, *_args) -> None:
        LOG.info("stopping")
        self.running = False

    # -- lamp policy --------------------------------------------------------

    def apply_online(self, online: bool | None) -> None:
        """Green when known online, red when known offline or unknown."""
        if online is True:
            self.lamps.set("green", True)
            self.lamps.set("red", False)
        elif online is False:
            self.lamps.set("green", False)
            self.lamps.set("red", True)
        else:
            # Unknown. Never green: see the module docstring.
            self.lamps.set("green", False)
            self.lamps.set("red", self.cfg.fail_state == "red")

    def service_flicker(self, now: float) -> None:
        """Drive the orange lamp. Non-blocking, so polling continues during a
        burst and green/red stay live."""
        if now >= self.flicker_until:
            self.lamps.set("orange", False)
            return
        # Square wave, phased from the START of the burst rather than the end.
        # Counting down from the deadline made the first period depend on whether
        # the duration was an even multiple of the period, so an odd duration
        # began the burst dark. Counting up always begins lit.
        elapsed = self.cfg.flicker_duration_s - (self.flicker_until - now)
        phase = int(elapsed // self.cfg.flicker_period_s)
        self.lamps.set("orange", phase % 2 == 0)

    def arm_flicker(self, now: float, km, key: int) -> None:
        restart = now < self.flicker_until
        self.flicker_until = now + self.cfg.flicker_duration_s
        LOG.info("strike inside alert distance at %s km (%s) -> orange %ss%s",
                 km if km is not None else "?", key,
                 self.cfg.flicker_duration_s,
                 " (burst restarted)" if restart else "")

    # -- one cycle ----------------------------------------------------------

    def poll_once(self) -> None:
        now = time.monotonic()
        try:
            state = fetch_state(self.cfg)
        except PanelError as exc:
            self.consecutive_failures += 1
            # Log the first failure at warning, then back off to avoid filling
            # the journal during a long outage.
            if self.consecutive_failures == 1 or self.consecutive_failures % 30 == 0:
                LOG.warning("panel unreachable (%s consecutive): %s",
                            self.consecutive_failures, exc)
            self.apply_online(None)
            self.service_flicker(now)
            return

        if self.consecutive_failures:
            LOG.info("panel reachable again after %s failed attempt(s)",
                     self.consecutive_failures)
            self.consecutive_failures = 0

        online = state.get("unit_online")
        self.apply_online(bool(online) if online is not None else None)

        # The endpoint only reports strikes already filtered to the configured
        # alert radius, so any strike that appears here qualifies.
        key = strike_key(state)
        if key is not None and key != self.seen_strike:
            first_run = self.seen_strike is None
            self.seen_strike = key
            age = state.get("last_strike_age_s")
            if first_run and isinstance(age, (int, float)) \
                    and age > self.cfg.flicker_duration_s:
                # Do not fire a burst for a strike that happened before we
                # started: on a reboot mid-storm that would announce old news
                # as if it were new.
                LOG.info("ignoring pre-existing strike from %ss ago on start-up",
                         int(age))
            else:
                self.arm_flicker(now, state.get("last_strike_km"), key)

        self.service_flicker(now)

        if not state.get("alerts_enabled", True):
            LOG.debug("note: SMS alerts are off on the panel; lamps still work")

    def run(self) -> int:
        LOG.info("beacon starting: %s", self.cfg.describe())
        if not self.cfg.token:
            # Not fatal: the panel leaves ingest open when no token is set. But
            # on a configured panel this guarantees 401s, so say so loudly.
            LOG.warning("BEACON_TOKEN is empty. If the panel has "
                        "ALERT_WEBHOOK_TOKEN set, every poll will get HTTP 401.")

        # Show the fail state immediately: an unlit beacon at boot is
        # indistinguishable from a dead one.
        self.apply_online(None)

        next_poll = 0.0
        while self.running:
            now = time.monotonic()
            if now >= next_poll:
                self.poll_once()
                next_poll = time.monotonic() + self.cfg.poll_s
            else:
                # Tick often enough to run the flicker smoothly between polls.
                self.service_flicker(now)
            time.sleep(0.1)

        self.lamps.close()
        LOG.info("stopped, lamps off")
        return 0


def main() -> int:
    logging.basicConfig(
        level=logging.DEBUG if _env_bool("BEACON_DEBUG", False) else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )
    cfg = Config()
    try:
        lamps = Lamps(cfg)
    except Exception as exc:                # noqa: BLE001
        LOG.error("could not open the relay outputs: %s", exc)
        LOG.error("On Pi OS install gpiozero and a backend: "
                  "sudo apt install -y python3-gpiozero python3-lgpio")
        return 1

    beacon = Beacon(cfg, lamps)
    signal.signal(signal.SIGTERM, beacon.stop)
    signal.signal(signal.SIGINT, beacon.stop)
    try:
        return beacon.run()
    except Exception:                       # noqa: BLE001
        # Park the lamps before dying, then let systemd restart us. A crash must
        # not leave green lit with nothing behind it.
        LOG.exception("unhandled error")
        lamps.close()
        return 1


if __name__ == "__main__":
    sys.exit(main())
