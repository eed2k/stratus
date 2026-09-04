"""Numerical-weather-prediction backgrounds for the nano-climate forecast.

The engine forecasts from station history by default. A provider in here can
supply a model background that the station history then corrects, which is what
lets the forecast know about weather that has not happened at the site before.

See base.py for why the split exists and what the canonical units are.

Only Vaisala Xweather ships. The abstraction is kept deliberately thin so
another source can be added as one file plus one registry entry, without the
engine or the interface changing.
"""
from .base import CANONICAL_VARIABLES, NwpForecast, NwpPoint, NwpProvider
from .registry import (ALL_PROVIDER_NAMES, StationNwpConfig, build_providers,
                       describe_providers, fetch_background,
                       restrict_to_opted_in)
from .xweather import XweatherProvider

__all__ = [
    "CANONICAL_VARIABLES",
    "NwpForecast",
    "NwpPoint",
    "NwpProvider",
    "ALL_PROVIDER_NAMES",
    "StationNwpConfig",
    "build_providers",
    "describe_providers",
    "fetch_background",
    "restrict_to_opted_in",
    "XweatherProvider",
]
