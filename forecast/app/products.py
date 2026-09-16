"""Nano-climate products derived from the hourly forecast.

These are the outputs worth having. A temperature curve is data; "frost likely
between 03:00 and 06:00, worst in the hollow" is a decision. Everything here
turns forecast hours into something a site owner acts on.

Every formula is named and referenced, because an unattributed agronomic
threshold is impossible to check and impossible to defend when it is wrong.

UNITS, once, everywhere
    temperature, dew point   degrees Celsius
    humidity                 percent
    wind speed               km/h  (converted internally where m/s is required)
    pressure                 hPa
    solar radiation          W/m2
    rainfall                 mm
    ET0                      mm/day
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

KMH_TO_MS = 1000.0 / 3600.0


# ---------------------------------------------------------------------------
#  Psychrometrics
# ---------------------------------------------------------------------------

def saturation_vapor_pressure(temp_c: float) -> float:
    """Saturation vapor pressure in kPa. Tetens, as adopted in FAO-56 eq. 11."""
    return 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))


def actual_vapor_pressure(temp_c: float, humidity_pct: float) -> float:
    """Actual vapor pressure in kPa from temperature and relative humidity."""
    return saturation_vapor_pressure(temp_c) * (humidity_pct / 100.0)


def dew_point(temp_c: float | None, humidity_pct: float | None) -> float | None:
    """Dew point in degrees C. Magnus-Tetens inversion.

    The station usually reports its own dew point and that value is preferred;
    this exists for the forecast hours, where dew point has to be derived from
    forecast temperature and humidity.
    """
    if temp_c is None or humidity_pct is None:
        return None
    rh = max(1.0, min(100.0, humidity_pct))       # log(0) at rh=0
    a, b = 17.27, 237.3
    alpha = ((a * temp_c) / (b + temp_c)) + math.log(rh / 100.0)
    return (b * alpha) / (a - alpha)


def wet_bulb_temperature(temp_c: float | None,
                         humidity_pct: float | None) -> float | None:
    """Wet-bulb temperature in degrees C. Stull (2011) empirical fit.

    Valid roughly -20 to 50 C and 5 to 99% humidity, which covers any site this
    system is deployed at. Used for heat stress, and for frost work because a
    wet bulb below zero means evaporative cooling can reach freezing even when
    the air has not.
    """
    if temp_c is None or humidity_pct is None:
        return None
    rh = max(5.0, min(99.0, humidity_pct))
    return (temp_c * math.atan(0.151977 * math.sqrt(rh + 8.313659))
            + math.atan(temp_c + rh) - math.atan(rh - 1.676331)
            + 0.00391838 * (rh ** 1.5) * math.atan(0.023101 * rh)
            - 4.686035)


def vapor_pressure_deficit(temp_c: float | None,
                            humidity_pct: float | None) -> float | None:
    """Vapor pressure deficit in kPa.

    The variable that actually governs transpiration and many spray decisions,
    and a better guide than humidity alone because it accounts for how much
    moisture the air could hold at that temperature.
    """
    if temp_c is None or humidity_pct is None:
        return None
    return max(0.0, saturation_vapor_pressure(temp_c)
               - actual_vapor_pressure(temp_c, humidity_pct))


def delta_t(temp_c: float | None, humidity_pct: float | None) -> float | None:
    """Dry-bulb minus wet-bulb, in degrees C.

    The standard spray-suitability measure in Australian and South African
    practice: below about 2 means droplets stay wet and drift, above about 8
    means they evaporate before reaching the target.
    """
    wb = wet_bulb_temperature(temp_c, humidity_pct)
    if wb is None or temp_c is None:
        return None
    return temp_c - wb


# ---------------------------------------------------------------------------
#  Frost
# ---------------------------------------------------------------------------

#: Screen-to-8 m difference above which a nocturnal inversion is taken as real,
#: degrees Celsius. Air at height warmer than the surface by more than this is
#: the radiative-frost signature that a frost fan can act on.
INVERSION_THRESHOLD_C = 1.5


def _inversion_delta(hour) -> float | None:
    """8 m air temperature minus the screen temperature for one hour.

    Positive under a nocturnal inversion. Accepts a stored delta directly, or
    computes it from a second-height temperature, under any of the spellings the
    data might carry. Returns None when the station has only one height, which
    is the normal case and the reason the frost type usually rests on a wind
    proxy rather than a measured inversion.
    """
    for key in ("delta_temperature", "deltaTemperature"):
        v = hour.get(key)
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                return None
    t = hour.get("temperature")
    for key in ("temperature_8m", "temperature8m", "temp_8m"):
        t8 = hour.get(key)
        if t8 is not None and t is not None:
            try:
                return float(t8) - float(t)
            except (TypeError, ValueError):
                return None
    return None


@dataclass
class FrostAssessment:
    """Frost outlook for one night.

    The number a reader sees as a probability comes from the ensemble
    (`probabilistic.frost_risk`), which a reliability diagram can verify. This
    assessment contributes the risk band, the reasoning, the timing and the
    type only. Its own `heuristic_score` is an uncalibrated internal blend and
    is deliberately NOT rendered as a probability: two differently derived
    percentages for the same night on the same page cannot be reconciled by a
    reader.
    """

    risk: str                       # none | slight | moderate | severe
    heuristic_score: float          # 0..1, internal, NOT a calibrated probability
    min_temperature: float | None
    min_at: datetime | None
    first_below_zero: datetime | None = None
    last_below_zero: datetime | None = None
    frost_type: str | None = None   # radiation | advection | mixed
    # How the type was determined. Only an `inversion` basis, measured from two
    # temperature heights, may speak to whether frost fans help.
    frost_type_basis: str = "undetermined"  # inversion | wind_proxy | undetermined
    # True or False only when the basis is `inversion`; None otherwise, because
    # the fan question costs a grower money and must rest on a measurement.
    frost_fans_help: bool | None = None
    reasoning: list = field(default_factory=list)


def assess_frost(hours) -> FrostAssessment:
    """Assess frost risk over a set of forecast hours.

    `hours` is a sequence of dicts with valid_at, temperature, dew_point,
    wind_speed, humidity and optionally p10 (the cold edge of the ensemble) and
    cloud_cover.

    WHY IT IS NOT JUST "IS THE FORECAST BELOW ZERO"

    Three things make a screen temperature above zero still produce frost, and
    all three are why a bare threshold under-warns:

      - Screen height. Air temperature is measured at 1.2 to 2 m. On a still,
        clear night the grass surface can be 2 to 4 degrees colder, so ground
        frost occurs with the screen reading +2 or +3.
      - The dew point sets the floor. Once air cools to its dew point,
        condensation releases latent heat and the fall slows sharply. A night
        with a dew point of -4 can keep cooling; one with a dew point of +6
        usually cannot reach zero at all.
      - Wind and cloud decide whether the surface can decouple from the air at
        all. Calm and clear is the classic radiation frost. Windy means the
        boundary layer stays mixed and the surface cannot run away.

    The probability is a deliberately coarse blend of those factors. It is
    honest about being indicative: it is not a calibrated probability from a
    verified ensemble, and the UI says so rather than implying a rigor that a
    single station's history cannot support.
    """
    temps = [(h.get("valid_at"), h.get("temperature")) for h in hours
             if h.get("temperature") is not None]
    if not temps:
        return FrostAssessment(risk="none", heuristic_score=0.0,
                               min_temperature=None, min_at=None,
                               frost_type_basis="undetermined",
                               reasoning=["No temperature forecast available."])

    min_at, min_temp = min(temps, key=lambda t: t[1])

    # The cold edge of the ensemble, where available. Frost is an asymmetric
    # risk: being 2 degrees too warm costs a crop, being 2 too cold costs a
    # night's sleep, so the assessment leans on the cold tail.
    cold_edge = [h.get("p10") for h in hours if h.get("p10") is not None]
    min_cold = min(cold_edge) if cold_edge else None

    below = [t for t in temps if t[1] <= 0.0]
    first_below = below[0][0] if below else None
    last_below = below[-1][0] if below else None

    # Conditions during the coldest part of the night.
    coldest = sorted(hours, key=lambda h: h.get("temperature")
                     if h.get("temperature") is not None else 999)[:4]
    winds = [h.get("wind_speed") for h in coldest
             if h.get("wind_speed") is not None]
    dews = [h.get("dew_point") for h in coldest if h.get("dew_point") is not None]
    clouds = [h.get("cloud_cover") for h in coldest
              if h.get("cloud_cover") is not None]
    mean_wind = sum(winds) / len(winds) if winds else None
    min_dew = min(dews) if dews else None
    mean_cloud = sum(clouds) / len(clouds) if clouds else None

    reasoning = []
    score = 0.0

    # 1. How close the screen temperature gets to freezing. The offsets below
    #    zero account for the grass-minimum being colder than the screen.
    effective = min_cold if min_cold is not None else min_temp
    if effective <= -2.0:
        score += 0.55
        reasoning.append(f"Forecast minimum {effective:.1f} C is well below zero.")
    elif effective <= 0.0:
        score += 0.45
        reasoning.append(f"Forecast minimum {effective:.1f} C is at or below zero.")
    elif effective <= 2.0:
        score += 0.30
        reasoning.append(
            f"Forecast minimum {effective:.1f} C is above zero, but grass level "
            "typically runs 2 to 4 C colder than screen height on a still, "
            "clear night.")
    elif effective <= 4.0:
        score += 0.12
        reasoning.append(f"Forecast minimum {effective:.1f} C leaves little margin.")
    else:
        reasoning.append(f"Forecast minimum {effective:.1f} C is comfortably above "
                         "frost range.")

    # 2. The dew point floor.
    if min_dew is not None:
        if min_dew <= -3.0:
            score += 0.20
            reasoning.append(
                f"Dew point {min_dew:.1f} C is low, so cooling is not checked by "
                "condensation and temperatures can keep falling.")
        elif min_dew <= 1.0:
            score += 0.10
            reasoning.append(f"Dew point {min_dew:.1f} C allows further cooling.")
        else:
            score -= 0.12
            reasoning.append(
                f"Dew point {min_dew:.1f} C acts as a floor: latent heat released "
                "by condensation will slow the fall well before zero.")

    # 3. Frost TYPE and, crucially, the basis for it. A two-height measurement
    #    resolves the inversion directly and may speak to frost fans; wind alone
    #    is a labelled proxy that may not, because acting on it costs money.
    cold_deltas = [d for d in (_inversion_delta(h) for h in coldest)
                   if d is not None]
    frost_type = None
    frost_type_basis = "undetermined"
    frost_fans_help = None

    if cold_deltas:
        frost_type_basis = "inversion"
        mean_delta = sum(cold_deltas) / len(cold_deltas)
        if mean_delta >= INVERSION_THRESHOLD_C:
            score += 0.18
            frost_type = "radiation"
            frost_fans_help = True
            reasoning.append(
                f"Measured inversion: the air aloft is {mean_delta:.1f} C warmer "
                "than the surface, the radiative-frost signature. Mixing that "
                "warmer air down with frost fans is expected to help.")
        else:
            frost_type = "advection"
            frost_fans_help = False
            reasoning.append(
                f"No surface inversion measured (only {mean_delta:.1f} C between "
                "heights): the layer is mixed, so any frost is advective and "
                "frost fans are not expected to help.")
        if mean_wind is not None and mean_wind >= 20.0:
            score -= 0.10
    elif mean_wind is not None:
        frost_type_basis = "wind_proxy"
        if mean_wind <= 6.0:
            score += 0.18
            frost_type = "radiation"
            reasoning.append(
                f"Light wind ({mean_wind:.0f} km/h) allows cold air to pool and "
                "the surface to decouple, which suggests radiation frost, worst "
                "in hollows. Inferred from wind alone, not a measured inversion, "
                "so no claim is made about whether frost fans would help.")
        elif mean_wind >= 20.0:
            score -= 0.15
            frost_type = "advection" if effective <= 0.0 else None
            reasoning.append(
                f"Wind of {mean_wind:.0f} km/h keeps the air mixed, suppressing "
                "surface cooling; any frost would be advective. Inferred from "
                "wind, not measured.")
        else:
            frost_type = "mixed"
            reasoning.append(f"Moderate wind ({mean_wind:.0f} km/h); type "
                             "inferred from wind, not from a measured inversion.")
    else:
        reasoning.append(
            "Neither a second temperature height nor wind data is available, so "
            "the frost type is undetermined.")

    # 4. Cloud, where the station can see it.
    if mean_cloud is not None:
        if mean_cloud <= 25.0:
            score += 0.12
            reasoning.append(f"Clear sky ({mean_cloud:.0f}% cloud) maximizes "
                             "radiative loss.")
        elif mean_cloud >= 70.0:
            score -= 0.15
            reasoning.append(f"Cloud cover ({mean_cloud:.0f}%) traps outgoing "
                             "radiation and limits cooling.")

    heuristic = max(0.0, min(1.0, score))

    if effective > 4.0 and heuristic < 0.15:
        risk = "none"
    elif heuristic >= 0.65:
        risk = "severe"
    elif heuristic >= 0.40:
        risk = "moderate"
    elif heuristic >= 0.18:
        risk = "slight"
    else:
        risk = "none"

    return FrostAssessment(
        risk=risk, heuristic_score=heuristic, min_temperature=min_temp,
        min_at=min_at, first_below_zero=first_below, last_below_zero=last_below,
        frost_type=frost_type, frost_type_basis=frost_type_basis,
        frost_fans_help=frost_fans_help, reasoning=reasoning)


# ---------------------------------------------------------------------------
#  Dew and leaf wetness
# ---------------------------------------------------------------------------

# A warm, breezy hour near the dew point still dries, so it does not count
# toward leaf wetness. These set that drying allowance: a marginal wet hour with
# at least this vapor pressure deficit AND at least this wind is treated as dry.
# The deficit is low because near the dew point the deficit is always small; it
# is reachable in the warm, breezy margin of a wet period, which is exactly the
# hour that dries first.
DRY_VPD_KPA = 0.2
DRY_WIND_KMH = 15.0


@dataclass
class DewAssessment:
    """Expected dew period, which drives fungal disease pressure.

    `duration_hours` is a leaf wetness duration derived from the temperature to
    dew-point spread with a drying allowance. It is not a measured leaf-wetness
    sensor reading, and `duration_is_measured` says so, because a derived figure
    presented as measured would be a mislabeling a grower could act on.
    """

    expected: bool
    onset: datetime | None
    clearing: datetime | None
    duration_hours: float
    disease_pressure: str           # low | moderate | high
    duration_is_measured: bool = False
    reasoning: list = field(default_factory=list)


def assess_dew(hours, spread_threshold: float = 2.0) -> DewAssessment:
    """Work out when dew forms and when it burns off.

    Dew is expected when the temperature closes to within `spread_threshold` of
    the dew point. It is not a sharp threshold in reality - it depends on surface
    emissivity and wind - so 2 C is used as the practical trigger rather than 0.

    Duration matters more than occurrence. Most foliar pathogens need a
    continuous wet period to establish, commonly quoted around 6 hours for many
    of them at moderate temperature, so the pressure bands below key off length
    of wetness and whether the temperature sat in the range fungi favor.
    """
    wet_hours = []
    for h in hours:
        t = h.get("temperature")
        d = h.get("dew_point")
        if t is None or d is None:
            continue
        if (t - d) <= spread_threshold:
            # Drying allowance (R5.3): a dry, windy hour evaporates surface
            # moisture even near saturation, so it is not counted as leaf-wet.
            rh = h.get("humidity")
            wind = h.get("wind_speed")
            vpd = vapor_pressure_deficit(t, rh) if rh is not None else None
            if (vpd is not None and vpd >= DRY_VPD_KPA
                    and wind is not None and wind >= DRY_WIND_KMH):
                continue
            wet_hours.append(h)

    if not wet_hours:
        return DewAssessment(expected=False, onset=None, clearing=None,
                             duration_hours=0.0, disease_pressure="low",
                             reasoning=["Temperature stays well clear of the dew "
                                        "point: no dew expected."])

    onset = wet_hours[0].get("valid_at")
    clearing = wet_hours[-1].get("valid_at")
    duration = float(len(wet_hours))

    # Fungal activity is fastest in the mid teens to low twenties. A long cold
    # wet period is much less dangerous than a shorter mild one.
    temps = [h.get("temperature") for h in wet_hours
             if h.get("temperature") is not None]
    mean_temp = sum(temps) / len(temps) if temps else None
    favorable = mean_temp is not None and 12.0 <= mean_temp <= 25.0

    reasoning = [f"Temperature within {spread_threshold:.0f} C of the dew point "
                 f"for {duration:.0f} hour(s).",
                 "Duration is derived from the temperature to dew-point spread "
                 "with a drying allowance, not from a leaf-wetness sensor."]
    if mean_temp is not None:
        reasoning.append(f"Mean temperature through the wet period "
                         f"{mean_temp:.1f} C.")

    if duration >= 8 and favorable:
        pressure = "high"
        reasoning.append("Long wet period in the temperature range most foliar "
                         "pathogens favor.")
    elif duration >= 6 and favorable:
        pressure = "moderate"
        reasoning.append("Wet period long enough for infection in susceptible "
                         "crops.")
    elif duration >= 10:
        pressure = "moderate"
        reasoning.append("Long wet period, though cooler than the range that "
                         "most favors infection.")
    else:
        pressure = "low"

    return DewAssessment(expected=True, onset=onset, clearing=clearing,
                         duration_hours=duration, disease_pressure=pressure,
                         reasoning=reasoning)


# ---------------------------------------------------------------------------
#  Heat stress
# ---------------------------------------------------------------------------

def heat_index(temp_c: float | None, humidity_pct: float | None) -> float | None:
    """Apparent temperature in degrees C. Rothfusz regression, NWS.

    Only meaningful above about 27 C; below that the regression is not valid and
    the air temperature itself is returned.
    """
    if temp_c is None or humidity_pct is None:
        return None
    if temp_c < 26.7:
        return temp_c
    t = temp_c * 9.0 / 5.0 + 32.0                 # the fit is in Fahrenheit
    r = humidity_pct
    hi = (-42.379 + 2.04901523 * t + 10.14333127 * r
          - 0.22475541 * t * r - 6.83783e-3 * t * t
          - 5.481717e-2 * r * r + 1.22874e-3 * t * t * r
          + 8.5282e-4 * t * r * r - 1.99e-6 * t * t * r * r)
    # The two adjustments the NWS applies at the edges of the fit.
    if r < 13.0 and 80.0 <= t <= 112.0:
        hi -= ((13.0 - r) / 4.0) * math.sqrt((17.0 - abs(t - 95.0)) / 17.0)
    elif r > 85.0 and 80.0 <= t <= 87.0:
        hi += ((r - 85.0) / 10.0) * ((87.0 - t) / 5.0)
    return (hi - 32.0) * 5.0 / 9.0


def wbgt_shade(temp_c: float | None, humidity_pct: float | None) -> float | None:
    """Shaded wet-bulb globe temperature, degrees C.

    The approximation WBGT = 0.7*Tw + 0.3*Ta for shade or indoor conditions. In
    full sun the true WBGT is higher because of the globe term, so this
    understates outdoor exposure and is labeled as shade for that reason.
    """
    wb = wet_bulb_temperature(temp_c, humidity_pct)
    if wb is None or temp_c is None:
        return None
    return 0.7 * wb + 0.3 * temp_c


@dataclass
class HeatAssessment:
    """Heat stress outlook for a working day."""

    level: str                      # none | caution | extreme_caution | danger
    peak_heat_index: float | None
    peak_at: datetime | None
    peak_wbgt: float | None
    hours_above_caution: int
    reasoning: list = field(default_factory=list)


def assess_heat(hours) -> HeatAssessment:
    """Assess heat stress across forecast hours, using NWS heat index bands."""
    indices = []
    for h in hours:
        hi = heat_index(h.get("temperature"), h.get("humidity"))
        if hi is not None:
            indices.append((h.get("valid_at"), hi))
    if not indices:
        return HeatAssessment(level="none", peak_heat_index=None, peak_at=None,
                              peak_wbgt=None, hours_above_caution=0,
                              reasoning=["No temperature and humidity forecast "
                                         "available."])

    peak_at, peak_hi = max(indices, key=lambda x: x[1])
    wbgts = [wbgt_shade(h.get("temperature"), h.get("humidity")) for h in hours]
    peak_wbgt = max((w for w in wbgts if w is not None), default=None)
    above = sum(1 for _t, hi in indices if hi >= 27.0)

    reasoning = [f"Peak apparent temperature {peak_hi:.1f} C."]
    if peak_hi >= 41.0:
        level = "danger"
        reasoning.append("Heat cramps and heat exhaustion likely with continued "
                         "activity; heat stroke possible.")
    elif peak_hi >= 32.0:
        level = "extreme_caution"
        reasoning.append("Heat cramps and heat exhaustion possible with prolonged "
                         "exertion.")
    elif peak_hi >= 27.0:
        level = "caution"
        reasoning.append("Fatigue possible with prolonged exposure and activity.")
    else:
        level = "none"

    if peak_wbgt is not None:
        reasoning.append(f"Shaded WBGT peaks near {peak_wbgt:.1f} C; in full sun "
                         "the effective figure is higher.")

    return HeatAssessment(level=level, peak_heat_index=peak_hi, peak_at=peak_at,
                          peak_wbgt=peak_wbgt, hours_above_caution=above,
                          reasoning=reasoning)


# ---------------------------------------------------------------------------
#  Reference evapotranspiration
# ---------------------------------------------------------------------------

def et0_hargreaves(t_mean: float | None, t_max: float | None,
                   t_min: float | None, ra_mj: float | None) -> float | None:
    """Reference ET in mm/day. Hargreaves-Samani, FAO-56 eq. 52.

    Used when solar radiation is unavailable. It needs only the temperature
    range, which is itself a proxy for cloudiness, and is the FAO's recommended
    fallback for exactly that situation.
    """
    if None in (t_mean, t_max, t_min, ra_mj):
        return None
    if t_max < t_min:
        return None
    return max(0.0, 0.0023 * (t_mean + 17.8)
               * math.sqrt(t_max - t_min) * ra_mj * 0.408)


def extraterrestrial_radiation(latitude_deg: float,
                               day_of_year: int) -> float:
    """Extraterrestrial radiation Ra in MJ/m2/day. FAO-56 eq. 21.

    Depends only on latitude and date, so it is available for any site with
    coordinates and needs no sensor at all.
    """
    phi = math.radians(latitude_deg)
    dr = 1.0 + 0.033 * math.cos(2.0 * math.pi * day_of_year / 365.0)
    delta = 0.409 * math.sin(2.0 * math.pi * day_of_year / 365.0 - 1.39)
    # Sunset hour angle, clamped so it stays valid inside the polar circles.
    x = -math.tan(phi) * math.tan(delta)
    ws = math.acos(max(-1.0, min(1.0, x)))
    return ((24.0 * 60.0 / math.pi) * 0.0820 * dr
            * (ws * math.sin(phi) * math.sin(delta)
               + math.cos(phi) * math.cos(delta) * math.sin(ws)))


def et0_penman_monteith(t_mean: float, t_max: float, t_min: float,
                        humidity_pct: float, wind_kmh: float,
                        solar_mj: float, altitude_m: float,
                        latitude_deg: float, day_of_year: int) -> float | None:
    """Reference ET in mm/day. FAO-56 Penman-Monteith, eq. 6.

    The standard method, and preferred whenever the station measures solar
    radiation - which these stations do. Wind is converted to the 2 m height the
    equation assumes; a station measuring at 10 m would otherwise overstate ET.
    """
    try:
        # Pressure from altitude, FAO-56 eq. 7.
        p = 101.3 * (((293.0 - 0.0065 * altitude_m) / 293.0) ** 5.26)
        gamma = 0.000665 * p                       # psychrometric constant

        es_max = saturation_vapor_pressure(t_max)
        es_min = saturation_vapor_pressure(t_min)
        es = (es_max + es_min) / 2.0
        ea = actual_vapor_pressure(t_mean, humidity_pct)

        # Slope of the vapor pressure curve, FAO-56 eq. 13.
        delta = (4098.0 * saturation_vapor_pressure(t_mean)
                 / ((t_mean + 237.3) ** 2))

        # Wind at 2 m from a 10 m measurement, FAO-56 eq. 47.
        u10 = wind_kmh * KMH_TO_MS
        u2 = u10 * (4.87 / math.log(67.8 * 10.0 - 5.42))

        ra = extraterrestrial_radiation(latitude_deg, day_of_year)
        rso = (0.75 + 2e-5 * altitude_m) * ra      # clear-sky radiation
        rns = (1.0 - 0.23) * solar_mj              # net shortwave, albedo 0.23

        # Net longwave, FAO-56 eq. 39.
        sigma = 4.903e-9
        tmaxk = (t_max + 273.16) ** 4
        tmink = (t_min + 273.16) ** 4
        cloud_factor = 1.35 * (solar_mj / rso) - 0.35 if rso > 0 else 0.0
        cloud_factor = max(0.05, min(1.0, cloud_factor))
        rnl = (sigma * ((tmaxk + tmink) / 2.0)
               * (0.34 - 0.14 * math.sqrt(max(0.0, ea))) * cloud_factor)
        rn = rns - rnl

        numerator = (0.408 * delta * rn
                     + gamma * (900.0 / (t_mean + 273.0)) * u2 * (es - ea))
        denominator = delta + gamma * (1.0 + 0.34 * u2)
        if denominator == 0:
            return None
        return max(0.0, numerator / denominator)
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


# ---------------------------------------------------------------------------
#  Spray window
# ---------------------------------------------------------------------------

@dataclass
class SprayWindow:
    """A period suitable for spraying."""

    start: datetime
    end: datetime
    quality: str                    # good | marginal
    note: str = ""


def find_spray_windows(hours, min_wind: float = 3.0, max_wind: float = 15.0,
                       min_delta_t: float = 2.0, max_delta_t: float = 8.0,
                       max_gust: float = 25.0) -> list:
    """Find hours suitable for spraying, and group them into windows.

    The four conditions, and why each matters:

      - Wind above `min_wind`. Dead calm is not good spraying weather, which
        surprises people. Still air at night usually means a temperature
        inversion, and under an inversion fine droplets stay suspended and drift
        far off target instead of settling.
      - Wind below `max_wind`, and gusts below `max_gust`, or spray is carried
        off target directly.
      - Delta-T between `min_delta_t` and `max_delta_t`. Below 2 the droplets
        barely evaporate and stay prone to drift; above 8 they evaporate before
        reaching the leaf.
      - No rain forecast, which would wash the application off.

    Defaults follow the conventional agronomic guidance; all four are arguments
    because the right numbers depend on the product and the nozzle.
    """
    suitable = []
    for h in hours:
        wind = h.get("wind_speed")
        gust = h.get("wind_gust")
        dt = delta_t(h.get("temperature"), h.get("humidity"))
        rain = h.get("rain_probability")

        if wind is None or dt is None:
            continue
        if not (min_wind <= wind <= max_wind):
            continue
        if gust is not None and gust > max_gust:
            continue
        if not (min_delta_t <= dt <= max_delta_t):
            continue
        if rain is not None and rain > 0.4:
            continue

        # Mark the edges of the acceptable band as marginal rather than good, so
        # a window that only just qualifies is not presented as ideal.
        margin_wind = wind <= min_wind + 1.0 or wind >= max_wind - 2.0
        margin_dt = dt <= min_delta_t + 0.5 or dt >= max_delta_t - 1.0
        suitable.append((h, "marginal" if (margin_wind or margin_dt) else "good"))

    # Group consecutive hours into windows.
    windows = []
    run = []
    for item in suitable:
        if not run:
            run = [item]
            continue
        previous = run[-1][0].get("valid_at")
        current = item[0].get("valid_at")
        if previous and current and (current - previous).total_seconds() <= 3700:
            run.append(item)
        else:
            windows.append(run)
            run = [item]
    if run:
        windows.append(run)

    out = []
    for run in windows:
        if len(run) < 2:
            continue                       # a single hour is not a usable window
        quality = "good" if all(q == "good" for _h, q in run) else "marginal"
        first, last = run[0][0], run[-1][0]
        out.append(SprayWindow(start=first.get("valid_at"),
                               end=last.get("valid_at"), quality=quality,
                               note=f"{len(run)} hour(s)"))
    return out


# ---------------------------------------------------------------------------
#  Accumulations
# ---------------------------------------------------------------------------

def growing_degree_days(t_max: float | None, t_min: float | None,
                        base: float = 10.0,
                        upper: float | None = 30.0) -> float | None:
    """Growing degree days for one day, single-triangle with an upper cutoff.

    Base 10 C suits maize and many summer crops; wheat is usually 0 C and
    grapevine 10 C, so `base` is an argument rather than a constant. The upper
    cutoff reflects that development does not keep accelerating in extreme heat.
    """
    if t_max is None or t_min is None:
        return None
    hi = min(t_max, upper) if upper is not None else t_max
    lo = max(t_min, base)
    hi = max(hi, base)
    return max(0.0, ((hi + lo) / 2.0) - base)


def chill_hours(hours, low: float = 0.0, high: float = 7.2) -> int:
    """Hours in the chilling range, the Weinberger 0 to 7.2 C model.

    Deciduous fruit needs an accumulated chill period to break dormancy, and
    growers track it through winter. This is the simplest of the several chill
    models in use and the easiest to explain, but it treats every hour in the
    range as equal and counts nothing outside it, so it underestimates
    accumulation in a warm winter. `chill_summary` reports it beside the Utah
    and Dynamic models for exactly that reason.
    """
    count = 0
    for h in hours:
        t = h.get("temperature")
        if t is not None and low <= t <= high:
            count += 1
    return count


# ---------------------------------------------------------------------------
#  Crop evapotranspiration (ETc)
# ---------------------------------------------------------------------------

# FAO-56 single crop coefficients and stage lengths in days: initial,
# development, mid-season, late-season, with the coefficient in each of the
# three plateaus (Kc_ini, Kc_mid, Kc_end). Allen et al. (1998), Table 11/12.
CROP_CALENDAR = {
    "maize":  {"lengths": (20, 35, 40, 30), "kc": (0.30, 1.20, 0.60)},
    "wheat":  {"lengths": (15, 25, 50, 30), "kc": (0.30, 1.15, 0.40)},
    "grape":  {"lengths": (20, 40, 60, 30), "kc": (0.30, 0.85, 0.45)},
    "potato": {"lengths": (25, 30, 40, 30), "kc": (0.50, 1.15, 0.75)},
    "lucerne": {"lengths": (10, 20, 20, 10), "kc": (0.40, 1.20, 1.15)},
    "generic": {"lengths": (20, 30, 40, 30), "kc": (0.35, 1.05, 0.60)},
}


def crop_coefficient(crop: str, days_after_planting: int) -> float | None:
    """FAO-56 single crop coefficient Kc for the day, piecewise-linear.

    Flat at Kc_ini through the initial stage, ramping to Kc_mid across the
    development stage, flat at Kc_mid through mid-season, then ramping to Kc_end
    by the end of the late stage. Beyond the season it holds Kc_end.
    """
    cal = CROP_CALENDAR.get((crop or "").lower())
    if cal is None or days_after_planting is None or days_after_planting < 0:
        return None
    l_ini, l_dev, l_mid, l_late = cal["lengths"]
    kc_ini, kc_mid, kc_end = cal["kc"]
    d = days_after_planting
    if d <= l_ini:
        return kc_ini
    if d <= l_ini + l_dev:
        frac = (d - l_ini) / l_dev
        return kc_ini + frac * (kc_mid - kc_ini)
    if d <= l_ini + l_dev + l_mid:
        return kc_mid
    if d <= l_ini + l_dev + l_mid + l_late:
        frac = (d - l_ini - l_dev - l_mid) / l_late
        return kc_mid + frac * (kc_end - kc_mid)
    return kc_end


def crop_etc(et0_mm: float | None, crop: str,
             days_after_planting: int) -> float | None:
    """Crop evapotranspiration, ETc = ET0 * Kc, in mm/day.

    This is a water DEMAND, not an irrigation instruction. No irrigation figure
    is derived, because that needs a soil water balance and the soil water
    balance is out of scope; presenting one would imply a depletion this system
    does not track.
    """
    if et0_mm is None:
        return None
    kc = crop_coefficient(crop, days_after_planting)
    if kc is None:
        return None
    return max(0.0, et0_mm * kc)


# ---------------------------------------------------------------------------
#  Foliar disease risk models
# ---------------------------------------------------------------------------

@dataclass
class DiseaseRisk:
    """One disease model's verdict, with the model named and its inputs shown so
    a reader can see why the level came out as it did (R5.6)."""

    model: str
    crop: str
    level: str                      # low | moderate | high
    inputs: dict = field(default_factory=dict)
    note: str = ""


def _band(value, moderate, high) -> str:
    if value >= high:
        return "high"
    if value >= moderate:
        return "moderate"
    return "low"


def disease_risks(leaf_wetness_h: float | None,
                  mean_temp_c: float | None,
                  rain_mm: float | None = None) -> list[DiseaseRisk]:
    """Evaluate published wetness-and-temperature disease models.

    Each model is a documented rule keyed on leaf wetness duration and mean
    temperature through the wet period, the two variables the forecast can
    supply. The verdicts are indicative infection-risk levels, not spray
    instructions.
    """
    risks: list[DiseaseRisk] = []
    if leaf_wetness_h is None or mean_temp_c is None:
        return risks
    lwd, t = leaf_wetness_h, mean_temp_c

    # Fusarium head blight on small grains: warm and wet at anthesis. Risk after
    # De Wolf et al. (2003): rises with wetness hours in the 15-30 C band.
    if 15.0 <= t <= 30.0:
        fhb = _band(lwd, 12.0, 24.0)
    else:
        fhb = "low"
    risks.append(DiseaseRisk(
        model="Fusarium head blight (De Wolf et al. 2003)",
        crop="small grains", level=fhb,
        inputs={"leaf_wetness_h": round(lwd, 1), "mean_temp_c": round(t, 1)},
        note="Highest near flowering; a warm wet spell is the driver."))

    # Grape downy mildew: Plasmopara needs a mild wet period; the classic guide
    # pairs 11-13 h of wetness at about 20 C for primary infection.
    if 10.0 <= t <= 27.0:
        dm = _band(lwd, 10.0, 16.0)
    else:
        dm = "low"
    risks.append(DiseaseRisk(
        model="Grape downy mildew (wetness-temperature)",
        crop="grapevine", level=dm,
        inputs={"leaf_wetness_h": round(lwd, 1), "mean_temp_c": round(t, 1),
                "rain_mm": rain_mm},
        note="Primary infection favored by a mild, wet period."))

    # Botrytis bunch rot: cooler and wetter than downy mildew.
    if 12.0 <= t <= 22.0:
        bot = _band(lwd, 12.0, 20.0)
    else:
        bot = "low"
    risks.append(DiseaseRisk(
        model="Botrytis (Broome et al. wetness-temperature)",
        crop="grapevine", level=bot,
        inputs={"leaf_wetness_h": round(lwd, 1), "mean_temp_c": round(t, 1)},
        note="Cool, prolonged wetness raises bunch-rot risk."))

    # Citrus black spot (Phyllosticta citricarpa): long warm wetness.
    if 20.0 <= t <= 27.0:
        cbs = _band(lwd, 12.0, 20.0)
    else:
        cbs = "low"
    risks.append(DiseaseRisk(
        model="Citrus black spot (Kotze wetness-temperature)",
        crop="citrus", level=cbs,
        inputs={"leaf_wetness_h": round(lwd, 1), "mean_temp_c": round(t, 1)},
        note="Ascospore infection favored by warm, prolonged wetness."))

    # Potato late blight: the Hutton criteria simplified to this forecast's
    # resolution - mild temperatures and a long wet period.
    if t >= 10.0:
        plb = _band(lwd, 6.0, 12.0)
    else:
        plb = "low"
    risks.append(DiseaseRisk(
        model="Potato late blight (Hutton criteria, simplified)",
        crop="potato", level=plb,
        inputs={"leaf_wetness_h": round(lwd, 1), "mean_temp_c": round(t, 1)},
        note="Min temperature at or above 10 C with a long humid spell."))

    return risks


# ---------------------------------------------------------------------------
#  Chill accumulation: three models, reported together
# ---------------------------------------------------------------------------

def utah_chill_units(hours) -> float | None:
    """Utah chill units, Richardson et al. (1974).

    Weights each hour by temperature: most effective near 3-9 C, neutral in the
    low teens, and negative above 16 C so a warm spell can undo accumulated
    chill. This is the negation the plain chill-hours count cannot express.
    """
    temps = [h.get("temperature") for h in hours
             if h.get("temperature") is not None]
    if not temps:
        return None
    total = 0.0
    for t in temps:
        if t <= 1.4:
            total += 0.0
        elif t <= 2.4:
            total += 0.5
        elif t <= 9.1:
            total += 1.0
        elif t <= 12.4:
            total += 0.5
        elif t <= 15.9:
            total += 0.0
        elif t <= 18.0:
            total -= 0.5
        else:
            total -= 1.0
    return total


def chill_portions(hours) -> float | None:
    """Chill portions from the Dynamic model, Fishman et al. (1987).

    The most robust chill model in warm climates, and the reason it is worth the
    complexity here: it treats chilling as a two-step process where an
    intermediate product forms and can be destroyed by heat until it locks into
    a permanent portion. Implementation after Luedeling et al. (2009).
    """
    temps = [h.get("temperature") for h in hours
             if h.get("temperature") is not None]
    if not temps:
        return None

    e0, e1 = 4153.5, 12888.8
    a0, a1 = 139500.0, 2.567e18
    slp, tetmlt = 1.6, 277.0
    aa = a0 / a1
    ee = e1 - e0

    inter_e = 0.0
    portions = 0.0
    for tc in temps:
        tk = tc + 273.0
        ftmprt = slp * tetmlt * (tk - tetmlt) / tk
        sr = math.exp(ftmprt)
        xi = sr / (1.0 + sr)
        xs = aa * math.exp(ee / tk)
        ak1 = a1 * math.exp(-e1 / tk)
        inter_e = xs - (xs - inter_e) * math.exp(-ak1)
        if inter_e >= 1.0:
            delt = xi * inter_e
            inter_e -= delt
            portions += delt
    return portions


@dataclass
class ChillSummary:
    """The three chill measures side by side, because they disagree by design in
    a warm winter and showing only one would mislead."""

    chill_hours: int
    utah_chill_units: float | None
    chill_portions: float | None
    note: str = ("Chill hours counts every hour from 0 to 7.2 C equally and "
                 "ignores warm-spell reversal, so it underestimates in a warm "
                 "winter; the Dynamic model's chill portions are the most "
                 "reliable there.")


def chill_summary(hours) -> ChillSummary:
    """All three chill models together (R5.11), with the caveat (R5.12)."""
    return ChillSummary(
        chill_hours=chill_hours(hours),
        utah_chill_units=utah_chill_units(hours),
        chill_portions=chill_portions(hours))


# ---------------------------------------------------------------------------
#  Livestock heat load
# ---------------------------------------------------------------------------

# Temperature humidity index thresholds (mild, moderate, severe) by species.
# Dairy cattle after Armstrong (1994); others from the corresponding extension
# guidance. Higher THI is more stressful.
THI_THRESHOLDS = {
    "dairy_cattle": (72.0, 79.0, 89.0),
    "beef_cattle": (75.0, 84.0, 96.0),
    "sheep": (77.0, 82.0, 90.0),
    "poultry": (70.0, 76.0, 82.0),
    "pig": (74.0, 79.0, 84.0),
}


@dataclass
class HeatLoad:
    species: str
    thi: float
    category: str                   # comfortable | mild | moderate | severe


def livestock_thi(temp_c: float | None, humidity_pct: float | None,
                  species: str = "dairy_cattle") -> HeatLoad | None:
    """Temperature humidity index and a stress category for a species.

    THI = (1.8 T + 32) - (0.55 - 0.0055 RH)(1.8 T - 26), the NRC form. The
    category uses species-specific thresholds because a THI a dairy cow finds
    severe is only mild for poultry.
    """
    if temp_c is None or humidity_pct is None:
        return None
    thresholds = THI_THRESHOLDS.get((species or "").lower())
    if thresholds is None:
        return None
    rh = max(0.0, min(100.0, humidity_pct))
    thi = ((1.8 * temp_c + 32.0)
           - (0.55 - 0.0055 * rh) * (1.8 * temp_c - 26.0))
    mild, moderate, severe = thresholds
    if thi >= severe:
        category = "severe"
    elif thi >= moderate:
        category = "moderate"
    elif thi >= mild:
        category = "mild"
    else:
        category = "comfortable"
    return HeatLoad(species=species, thi=thi, category=category)


# ---------------------------------------------------------------------------
#  Spray-time surface inversion
# ---------------------------------------------------------------------------

@dataclass
class InversionHazard:
    """Whether a surface temperature inversion is present, which traps spray and
    lets it drift. Distinct from the delta-T (wet-bulb depression) spray guide.
    """

    detected: bool
    basis: str                      # inversion | undetermined
    hours: list = field(default_factory=list)
    note: str = ""


def spray_inversion_hazard(hours) -> InversionHazard:
    """Flag a surface inversion during spraying, from two temperature heights.

    A surface inversion (air aloft warmer than at the surface) is a stable layer
    that holds fine droplets and carries them off target. It is a different
    hazard from a high delta-T, which is about droplets evaporating, so it is
    reported separately (R5.14). With only one height the basis is undetermined
    and no hazard is asserted rather than guessed.
    """
    flagged = []
    have_delta = False
    for h in hours:
        delta = _inversion_delta(h)
        if delta is None:
            continue
        have_delta = True
        if delta >= INVERSION_THRESHOLD_C:
            flagged.append(h.get("valid_at"))
    if not have_delta:
        return InversionHazard(
            detected=False, basis="undetermined",
            note="Only one temperature height, so a surface inversion cannot be "
                 "measured; no spray-drift inversion hazard is asserted.")
    if flagged:
        return InversionHazard(
            detected=True, basis="inversion", hours=flagged,
            note="Surface inversion present: fine spray can be held aloft and "
                 "drift off target. This is separate from delta-T guidance.")
    return InversionHazard(
        detected=False, basis="inversion",
        note="No surface inversion measured during the period.")
