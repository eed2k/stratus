"""Moist-air thermodynamics: density, humidity measures and derived heights.

WHY THIS MODULE EXISTS AT ALL

Air density is the quiet multiplier under both renewable-energy products, and
assuming sea level is the single largest avoidable error in this whole system.

Wind power scales with density: P = 0.5 * rho * A * U^3. A turbine on the
Highveld at 1350 m sits in air roughly 12 to 17 percent thinner than sea level,
depending on temperature, so a sea-level assumption overstates available power by
that much before any other modeling error is considered. Photovoltaic output
depends on cell temperature, which depends on the density and heat capacity of
the air carrying heat away from the module.

None of it is difficult. It just has to be done, and done with the station's own
pressure rather than a reduced value, which is why `ingest.py` insists on storing
station pressure and warns when a series looks sea-level reduced.

UNITS

    temperature      degrees Celsius on the way in and out; Kelvin internally
    pressure         hPa, and STATION pressure, not reduced to sea level
    humidity         percent
    vapor pressure   kPa, matching products.py
    density          kg/m3
    wind speed       km/h on the way in, m/s internally
    power density    W/m2

REFERENCES

    Rd, Rv, cp        CIPM-2007 / ISO 2533 standard atmosphere constants
    virtual temp      Wallace and Hobbs, Atmospheric Science, 2nd ed., eq. 3.16
    ISA profile       ISO 2533:1975 troposphere
    density altitude  inversion of the ISA density profile
    wind power        Betz/standard wind engineering, IEC 61400-12-1 air density
                      normalization
"""
from __future__ import annotations

import math

from .products import actual_vapor_pressure, saturation_vapor_pressure

# --- constants -------------------------------------------------------------

#: Specific gas constant for dry air, J/(kg K).
R_DRY = 287.058
#: Specific gas constant for water vapor, J/(kg K).
R_VAPOR = 461.495
#: Ratio of the two, dimensionless. Appears in every moist-air correction.
EPSILON = R_DRY / R_VAPOR                    # 0.6220
#: Specific heat of dry air at constant pressure, J/(kg K).
CP_DRY = 1004.67
#: Zero Celsius in Kelvin.
KELVIN = 273.15

#: ISA sea-level reference conditions.
ISA_DENSITY = 1.225                          # kg/m3
ISA_PRESSURE_HPA = 1013.25
ISA_TEMP_C = 15.0
#: ISA troposphere lapse rate, K/m.
ISA_LAPSE = 0.0065
#: Exponent in the ISA density profile.
_ISA_DENSITY_EXP = 4.25588
_ISA_DENSITY_COEF = 2.25577e-5

KMH_TO_MS = 1000.0 / 3600.0


def _ok(*values) -> bool:
    """True when every value is present and finite."""
    for v in values:
        if v is None:
            return False
        try:
            f = float(v)
        except (TypeError, ValueError):
            return False
        if f != f or f in (float("inf"), float("-inf")):
            return False
    return True


# ---------------------------------------------------------------------------
#  Humidity measures
# ---------------------------------------------------------------------------

def vapor_pressure_hpa(temp_c: float | None,
                       humidity_pct: float | None) -> float | None:
    """Actual vapor pressure in hPa.

    products.py works in kPa because FAO-56 does. Density work is in hPa and Pa,
    so the conversion happens here once rather than at every call site.
    """
    if not _ok(temp_c, humidity_pct):
        return None
    rh = max(0.0, min(100.0, float(humidity_pct)))
    return actual_vapor_pressure(float(temp_c), rh) * 10.0


def specific_humidity(temp_c: float | None, humidity_pct: float | None,
                      pressure_hpa: float | None) -> float | None:
    """Mass of water vapor per unit mass of moist air, kg/kg."""
    e = vapor_pressure_hpa(temp_c, humidity_pct)
    if e is None or not _ok(pressure_hpa) or float(pressure_hpa) <= 0:
        return None
    p = float(pressure_hpa)
    e = min(e, p * 0.999)          # cannot exceed total pressure
    return (EPSILON * e) / (p - (1.0 - EPSILON) * e)


