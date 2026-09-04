#!/usr/bin/env python3
"""
Stratus Weather - demo TOA5 data generator for Potchefstroom.

Produces two Campbell Scientific TOA5 files ready to import through the
Stratus dashboard Data Import screen:

  1. potchefstroom_full_demo.dat   Complete station: every weather parameter the
                                   dashboard can display, plus AS3935 lightning.
  2. as3935_lightning_demo.dat     Lightning only (AS3935 channels).

Site
----
Potchefstroom, North West, South Africa
  latitude   -26.7145
  longitude   27.0977
  altitude    1350 m AMSL

Because the site sits at 1350 m, station barometric pressure runs near 861 hPa
rather than sea-level 1013 hPa. That is correct, not a bug.

Data conventions (these match what the Stratus back end expects)
----------------------------------------------------------------
Lightning_Tot    CUMULATIVE strike counter, monotonically non-decreasing.
                 The report counts strikes as the sum of positive deltas
                 between consecutive readings, so a per-interval count would
                 be read incorrectly.
Rain_mm_Tot      PER-INTERVAL rainfall increment (mm in the last interval).
                 The back end sums increments when the maximum is <= 50.
LightningDist    One of the AS3935's 14 discrete distance steps, or NAN when no
LightningEnergy  strike was detected in the interval. Distance and energy
                 statistics ignore values <= 0, so NAN keeps the averages
                 honest instead of dragging them toward zero.

AS3935 sensor limits reproduced here
------------------------------------
  distance steps  1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km
  distance error  +/- 4 km (manufacturer rated)
  energy          21-bit relative, dimensionless, 0 .. 2 097 151
                  (not joules, not watts)

Usage
-----
    python generate_potchefstroom_demo.py [--days 14] [--interval 10]
"""

from __future__ import annotations

import argparse
import csv
import math
import random
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# Site constants
# ---------------------------------------------------------------------------

SITE_NAME = "Potchefstroom"
LATITUDE = -26.7145
LONGITUDE = 27.0977
ALTITUDE_M = 1350.0

# SAST is UTC+2 year round, no daylight saving.
TZ_OFFSET_H = 2.0
STANDARD_MERIDIAN = 15.0 * TZ_OFFSET_H  # 30 deg E

# ---------------------------------------------------------------------------
# AS3935 sensor characteristics
# ---------------------------------------------------------------------------

AS3935_DISTANCES = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40]
AS3935_ENERGY_MAX = 2_097_151  # 2**21 - 1


def nearest_as3935_distance(km: float) -> int:
    """Snap a distance to the nearest step the AS3935 can actually report."""
    return min(AS3935_DISTANCES, key=lambda step: abs(step - km))


# ---------------------------------------------------------------------------
# Solar geometry
# ---------------------------------------------------------------------------

def solar_elevation_deg(when: datetime) -> float:
    """Solar elevation angle in degrees for the site at a local (SAST) time."""
    n = when.timetuple().tm_yday

    # Declination (Cooper).
    decl = 23.45 * math.sin(math.radians(360.0 * (284 + n) / 365.0))

    # Equation of time in minutes (Spencer, abbreviated).
    b = math.radians(360.0 * (n - 81) / 364.0)
    eot = 9.87 * math.sin(2 * b) - 7.53 * math.cos(b) - 1.5 * math.sin(b)

    # Local solar time.
    clock_h = when.hour + when.minute / 60.0 + when.second / 3600.0
    solar_h = clock_h + (4.0 * (LONGITUDE - STANDARD_MERIDIAN) + eot) / 60.0
    hour_angle = math.radians(15.0 * (solar_h - 12.0))

    lat = math.radians(LATITUDE)
    d = math.radians(decl)
    sin_elev = (math.sin(lat) * math.sin(d)
                + math.cos(lat) * math.cos(d) * math.cos(hour_angle))
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_elev))))


def clear_sky_ghi(elev_deg: float, when: datetime) -> float:
    """Clear-sky global horizontal irradiance, W/m2.

    Highveld sites at 1350 m see a thin atmosphere and very clear winter air,
    so midday peaks around 1050-1100 W/m2 in summer are normal.
    """
    if elev_deg <= 0.0:
        return 0.0
    n = when.timetuple().tm_yday
    # Earth-Sun distance correction.
    e0 = 1.0 + 0.033 * math.cos(math.radians(360.0 * n / 365.0))
    sin_elev = math.sin(math.radians(elev_deg))
    # Altitude lifts transmittance slightly.
    transmittance = 0.76 + 0.00002 * ALTITUDE_M
    return 1367.0 * e0 * transmittance * (sin_elev ** 1.12)


