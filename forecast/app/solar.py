"""Solar geometry, irradiance decomposition, plane-of-array, and PV yield.

WHY THIS EXISTS

  Global horizontal irradiance is what a pyranometer measures and what the
  engine forecasts. It is not what a tilted module receives, and the gap between
  the two is neither small nor constant: it swings with the sun's height, the
  clearness of the sky and the tilt of the array. A solar developer is paid for
  plane-of-array irradiance, so this module carries global horizontal all the
  way to the plane, and then to a modeled module temperature and DC yield.

THREE STAGES

  1. Position. Where the sun is, in naive local standard time. Spencer (1971)
     for declination and the equation of time, Kasten and Young (1989) for air
     mass. Azimuth by atan2, never acos, because acos is ambiguous either side
     of solar noon.

  2. Decomposition. Split GHI into a direct-normal beam (DNI) and a diffuse
     horizontal part (DHI) with the Erbs, Klein and Duffie (1982) diffuse
     fraction. Below three degrees of elevation the beam diverges, so everything
     is attributed to diffuse there rather than reporting an enormous beam.

  3. Transposition and yield. Beam onto the plane by geometry, sky diffuse by
     Hay and Davies (1980), a ground-reflected term from an albedo table, and an
     ASHRAE incidence-angle modifier for reflection off the glass. Then Faiman
     (2008) module temperature and a temperature derate.

SOUTHERN HEMISPHERE

  A fixed array's optimal surface azimuth is derived from the sign of the
  latitude, so a southern site faces north at azimuth 0. It is never hard coded.

NONE, NOT ZERO, NOT AN EXCEPTION

  A station with no pyranometer gets None from every entry point, and no page
  raises. Zero is a measurement (the sun is down); None is the absence of a
  sensor. The two are never conflated.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from . import thermo

# Extraterrestrial normal irradiance, the solar constant. The modern accepted
# value (Kopp and Lean, 2011). Nothing at the surface can exceed it.
SOLAR_CONSTANT = 1361.0

# Below this solar elevation the 1/cos(zenith) in the beam split diverges and a
# direct-normal figure stops meaning anything, so all irradiance is called
# diffuse. Three degrees is the conventional cutoff.
MIN_BEAM_ELEVATION_DEG = 3.0

# Faiman (2008) convective coefficients for a glass-backsheet module, the values
# in the original paper. U0 is the wind-independent loss, U1 the wind-driven one.
FAIMAN_U0 = 25.0
FAIMAN_U1 = 6.84

# Crystalline-silicon power temperature coefficient, per degree Celsius. A
# module loses about 0.35 percent of its output per degree above 25 C.
DEFAULT_POWER_TEMP_COEFF = -0.0035

# Ground albedo by surface, fraction reflected. The default is short green
# grass. Values from the Liu and Jordan / ASHRAE tables.
ALBEDO = {
    "grass": 0.20,
    "green_grass": 0.23,
    "dry_grass": 0.28,
    "soil": 0.17,
    "sand": 0.30,
    "concrete": 0.25,
    "asphalt": 0.12,
    "snow": 0.80,
    "water": 0.07,
    "crop": 0.23,
}
DEFAULT_ALBEDO = ALBEDO["grass"]

# ASHRAE incidence-angle-modifier coefficient for a single glass cover.
_ASHRAE_B0 = 0.05


def _ok(*values) -> bool:
    return all(v is not None for v in values)


# ---------------------------------------------------------------------------
#  Structures
# ---------------------------------------------------------------------------

@dataclass
class SolarPosition:
    """Where the sun is, all angles in degrees except the air mass."""

    elevation: float
    zenith: float
    azimuth: float          # clockwise from true north, 0 to 360
    declination: float
    hour_angle: float
    air_mass: float | None  # None when the sun is at or below the horizon

    @property
    def is_up(self) -> bool:
        return self.elevation > 0.0


@dataclass
class Components:
    """A global horizontal irradiance split into its parts, all W/m2."""

    ghi: float
    dni: float              # direct normal
    dhi: float              # diffuse horizontal
    clearness_index: float  # kt, GHI over extraterrestrial horizontal


@dataclass
class PlaneOfArray:
    """Irradiance on a tilted plane, all W/m2 unless noted.

    `global_` is the geometric transposition and equals GHI exactly at zero
    tilt. `effective` additionally applies the incidence-angle modifier to the
    beam, which is the number a yield model should use; it is kept separate so
    the geometric invariant is not muddied by an optical loss.
    """

    global_: float
    beam: float
    diffuse: float
    ground: float
    aoi: float              # angle of incidence, degrees
    iam: float              # incidence-angle modifier applied to the beam
    effective: float


# ---------------------------------------------------------------------------
#  Stage 1: position
# ---------------------------------------------------------------------------

def _spencer(day_angle: float) -> tuple[float, float]:
    """Declination (radians) and equation of time (minutes), Spencer (1971)."""
    g = day_angle
    decl = (0.006918
            - 0.399912 * math.cos(g) + 0.070257 * math.sin(g)
            - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
            - 0.002697 * math.cos(3 * g) + 0.001480 * math.sin(3 * g))
    eot = 229.18 * (0.000075
                    + 0.001868 * math.cos(g) - 0.032077 * math.sin(g)
                    - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    return decl, eot


def _eccentricity(day_angle: float) -> float:
    """Earth-sun distance correction to the solar constant, Spencer (1971)."""
    g = day_angle
    return (1.000110
            + 0.034221 * math.cos(g) + 0.001280 * math.sin(g)
            + 0.000719 * math.cos(2 * g) + 0.000077 * math.sin(2 * g))


def solar_position(when: datetime | None, latitude_deg: float | None,
                   longitude_deg: float | None,
                   utc_offset_hours: float | None = 2.0
                   ) -> SolarPosition | None:
    """The sun's position at a naive local-standard-time instant.

    Naive on purpose: a logger runs in local standard time and does not shift
    for daylight saving, so the timestamp is treated as local standard time and
    the station's fixed UTC offset places its meridian.
    """
    if not _ok(when, latitude_deg, longitude_deg, utc_offset_hours):
        return None

    lat = math.radians(latitude_deg)
    n = when.timetuple().tm_yday
    hour = when.hour + when.minute / 60.0 + when.second / 3600.0
    day_angle = 2 * math.pi / 365.0 * (n - 1 + (hour - 12.0) / 24.0)

    decl, eot = _spencer(day_angle)

    # Local standard time meridian for the station's offset, then the correction
    # from the true longitude and the equation of time, in minutes.
    lstm = 15.0 * utc_offset_hours
    time_correction = 4.0 * (longitude_deg - lstm) + eot
    solar_time = hour + time_correction / 60.0
    hour_angle = math.radians(15.0 * (solar_time - 12.0))

    sin_elev = (math.sin(lat) * math.sin(decl)
                + math.cos(lat) * math.cos(decl) * math.cos(hour_angle))
    sin_elev = max(-1.0, min(1.0, sin_elev))
    elevation = math.asin(sin_elev)
    zenith = math.pi / 2.0 - elevation

    # Azimuth clockwise from north via atan2, unambiguous across noon. The +pi
    # turns the astronomical from-south convention into from-north.
    az = math.atan2(
        math.sin(hour_angle),
        math.cos(hour_angle) * math.sin(lat) - math.tan(decl) * math.cos(lat))
    azimuth = (math.degrees(az) + 180.0) % 360.0

    elev_deg = math.degrees(elevation)
    air_mass = None
    if elev_deg > 0.0:
        # Kasten and Young (1989).
        zen_deg = math.degrees(zenith)
        air_mass = 1.0 / (math.cos(zenith)
                          + 0.50572 * (96.07995 - zen_deg) ** -1.6364)

    return SolarPosition(
        elevation=elev_deg, zenith=math.degrees(zenith), azimuth=azimuth,
        declination=math.degrees(decl),
        hour_angle=math.degrees(hour_angle), air_mass=air_mass)


def extraterrestrial_normal(when: datetime | None) -> float | None:
    """Top-of-atmosphere normal irradiance for the date, W/m2."""
    if when is None:
        return None
    n = when.timetuple().tm_yday
    day_angle = 2 * math.pi / 365.0 * (n - 1)
    return SOLAR_CONSTANT * _eccentricity(day_angle)


def extraterrestrial_horizontal(when: datetime | None,
                                position: SolarPosition | None
                                ) -> float | None:
    """Top-of-atmosphere irradiance on a horizontal surface, W/m2."""
    if not _ok(when, position):
        return None
    if not position.is_up:
        return 0.0
    i0n = extraterrestrial_normal(when)
    return i0n * math.cos(math.radians(position.zenith))


# ---------------------------------------------------------------------------
#  Stage 2: clear sky and decomposition
# ---------------------------------------------------------------------------

def clear_sky_ghi(position: SolarPosition | None,
                  provider_wm2: float | None = None
                  ) -> tuple[float, str] | None:
    """Clear-sky global horizontal irradiance and where it came from.

    A provider's own clear-sky figure is preferred when one is available for the
    hour, because it can carry turbidity information a station cannot measure.
    Otherwise Haurwitz (1945), which needs only the solar elevation. Haurwitz is
    chosen over Ineichen or Bird deliberately: those are more accurate but need
    Linke turbidity or aerosol optical depth, and substituting a climatological
    guess for a measurement, then presenting it as site-specific, would be
    dishonest. The source is returned so a reader knows which they are seeing.
    """
    if position is None:
        return None
    if provider_wm2 is not None and provider_wm2 >= 0.0:
        return float(provider_wm2), "provider"
    if not position.is_up:
        return 0.0, "haurwitz"
    cos_z = math.cos(math.radians(position.zenith))
    if cos_z <= 0.0:
        return 0.0, "haurwitz"
    ghi = 1098.0 * cos_z * math.exp(-0.059 / cos_z)
    return max(0.0, ghi), "haurwitz"


def _erbs_diffuse_fraction(kt: float) -> float:
    """Diffuse fraction of GHI from the clearness index, Erbs et al. (1982)."""
    if kt <= 0.22:
        return 1.0 - 0.09 * kt
    if kt <= 0.80:
        return (0.9511 - 0.1604 * kt + 4.388 * kt ** 2
                - 16.638 * kt ** 3 + 12.336 * kt ** 4)
    return 0.165


def decompose(ghi: float | None, position: SolarPosition | None,
              when: datetime | None) -> Components | None:
    """Split GHI into DNI and DHI.

    Closure holds by construction: DHI plus the horizontal projection of the
    beam, DNI times cos(zenith), returns GHI to within rounding for every hour
    above the low-sun cutoff, and exactly (beam zero) below it.
    """
    if not _ok(ghi, position, when):
        return None
    if not position.is_up or ghi <= 0.0:
        return Components(ghi=0.0, dni=0.0, dhi=0.0, clearness_index=0.0)

    i0h = extraterrestrial_horizontal(when, position)
    if not i0h or i0h <= 0.0:
        return Components(ghi=ghi, dni=0.0, dhi=ghi, clearness_index=0.0)

    kt = max(0.0, min(1.0, ghi / i0h))

    # Below the cutoff the beam split diverges, so call it all diffuse.
    if position.elevation < MIN_BEAM_ELEVATION_DEG:
        return Components(ghi=ghi, dni=0.0, dhi=ghi, clearness_index=kt)

    df = _erbs_diffuse_fraction(kt)
    dhi = df * ghi
    cos_z = math.cos(math.radians(position.zenith))
    dni = (ghi - dhi) / cos_z if cos_z > 0.0 else 0.0
    # Physical ceiling: direct normal cannot exceed the extraterrestrial normal.
    i0n = extraterrestrial_normal(when) or SOLAR_CONSTANT
    dni = max(0.0, min(dni, i0n))
    return Components(ghi=ghi, dni=dni, dhi=dhi, clearness_index=kt)


# ---------------------------------------------------------------------------
#  Stage 3: transposition
# ---------------------------------------------------------------------------

def optimal_fixed_orientation(latitude_deg: float | None
                              ) -> tuple[float, float] | None:
    """A reasonable year-round fixed tilt and the surface azimuth for the site.

    The azimuth is derived from the sign of the latitude: a southern site faces
    north, azimuth 0; a northern site faces south, azimuth 180. The equator is
    treated as northern-facing by convention. Tilt near the latitude magnitude
    is the standard year-round compromise.
    """
    if latitude_deg is None:
        return None
    tilt = min(60.0, abs(latitude_deg))
    azimuth = 0.0 if latitude_deg < 0.0 else 180.0
    return tilt, azimuth


def angle_of_incidence(zenith_deg: float, solar_az_deg: float,
                       tilt_deg: float, surface_az_deg: float) -> float:
    """Angle between the beam and the surface normal, degrees.

    Public because the agrivoltaic shading model needs exactly this geometry to
    work out how much beam a row of modules intercepts.
    """
    z = math.radians(zenith_deg)
    tilt = math.radians(tilt_deg)
    az_diff = math.radians(solar_az_deg - surface_az_deg)
    cos_aoi = (math.cos(z) * math.cos(tilt)
               + math.sin(z) * math.sin(tilt) * math.cos(az_diff))
    cos_aoi = max(-1.0, min(1.0, cos_aoi))
    return math.degrees(math.acos(cos_aoi))


def _ashrae_iam(aoi_deg: float) -> float:
    """ASHRAE incidence-angle modifier, the transmittance relative to normal."""
    if aoi_deg >= 90.0:
        return 0.0
    cos_aoi = math.cos(math.radians(aoi_deg))
    if cos_aoi <= 0.0:
        return 0.0
    return max(0.0, 1.0 - _ASHRAE_B0 * (1.0 / cos_aoi - 1.0))


def plane_of_array(components: Components | None,
                   position: SolarPosition | None,
                   when: datetime | None,
                   tilt_deg: float, surface_azimuth_deg: float,
                   albedo: float = DEFAULT_ALBEDO) -> PlaneOfArray | None:
    """Transpose GHI to a tilted plane, Hay and Davies (1980).

    Beam by geometry, sky diffuse split into a circumsolar part that follows the
    beam and an isotropic part, and a ground-reflected term. The geometric
    global equals GHI exactly at zero tilt; the effective global additionally
    derates the beam by the incidence-angle modifier for the yield chain.
    """
    if not _ok(components, position, when):
        return None
    if not position.is_up:
        return PlaneOfArray(global_=0.0, beam=0.0, diffuse=0.0, ground=0.0,
                            aoi=90.0, iam=0.0, effective=0.0)

    z = math.radians(position.zenith)
    cos_z = math.cos(z)
    tilt = math.radians(tilt_deg)
    aoi = angle_of_incidence(position.zenith, position.azimuth,
                             tilt_deg, surface_azimuth_deg)
    cos_aoi = math.cos(math.radians(aoi))

    dni, dhi, ghi = components.dni, components.dhi, components.ghi

    beam = dni * max(0.0, cos_aoi)

    # Hay-Davies: the anisotropy index weights the circumsolar toward the beam.
    i0n = extraterrestrial_normal(when) or SOLAR_CONSTANT
    ai = dni / i0n if i0n > 0.0 else 0.0
    ai = max(0.0, min(1.0, ai))
    circumsolar_ratio = (max(0.0, cos_aoi) / cos_z) if cos_z > 0.0 else 0.0
    isotropic = (1.0 + math.cos(tilt)) / 2.0
    diffuse = dhi * (ai * circumsolar_ratio + (1.0 - ai) * isotropic)

    ground = ghi * albedo * (1.0 - math.cos(tilt)) / 2.0

    global_ = beam + diffuse + ground

    iam = _ashrae_iam(aoi)
    effective = beam * iam + diffuse + ground

    return PlaneOfArray(global_=global_, beam=beam, diffuse=diffuse,
                        ground=ground, aoi=aoi, iam=iam, effective=effective)


# ---------------------------------------------------------------------------
#  Cell temperature and DC yield
# ---------------------------------------------------------------------------

def module_temperature(poa_wm2: float | None, air_temp_c: float | None,
                       wind_ms: float | None,
                       pressure_hpa: float | None = None) -> float | None:
    """Module temperature, Faiman (2008): Tm = Ta + G / (U0 + U1 * wind).

    Where a station pressure is given the wind-driven term is scaled by the air
    density ratio from thermo.air_density: thinner air at altitude carries less
    heat away, so a module at 1400 m runs hotter than the sea-level model would
    say for the same wind.
    """
    if not _ok(poa_wm2, air_temp_c):
        return None
    wind = wind_ms if wind_ms is not None else 1.0
    wind = max(0.0, wind)
    density_ratio = 1.0
    if pressure_hpa is not None:
        rho = thermo.air_density(air_temp_c, pressure_hpa)
        if rho:
            density_ratio = rho / thermo.ISA_DENSITY
    denom = FAIMAN_U0 + FAIMAN_U1 * wind * density_ratio
    if denom <= 0.0:
        return air_temp_c
    return air_temp_c + poa_wm2 / denom


def dc_yield_ratio(cell_temp_c: float | None, poa_wm2: float | None,
                   temp_coeff: float = DEFAULT_POWER_TEMP_COEFF
                   ) -> float | None:
    """DC output as a fraction of nameplate at standard test conditions.

    Linear in irradiance (relative to 1000 W/m2) and derated for cell
    temperature away from 25 C by the power temperature coefficient.
    """
    if not _ok(cell_temp_c, poa_wm2):
        return None
    if poa_wm2 <= 0.0:
        return 0.0
    derate = 1.0 + temp_coeff * (cell_temp_c - 25.0)
    return max(0.0, (poa_wm2 / 1000.0) * derate)


def dc_power(poa_wm2: float | None, air_temp_c: float | None,
             wind_ms: float | None, rated_w: float,
             pressure_hpa: float | None = None,
             temp_coeff: float = DEFAULT_POWER_TEMP_COEFF) -> float | None:
    """Modeled DC power for an array rated `rated_w` at standard conditions."""
    cell = module_temperature(poa_wm2, air_temp_c, wind_ms, pressure_hpa)
    ratio = dc_yield_ratio(cell, poa_wm2, temp_coeff)
    if ratio is None:
        return None
    return rated_w * ratio


# ---------------------------------------------------------------------------
#  Single-axis tracking
# ---------------------------------------------------------------------------

def tracker_angle(position: SolarPosition | None,
                  axis_azimuth_deg: float = 0.0,
                  max_angle_deg: float = 60.0,
                  gcr: float = 0.4, backtrack: bool = True) -> float | None:
    """Rotation of a horizontal single-axis tracker, degrees, signed.

    True tracking points the plane at the sun by rotating about the axis. At low
    sun that rotation would let one row shade the next, so backtracking rotates
    the array back toward flat; the ground cover ratio sets how soon. Lorenzo,
    Narvarte and Munoz (2011). Zero is flat, positive tilts the plane toward the
    east.
    """
    if position is None:
        return None
    if not position.is_up:
        return 0.0

    z = math.radians(position.zenith)
    # Sun components in the axis frame: x perpendicular to the axis, z up.
    x = math.sin(z) * math.sin(math.radians(position.azimuth - axis_azimuth_deg))
    up = math.cos(z)
    ideal = math.atan2(x, up)

    angle = ideal
    if backtrack and gcr > 0.0:
        axes_distance = 1.0 / gcr
        temp = min(1.0, axes_distance * abs(math.cos(ideal)))
        correction = math.acos(temp)
        magnitude = max(0.0, abs(ideal) - correction)
        angle = math.copysign(magnitude, ideal)

    limit = math.radians(max_angle_deg)
    angle = max(-limit, min(limit, angle))
    return math.degrees(angle)