def mixing_ratio(temp_c: float | None, humidity_pct: float | None,
                 pressure_hpa: float | None) -> float | None:
    """Mass of water vapor per unit mass of DRY air, kg/kg.

    Distinct from specific humidity, and the difference matters at high humidity.
    Conserved under vertical motion, which is why it is the one to use when
    comparing air at two heights.
    """
    e = vapor_pressure_hpa(temp_c, humidity_pct)
    if e is None or not _ok(pressure_hpa) or float(pressure_hpa) <= 0:
        return None
    p = float(pressure_hpa)
    e = min(e, p * 0.999)
    return (EPSILON * e) / (p - e)


def absolute_humidity(temp_c: float | None,
                      humidity_pct: float | None) -> float | None:
    """Water vapor mass per cubic meter of air, g/m3.

    What a grower means by "how much moisture is in the air", and independent of
    pressure, unlike relative humidity.
    """
    e = vapor_pressure_hpa(temp_c, humidity_pct)
    if e is None or not _ok(temp_c):
        return None
    t_k = float(temp_c) + KELVIN
    if t_k <= 0:
        return None
    # e in hPa -> Pa, result kg/m3 -> g/m3
    return (e * 100.0) / (R_VAPOR * t_k) * 1000.0


# ---------------------------------------------------------------------------
#  Virtual temperature and density
# ---------------------------------------------------------------------------

def virtual_temperature_c(temp_c: float | None, humidity_pct: float | None,
                          pressure_hpa: float | None) -> float | None:
    """Virtual temperature in degrees C.

    The temperature dry air would need in order to have the density that this
    moist air actually has. Moist air is LESS dense than dry air at the same
    temperature and pressure, because a water molecule is lighter than the
    nitrogen or oxygen it displaces, so the virtual temperature is always at or
    above the actual temperature.

    Ignoring it is a small error, a few tenths of a percent in density in
    temperate conditions, but it is free to include and it becomes real in warm
    humid air. Wallace and Hobbs eq. 3.16.
    """
    e = vapor_pressure_hpa(temp_c, humidity_pct)
    if e is None or not _ok(temp_c, pressure_hpa) or float(pressure_hpa) <= 0:
        return None
    t_k = float(temp_c) + KELVIN
    p = float(pressure_hpa)
    denom = 1.0 - (e / p) * (1.0 - EPSILON)
    if denom <= 0:
        return None
    return (t_k / denom) - KELVIN


def air_density(temp_c: float | None, pressure_hpa: float | None,
                humidity_pct: float | None = None) -> float | None:
    """Moist-air density in kg/m3, from the ideal gas law.

    `humidity_pct` is optional. Omitting it computes dry-air density, which is
    within a fraction of a percent in cool dry conditions and is the right
    fallback for a station with no humidity sensor. Passing it applies the
    virtual-temperature correction.
    """
    if not _ok(temp_c, pressure_hpa) or float(pressure_hpa) <= 0:
        return None
    if humidity_pct is None:
        t_eff = float(temp_c)
    else:
        tv = virtual_temperature_c(temp_c, humidity_pct, pressure_hpa)
        t_eff = tv if tv is not None else float(temp_c)
    t_k = t_eff + KELVIN
    if t_k <= 0:
        return None
    return (float(pressure_hpa) * 100.0) / (R_DRY * t_k)


def air_density_ratio(temp_c: float | None, pressure_hpa: float | None,
                      humidity_pct: float | None = None) -> float | None:
    """Density as a fraction of the ISA sea-level value of 1.225 kg/m3.

    This is the number to quote when explaining why a nameplate figure will not
    be met. A ratio of 0.86 means every wind power estimate taken from a
    sea-level power curve is 14 percent optimistic.
    """
    rho = air_density(temp_c, pressure_hpa, humidity_pct)
    if rho is None:
        return None
    return rho / ISA_DENSITY


