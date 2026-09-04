"""Vaisala Xweather as a background provider.

WHAT THIS IS AND IS NOT

  Xweather runs its own numerical weather prediction and fuses several sources
  behind an API. It is not a raw single-model feed, and Vaisala does not publish
  an effective grid spacing for the point forecast, so `resolution_km` is left
  as None rather than guessed. Saying "13 km" because that is a common global
  figure would be inventing a number and it would end up printed on the page
  next to a real one from WRF.

AUTHENTICATION

  Confirmed against the live service: the data endpoints want `client_id` and
  `client_secret` as separate query parameters. The combined `id_secret` single
  key is accepted only by Raster Maps and a few other services, so it is not
  used here.

  Also confirmed: an account-level "allowed domains" restriction does NOT stop
  a server-side call, because there is no Referer header to check. The
  restriction protects browser-embedded use such as Raster Maps. It is not a
  containment boundary for the secret, so the secret stays server-side and is
  never sent to the browser.

STATION PRESSURE, NOT SEA LEVEL

  `spressureMB` is used for pressure, not `pressureMB`. See the note in
  base.py: at 1350 m the two differ by about 143 hPa and picking the wrong one
  would look like a failed barometer.

THE ACCESS BUDGET IS REAL

  The developer tier allows 15,000 accesses a month across all services. One
  station refreshed hourly is about 720 a month, which is fine, but the same
  call made once per page view is not. Responses are therefore cached on disk
  per station per hour, and the cache is consulted before the network every
  time. `from_cache` is set so the UI can be honest about the age of what it is
  showing.
"""
from __future__ import annotations

import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .base import NwpForecast, NwpPoint, NwpProvider

# Both hosts authenticate. data.api.xweather.com is the current name;
# api.aerisapi.com is the pre-rebrand host and still answers. The current name
# is used and the legacy one kept as a fallback, because a rebrand is exactly
# the kind of thing that gets one of the two retired without much warning.
HOSTS = ("https://data.api.xweather.com", "https://api.aerisapi.com")

# Xweather field -> canonical name. Only fields confirmed present in a live
# /forecasts?filter=1hr response are mapped.
FIELD_MAP = {
    "tempC": "temperature",
    "dewpointC": "dew_point",
    "humidity": "humidity",
    "spressureMB": "pressure",          # station pressure, deliberately
    "windSpeedKPH": "wind_speed",
    "windGustKPH": "wind_gust",
    "windDirDEG": "wind_direction",
    "solradWM2": "solar_radiation",
    "precipMM": "rainfall",
}

# Extra fields worth carrying for the products layer even though the engine
# does not blend them. Kept separate so they cannot be mistaken for background
# variables the bias correction applies to.
EXTRA_FIELDS = (
    "pop", "sky", "cloudsCoded", "uvi", "visibilityKM",
    "wetBulbGlobeTempC", "solradClearSkyWM2", "feelslikeC",
    "windSpeed80mKPH", "windDir80mDEG",
)

CACHE_TTL_SECONDS = 55 * 60          # just under an hour
CTX = ssl.create_default_context()


