"""Agrivoltaics: crop light under an array, and what tilting for the crop costs.

THE PRODUCT IS THE EXCHANGE RATE, NOT A RECOMMENDATION

  An agrivoltaic operator can tilt for kilowatt-hours or tilt to shade the crop.
  Nobody can tell them which is right, because the answer depends on the price
  of electricity, the price of the crop and the season. So this module always
  reports both branches unweighted: the energy given up, and the crop light and
  water gained. A weighting may be supplied and a preferred schedule shown, but
  never instead of the raw quantities.

WHY DAILY LIGHT INTEGRAL

  Crop science works in moles of photosynthetically active radiation per square
  meter per day, not in watts per square meter. Almost no weather service
  reports DLI, and it is the number a grower under an array actually needs.

THE SHADING SPLIT IS PHYSICAL, NOT A FUDGE FACTOR

  Beam and diffuse are shaded differently and are handled separately. The beam
  fraction the array intercepts follows from energy conservation: the collector's
  projected area normal to the beam over the ground area per row. The diffuse
  fraction follows from the sky the array hides, which is the ground cover ratio.
  There is no tunable shading coefficient anywhere in this module.

EVAPOTRANSPIRATION AVOIDED IS TWO HONEST CALLS, NOT A MULTIPLIER

  ET avoided is the difference between FAO-56 Penman-Monteith run on the open
  radiation and the same equation run on the shaded radiation. The physics
  already knows what less radiation does; applying a made-up shading factor to a
  single result would be an unsourced fudge on top of a sourced model.

NO SOIL WATER BALANCE

  Deliberately out of scope. This module reports a water DEMAND that is avoided,
  never a soil moisture state or an irrigation instruction.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime

from . import products
from . import solar
from . import thermo

# Micromoles of PAR photons per joule of global horizontal irradiance.
#
# The product of two factors: about 0.45 of global shortwave energy falls in the
# 400-700 nm photosynthetic waveband, and that waveband carries about 4.57
# micromoles per joule. Their product is close to 2.02. Both vary with sky
# condition, so this is an assumption and is labeled as one wherever a DLI is
# reported. McCree (1972) for the photon energy, Monteith and Unsworth for the
# waveband fraction.
PAR_MICROMOL_PER_JOULE = 2.02

# Heat index at or above which the NWS calls for caution, degrees Celsius. Same
# threshold products.assess_heat uses, referenced rather than redefined.
HEAT_CAUTION_C = 27.0

#: Watts per square meter of module area at standard test conditions, a typical
#: crystalline-silicon module. Only used when a caller asks for energy in kWh
#: without supplying its own rating.
DEFAULT_MODULE_W_PER_M2 = 200.0


def _ok(*values) -> bool:
    return all(v is not None for v in values)


# ---------------------------------------------------------------------------
#  Geometry
# ---------------------------------------------------------------------------

@dataclass
class ArrayGeometry:
    """The array over the crop.

    `collector_width_m` is the module dimension along the slope, `row_pitch_m`
    the distance between row centers. Their ratio is the ground cover ratio,
    which is what actually drives both the diffuse shading and the backtracking
    limit, so it is derived here rather than configured separately and allowed to
    disagree.
    """

    collector_width_m: float
    row_pitch_m: float
    tilt_deg: float = 25.0
    surface_azimuth_deg: float = 0.0
    tracking: str = "fixed"                 # fixed | single_axis
    axis_azimuth_deg: float = 0.0
    max_angle_deg: float = 60.0
    albedo_surface: str = "crop"

    @property
    def gcr(self) -> float:
        if self.row_pitch_m <= 0.0:
            return 0.0
        return max(0.0, min(1.0, self.collector_width_m / self.row_pitch_m))

    @property
    def albedo(self) -> float:
        return solar.ALBEDO.get(self.albedo_surface, solar.DEFAULT_ALBEDO)


@dataclass
class Shading:
    """How much light reaches the crop, as fractions of the open-field values."""

    transmitted_fraction: float          # of GHI
    beam_transmitted: float              # of the horizontal beam component
    diffuse_transmitted: float           # of the diffuse component
    tilt_deg: float


@dataclass
class LightBudget:
    """PAR and DLI in the open and under the array."""

    dli_open: float                      # mol/m2/day
    dli_under_array: float
    dli_difference: float
    mean_transmitted_fraction: float
    hours_counted: int
    assumption: str = (
        "PAR taken as 2.02 micromoles per joule of global irradiance, the "
        "product of a 0.45 photosynthetic energy fraction and 4.57 micromoles "
        "per joule; both vary with sky condition.")


# ---------------------------------------------------------------------------
#  PAR and DLI
# ---------------------------------------------------------------------------

def ppfd_from_ghi(ghi_wm2: float | None) -> float | None:
    """Photosynthetic photon flux density, micromol/m2/s, from GHI in W/m2."""
    if ghi_wm2 is None:
        return None
    return max(0.0, ghi_wm2) * PAR_MICROMOL_PER_JOULE


def daily_light_integral(ppfd_series, step_seconds: float = 3600.0
                         ) -> float | None:
    """Integrate PPFD to a daily light integral in mol/m2/day.

    Micromoles per second, times the seconds each sample represents, divided by
    a million to reach moles.
    """
    values = [v for v in (ppfd_series or ()) if v is not None]
    if not values:
        return None
    return sum(values) * step_seconds / 1_000_000.0


# ---------------------------------------------------------------------------
#  Shading
# ---------------------------------------------------------------------------

def shading(geometry: ArrayGeometry | None,
            components: solar.Components | None,
            position: solar.SolarPosition | None,
            when: datetime | None,
            tilt_override_deg: float | None = None) -> Shading | None:
    """The fraction of open-field light that reaches the crop for one hour.

    Beam: the collector intercepts `width * cos(aoi)` of beam per unit row
    length, while the ground receives `pitch * cos(zenith)`, so the intercepted
    share is their ratio. This is energy conservation, not a fitted coefficient,
    and it correctly goes to zero when the sun is edge-on to the modules.

    Diffuse: the array hides a share of the sky equal to the ground cover ratio
    under an isotropic sky, so that share of the diffuse is lost.

    At night everything is zero and the transmitted fraction is reported as 1.0,
    because no light is being withheld from the crop when there is no light.
    """
    if not _ok(geometry, components, position, when):
        return None
    if geometry.row_pitch_m <= 0.0 or geometry.collector_width_m <= 0.0:
        return None

    tilt = tilt_override_deg
    if tilt is None:
        if geometry.tracking == "single_axis":
            angle = solar.tracker_angle(
                position, axis_azimuth_deg=geometry.axis_azimuth_deg,
                max_angle_deg=geometry.max_angle_deg, gcr=geometry.gcr)
            tilt = abs(angle) if angle is not None else geometry.tilt_deg
        else:
            tilt = geometry.tilt_deg

    gcr = geometry.gcr
    diffuse_transmitted = max(0.0, 1.0 - gcr)

    if not position.is_up:
        return Shading(transmitted_fraction=1.0, beam_transmitted=1.0,
                       diffuse_transmitted=diffuse_transmitted, tilt_deg=tilt)

    cos_z = math.cos(math.radians(position.zenith))
    aoi = solar.angle_of_incidence(position.zenith, position.azimuth,
                                   tilt, geometry.surface_azimuth_deg)
    cos_aoi = max(0.0, math.cos(math.radians(aoi)))

    if cos_z <= 0.0:
        beam_transmitted = 1.0
    else:
        intercepted = (geometry.collector_width_m * cos_aoi) / \
            (geometry.row_pitch_m * cos_z)
        beam_transmitted = max(0.0, 1.0 - min(1.0, intercepted))

    beam_h = components.dni * cos_z
    total = beam_h + components.dhi
    if total <= 0.0:
        transmitted = 1.0
    else:
        reaching = beam_h * beam_transmitted + components.dhi * diffuse_transmitted
        transmitted = max(0.0, min(1.0, reaching / total))

    return Shading(transmitted_fraction=transmitted,
                   beam_transmitted=beam_transmitted,
                   diffuse_transmitted=diffuse_transmitted, tilt_deg=tilt)


def light_budget(geometry: ArrayGeometry | None, hours,
                 latitude_deg: float | None, longitude_deg: float | None,
                 utc_offset_hours: float = 2.0,
                 step_seconds: float = 3600.0) -> LightBudget | None:
    """Daily light integral in the open and under the array (R6.4).

    `hours` is an iterable of dicts with `valid_at` and `solar_radiation`.
    """
    if not _ok(geometry, latitude_deg, longitude_deg):
        return None

    open_ppfd, under_ppfd, fractions = [], [], []
    for h in hours or ():
        when = h.get("valid_at")
        ghi = h.get("solar_radiation")
        if when is None or ghi is None:
            continue
        pos = solar.solar_position(when, latitude_deg, longitude_deg,
                                   utc_offset_hours)
        comp = solar.decompose(ghi, pos, when)
        sh = shading(geometry, comp, pos, when)
        if sh is None:
            continue
        ppfd = ppfd_from_ghi(ghi)
        open_ppfd.append(ppfd)
        under_ppfd.append(ppfd * sh.transmitted_fraction)
        if ghi > 0.0:
            fractions.append(sh.transmitted_fraction)

    if not open_ppfd:
        return None
    dli_open = daily_light_integral(open_ppfd, step_seconds)
    dli_under = daily_light_integral(under_ppfd, step_seconds)
    mean_fraction = (sum(fractions) / len(fractions)) if fractions else 1.0
    return LightBudget(dli_open=dli_open, dli_under_array=dli_under,
                       dli_difference=dli_open - dli_under,
                       mean_transmitted_fraction=mean_fraction,
                       hours_counted=len(open_ppfd))


# ---------------------------------------------------------------------------
#  The tradeoff
# ---------------------------------------------------------------------------

@dataclass
class Branch:
    """One side of the hourly choice."""

    tilt_deg: float
    poa_wm2: float
    dc_w_per_m2: float
    transmitted_fraction: float
    crop_ppfd: float


@dataclass
class HourTradeoff:
    valid_at: datetime
    energy: Branch
    crop: Branch
    dc_given_up_w_per_m2: float
    crop_ppfd_gained: float
    preferred: str | None = None        # "energy" | "crop", only when weighted


@dataclass
class Tradeoff:
    """The hourly schedule plus its unweighted daily totals.

    The totals are always populated. `weighting` and `preferred_schedule` are
    only set when a caller supplied a weighting, and they never replace the
    unweighted numbers (R6.6, R6.7).
    """

    hours: list = field(default_factory=list)
    dc_energy_open_wh_per_m2: float = 0.0
    dc_energy_crop_wh_per_m2: float = 0.0
    dc_energy_given_up_wh_per_m2: float = 0.0
    dli_energy_branch: float = 0.0
    dli_crop_branch: float = 0.0
    weighting: float | None = None
    note: str = ("Both branches are reported unweighted. The exchange rate "
                 "between kilowatt-hours and crop light is a commercial "
                 "judgment, not a physical one.")


def _branch(geometry: ArrayGeometry, comp: solar.Components,
            pos: solar.SolarPosition, when: datetime, tilt: float,
            air_temp_c: float | None, wind_kmh: float | None,
            pressure_hpa: float | None) -> Branch:
    poa = solar.plane_of_array(comp, pos, when, tilt,
                               geometry.surface_azimuth_deg, geometry.albedo)
    sh = shading(geometry, comp, pos, when, tilt_override_deg=tilt)
    poa_eff = poa.effective if poa else 0.0
    wind_ms = (wind_kmh * thermo.KMH_TO_MS) if wind_kmh is not None else None
    dc = solar.dc_power(poa_eff, air_temp_c, wind_ms, DEFAULT_MODULE_W_PER_M2,
                        pressure_hpa)
    ghi = comp.ghi
    transmitted = sh.transmitted_fraction if sh else 1.0
    return Branch(tilt_deg=tilt, poa_wm2=poa_eff, dc_w_per_m2=dc or 0.0,
                  transmitted_fraction=transmitted,
                  crop_ppfd=(ppfd_from_ghi(ghi) or 0.0) * transmitted)


def evaluate_tradeoff(geometry: ArrayGeometry | None, hours,
                      latitude_deg: float | None, longitude_deg: float | None,
                      utc_offset_hours: float = 2.0,
                      crop_tilt_deg: float | None = None,
                      weighting: float | None = None) -> Tradeoff | None:
    """Both branches, hour by hour (R6.5).

    The energy branch uses the array's own tilt, or its tracker angle. The crop
    branch uses `crop_tilt_deg` when given; otherwise it takes the array steeply
    edge-on to the sun, which is the orientation that lets the most beam past to
    the crop.
    """
    if not _ok(geometry, latitude_deg, longitude_deg):
        return None

    out = Tradeoff(weighting=weighting)
    for h in hours or ():
        when = h.get("valid_at")
        ghi = h.get("solar_radiation")
        if when is None or ghi is None:
            continue
        pos = solar.solar_position(when, latitude_deg, longitude_deg,
                                   utc_offset_hours)
        comp = solar.decompose(ghi, pos, when)
        if pos is None or comp is None:
            continue

        if geometry.tracking == "single_axis":
            angle = solar.tracker_angle(
                pos, axis_azimuth_deg=geometry.axis_azimuth_deg,
                max_angle_deg=geometry.max_angle_deg, gcr=geometry.gcr)
            energy_tilt = abs(angle) if angle is not None else geometry.tilt_deg
        else:
            energy_tilt = geometry.tilt_deg
        crop_tilt = (crop_tilt_deg if crop_tilt_deg is not None
                     else min(geometry.max_angle_deg, 90.0))

        air = h.get("temperature")
        wind = h.get("wind_speed")
        press = h.get("pressure")
        e = _branch(geometry, comp, pos, when, energy_tilt, air, wind, press)
        c = _branch(geometry, comp, pos, when, crop_tilt, air, wind, press)

        given_up = max(0.0, e.dc_w_per_m2 - c.dc_w_per_m2)
        gained = max(0.0, c.crop_ppfd - e.crop_ppfd)

        preferred = None
        if weighting is not None:
            # Weighted comparison, in the caller's own exchange rate: watts of DC
            # per micromole of crop PAR. Shown alongside, never instead of, the
            # unweighted quantities.
            preferred = "crop" if gained * weighting >= given_up else "energy"

        out.hours.append(HourTradeoff(
            valid_at=when, energy=e, crop=c,
            dc_given_up_w_per_m2=given_up, crop_ppfd_gained=gained,
            preferred=preferred))

        out.dc_energy_open_wh_per_m2 += e.dc_w_per_m2
        out.dc_energy_crop_wh_per_m2 += c.dc_w_per_m2
        out.dc_energy_given_up_wh_per_m2 += given_up

    if not out.hours:
        return None
    out.dli_energy_branch = daily_light_integral(
        [h.energy.crop_ppfd for h in out.hours]) or 0.0
    out.dli_crop_branch = daily_light_integral(
        [h.crop.crop_ppfd for h in out.hours]) or 0.0
    return out


# ---------------------------------------------------------------------------
#  Microclimate under the array
# ---------------------------------------------------------------------------

@dataclass
class Microclimate:
    """Water and heat under the array."""

    et0_open_mm: float
    et0_shaded_mm: float
    et_avoided_mm: float
    transmitted_fraction: float
    water_use_efficiency: float | None       # mol PAR per mm of water demand
    heat_stress_hours_shaded: int
    note: str = ("Evapotranspiration avoided is the FAO-56 equation evaluated "
                 "twice, on the open and the shaded radiation, not a shading "
                 "factor applied to one result. Heat-stress hours shaded counts "
                 "hours the crop was shaded while the open-field heat index was "
                 "at or above caution; it is radiant-load relief, not a modeled "
                 "air-temperature reduction.")


def microclimate(hours, transmitted_fraction: float | None,
                 latitude_deg: float | None, altitude_m: float | None,
                 dli_under_array: float | None = None) -> Microclimate | None:
    """Reduced water demand and a water-use-efficiency figure (R6.8).

    `hours` is a day of dicts carrying temperature, humidity, wind_speed and
    solar_radiation. ET0 is computed twice from the same day: once with the
    open-field radiation total and once with that total scaled by the fraction of
    light reaching the crop.
    """
    if not _ok(transmitted_fraction, latitude_deg, altitude_m):
        return None

    temps = [h.get("temperature") for h in hours or ()
             if h.get("temperature") is not None]
    hums = [h.get("humidity") for h in hours or ()
            if h.get("humidity") is not None]
    winds = [h.get("wind_speed") for h in hours or ()
             if h.get("wind_speed") is not None]
    solars = [h.get("solar_radiation") for h in hours or ()
              if h.get("solar_radiation") is not None]
    whens = [h.get("valid_at") for h in hours or ()
             if h.get("valid_at") is not None]
    if not temps or not hums or not solars or not whens:
        return None

    t_mean = sum(temps) / len(temps)
    t_max, t_min = max(temps), min(temps)
    humidity = sum(hums) / len(hums)
    wind = (sum(winds) / len(winds)) if winds else 5.0
    # Mean W/m2 over the day to MJ/m2/day: watts are joules per second.
    mean_w = sum(solars) / len(solars)
    solar_mj_open = mean_w * 86400.0 / 1_000_000.0
    day_of_year = whens[0].timetuple().tm_yday

    et_open = products.et0_penman_monteith(
        t_mean, t_max, t_min, humidity, wind, solar_mj_open,
        altitude_m, latitude_deg, day_of_year)
    et_shaded = products.et0_penman_monteith(
        t_mean, t_max, t_min, humidity, wind,
        solar_mj_open * transmitted_fraction,
        altitude_m, latitude_deg, day_of_year)
    if et_open is None or et_shaded is None:
        return None

    wue = None
    if dli_under_array is not None and et_shaded > 0.0:
        wue = dli_under_array / et_shaded

    shaded_heat_hours = 0
    for h in hours or ():
        hi = products.heat_index(h.get("temperature"), h.get("humidity"))
        if hi is not None and hi >= HEAT_CAUTION_C and transmitted_fraction < 1.0:
            shaded_heat_hours += 1

    return Microclimate(
        et0_open_mm=et_open, et0_shaded_mm=et_shaded,
        et_avoided_mm=max(0.0, et_open - et_shaded),
        transmitted_fraction=transmitted_fraction,
        water_use_efficiency=wue,
        heat_stress_hours_shaded=shaded_heat_hours)


# ---------------------------------------------------------------------------
#  Bifacial
# ---------------------------------------------------------------------------

@dataclass
class BifacialGain:
    rear_irradiance_wm2: float
    gain_fraction: float
    albedo: float
    surface: str
    caveat: str = ("Crop albedo changes through the growth stage, from bare soil "
                   "to full canopy, so a single albedo is a snapshot rather than "
                   "a season.")


def bifacial_gain(ghi_wm2: float | None, geometry: ArrayGeometry | None,
                  poa_front_wm2: float | None,
                  bifaciality: float = 0.7) -> BifacialGain | None:
    """Rear-side irradiance and the gain it represents (R6.9).

    The ground reflects `albedo * GHI`, of which the rear face sees the part not
    hidden by the array itself, approximated by one minus the ground cover ratio.
    `bifaciality` is the module's rear-to-front response.
    """
    if not _ok(ghi_wm2, geometry, poa_front_wm2):
        return None
    if poa_front_wm2 <= 0.0:
        return BifacialGain(rear_irradiance_wm2=0.0, gain_fraction=0.0,
                            albedo=geometry.albedo,
                            surface=geometry.albedo_surface)
    rear = ghi_wm2 * geometry.albedo * max(0.0, 1.0 - geometry.gcr)
    gain = (rear * bifaciality) / poa_front_wm2
    return BifacialGain(rear_irradiance_wm2=rear, gain_fraction=gain,
                        albedo=geometry.albedo,
                        surface=geometry.albedo_surface)