def density_altitude_m(temp_c: float | None, pressure_hpa: float | None,
                       humidity_pct: float | None = None) -> float | None:
    """The ISA altitude at which the standard atmosphere has this density.

    Familiar to anyone who has flown out of a high-altitude airfield on a hot
    day, and the most intuitive single number for "how thin is the air here
    really". A site at 1350 m on a 30 degree afternoon behaves like 2000 m or
    more.
    """
    ratio = air_density_ratio(temp_c, pressure_hpa, humidity_pct)
    if ratio is None or ratio <= 0:
        return None
    return (1.0 - ratio ** (1.0 / _ISA_DENSITY_EXP)) / _ISA_DENSITY_COEF


def potential_temperature_c(temp_c: float | None,
                            pressure_hpa: float | None,
                            reference_hpa: float = 1000.0) -> float | None:
    """Potential temperature in degrees C.

    Temperature an air parcel would have if brought adiabatically to the
    reference pressure. Two air masses at different heights are only comparable
    through this, which is what makes it the basis of any stability or inversion
    calculation.
    """
    if not _ok(temp_c, pressure_hpa) or float(pressure_hpa) <= 0:
        return None
    t_k = float(temp_c) + KELVIN
    return t_k * (reference_hpa / float(pressure_hpa)) ** (R_DRY / CP_DRY) \
        - KELVIN


# ---------------------------------------------------------------------------
#  Pressure reduction, both directions
# ---------------------------------------------------------------------------

def sea_level_pressure_hpa(station_hpa: float | None, temp_c: float | None,
                           elevation_m: float | None) -> float | None:
    """Reduce a station reading to mean sea level.

    Provided so a station can be compared against a synoptic chart or a weather
    API that reports reduced pressure, and so the ingest warning about a
    sea-level-looking series can be checked rather than guessed at. The forecast
    itself never uses reduced pressure.

    Uses the hypsometric relation with the mean of the station and an assumed
    sea-level temperature, which is the usual meteorological convention.
    """
    if not _ok(station_hpa, temp_c, elevation_m) or float(station_hpa) <= 0:
        return None
    h = float(elevation_m)
    t_mean_k = float(temp_c) + KELVIN + (ISA_LAPSE * h) / 2.0
    if t_mean_k <= 0:
        return None
    return float(station_hpa) * math.exp((9.80665 * h) / (R_DRY * t_mean_k))


def station_pressure_hpa(sea_level_hpa: float | None, temp_c: float | None,
                         elevation_m: float | None) -> float | None:
    """The inverse: what a barometer at `elevation_m` would read.

    Useful for a station whose logger reports only reduced pressure, so its
    series can be brought back to the convention everything else here uses
    rather than being silently blended against a model's station pressure.
    """
    if not _ok(sea_level_hpa, temp_c, elevation_m) or float(sea_level_hpa) <= 0:
        return None
    h = float(elevation_m)
    t_mean_k = float(temp_c) + KELVIN + (ISA_LAPSE * h) / 2.0
    if t_mean_k <= 0:
        return None
    return float(sea_level_hpa) / math.exp((9.80665 * h) / (R_DRY * t_mean_k))


def isa_pressure_hpa(elevation_m: float | None) -> float | None:
    """Standard-atmosphere pressure at a height, hPa.

    A sanity reference: a station reading far from this at its stated elevation
    has either a mis-entered elevation or a drifting barometer.
    """
    if not _ok(elevation_m):
        return None
    h = float(elevation_m)
    return ISA_PRESSURE_HPA * (1.0 - (ISA_LAPSE * h)
                               / (ISA_TEMP_C + KELVIN)) ** 5.25588


# ---------------------------------------------------------------------------
#  Wind power density
# ---------------------------------------------------------------------------

