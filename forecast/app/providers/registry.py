"""Provider selection, and the operator's opt-in.

THE DEFAULT IS STATION HISTORY ONLY

  Nothing here changes that. A background is used for a station only when an
  operator has turned a provider on for that station, and only for the
  variables they picked. That is the shape the admin panel already uses for
  data feeds: the operator chooses whether data is fed in, and which data.

  There are three reasons the opt-in is per variable and not just per station:

    Cost      every call spends the operator's access budget.
    Trust     a model background helps temperature and pressure a great deal,
              helps wind less, and for a sheltered site can actively hurt wind.
              Forcing all-or-nothing would push someone to switch the whole
              thing off because one variable looked wrong.
    Honesty   the page states which variables are model-backed. That is only
              meaningful if it can differ per variable.

PRECEDENCE

  Highest resolution that is actually available wins, because a 3 km
  convection-permitting nest over the Highveld is a better background than a
  fused global product for the things our clients care about. A provider that
  reports no resolution sorts last on that criterion but is still used when it
  is the only one configured.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .base import CANONICAL_VARIABLES, NwpForecast, NwpProvider
from .xweather import XweatherProvider


@dataclass
class StationNwpConfig:
    """What an operator has switched on for one station."""

    enabled: bool = False
    #: Provider names in preferred order. Empty means "any available".
    providers: list[str] = field(default_factory=list)
    #: Canonical variable names the background may inform. Empty means none,
    #: not all: an explicit choice is required before any call is made.
    variables: list[str] = field(default_factory=list)

    def allows(self, variable: str) -> bool:
        return self.enabled and variable in self.variables

    def sanitized(self) -> "StationNwpConfig":
        """Drop anything unrecognized rather than trusting stored config."""
        return StationNwpConfig(
            enabled=bool(self.enabled),
            providers=[p for p in self.providers if p in ALL_PROVIDER_NAMES],
            variables=[v for v in self.variables
                       if v in CANONICAL_VARIABLES])


def build_providers() -> list[NwpProvider]:
    """All known providers, configured from the environment."""
    return [XweatherProvider()]


ALL_PROVIDER_NAMES = ("xweather",)


def describe_providers() -> list[dict]:
    """For the admin screen: what exists and what is usable right now."""
    out = []
    for p in build_providers():
        d = p.describe()
        d["last_error"] = getattr(p, "last_error", None)
        out.append(d)
    return out


def _sort_key(res: float | None) -> float:
    # None sorts last. Smaller grid spacing sorts first.
    return float("inf") if res is None else res


def fetch_background(lat: float, lon: float,
                     config: StationNwpConfig,
                     hours: int = 72) -> NwpForecast | None:
    """The best available background for a station, or None.

    Returns None whenever the operator has not opted in, no provider is
    configured, or every provider failed. None is a normal outcome, not an
    error: the engine simply stays on station history.
    """
    cfg = config.sanitized()
    if not cfg.enabled or not cfg.variables:
        return None

    providers = {p.name: p for p in build_providers()}
    order = cfg.providers or list(ALL_PROVIDER_NAMES)

    results: list[NwpForecast] = []
    for name in order:
        p = providers.get(name)
        if p is None or not p.available():
            continue
        fc = p.fetch(lat, lon, hours=hours)
        if fc is None or not fc.points:
            continue
        # A provider that returned nothing the operator asked for is not a
        # usable background, and should not displace one that did.
        if not (fc.variables() & set(cfg.variables)):
            continue
        results.append(fc)
        # An explicit preference order is an instruction, so stop at the first
        # hit. Without one, gather and pick on resolution below.
        if cfg.providers:
            break

    if not results:
        return None
    if cfg.providers:
        return results[0]

    resolved = getattr(providers.get(results[0].provider),
                       "resolution_for", None)
    for fc in results:
        prov = providers.get(fc.provider)
        rf = getattr(prov, "resolution_for", None)
        if fc.resolution_km is None and callable(rf):
            fc.resolution_km = rf(lat, lon)
    del resolved

    results.sort(key=lambda f: _sort_key(f.resolution_km))
    return results[0]


def restrict_to_opted_in(forecast: NwpForecast | None,
                         config: StationNwpConfig) -> NwpForecast | None:
    """Strip variables the operator did not opt into.

    Done here rather than trusted to callers, so a future caller cannot
    accidentally blend a model wind into a station the operator only enabled
    temperature for.
    """
    if forecast is None:
        return None
    cfg = config.sanitized()
    allowed = set(cfg.variables)
    for p in forecast.points:
        p.values = {k: v for k, v in p.values.items() if k in allowed}
    if not any(p.values for p in forecast.points):
        return None
    return forecast
