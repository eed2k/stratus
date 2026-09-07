#!/usr/bin/env python3
# =========================================================================
#
#  Stratus AS3935 Lightning Detection System
#  Sends one heartbeat on demand instead of waiting for the scheduled one.
#
#  Property of METRON (PTY) LTD | Inteltronics
#  Developed by L.J. Esterhuizen, Inteltronics
#
# =========================================================================
"""Send one heartbeat to the admin panel now, and show exactly what happened.

The detector only posts a panel heartbeat every HEARTBEAT_WEBHOOK_INTERVAL
seconds (3600 by default), so after a config change you would otherwise wait up
to an hour to find out whether it works. This sends one immediately using the
same config file, the same URL derivation and the same token as the detector, so
a success here means the real heartbeat will succeed too.

Run on the Pi:

    python3 send_test_heartbeat.py

Useful options:

    python3 send_test_heartbeat.py --dry-run       show what would be sent
    python3 send_test_heartbeat.py --station GWLD1 override the station id
    python3 send_test_heartbeat.py --verbose       include the request headers

A heartbeat is pure telemetry. The panel's /heartbeat handler records liveness
and a CPU sample; it never dispatches an alert, so this cannot send an SMS.

Stdlib only, matching the detector, so there is nothing to install.
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "lightning_config.json"
SAST = timezone(timedelta(hours=2))


def read_config(path: Path) -> dict:
    if not path.is_file():
        sys.exit(f"Config not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        sys.exit(f"Config is not valid JSON: {exc}")


def heartbeat_url(alert_url: str) -> str:
    """Swap the last path segment, exactly as the detector's _heartbeat_url does.

    https://panel/gwld1/api/v1/lightning -> https://panel/gwld1/api/v1/heartbeat
    """
    base = (alert_url or "").strip()
    if not base:
        return ""
    return base.rsplit("/", 1)[0] + "/heartbeat"


def cpu_temp_c() -> float | None:
    for p in ("/sys/class/thermal/thermal_zone0/temp",):
        try:
            raw = Path(p).read_text().strip()
            return round(int(raw) / 1000.0, 1)
        except Exception:
            continue
    return None


def uptime_s() -> float | None:
    try:
        return round(float(Path("/proc/uptime").read_text().split()[0]), 1)
    except Exception:
        return None


def cpu_load_pct() -> float | None:
    try:
        n = os.cpu_count() or 1
        return round((os.getloadavg()[0] / n) * 100.0, 1)
    except Exception:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("--station", default=None, help="override station_id")
    ap.add_argument("--url", default=None, help="override the heartbeat URL")
    ap.add_argument("--timeout", type=float, default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    cfg = read_config(args.config)

    station = args.station or cfg.get("station_id") or "UNKNOWN"
    token = (cfg.get("alert_webhook_token") or "").strip()
    url = args.url or heartbeat_url(cfg.get("alert_webhook_url", ""))
    timeout = args.timeout or float(cfg.get("alert_webhook_timeout", 5) or 5)
    enabled = bool(cfg.get("alert_webhook_enabled", False))

    print("=" * 68)
    print("Panel heartbeat self-test")
    print("=" * 68)
    print(f"  config          {args.config}")
    print(f"  station_id      {station!r}")
    print(f"  webhook enabled {enabled}")
    print(f"  alert url       {cfg.get('alert_webhook_url','') or '<unset>'}")
    print(f"  heartbeat url   {url or '<could not derive>'}")
    print(f"  token           {len(token)} chars {'(set)' if token else '(MISSING)'}")
    print(f"  timeout         {timeout}s")
    print()

    problems = []
    if not enabled:
        problems.append("alert_webhook_enabled is false, so the detector will "
                        "not post heartbeats at all")
    if not url:
        problems.append("could not derive a heartbeat URL from alert_webhook_url")
    if not token:
        problems.append("alert_webhook_token is empty; the panel will answer 401")
    if problems:
        print("Configuration problems:")
        for p in problems:
            print(f"  - {p}")
        print()
        if not url or not token:
            return 2

    payload = {
        "station_id": station,
        "timestamp": datetime.now(SAST).strftime("%Y-%m-%dT%H:%M:%S%z"),
        "cpu_temp_c": cpu_temp_c(),
        "uptime_s": uptime_s(),
        "noise_floor": cfg.get("noise_floor"),
        "strikes_today": 0,
        "cpu_load_pct": cpu_load_pct(),
    }
    # The panel rejects unknown nulls politely, but sending only real readings
    # keeps the stored sample honest.
    payload = {k: v for k, v in payload.items() if v is not None}

    print("Payload:")
    print(json.dumps(payload, indent=2))
    print()

    if args.dry_run:
        print("--dry-run: nothing was sent.")
        return 0

    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Auth-Token", token)
    if args.verbose:
        print("Headers: Content-Type: application/json, "
              f"X-Auth-Token: {token[:6]}...{token[-4:]}")
        print()

    print(f"POST {url}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode(errors="replace")
            print(f"  HTTP {resp.status}")
            print(f"  {text}")
            if 200 <= resp.status < 300:
                print()
                print("SUCCESS. The panel accepted the heartbeat.")
                print(f"It now appears under Stations as {station!r}, with the")
                print("last-seen time and CPU temperature just sent.")
                print()
                print("  https://adminpanel.stratusweather.co.za/gwld1/stations")
                return 0
            print()
            print("The request completed but the status was not 2xx.")
            return 1
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        print(f"  HTTP {e.code}")
        print(f"  {detail}")
        print()
        if e.code == 401:
            print("401 means the token was rejected. alert_webhook_token in")
            print("the config must match ALERT_WEBHOOK_TOKEN on the panel.")
        elif e.code == 404:
            print("404 means the URL path is wrong. It should end in")
            print("/api/v1/heartbeat and include the client slug, e.g.")
            print("https://adminpanel.stratusweather.co.za/gwld1/api/v1/heartbeat")
        elif e.code == 422:
            print("422 means the payload failed validation. Check station_id is")
            print("1-64 characters and the numeric fields are numbers.")
        return 1
    except urllib.error.URLError as e:
        print(f"  network error: {e.reason}")
        print()
        print("The panel was not reachable. Check DNS and connectivity:")
        print("  ping -c1 adminpanel.stratusweather.co.za")
        print("  curl -sS https://adminpanel.stratusweather.co.za/api/v1/health")
        return 1
    except socket.timeout:
        print(f"  timed out after {timeout}s")
        return 1


if __name__ == "__main__":
    sys.exit(main())