def wind_power_density(speed_kmh: float | None,
                       density: float | None = None) -> float | None:
    """Available power per unit swept area, W/m2.

    P/A = 0.5 * rho * U^3. The cube is why a wind resource is so sensitive to
    speed, and why averaging speed and then cubing it understates the resource
    badly: always cube each sample and then average.

    `density` defaults to the ISA sea-level value, which is the wrong choice at
    altitude and is only the default so a caller with no pressure reading still
    gets a number. Pass the real density.
    """
    if not _ok(speed_kmh):
        return None
    u = max(0.0, float(speed_kmh)) * KMH_TO_MS
    rho = ISA_DENSITY if density is None else float(density)
    if rho <= 0:
        return None
    return 0.5 * rho * (u ** 3)


def mean_wind_power_density(samples) -> float | None:
    """Mean of the per-sample power densities.

    `samples` is an iterable of (speed_kmh, density) pairs, density optional.

    This exists to make the cube-then-average order impossible to get wrong. The
    mean of U^3 exceeds the cube of mean U by a factor that depends on the
    distribution: for a typical Weibull k near 2 it is about 1.9, so using mean
    speed halves the apparent resource.
    """
    total = 0.0
    n = 0
    for item in samples or ():
        if isinstance(item, (tuple, list)):
            speed = item[0]
            rho = item[1] if len(item) > 1 else None
        else:
            speed, rho = item, None
        pd = wind_power_density(speed, rho)
        if pd is not None:
            total += pd
            n += 1
    if not n:
        return None
    return total / n


def density_corrected_speed(speed_kmh: float | None,
                            density: float | None) -> float | None:
    """Speed that would give the same power density at ISA sea level, km/h.

    The normalization in IEC 61400-12-1: rather than adjusting a manufacturer's
    power curve, adjust the measured wind speed by (rho/rho0)^(1/3) and read the
    standard curve. Equivalent, and far less error-prone than rescaling a curve.
    """
    if not _ok(speed_kmh, density) or float(density) <= 0:
        return None
    return float(speed_kmh) * (float(density) / ISA_DENSITY) ** (1.0 / 3.0)


# ---------------------------------------------------------------------------
#  Summary for display
# ---------------------------------------------------------------------------

def air_summary(temp_c: float | None, pressure_hpa: float | None,
                humidity_pct: float | None = None,
                elevation_m: float | None = None) -> dict:
    """Everything above in one dict, for a panel or a report row.

    Keys are None where an input was missing, so a caller can render a partial
    row rather than having to pre-check which sensors a station has.
    """
    rho = air_density(temp_c, pressure_hpa, humidity_pct)
    ratio = air_density_ratio(temp_c, pressure_hpa, humidity_pct)
    out = {
        "density": rho,
        "density_ratio": ratio,
        "density_deficit_pct": (None if ratio is None
                                else (1.0 - ratio) * 100.0),
        "density_altitude_m": density_altitude_m(temp_c, pressure_hpa,
                                                 humidity_pct),
        "virtual_temperature": virtual_temperature_c(temp_c, humidity_pct,
                                                     pressure_hpa),
        "specific_humidity": specific_humidity(temp_c, humidity_pct,
                                               pressure_hpa),
        "mixing_ratio": mixing_ratio(temp_c, humidity_pct, pressure_hpa),
        "absolute_humidity": absolute_humidity(temp_c, humidity_pct),
        "potential_temperature": potential_temperature_c(temp_c, pressure_hpa),
        "vapor_pressure_hpa": vapor_pressure_hpa(temp_c, humidity_pct),
        "saturation_vapor_pressure_hpa": (
            saturation_vapor_pressure(float(temp_c)) * 10.0
            if _ok(temp_c) else None),
    }
    if _ok(elevation_m):
        out["sea_level_pressure"] = sea_level_pressure_hpa(
            pressure_hpa, temp_c, elevation_m)
        out["isa_pressure_at_elevation"] = isa_pressure_hpa(elevation_m)
        expected = out["isa_pressure_at_elevation"]
        if expected and _ok(pressure_hpa):
            # A barometer more than about 40 hPa from the standard atmosphere at
            # its stated elevation is reporting the wrong thing, or the elevation
            # is wrong. Either way it invalidates every density figure above.
            out["pressure_plausible"] = abs(float(pressure_hpa)
                                            - expected) <= 40.0
    return out
