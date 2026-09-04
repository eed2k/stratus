"""A common shape for numerical-weather-prediction backgrounds.

WHY THERE IS AN ABSTRACTION HERE AT ALL

  The forecast engine works from station history: a harmonic climatology, a
  damped anomaly and an analog ensemble. That gives a genuinely site-specific
  answer, because it is built from the site's own record. What it cannot do is
  know that a cold front arrives on Thursday. Nothing in a station's past tells
  it what the atmosphere is about to do.

  A mesoscale model does know that, and knows it on a 3 to 13 km grid. What it
  does not know is that this particular sensor sits in a hollow that pools cold
  air, or behind a treeline that halves the wind. That is the part the station
  record has.

  So the two are complements, not competitors, and the useful arrangement is
  the classic one: the model supplies the background, the station history
  supplies the correction. Everything in this package exists to deliver the
  background in one predictable shape, so the engine never learns which
  provider it came from.

CANONICAL UNITS

  Matched to engine.VARIABLE_RULES, so a provider adapter is the only place a
  unit conversion is allowed to happen:

    temperature       degrees C
    dew_point         degrees C
    humidity          percent, 0-100
    pressure          hPa, STATION pressure, not reduced to sea level
    wind_speed        km/h
    wind_gust         km/h
    wind_direction    degrees, 0-360, direction the wind comes FROM
    solar_radiation   W/m2
    rainfall          mm

  The pressure convention is worth stating plainly because it is the easiest
  way to inject a large silent bias. Most APIs return a sea-level-reduced
  pressure by default. At Potchefstroom, 1350 m up, the reduced value is about
  1018 hPa while the station barometer reads about 875 hPa. Blending a 1018
  background against an 875 observation would hand the bias-correction term a
  143 hPa offset to chew on, and it would look like a broken sensor rather than
  a units mistake. Adapters MUST return station pressure.
"""
from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime

# The variables a background may supply. A provider is free to return a subset;
# the engine simply keeps station-history-only behavior for whatever is absent.
CANONICAL_VARIABLES = (
    "temperature",
    "dew_point",
    "humidity",
    "pressure",
    "wind_speed",
    "wind_gust",
    "wind_direction",
    "solar_radiation",
    "rainfall",
)


@dataclass
class NwpPoint:
    """One valid time from a model, in canonical units."""

    valid_at: datetime
    values: dict[str, float] = field(default_factory=dict)

    def get(self, variable: str):
        return self.values.get(variable)


@dataclass
class NwpForecast:
    """A model's time series for one point on the ground.

    `resolution_km` is carried through to the UI on purpose. A 13 km background
    and a 3 km background deserve different confidence language, and a reader
    who is told "3 km convection-permitting" understands something different
    from "13 km, convection parameterised". Hiding it would overstate the 13 km
    case and undersell the 3 km one.
    """

    provider: str
    issued_at: datetime | None
    points: list[NwpPoint] = field(default_factory=list)
    resolution_km: float | None = None
    # Free text shown in the "how was this made" panel.
    notes: str = ""
    # True when served from cache rather than a fresh call, so the access
    # budget can be reasoned about.
    from_cache: bool = False

    def variables(self) -> set[str]:
        out: set[str] = set()
        for p in self.points:
            out |= set(p.values)
        return out

    def at(self, when: datetime) -> NwpPoint | None:
        """Nearest point to `when`, or None if the series does not cover it.

        Nearest rather than interpolated: the caller asks on the hour and model
        output is hourly or 3-hourly, so interpolation would invent precision
        the model does not have. Anything further than 90 minutes away is
        treated as not covered rather than stretched to fit.
        """
        if not self.points:
            return None
        best = min(self.points,
                   key=lambda p: abs((p.valid_at - when).total_seconds()))
        if abs((best.valid_at - when).total_seconds()) > 90 * 60:
            return None
        return best


class NwpProvider(abc.ABC):
    """One source of background forecasts.

    Implementations must be side-effect free apart from their own cache, and
    must never raise into the engine: a provider that is down has to degrade to
    None so the station-history forecast still renders. A forecast page that
    500s because a third party is unreachable is worse than a forecast page
    that quietly says it is running on station history alone.
    """

    #: Short stable identifier stored in config and shown in the UI.
    name: str = "base"
    #: Human-readable label.
    label: str = "Base provider"
    #: Nominal grid spacing, for the confidence language described above.
    resolution_km: float | None = None

    @abc.abstractmethod
    def available(self) -> bool:
        """True when this provider is configured well enough to be called."""

    @abc.abstractmethod
    def fetch(self, lat: float, lon: float,
              hours: int = 72) -> NwpForecast | None:
        """Background series for a point, or None if unavailable.

        Must not raise.
        """

    def describe(self) -> dict:
        return {
            "name": self.name,
            "label": self.label,
            "resolution_km": self.resolution_km,
            "available": self.available(),
        }
