"""Assemble one sector's view from a stored forecast run.

WHY THIS MODULE EXISTS

  Every other module in this package has a narrow job and a one-way dependency.
  This one is allowed to depend on all of them, and that is the point: it is the
  single place where per-sector orchestration lives, so `main.py` does not grow a
  large block of it and so the same assembled structure can feed the HTML view
  and any future export.

NOTHING IS CACHED

  Every quantity here is recomputed on demand from the stored forecast points and
  the station's sector configuration. A cached plane-of-array figure could
  disagree with the forecast it came from after a re-run, and a page that
  contradicts its own source is worse than a slow page. The one exception is the
  method version, which is captured at issue time because it describes code that
  cannot be recovered later.

A MISSING SENSOR IS NAMED, NOT HIDDEN

  When a sector cannot be built, the report says which sensor or setting is
  missing, in the words an operator would use ("no pyranometer", not
  "solar_radiation is None"). No section renders zeros to fill space.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from . import agrivoltaics
from . import probabilistic
from . import products
from . import solar
from . import thermo
from . import wind
from .db import Database

#: Sensor names as an operator would say them, keyed by the canonical variable.
#: Used so a missing-data message never leaks an internal field name (R8.6).
SENSOR_NAMES = {
    "solar_radiation": "pyranometer (solar radiation)",
    "temperature": "air temperature sensor",
    "humidity": "humidity sensor",
    "wind_speed": "anemometer (wind speed)",
    "wind_direction": "wind vane (wind direction)",
    "wind_gust": "anemometer gust channel",
    "pressure": "barometer",
    "dew_point": "dew point (from temperature and humidity)",
    "temperature8m": "second temperature height (8 m)",
    "moduleTemperature": "module temperature sensor",
    "mpptSolarPower": "MPPT DC power channel",
}


def sensor_label(variable: str) -> str:
    return SENSOR_NAMES.get(variable, variable)


@dataclass
class SectorSection:
    """One block on a sector page.

    `available` False means the station cannot support this block; `missing`
    then names what it would need, and the template states the absence instead
    of drawing an empty chart.
    """

    title: str
    available: bool
    data: dict = field(default_factory=dict)
    missing: list = field(default_factory=list)
    note: str = ""


@dataclass
class SectorReport:
    sector: str
    station_id: int
    station_name: str
    horizon_days: int
    base_time: datetime | None = None
    method_version: str = ""
    sections: list = field(default_factory=list)
    missing_config: list = field(default_factory=list)

    @property
    def usable(self) -> bool:
        return any(s.available for s in self.sections)


# ---------------------------------------------------------------------------
#  Shared helpers
# ---------------------------------------------------------------------------

def _hours_from_run(db: Database, run: dict) -> list[dict]:
    """Forecast points for a run, reshaped into per-hour dicts.

    One dict per valid time carrying every variable forecast for that hour, which
    is the shape every product in this package already expects. A single query
    returns every variable, so this does not fan out per variable.
    """
    by_time: dict[datetime, dict] = {}
    for p in db.run_points(run["id"]):
        when = p["valid_at"]
        if isinstance(when, str):
            when = datetime.strptime(when, "%Y-%m-%d %H:%M:%S")
        slot = by_time.setdefault(when, {"valid_at": when})
        slot[p["variable"]] = p["value"]
        # Temperature members carry the frost ensemble, the one probability the
        # interface presents.
        if p["variable"] == "temperature":
            slot["_members"] = db.decode_members(p.get("members"))
    return [by_time[t] for t in sorted(by_time)]


def _missing(hours: list[dict], required) -> list[str]:
    """Which required variables never appear in the forecast hours."""
    present = {k for h in hours for k, v in h.items() if v is not None}
    return [sensor_label(v) for v in required if v not in present]


def _series(hours: list[dict], variable: str) -> list[float]:
    return [h[variable] for h in hours
            if h.get(variable) is not None]


# ---------------------------------------------------------------------------
#  Solar
# ---------------------------------------------------------------------------

def _solar_sections(db: Database, station, cfg: dict,
                    hours: list[dict]) -> list[SectorSection]:
    sections = []
    missing = _missing(hours, ["solar_radiation"])
    if station.latitude is None or station.longitude is None:
        missing.append("station coordinates")

    if missing:
        return [SectorSection(
            title="Plane of array and yield", available=False, missing=missing,
            note="Irradiance and a position are both needed before a tilted "
                 "plane means anything.")]

    tilt = cfg.get("tilt_deg")
    azimuth = cfg.get("surface_azimuth_deg")
    if tilt is None or azimuth is None:
        orientation = solar.optimal_fixed_orientation(station.latitude)
        if orientation:
            tilt = tilt if tilt is not None else orientation[0]
            azimuth = azimuth if azimuth is not None else orientation[1]

    rows = []
    poa_total = 0.0
    dc_total = 0.0
    rated = cfg.get("rated_w")
    for h in hours:
        ghi = h.get("solar_radiation")
        when = h["valid_at"]
        pos = solar.solar_position(when, station.latitude, station.longitude,
                                   station.utc_offset_hours)
        clear = solar.clear_sky_ghi(pos, db.clear_sky_at(station.id, when))
        comp = solar.decompose(ghi, pos, when)
        poa = solar.plane_of_array(comp, pos, when, tilt, azimuth)
        if pos is None or comp is None or poa is None:
            continue
        wind_ms = None
        if h.get("wind_speed") is not None:
            wind_ms = h["wind_speed"] * thermo.KMH_TO_MS
        cell = solar.module_temperature(poa.effective, h.get("temperature"),
                                        wind_ms, h.get("pressure"))
        dc = (solar.dc_power(poa.effective, h.get("temperature"), wind_ms,
                             rated, h.get("pressure")) if rated else None)
        poa_total += poa.global_
        if dc:
            dc_total += dc
        rows.append({
            "valid_at": when, "elevation": pos.elevation,
            "ghi": ghi, "dni": comp.dni, "dhi": comp.dhi,
            "clear_sky": clear[0] if clear else None,
            "clear_sky_source": clear[1] if clear else "",
            "poa": poa.global_, "poa_effective": poa.effective,
            "cell_temp": cell, "dc_w": dc,
        })

    sections.append(SectorSection(
        title="Plane of array and yield", available=bool(rows),
        data={"rows": rows, "tilt_deg": tilt, "surface_azimuth_deg": azimuth,
              "poa_kwh_per_m2": poa_total / 1000.0,
              "dc_kwh": dc_total / 1000.0 if rated else None,
              "rated_w": rated},
        note=("Facing " + ("north" if azimuth == 0.0 else f"{azimuth:.0f} deg")
              + f" at {tilt:.0f} deg tilt.")))

    if not rated:
        sections.append(SectorSection(
            title="DC yield", available=False,
            missing=["array rating (configure rated_w)"],
            note="Irradiance on the plane is shown above; a rating is needed "
                 "before it can be turned into kilowatt-hours."))

    return sections


# ---------------------------------------------------------------------------
#  Wind
# ---------------------------------------------------------------------------

def _wind_sections(db: Database, station, cfg: dict,
                   hours: list[dict]) -> list[SectorSection]:
    missing = _missing(hours, ["wind_speed"])
    if missing:
        return [SectorSection(
            title="Wind resource", available=False, missing=missing,
            note="Wind speed is the one channel this sector cannot do without.")]

    speeds = _series(hours, "wind_speed")
    directions = _series(hours, "wind_direction")
    gusts = _series(hours, "wind_gust")
    measurement_height = cfg.get("measurement_height_m") or 10.0
    hub = cfg.get("hub_height_m")

    density = None
    temps = _series(hours, "temperature")
    pressures = _series(hours, "pressure")
    if temps and pressures:
        density = thermo.air_density(
            sum(temps) / len(temps), sum(pressures) / len(pressures))

    sections = [SectorSection(
        title="Wind resource", available=True,
        data={
            "mean_speed_kmh": sum(speeds) / len(speeds),
            "power_density_wm2": wind.mean_power_density(speeds, density),
            "air_density": density,
            "weibull": wind.weibull_fit(speeds),
            "p90_speed_kmh": wind.energy_exceedance(speeds, 90.0),
            "p50_speed_kmh": wind.energy_exceedance(speeds, 50.0),
            "p10_speed_kmh": wind.energy_exceedance(speeds, 10.0),
            "measurement_height_m": measurement_height,
        },
        note="Power density is the mean of the cubed speeds, corrected for air "
             "density, not the cube of the mean speed.")]

    if hub:
        shear = wind.extrapolate_to_hub(
            sum(speeds) / len(speeds), measurement_height, hub)
        sections.append(SectorSection(
            title="Hub height", available=shear is not None,
            data={"shear": shear},
            note=("Shear exponent is assumed, not measured: this station has "
                  "only one wind height." if shear and shear.basis == "assumed"
                  else "")))
    else:
        sections.append(SectorSection(
            title="Hub height", available=False,
            missing=["hub height (configure hub_height_m)"],
            note="Without a hub height there is nothing to extrapolate to."))

    if directions:
        pairs = [(h["wind_speed"], h["wind_direction"]) for h in hours
                 if h.get("wind_speed") is not None
                 and h.get("wind_direction") is not None]
        sections.append(SectorSection(
            title="Direction", available=bool(pairs),
            data={"sectors": wind.sector_statistics(pairs, density=density),
                  "prevailing_deg": wind.prevailing_direction(pairs)},
            note="Sectors are energy-weighted, and every direction is computed "
                 "with vector arithmetic."))
    else:
        sections.append(SectorSection(
            title="Direction", available=False,
            missing=[sensor_label("wind_direction")]))

    mean_speed = sum(speeds) / len(speeds)
    mean_gust = (sum(gusts) / len(gusts)) if gusts else None
    turbulence = wind.describe_turbulence(mean_speed, mean_gust)
    sections.append(SectorSection(
        title="Gust factor", available=turbulence is not None,
        data={"turbulence": turbulence},
        missing=[] if gusts else [sensor_label("wind_gust")],
        note=turbulence.note if turbulence else ""))
    return sections


# ---------------------------------------------------------------------------
#  Agriculture
# ---------------------------------------------------------------------------

def _agriculture_sections(db: Database, station, cfg: dict,
                          hours: list[dict]) -> list[SectorSection]:
    missing = _missing(hours, ["temperature"])
    if missing:
        return [SectorSection(title="Agricultural outlook", available=False,
                              missing=missing)]

    sections = []

    frost = products.assess_frost(hours)
    members_by_hour = [{"valid_at": h["valid_at"],
                        "members": h.get("_members", [])} for h in hours]
    nights = probabilistic.frost_risk(members_by_hour)
    sections.append(SectorSection(
        title="Frost", available=True,
        data={"assessment": frost, "nights": nights},
        note="The percentage shown is the ensemble frost probability, the one a "
             "reliability diagram can check. The assessment contributes the "
             "band, the timing and the type."))

    dew = products.assess_dew(hours)
    lwd = dew.duration_hours
    temps = _series(hours, "temperature")
    mean_temp = sum(temps) / len(temps) if temps else None
    sections.append(SectorSection(
        title="Leaf wetness and disease", available=True,
        data={"dew": dew,
              "diseases": products.disease_risks(lwd, mean_temp)},
        note="Leaf wetness duration is derived from the temperature to dew "
             "point spread, not measured by a wetness sensor."))

    sections.append(SectorSection(
        title="Chill", available=True,
        data={"chill": products.chill_summary(hours)}))

    if cfg.get("livestock"):
        loads = [products.livestock_thi(h.get("temperature"),
                                        h.get("humidity"),
                                        cfg["livestock"])
                 for h in hours]
        loads = [x for x in loads if x is not None]
        sections.append(SectorSection(
            title="Livestock heat load", available=bool(loads),
            data={"loads": loads,
                  "peak": max(loads, key=lambda x: x.thi) if loads else None},
            missing=[] if loads else [sensor_label("humidity")]))

    crop = cfg.get("crop")
    if crop:
        sections.append(SectorSection(
            title="Crop water demand", available=True,
            data={"crop": crop},
            note="Crop evapotranspiration is a water demand. No irrigation "
                 "figure is given: that needs a soil water balance, which this "
                 "service deliberately does not model."))

    sections.append(SectorSection(
        title="Spray windows", available=True,
        data={"windows": products.find_spray_windows(hours),
              "inversion": products.spray_inversion_hazard(hours)}))
    return sections


# ---------------------------------------------------------------------------
#  Agrivoltaics
# ---------------------------------------------------------------------------

def _agrivoltaics_sections(db: Database, station, cfg: dict,
                           hours: list[dict]) -> list[SectorSection]:
    missing = _missing(hours, ["solar_radiation"])
    if station.latitude is None or station.longitude is None:
        missing.append("station coordinates")
    geometry_missing = []
    if not cfg.get("row_pitch_m"):
        geometry_missing.append("row pitch (configure row_pitch_m)")
    if not cfg.get("collector_width_m"):
        geometry_missing.append("collector width (configure collector_width_m)")

    if missing or geometry_missing:
        return [SectorSection(
            title="Crop light under the array", available=False,
            missing=missing + geometry_missing,
            note="Array geometry decides how much light reaches the crop, so "
                 "there is nothing to report until it is configured.")]

    geometry = agrivoltaics.ArrayGeometry(
        collector_width_m=cfg["collector_width_m"],
        row_pitch_m=cfg["row_pitch_m"],
        tilt_deg=cfg.get("tilt_deg") or 25.0,
        surface_azimuth_deg=cfg.get("surface_azimuth_deg") or 0.0,
        tracking=cfg.get("tracking") or "fixed",
        albedo_surface=cfg.get("albedo_surface") or "grass")

    budget = agrivoltaics.light_budget(
        geometry, hours, station.latitude, station.longitude,
        station.utc_offset_hours)
    tradeoff = agrivoltaics.evaluate_tradeoff(
        geometry, hours, station.latitude, station.longitude,
        station.utc_offset_hours)

    sections = [SectorSection(
        title="Crop light under the array", available=budget is not None,
        data={"budget": budget, "gcr": geometry.gcr},
        note=budget.assumption if budget else "")]

    sections.append(SectorSection(
        title="Energy against crop light", available=tradeoff is not None,
        data={"tradeoff": tradeoff},
        note=tradeoff.note if tradeoff else ""))

    if budget is not None and station.elevation_m is not None:
        micro = agrivoltaics.microclimate(
            hours, budget.mean_transmitted_fraction, station.latitude,
            station.elevation_m, budget.dli_under_array)
        sections.append(SectorSection(
            title="Microclimate", available=micro is not None,
            data={"microclimate": micro},
            note=micro.note if micro else ""))
    else:
        sections.append(SectorSection(
            title="Microclimate", available=False,
            missing=["station elevation"],
            note="Evapotranspiration needs the site elevation."))
    return sections


_BUILDERS = {
    "solar": _solar_sections,
    "wind": _wind_sections,
    "agriculture": _agriculture_sections,
    "agrivoltaics": _agrivoltaics_sections,
}


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------

def build(db: Database, station_id: int, sector: str,
          horizon_days: int = 1) -> SectorReport | None:
    """Assemble one sector's report from the latest run at that horizon.

    Returns None only when the sector is unknown or there is no run to build
    from. A station that simply lacks sensors gets a report whose sections are
    unavailable and say what is missing, because that is a page an operator can
    act on and a 500 is not.
    """
    builder = _BUILDERS.get(sector)
    if builder is None:
        return None
    station = db.get_station(station_id)
    if station is None:
        return None

    from . import forecasting
    horizon_hours = forecasting.HORIZON_HOURS.get(horizon_days)
    if horizon_hours is None:
        return None
    run = db.latest_run(station_id, horizon_hours)
    if run is None:
        return None

    cfg = db.get_sector_config(station_id) or {}
    hours = _hours_from_run(db, run)

    base = run.get("base_time")
    if isinstance(base, str):
        base = datetime.strptime(base, "%Y-%m-%d %H:%M:%S")

    report = SectorReport(
        sector=sector, station_id=station_id, station_name=station.name,
        horizon_days=horizon_days, base_time=base,
        method_version=run.get("method_version", ""))
    report.sections = builder(db, station, cfg, hours)
    return report