# ---------------------------------------------------------------------------
# Psychrometrics
# ---------------------------------------------------------------------------

def sat_vapor_pressure_kpa(temp_c: float) -> float:
    """Saturation vapor pressure, kPa (FAO-56 eq. 11)."""
    return 0.6108 * math.exp(17.27 * temp_c / (temp_c + 237.3))


def rh_from_dewpoint(temp_c: float, dew_c: float) -> float:
    """Relative humidity in percent from air and dew-point temperature."""
    rh = 100.0 * sat_vapor_pressure_kpa(dew_c) / sat_vapor_pressure_kpa(temp_c)
    return max(3.0, min(100.0, rh))


def station_pressure_hpa() -> float:
    """Barometric pressure at station altitude, hPa (ISA)."""
    return 1013.25 * (1.0 - 2.25577e-5 * ALTITUDE_M) ** 5.25588


# ---------------------------------------------------------------------------
# Storm model
# ---------------------------------------------------------------------------

class Storm:
    """A convective cell that passes the site: rain plus AS3935 strikes."""

    def __init__(self, start: datetime, duration_min: int, peak_rain_mm: float,
                 closest_km: int, strike_total: int):
        self.start = start
        self.end = start + timedelta(minutes=duration_min)
        self.duration_min = duration_min
        self.peak_rain_mm = peak_rain_mm
        self.closest_km = closest_km
        self.strike_total = strike_total

    def contains(self, when: datetime) -> bool:
        return self.start <= when < self.end

    def progress(self, when: datetime) -> float:
        """0.0 at the leading edge, 1.0 at the trailing edge."""
        return (when - self.start).total_seconds() / (self.duration_min * 60.0)

    def distance_km(self, when: datetime) -> float:
        """Cell approaches, sits overhead, then recedes."""
        p = self.progress(when)
        if p < 0.35:                       # approach
            frac = p / 0.35
            return 40.0 - (40.0 - self.closest_km) * frac
        if p < 0.65:                       # overhead
            return self.closest_km + random.uniform(-1.5, 2.5)
        frac = (p - 0.65) / 0.35           # recede
        return self.closest_km + (40.0 - self.closest_km) * frac

    def strike_rate(self, when: datetime) -> float:
        """Relative strike activity, 0..1, peaking mid-passage."""
        p = self.progress(when)
        return max(0.0, math.sin(math.pi * min(1.0, max(0.0, p))) ** 1.5)


def storm_rain_fraction(storm: "Storm", when: datetime) -> float:
    """Share of the storm's total rainfall falling in this instant, 0..1."""
    p = storm.progress(when)
    if p < 0.15 or p > 0.9:
        return 0.02
    # Most of the rain arrives in the middle third of the passage.
    return math.sin(math.pi * (p - 0.15) / 0.75) ** 2


