"""Turn a forecast into plain language.

WHY THIS EXISTS

  The forecast pages are built for someone who wants the detail: a variable
  selector, percentile bands, skill scores, reliability diagrams. That is the
  right tool for an operator checking whether the model is behaving, and the
  wrong one for a farm manager who wants to know whether to spray tomorrow.

  This module holds the translation, and only the translation. It takes the
  forecast points that are already stored and produces day-by-day figures and
  sentences a reader needs no training to interpret. It is deliberately separate
  from the route and the template so it can be unit tested on its own: a wrong
  sentence here is a wrong decision in a field, and "it looked fine in the
  browser" is not a test.

WHAT IT REFUSES TO DO

  It does not invent a rain percentage. A percent chance of rain is a
  probability the engine does not produce for rainfall, and printing one would
  be fabricating precision. Instead the rainfall band is described in words that
  match what the numbers actually support ("no rain expected", "a chance of
  light rain"), which is honest about the uncertainty rather than hiding it
  behind a number.

  It does not soften a wide uncertainty band. Where the spread is large the
  confidence is reported as low, in the same breath as the value, so the reader
  sees both at once.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime

# Rainfall in millimeters over a day. Below the first figure a tipping bucket
# has effectively recorded nothing, so calling it "rain" would be misleading.
RAIN_TRACE_MM = 0.2
RAIN_LIGHT_MM = 2.0
RAIN_MODERATE_MM = 10.0
RAIN_HEAVY_MM = 25.0

# Wind in km/h. Chosen to match how the readings are actually used on site
# rather than to reproduce the Beaufort scale, which is already elsewhere.
WIND_BREEZY_KMH = 20.0
WIND_STRONG_KMH = 40.0
WIND_DAMAGING_KMH = 60.0

# Spread (p90 minus p10) beyond which a value should not be read as precise.
# Per variable, in that variable's own unit, because 3 degrees and 3 km/h are
# not comparable amounts of doubt.
CONFIDENCE_LIMITS = {
    "temperature": (2.0, 5.0),
    "dew_point": (2.0, 5.0),
    "humidity": (10.0, 25.0),
    "pressure": (2.0, 6.0),
    "wind_speed": (8.0, 20.0),
    "wind_gust": (12.0, 28.0),
    "solar_radiation": (100.0, 300.0),
    "rainfall": (1.0, 5.0),
}


@dataclass
class DayOutlook:
    """One day of forecast, in figures a reader can act on."""

    day: date
    label: str
    temp_min: float | None = None
    temp_max: float | None = None
    rain_mm: float | None = None
    wind_max: float | None = None
    gust_max: float | None = None
    solar_max: float | None = None
    humidity_min: float | None = None
    humidity_max: float | None = None
    #: Plain sentence describing the day.
    summary: str = ""
    #: "high", "moderate" or "low", from the width of the forecast band.
    confidence: str = "moderate"
    #: Widest band seen for temperature that day, in degrees.
    temp_spread: float | None = None


def day_label(day: date, today: date) -> str:
    """"Today", "Tomorrow", then the weekday name."""
    delta = (day - today).days
    if delta == 0:
        return "Today"
    if delta == 1:
        return "Tomorrow"
    if delta == -1:
        return "Yesterday"
    return day.strftime("%A")


def confidence_for(variable: str, spread: float | None) -> str:
    """Turn a p10-to-p90 spread into a word.

    A missing spread is reported as moderate rather than high: absence of a band
    is not evidence of precision.
    """
    if spread is None:
        return "moderate"
    tight, loose = CONFIDENCE_LIMITS.get(variable, (2.0, 5.0))
    if spread <= tight:
        return "high"
    if spread >= loose:
        return "low"
    return "moderate"


def describe_rain(mm: float | None) -> str:
    """Words for a day's rainfall total, with no invented probability."""
    if mm is None:
        return "no rainfall forecast"
    if mm < RAIN_TRACE_MM:
        return "no rain expected"
    if mm < RAIN_LIGHT_MM:
        return f"a chance of light rain, around {mm:.1f} mm"
    if mm < RAIN_MODERATE_MM:
        return f"rain likely, around {mm:.0f} mm"
    if mm < RAIN_HEAVY_MM:
        return f"substantial rain, around {mm:.0f} mm"
    return f"heavy rain, around {mm:.0f} mm"


def describe_wind(wind: float | None, gust: float | None) -> str:
    """Words for a day's wind, naming the gust only when it matters."""
    if wind is None:
        return "no wind forecast"
    if wind < WIND_BREEZY_KMH:
        base = f"light wind to {wind:.0f} km/h"
    elif wind < WIND_STRONG_KMH:
        base = f"breezy, up to {wind:.0f} km/h"
    elif wind < WIND_DAMAGING_KMH:
        base = f"strong wind, up to {wind:.0f} km/h"
    else:
        base = f"damaging wind, up to {wind:.0f} km/h"
    # A gust is only worth a reader's attention when it is meaningfully above
    # the sustained wind; otherwise it is noise in the sentence.
    if gust is not None and gust >= max(wind + 10.0, WIND_BREEZY_KMH):
        base += f", gusting {gust:.0f}"
    return base


