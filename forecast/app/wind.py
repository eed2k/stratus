"""Wind resource assessment: shear, power density, Weibull, sectors, extremes.

WHAT A WIND DEVELOPER ACTUALLY ASKS

  Not "how windy is it" but "how much energy, and how much of that number is
  measurement rather than assumption". So every extrapolated figure here carries
  its provenance, and the two quantities that are routinely confused, the gust
  factor and the turbulence intensity, are kept strictly apart.

UNITS

  Wind speed is km/h throughout, the forecast's canonical unit, so a series from
  the engine or from observations goes straight in. The one exception is a
  manufacturer power curve, which is conventionally in m/s; the speed is
  converted for the lookup and this is stated where it happens.

THE TRAPS THIS MODULE IS BUILT AROUND

  Power density is the mean of the cubes, never the cube of the mean, so it is
  delegated to thermo.mean_wind_power_density which cannot get that order wrong.
  Air density lowers the resource at altitude, so it is carried through. A
  direction is circular, so every direction output is vector arithmetic and a
  mean of 350 and 10 degrees is 0, not 180. And turbulence intensity needs a
  wind SPEED standard deviation, which the Stratus vocabulary does not carry;
  windDirStdDev is direction scatter and a different quantity, so it is never
  passed here as sigma_u.

NONE, NOT ZERO

  A station with no anemometer gets None from every entry point and no page
  raises.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from . import thermo
from . import probabilistic

# Open, flat terrain power-law exponent, the one-seventh law. Used and labelled
# as assumed when a second measurement height is not available (which, for the
# Stratus vocabulary, is almost always).
DEFAULT_SHEAR_EXPONENT = 0.143

# IEC 61400-1 reference turbulence intensities for the three turbulence
# categories. Higher means more turbulent: category A is the most demanding.
IEC_REFERENCE_TI = {"A": 0.16, "B": 0.14, "C": 0.12}

KMH_TO_MS = thermo.KMH_TO_MS


def _ok(*values) -> bool:
    return all(v is not None for v in values)


def _clean(values) -> list[float]:
    out = []
    for v in values or ():
        if v is None:
            continue
        try:
            out.append(float(v))
        except (TypeError, ValueError):
            continue
    return out


# ---------------------------------------------------------------------------
#  Shear
# ---------------------------------------------------------------------------

@dataclass
class WindShear:
    """An extrapolated hub-height wind, and where its exponent came from."""

    speed_kmh: float
    exponent: float
    basis: str                 # "measured" or "assumed"
    measurement_height_m: float
    hub_height_m: float


def shear_exponent(speed_low: float | None, height_low: float | None,
                   speed_high: float | None,
                   height_high: float | None) -> float | None:
    """Power-law exponent from two heights: alpha = ln(v2/v1) / ln(h2/h1)."""
    if not _ok(speed_low, height_low, speed_high, height_high):
        return None
    if (speed_low <= 0.0 or speed_high <= 0.0
            or height_low <= 0.0 or height_high <= 0.0
            or height_low == height_high):
        return None
    return math.log(speed_high / speed_low) / math.log(height_high / height_low)


def extrapolate_to_hub(speed_kmh: float | None,
                       measurement_height_m: float | None,
                       hub_height_m: float | None, *,
                       exponent: float | None = None,
                       second_speed_kmh: float | None = None,
                       second_height_m: float | None = None,
                       roughness_default: float = DEFAULT_SHEAR_EXPONENT
                       ) -> WindShear | None:
    """Extrapolate a wind speed to hub height by the power law.

    The exponent is measured from a second height when one is present and
    labeled `measured`; otherwise a documented roughness default is used and
    labeled `assumed`. The label is the point: for the Stratus vocabulary, which
    has no second wind height, the assumed path is the normal one, and a reader
    must not mistake an assumption for a measurement.
    """
    if not _ok(speed_kmh, measurement_height_m, hub_height_m):
        return None
    if measurement_height_m <= 0.0 or hub_height_m <= 0.0:
        return None

    measured = shear_exponent(speed_kmh, measurement_height_m,
                              second_speed_kmh, second_height_m)
    if measured is not None:
        alpha, basis = measured, "measured"
    elif exponent is not None:
        alpha, basis = float(exponent), "assumed"
    else:
        alpha, basis = roughness_default, "assumed"

    speed_hub = speed_kmh * (hub_height_m / measurement_height_m) ** alpha
    return WindShear(speed_kmh=speed_hub, exponent=alpha, basis=basis,
                     measurement_height_m=measurement_height_m,
                     hub_height_m=hub_height_m)


# ---------------------------------------------------------------------------
#  Power density
# ---------------------------------------------------------------------------

def power_density(speed_kmh: float | None,
                  density: float | None = None) -> float | None:
    """Instantaneous wind power density, W/m2. Delegates to thermo."""
    return thermo.wind_power_density(speed_kmh, density)


def mean_power_density(speeds_kmh, density: float | None = None
                       ) -> float | None:
    """Mean wind power density over a series, W/m2.

    Delegates to thermo.mean_wind_power_density so the cube-then-average order
    and the density correction are inherited and cannot be got wrong here.
    """
    speeds = _clean(speeds_kmh)
    if not speeds:
        return None
    return thermo.mean_wind_power_density((s, density) for s in speeds)


# ---------------------------------------------------------------------------
#  Weibull
# ---------------------------------------------------------------------------

@dataclass
class Weibull:
    """A fitted wind-speed distribution, speeds in km/h."""

    shape: float               # k
    scale: float               # c, km/h
    mean_speed: float


def weibull_fit(speeds_kmh) -> Weibull | None:
    """Fit Weibull shape and scale by the method of moments.

    k from the coefficient of variation, Justus (1978): k = (sd/mean)^-1.086,
    then c = mean / Gamma(1 + 1/k). Cheap, closed-form and standard for a wind
    resource, where the tail is what matters and a maximum-likelihood refinement
    changes little.
    """
    speeds = [s for s in _clean(speeds_kmh) if s >= 0.0]
    if len(speeds) < 3:
        return None
    mean = sum(speeds) / len(speeds)
    if mean <= 0.0:
        return None
    var = sum((s - mean) ** 2 for s in speeds) / len(speeds)
    sd = math.sqrt(var)
    if sd <= 0.0:
        return None
    k = (sd / mean) ** -1.086
    k = max(0.5, min(6.0, k))
    c = mean / math.gamma(1.0 + 1.0 / k)
    return Weibull(shape=k, scale=c, mean_speed=mean)


# ---------------------------------------------------------------------------
#  Direction: everything circular
# ---------------------------------------------------------------------------

def circular_mean_direction(directions) -> float | None:
    """Vector mean of compass directions, degrees in 0 to 360.

    Averaging degrees arithmetically is the classic bug: the mean of 350 and 10
    is 0, not 180. Summing unit vectors and taking the angle back is the only
    correct way.
    """
    dirs = _clean(directions)
    if not dirs:
        return None
    sin_sum = sum(math.sin(math.radians(d)) for d in dirs)
    cos_sum = sum(math.cos(math.radians(d)) for d in dirs)
    if abs(sin_sum) < 1e-12 and abs(cos_sum) < 1e-12:
        return None                    # directions cancel; no prevailing wind
    return math.degrees(math.atan2(sin_sum, cos_sum)) % 360.0


def sector_index(direction_deg: float, n_sectors: int = 12) -> int:
    """Which sector a direction falls in, 0-based, sector 0 centered on north."""
    width = 360.0 / n_sectors
    return int((direction_deg % 360.0 + width / 2.0) // width) % n_sectors


@dataclass
class SectorStat:
    center_deg: float
    count: int
    frequency: float           # fraction of the record
    mean_speed_kmh: float
    power_density_wm2: float | None


def sector_statistics(records, n_sectors: int = 12,
                      density: float | None = None) -> list[SectorStat] | None:
    """Per-direction-sector wind statistics.

    `records` is an iterable of (speed_kmh, direction_deg). Twelve sectors by
    default, each 30 degrees, sector 0 centered on north. Power density per
    sector is the mean of the cubes within the sector.
    """
    pairs = [(float(s), float(d)) for s, d in (records or ())
             if s is not None and d is not None]
    if not pairs:
        return None
    width = 360.0 / n_sectors
    buckets: list[list[float]] = [[] for _ in range(n_sectors)]
    for speed, direction in pairs:
        buckets[sector_index(direction, n_sectors)].append(speed)
    total = len(pairs)
    stats = []
    for i, speeds in enumerate(buckets):
        if speeds:
            mean_speed = sum(speeds) / len(speeds)
            pd = mean_power_density(speeds, density)
        else:
            mean_speed, pd = 0.0, 0.0
        stats.append(SectorStat(
            center_deg=(i * width) % 360.0, count=len(speeds),
            frequency=len(speeds) / total, mean_speed_kmh=mean_speed,
            power_density_wm2=pd))
    return stats


def prevailing_direction(records, n_sectors: int = 12) -> float | None:
    """The center of the sector that carries the most wind energy, 0 to 360.

    Weighted by energy, not by count: a wind resource cares where the power
    comes from, and a few strong hours matter more than many calm ones.
    """
    stats = sector_statistics(records, n_sectors)
    if not stats:
        return None
    energetic = max(stats, key=lambda s: (s.power_density_wm2 or 0.0) * s.count)
    if energetic.count == 0:
        return None
    return energetic.center_deg


# ---------------------------------------------------------------------------
#  Annual energy production
# ---------------------------------------------------------------------------

def interpolate_power(power_curve, speed_ms: float) -> float:
    """Turbine power (kW) at a wind speed (m/s) by linear interpolation.

    `power_curve` is a sequence of (speed_ms, power_kw) sorted by speed. Below
    the first point or above the last it is zero, which captures cut-in and
    cut-out without needing them named separately.
    """
    curve = sorted((float(s), float(p)) for s, p in power_curve)
    if not curve or speed_ms < curve[0][0] or speed_ms > curve[-1][0]:
        return 0.0
    prev_s, prev_p = curve[0]
    for s, p in curve:
        if speed_ms <= s:
            if s == prev_s:
                return p
            frac = (speed_ms - prev_s) / (s - prev_s)
            return prev_p + frac * (p - prev_p)
        prev_s, prev_p = s, p
    return curve[-1][1]


def annual_energy_production(speeds_kmh, power_curve,
                             availability: float = 1.0) -> float | None:
    """Expected annual energy, kWh, from a wind series and a power curve.

    The mean turbine power over the representative series, times the hours in a
    year, times an availability factor. The power curve is in m/s by convention,
    so each speed is converted for the lookup.
    """
    speeds = _clean(speeds_kmh)
    if not speeds or not power_curve:
        return None
    powers = [interpolate_power(power_curve, s * KMH_TO_MS) for s in speeds]
    mean_power_kw = sum(powers) / len(powers)
    return mean_power_kw * 8760.0 * max(0.0, min(1.0, availability))


def energy_exceedance(member_values, exceedance_pct: float) -> float | None:
    """P50/P90 from an ensemble of AEP or speed members.

    Thin wrapper over probabilistic.exceedance_level so the meaning of P90 is
    the one used everywhere else: the value exceeded 90 percent of the time.
    """
    return probabilistic.exceedance_level(_clean(member_values), exceedance_pct)


# ---------------------------------------------------------------------------
#  Gust factor and turbulence: kept strictly apart
# ---------------------------------------------------------------------------

@dataclass
class Turbulence:
    """Gust factor is always available; turbulence intensity only from a real
    wind-speed standard deviation."""

    gust_factor: float | None
    turbulence_intensity: float | None
    iec_class: str | None
    note: str = ""


def iec_turbulence_class(turbulence_intensity: float | None) -> str | None:
    """IEC 61400-1 turbulence category from a representative intensity.

    Compared against the reference intensities 0.12, 0.14 and 0.16. A rigorous
    classification uses the 90th-percentile intensity at 15 m/s; this compares
    the supplied representative value and names the lowest category it fits.
    """
    if turbulence_intensity is None:
        return None
    ti = turbulence_intensity
    if ti <= IEC_REFERENCE_TI["C"]:
        return "C"
    if ti <= IEC_REFERENCE_TI["B"]:
        return "B"
    if ti <= IEC_REFERENCE_TI["A"]:
        return "A"
    return "exceeds A"


def describe_turbulence(mean_speed_kmh: float | None,
                        gust_kmh: float | None = None,
                        sigma_u_kmh: float | None = None) -> Turbulence | None:
    """Gust factor and, only when a true wind-speed sigma is given, turbulence
    intensity and the IEC class.

    `sigma_u_kmh` must be a standard deviation of wind SPEED. windDirStdDev is
    direction scatter and must never be passed here: it would produce a number
    that looks like turbulence intensity and is not, and an engineer would size
    a turbine against it.
    """
    if not _ok(mean_speed_kmh) or mean_speed_kmh <= 0.0:
        return None

    gust_factor = None
    if gust_kmh is not None and gust_kmh >= 0.0:
        gust_factor = gust_kmh / mean_speed_kmh

    if sigma_u_kmh is not None and sigma_u_kmh >= 0.0:
        ti = sigma_u_kmh / mean_speed_kmh
        return Turbulence(gust_factor=gust_factor, turbulence_intensity=ti,
                          iec_class=iec_turbulence_class(ti),
                          note="turbulence intensity from a measured wind-speed "
                               "standard deviation")
    return Turbulence(gust_factor=gust_factor, turbulence_intensity=None,
                      iec_class=None,
                      note="no wind-speed standard deviation available; gust "
                           "factor shown, turbulence intensity not computed")


# ---------------------------------------------------------------------------
#  Extreme wind
# ---------------------------------------------------------------------------

@dataclass
class ExtremeWind:
    speed_kmh: float
    return_period_years: int
    record_years: int


def gumbel_extreme(annual_maxima_kmh, return_period_years: int = 50
                   ) -> ExtremeWind | None:
    """The N-year extreme wind by a Gumbel fit to annual maxima.

    Method of moments: scale beta = sd * sqrt(6) / pi, location mu = mean -
    0.5772 * beta, then the return level mu - beta * ln(-ln(1 - 1/T)). The record
    length is reported alongside because a 50-year estimate from three years of
    maxima is an extrapolation the reader must be able to judge.
    """
    maxima = _clean(annual_maxima_kmh)
    if len(maxima) < 2 or return_period_years < 2:
        return None
    mean = sum(maxima) / len(maxima)
    var = sum((m - mean) ** 2 for m in maxima) / len(maxima)
    sd = math.sqrt(var)
    if sd <= 0.0:
        return None
    beta = sd * math.sqrt(6.0) / math.pi
    mu = mean - 0.5772156649 * beta
    t = return_period_years
    level = mu - beta * math.log(-math.log(1.0 - 1.0 / t))
    return ExtremeWind(speed_kmh=level, return_period_years=t,
                       record_years=len(maxima))