def build_storms(start: datetime, days: int) -> list[Storm]:
    """Lay out afternoon and evening thunderstorms across the run.

    Potchefstroom is a summer-rainfall Highveld site: convection fires in the
    late afternoon, so storms are placed between 14:00 and 20:00.
    """
    storms: list[Storm] = []
    # Storm days spread through the window, with the last one at the very end of
    # the series so the dashboard's current-conditions cards show live activity.
    storm_days = sorted(random.sample(range(days), k=max(3, days // 3)))
    if (days - 1) not in storm_days:
        storm_days[-1] = days - 1

    for day in storm_days:
        hour = random.choice([14, 15, 16, 17, 18])
        if day == days - 1:
            hour = 16  # keeps the final cell inside the series
        base = (start + timedelta(days=day)).replace(
            hour=hour, minute=random.choice([0, 10, 20, 30]), second=0, microsecond=0)
        storms.append(Storm(
            start=base,
            duration_min=random.choice([90, 120, 150, 180]),
            peak_rain_mm=round(random.uniform(6.0, 28.0), 1),
            closest_km=random.choice([1, 5, 6, 8]),
            strike_total=random.randint(90, 320),
        ))
    return storms


# ---------------------------------------------------------------------------
# TOA5 writing
# ---------------------------------------------------------------------------

def write_toa5(path: str, station: str, table: str,
               columns: list[tuple[str, str, str]],
               rows: list[list]) -> None:
    """Write a TOA5 file.

    `columns` is a list of (name, unit, processing) for the data columns only;
    TIMESTAMP and RECORD are added automatically because the Stratus parser
    requires them in positions 0 and 1.
    """
    names = ["TIMESTAMP", "RECORD"] + [c[0] for c in columns]
    units = ["TS", "RN"] + [c[1] for c in columns]
    procs = ["", ""] + [c[2] for c in columns]

    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write(','.join('"%s"' % v for v in [
            "TOA5", station, "CR1000X", "12345",
            "CR1000X.Std.13.02", "CPU:StratusDemo.CR1X", "51201", table,
        ]) + "\n")
        for header in (names, units, procs):
            fh.write(','.join('"%s"' % v for v in header) + "\n")

        writer = csv.writer(fh, quoting=csv.QUOTE_ALL, lineterminator="\n")
        for i, row in enumerate(rows, start=1):
            writer.writerow([row[0].strftime("%Y-%m-%d %H:%M:%S"), i] + row[1:])


def num(value, decimals: int):
    """Format a value for TOA5, using NAN for missing data as Campbell does."""
    if value is None:
        return "NAN"
    if decimals == 0:
        return str(int(round(value)))
    return f"{value:.{decimals}f}"


# ---------------------------------------------------------------------------
# Full-station series
# ---------------------------------------------------------------------------

FULL_COLUMNS = [
    ("AirTC_Avg", "Deg C", "Avg"),
    ("RH", "%", "Smp"),
    ("DewPt_Avg", "Deg C", "Avg"),
    ("BP_mbar_Avg", "mbar", "Avg"),
    ("WS_ms_Avg", "m/s", "Avg"),
    ("WS_Max", "m/s", "Max"),
    ("WSpd_Min", "m/s", "Min"),
    ("WindDir", "Deg", "Smp"),
    ("Wind_Dir_SD1_WVT", "Deg", "Std"),
    ("SlrW_Avg", "W/m^2", "Avg"),
    ("SlrMJ_Tot", "MJ/m^2", "Tot"),
    ("UV_Index_Avg", "index", "Avg"),
    ("Rain_mm_Tot", "mm", "Tot"),
    ("SoilTC_Avg", "Deg C", "Avg"),
    ("VWC_Avg", "m^3/m^3", "Avg"),
    ("Visibility_km", "km", "Avg"),
    ("PM2_5_Avg", "ug/m^3", "Avg"),
    ("PM10_Avg", "ug/m^3", "Avg"),
    ("Lightning_Tot", "count", "Tot"),
    ("LightningDist", "km", "Smp"),
    ("LightningEnergy", "", "Smp"),
    ("BattV_Avg", "V", "Avg"),
    ("PTemp_C_Avg", "Deg C", "Avg"),
    ("MPPT_SolV_Avg", "V", "Avg"),
    ("MPPT_SolI_Avg", "A", "Avg"),
    ("MPPT_SolP_Avg", "W", "Avg"),
    ("MPPT_BatV_Avg", "V", "Avg"),
    ("MPPT_LdV_Avg", "V", "Avg"),
    ("MPPT_LdI_Avg", "A", "Avg"),
    ("SolarCharger_BoardTemp_1_Avg", "Deg C", "Avg"),
]


def generate_full_series(start: datetime, days: int, interval_min: int):
    """Build the complete-station series and return (rows, summary)."""
    steps = int(days * 24 * 60 / interval_min)
    storms = build_storms(start, days)
    base_pressure = station_pressure_hpa()

    # Per-day synoptic character.
    day_temp_offset = {}
    day_dew_base = {}
    for d in range(days + 1):
        day_temp_offset[d] = random.uniform(-3.0, 3.0)
        day_dew_base[d] = random.uniform(8.0, 16.0)

    strike_counter = 0          # cumulative, as the back end expects
    soil_moisture = 0.16        # m3/m3, rises with rain and dries down
    rain_today = 0.0
    current_day = None

    rows: list[list] = []
    totals = {"rain": 0.0, "strikes": 0, "closest": None,
              "peak_energy": 0, "solar_mj": 0.0, "storm_days": len(storms)}

    for i in range(steps):
        when = start + timedelta(minutes=i * interval_min)
        day_index = (when - start).days
        if current_day != when.date():
            current_day = when.date()
            rain_today = 0.0

        elev = solar_elevation_deg(when)
        ghi_clear = clear_sky_ghi(elev, when)

        storm = next((s for s in storms if s.contains(when)), None)

        # ── cloud and irradiance ───────────────────────────────────────────
        if storm is not None:
            cloud = 0.55 + 0.4 * storm.strike_rate(when)
        else:
            # Fair-weather cumulus builds through the afternoon.
            cloud = 0.05 + 0.18 * max(0.0, math.sin(math.pi * (when.hour - 9) / 12.0))
            cloud += random.uniform(-0.03, 0.06)
        cloud = max(0.0, min(0.95, cloud))
        solar_w = max(0.0, ghi_clear * (1.0 - 0.78 * cloud))
        solar_mj = solar_w * interval_min * 60.0 / 1e6

        # ── temperature ────────────────────────────────────────────────────
        # Minimum near 06:00, maximum near 15:00.
        clock_h = when.hour + when.minute / 60.0
        diurnal = math.cos(math.radians(360.0 * (clock_h - 15.0) / 24.0))
        # Tuned to a warm, unusually wet late-winter spell on the Highveld:
        # roughly 7 degC before dawn to 27 degC mid-afternoon. Keeping the run
        # warm and convective is what makes the rainfall and lightning cards
        # populate; see the note in the accompanying README.
        t_mean = 18.0 + day_temp_offset.get(day_index, 0.0)
        t_amp = 9.5
        temp = t_mean + t_amp * diurnal
        temp -= 6.0 * cloud * max(0.0, diurnal)          # cloud caps the peak
        if storm is not None:
            temp -= 5.5 * storm.strike_rate(when)        # outflow cools the air
        temp += random.uniform(-0.3, 0.3)

        # ── moisture ───────────────────────────────────────────────────────
        dew = day_dew_base.get(day_index, 12.0) + random.uniform(-0.6, 0.6)
        if storm is not None:
            dew += 4.0 * storm.strike_rate(when)
        dew = min(dew, temp - 0.3)                       # dew point cannot exceed air temp
        rh = rh_from_dewpoint(temp, dew)

        # ── pressure ───────────────────────────────────────────────────────
        synoptic = 4.0 * math.sin(2 * math.pi * (i / steps) * 1.5)
        tide = 1.1 * math.sin(math.radians(360.0 * (clock_h - 4.0) / 12.0))
        pressure = base_pressure + synoptic + tide
        if storm is not None:
            pressure -= 2.2 * storm.strike_rate(when)
        pressure += random.uniform(-0.15, 0.15)

        # ── wind ───────────────────────────────────────────────────────────
        wind = 1.2 + 2.6 * max(0.0, diurnal) + random.uniform(-0.3, 0.6)
        if storm is not None:
            wind += 6.5 * storm.strike_rate(when)
        wind = max(0.0, wind)
        gust = wind * random.uniform(1.35, 1.75)
        if storm is not None:
            gust = max(gust, wind + random.uniform(4.0, 9.0))
        wind_min = max(0.0, wind * random.uniform(0.45, 0.75))
        # Prevailing north-easterly, swinging to the storm outflow direction.
        direction = 55.0 + 35.0 * math.sin(2 * math.pi * i / (steps / 3.0))
        if storm is not None:
            direction = (direction + 180.0 * storm.strike_rate(when))
        direction = direction % 360.0
        dir_sd = random.uniform(6.0, 18.0) + (12.0 if storm is not None else 0.0)

        # ── rainfall (per-interval increment) ──────────────────────────────
        rain_inc = 0.0
        if storm is not None:
            share = storm_rain_fraction(storm, when)
            per_step = storm.peak_rain_mm * share / max(1.0, storm.duration_min / interval_min)
            rain_inc = round(max(0.0, per_step * random.uniform(0.6, 1.9)), 2)
        rain_today += rain_inc
        totals["rain"] += rain_inc

        # ── soil ───────────────────────────────────────────────────────────
        soil_moisture += rain_inc * 0.004                     # wetting
        soil_moisture -= 0.00018 * max(0.0, solar_w / 900.0)  # drying
        soil_moisture = max(0.08, min(0.42, soil_moisture))
        # Soil at 100 mm lags air temperature and swings far less.
        soil_lag = math.cos(math.radians(360.0 * (clock_h - 18.0) / 24.0))
        soil_temp = t_mean - 1.0 + 3.2 * soil_lag

        # ── AS3935 lightning ───────────────────────────────────────────────
        if storm is not None:
            rate = storm.strike_rate(when)
            new_strikes = int(round(rate * storm.strike_total
                                    / max(1.0, storm.duration_min / interval_min)
                                    * random.uniform(0.6, 1.5)))
        else:
            new_strikes = 0

        if new_strikes > 0:
            strike_counter += new_strikes
            dist = nearest_as3935_distance(max(1.0, min(40.0, storm.distance_km(when))))
            # Closer, more active cells return higher relative energy.
            closeness = 1.0 - (dist / 40.0)
            energy_frac = min(0.98, max(0.04,
                                        0.15 + 0.75 * closeness * random.uniform(0.7, 1.25)))
            energy = int(energy_frac * AS3935_ENERGY_MAX)
            totals["strikes"] += new_strikes
            totals["closest"] = dist if totals["closest"] is None else min(totals["closest"], dist)
            totals["peak_energy"] = max(totals["peak_energy"], energy)
        else:
            # No strike this interval: report nothing rather than a zero, so the
            # distance and intensity averages are not dragged down.
            dist = None
            energy = None

        # ── power system ───────────────────────────────────────────────────
        panel_v = 0.0 if solar_w < 5 else 17.5 + 3.0 * min(1.0, solar_w / 900.0) + random.uniform(-0.4, 0.4)
        panel_i = 0.0 if solar_w < 5 else round(4.6 * min(1.0, solar_w / 950.0) + random.uniform(-0.15, 0.15), 2)
        panel_i = max(0.0, panel_i)
        panel_p = round(panel_v * panel_i, 1)
        # Battery: charges under sun, discharges overnight.
        if solar_w > 60:
            batt = 13.5 + 0.9 * min(1.0, solar_w / 800.0)
        else:
            night_h = (clock_h - 18.0) % 24.0
            batt = 12.95 - 0.055 * min(11.0, night_h)
        batt += random.uniform(-0.02, 0.02)
        load_v = batt - random.uniform(0.05, 0.15)
        load_i = round(random.uniform(0.12, 0.34), 2)
        board_temp = temp + (5.5 if solar_w > 300 else 1.2) + random.uniform(-0.5, 0.5)
        panel_temp = temp + (6.5 if solar_w > 300 else 0.8) + random.uniform(-0.6, 0.6)

        # ── air quality and visibility ─────────────────────────────────────
        # Rain scavenges particulates; still winter nights trap them.
        pm25 = 8.0 + 10.0 * (1.0 - min(1.0, wind / 5.0)) + random.uniform(-2.0, 3.0)
        if rain_today > 1.0:
            pm25 *= 0.55
        pm25 = max(2.0, pm25)
        pm10 = pm25 * random.uniform(1.7, 2.4)
        visibility = 40.0 - 0.55 * pm10 + random.uniform(-2.0, 2.0)
        if storm is not None:
            visibility = min(visibility, 6.0 + 8.0 * (1.0 - storm.strike_rate(when)))
        visibility = max(0.4, min(60.0, visibility))

        uv = max(0.0, 12.0 * (solar_w / 1050.0) ** 1.05)
        totals["solar_mj"] += solar_mj

        rows.append([
            when,
            num(temp, 2), num(rh, 1), num(dew, 2), num(pressure, 2),
            num(wind, 2), num(gust, 2), num(wind_min, 2),
            num(direction, 1), num(dir_sd, 1),
            num(solar_w, 1), num(solar_mj, 4), num(uv, 1),
            num(rain_inc, 2),
            num(soil_temp, 2), num(soil_moisture, 4),
            num(visibility, 1), num(pm25, 1), num(pm10, 1),
            num(strike_counter, 0), num(dist, 0), num(energy, 0),
            num(batt, 3), num(panel_temp, 2),
            num(panel_v, 2), num(panel_i, 2), num(panel_p, 1),
            num(batt, 3), num(load_v, 2), num(load_i, 2),
            num(board_temp, 2),
        ])

    return rows, totals


# ---------------------------------------------------------------------------
# Lightning-only series
# ---------------------------------------------------------------------------

LIGHTNING_COLUMNS = [
    ("Lightning_Tot", "count", "Tot"),
    ("LightningDist", "km", "Smp"),
    ("LightningEnergy", "", "Smp"),
]


def generate_lightning_series(start: datetime, days: int, interval_min: int):
    """Build an AS3935-only series and return (rows, summary)."""
    steps = int(days * 24 * 60 / interval_min)
    storms = build_storms(start, days)
    strike_counter = 0
    rows: list[list] = []
    totals = {"strikes": 0, "closest": None, "peak_energy": 0,
              "storm_days": len(storms), "active_rows": 0}

    for i in range(steps):
        when = start + timedelta(minutes=i * interval_min)
        storm = next((s for s in storms if s.contains(when)), None)

        if storm is not None:
            rate = storm.strike_rate(when)
            new_strikes = int(round(rate * storm.strike_total
                                    / max(1.0, storm.duration_min / interval_min)
                                    * random.uniform(0.6, 1.5)))
        else:
            new_strikes = 0

        if new_strikes > 0:
            strike_counter += new_strikes
            dist = nearest_as3935_distance(max(1.0, min(40.0, storm.distance_km(when))))
            closeness = 1.0 - (dist / 40.0)
            energy_frac = min(0.98, max(0.04,
                                        0.15 + 0.75 * closeness * random.uniform(0.7, 1.25)))
            energy = int(energy_frac * AS3935_ENERGY_MAX)
            totals["strikes"] += new_strikes
            totals["active_rows"] += 1
            totals["closest"] = dist if totals["closest"] is None else min(totals["closest"], dist)
            totals["peak_energy"] = max(totals["peak_energy"], energy)
        else:
            dist = None
            energy = None

        rows.append([when, num(strike_counter, 0), num(dist, 0), num(energy, 0)])

    return rows, totals


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Generate Potchefstroom demo TOA5 files for Stratus.")
    ap.add_argument("--days", type=int, default=14,
                    help="length of the record in days (default 14, minimum 7)")
    ap.add_argument("--interval", type=int, default=10,
                    help="logging interval in minutes (default 10)")
    ap.add_argument("--seed", type=int, default=20260812,
                    help="random seed, for reproducible files")
    args = ap.parse_args()

    days = max(7, args.days)
    interval = max(1, args.interval)
    random.seed(args.seed)

    # End on the most recent completed interval so the series runs right up to
    # now and lands inside the dashboard's default 7-day window.
    now = datetime.now().replace(second=0, microsecond=0)
    now -= timedelta(minutes=now.minute % interval)
    start = now - timedelta(days=days)

    print("Stratus demo data generator")
    print("=" * 68)
    print(f"Site       {SITE_NAME}  lat {LATITUDE}  lon {LONGITUDE}  alt {ALTITUDE_M:.0f} m")
    print(f"Window     {start:%Y-%m-%d %H:%M} to {now:%Y-%m-%d %H:%M} SAST ({days} days)")
    print(f"Interval   {interval} min")
    print(f"Pressure   station level near {station_pressure_hpa():.1f} hPa at {ALTITUDE_M:.0f} m")
    print()

    # ── file 1: complete station ────────────────────────────────────────────
    random.seed(args.seed)
    rows, totals = generate_full_series(start, days, interval)
    full_path = "potchefstroom_full_demo.dat"
    write_toa5(full_path, SITE_NAME, "WeatherData", FULL_COLUMNS, rows)

    print(f"1. {full_path}")
    print(f"   {len(rows)} records, {len(FULL_COLUMNS)} measured channels")
    print(f"   rainfall total      {totals['rain']:.1f} mm over {totals['storm_days']} storm days")
    print(f"   solar total         {totals['solar_mj']:.1f} MJ/m2")
    print(f"   lightning strikes   {totals['strikes']} (cumulative counter)")
    if totals["closest"] is not None:
        print(f"   closest strike      {totals['closest']} km")
        pct = 100.0 * totals["peak_energy"] / AS3935_ENERGY_MAX
        print(f"   peak intensity      {totals['peak_energy']:,} ({pct:.0f}% of 21-bit full scale)")
    print()

    # ── file 2: lightning only ──────────────────────────────────────────────
    random.seed(args.seed + 1)
    lrows, ltotals = generate_lightning_series(start, days, interval)
    lightning_path = "as3935_lightning_demo.dat"
    write_toa5(lightning_path, f"{SITE_NAME} AS3935", "Lightning",
               LIGHTNING_COLUMNS, lrows)

    print(f"2. {lightning_path}")
    print(f"   {len(lrows)} records, {ltotals['active_rows']} with a detected strike")
    print(f"   lightning strikes   {ltotals['strikes']} over {ltotals['storm_days']} storm days")
    if ltotals["closest"] is not None:
        print(f"   closest strike      {ltotals['closest']} km")
        pct = 100.0 * ltotals["peak_energy"] / AS3935_ENERGY_MAX
        print(f"   peak intensity      {ltotals['peak_energy']:,} ({pct:.0f}% of 21-bit full scale)")
    print()
    print("Import through the dashboard Data Import screen.")
    print("Set the station latitude, longitude and altitude to the values above,")
    print("otherwise reference ETo and the report site line cannot be calculated.")


if __name__ == "__main__":
    main()