class XweatherProvider(NwpProvider):
    name = "xweather"
    label = "Vaisala Xweather"
    # Vaisala does not publish an effective grid spacing for the point
    # forecast, so this stays None rather than being guessed.
    resolution_km = None

    def __init__(self, client_id: str | None = None,
                 client_secret: str | None = None,
                 cache_dir: str | Path | None = None,
                 timeout: int = 20):
        # `is not None` rather than `or`: an explicit empty string means "no
        # credentials", and must not silently fall back to the environment.
        # With `or`, a caller passing "" would pick up whatever happened to be
        # set in the process, which is the sort of thing that makes a test pass
        # on one machine and fail on another.
        self.client_id = (
            client_id if client_id is not None
            else os.environ.get("XWEATHER_CLIENT_ID", "")).strip()
        self.client_secret = (
            client_secret if client_secret is not None
            else os.environ.get("XWEATHER_CLIENT_SECRET", "")).strip()
        self.timeout = timeout
        self.cache_dir = Path(cache_dir or os.environ.get(
            "FORECAST_CACHE_DIR", "data/nwp-cache")) / self.name
        self.last_error: str | None = None

    # -- configuration ----------------------------------------------------

    def available(self) -> bool:
        """Configured, and switched on by the operator.

        Both halves matter. A key being present is not consent to spend the
        operator's access budget, so XWEATHER_ENABLED has to be set as well.
        """
        if not (self.client_id and self.client_secret):
            return False
        return os.environ.get("XWEATHER_ENABLED", "false").strip().lower() in (
            "1", "true", "yes", "on")

    # -- cache ------------------------------------------------------------

    def _cache_path(self, lat: float, lon: float) -> Path:
        # Rounded to about 100 m. Finer than the model resolution, coarse
        # enough that two stations on one farm share a cache entry.
        return self.cache_dir / f"{lat:.3f}_{lon:.3f}.json"

    def _read_cache(self, lat: float, lon: float) -> dict | None:
        p = self._cache_path(lat, lon)
        try:
            if not p.is_file():
                return None
            if time.time() - p.stat().st_mtime > CACHE_TTL_SECONDS:
                return None
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _write_cache(self, lat: float, lon: float, payload: dict) -> None:
        p = self._cache_path(lat, lon)
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(".tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            tmp.replace(p)
        except OSError:
            # A cache that cannot be written is a performance problem, not a
            # correctness one. Carry on.
            pass

    # -- fetch ------------------------------------------------------------

    def _call(self, lat: float, lon: float, hours: int) -> dict | None:
        query = urllib.parse.urlencode({
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "filter": "1hr",
            "limit": str(max(1, min(hours, 240))),
        })
        for host in HOSTS:
            url = f"{host}/forecasts/{lat},{lon}?{query}"
            try:
                req = urllib.request.Request(
                    url, headers={"User-Agent": "stratus-forecast/1.0"})
                with urllib.request.urlopen(
                        req, timeout=self.timeout, context=CTX) as r:
                    body = json.loads(r.read().decode("utf-8", "replace"))
            except (urllib.error.URLError, urllib.error.HTTPError,
                    ValueError, OSError, TimeoutError) as exc:
                self.last_error = f"{type(exc).__name__}: {exc}"
                continue
            if not body.get("success"):
                err = (body.get("error") or {})
                self.last_error = (f"{err.get('code', 'unknown')}: "
                                   f"{err.get('description', '')}")
                # An auth or quota failure will fail identically on the other
                # host, so do not spend a second access proving it.
                if str(err.get("code", "")).startswith(("auth_", "perm_",
                                                        "quota")):
                    return None
                continue
            self.last_error = None
            return body
        return None

    def fetch(self, lat: float, lon: float,
              hours: int = 72) -> NwpForecast | None:
        if not self.available():
            return None

        cached = self._read_cache(lat, lon)
        body, from_cache = (cached, True) if cached else (
            self._call(lat, lon, hours), False)
        if body is None:
            return None
        if not from_cache:
            self._write_cache(lat, lon, body)

        try:
            periods = body["response"][0]["periods"]
        except (KeyError, IndexError, TypeError):
            self.last_error = "unexpected response shape"
            return None

        points: list[NwpPoint] = []
        for p in periods:
            when = _parse_time(p)
            if when is None:
                continue
            values: dict[str, float] = {}
            for src, canon in FIELD_MAP.items():
                v = p.get(src)
                if isinstance(v, (int, float)):
                    values[canon] = float(v)
            extras = {k: p[k] for k in EXTRA_FIELDS
                      if isinstance(p.get(k), (int, float, str))}
            pt = NwpPoint(valid_at=when, values=values)
            # Attached rather than blended: the products layer reads these,
            # the bias correction must not.
            pt.extras = extras                       # type: ignore[attr-defined]
            points.append(pt)

        if not points:
            return None

        return NwpForecast(
            provider=self.name,
            issued_at=datetime.now(timezone.utc),
            points=points,
            resolution_km=self.resolution_km,
            notes=("Vaisala Xweather point forecast, hourly. Pressure is "
                   "station pressure. Multi-source fused prediction; Vaisala "
                   "does not publish an effective grid spacing."),
            from_cache=from_cache,
        )


def _parse_time(period: dict) -> datetime | None:
    """Valid time of a period, preferring the epoch to the formatted string."""
    ts = period.get("timestamp")
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    iso = period.get("dateTimeISO") or period.get("validTime")
    if isinstance(iso, str):
        try:
            return datetime.fromisoformat(iso)
        except ValueError:
            return None
    return None