def describe_temperature(tmin: float | None, tmax: float | None) -> str:
    if tmax is None and tmin is None:
        return "no temperature forecast"
    if tmin is None:
        return f"reaching {tmax:.0f} degrees"
    if tmax is None:
        return f"down to {tmin:.0f} degrees"
    return f"{tmin:.0f} to {tmax:.0f} degrees"


def _summary_sentence(o: DayOutlook) -> str:
    """One sentence per day: temperature, then rain, then wind if notable."""
    parts = [describe_temperature(o.temp_min, o.temp_max)]
    rain = describe_rain(o.rain_mm)
    parts.append(rain)
    # Wind earns a mention only when it is above "light", to keep the sentence
    # about what is unusual rather than listing every variable every day.
    if o.wind_max is not None and o.wind_max >= WIND_BREEZY_KMH:
        parts.append(describe_wind(o.wind_max, o.gust_max))
    sentence = ", ".join(parts)
    return sentence[0].upper() + sentence[1:] if sentence else ""


def _minmax(values: list[float]) -> tuple[float | None, float | None]:
    clean = [v for v in values if v is not None]
    if not clean:
        return None, None
    return min(clean), max(clean)


def build_outlook(series_by_variable: dict[str, list[dict]],
                  today: date | None = None,
                  max_days: int = 7) -> list[DayOutlook]:
    """Group forecast points into per-day figures and sentences.

    `series_by_variable` maps a canonical variable name to the stored forecast
    points, each a mapping with at least `valid_at` (a naive local datetime) and
    `value`, optionally `p10` and `p90`.

    Rainfall is SUMMED over the day because it is an accumulation; everything
    else is reduced to the day's minimum and maximum. Mixing those up is the
    classic way to report a lifetime rain counter as a daily total.
    """
    buckets: dict[date, dict[str, list]] = {}
    spreads: dict[date, list[float]] = {}

    for variable, points in (series_by_variable or {}).items():
        for p in points or []:
            when = p.get("valid_at")
            if isinstance(when, str):
                try:
                    when = datetime.strptime(when, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    continue
            if not isinstance(when, datetime):
                continue
            value = p.get("value")
            if value is None:
                continue
            day = when.date()
            buckets.setdefault(day, {}).setdefault(variable, []).append(float(value))
            if variable == "temperature":
                lo, hi = p.get("p10"), p.get("p90")
                if lo is not None and hi is not None:
                    spreads.setdefault(day, []).append(abs(float(hi) - float(lo)))

    if today is None:
        today = min(buckets) if buckets else date.today()

    out: list[DayOutlook] = []
    for day in sorted(buckets)[:max_days]:
        vals = buckets[day]
        tmin, tmax = _minmax(vals.get("temperature", []))
        hmin, hmax = _minmax(vals.get("humidity", []))
        _wmin, wmax = _minmax(vals.get("wind_speed", []))
        _gmin, gmax = _minmax(vals.get("wind_gust", []))
        _smin, smax = _minmax(vals.get("solar_radiation", []))
        rain_vals = [v for v in vals.get("rainfall", []) if v is not None]
        rain = round(sum(rain_vals), 2) if rain_vals else None
        day_spreads = spreads.get(day, [])
        spread = max(day_spreads) if day_spreads else None

        o = DayOutlook(
            day=day, label=day_label(day, today),
            temp_min=tmin, temp_max=tmax,
            rain_mm=rain, wind_max=wmax, gust_max=gmax,
            solar_max=smax, humidity_min=hmin, humidity_max=hmax,
            temp_spread=spread,
            confidence=confidence_for("temperature", spread),
        )
        o.summary = _summary_sentence(o)
        out.append(o)
    return out


def headline(outlooks: list[DayOutlook]) -> str:
    """A single line for the top of the page, about the nearest day."""
    if not outlooks:
        return "There is no forecast for this station yet."
    first = outlooks[0]
    return f"{first.label}: {first.summary}."


def rain_outlook(outlooks: list[DayOutlook]) -> str:
    """A plain statement about rain across the whole forecast period."""
    if not outlooks:
        return ""
    wet = [o for o in outlooks
           if o.rain_mm is not None and o.rain_mm >= RAIN_TRACE_MM]
    if not wet:
        days = len(outlooks)
        return (f"No rain is expected over the next {days} days."
                if days > 1 else "No rain is expected.")
    total = sum(o.rain_mm or 0.0 for o in wet)
    if len(wet) == 1:
        return (f"Rain is expected on one day ({wet[0].label}), "
                f"around {total:.1f} mm in total.")
    names = ", ".join(o.label for o in wet)
    return (f"Rain is expected on {len(wet)} days ({names}), "
            f"around {total:.1f} mm in total.")


def describe_backing(model_backed: list[str] | None) -> str:
    """State what the forecast is built from, in the reader's terms."""
    if not model_backed:
        return ("Built from this station's own recorded history. No external "
                "weather model is being used for it.")
    names = ", ".join(sorted(model_backed))
    return ("Built from this station's own recorded history, corrected against "
            f"a commercial forecast model for: {names}.")
