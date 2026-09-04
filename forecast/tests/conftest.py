"""Shared fixtures.

The TOA5 fixture is generated here rather than shipped as a file. A checked-in
sample would be demo data by another name, and it would drift from what the
parser actually claims to support.
"""
from __future__ import annotations

import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(autouse=True)
def no_live_credentials(monkeypatch):
    """Keep real third-party credentials out of every test.

    Applied automatically. The shell that runs the suite may well have the
    deploy credentials exported, and a test that assumes a service is
    unconfigured would then quietly make a live API call against the operator's
    account and spend their quota. This makes that impossible rather than
    relying on each test to remember.
    """
    for name in ("XWEATHER_CLIENT_ID", "XWEATHER_CLIENT_SECRET",
                 "XWEATHER_KEY", "XWEATHER_ENABLED",
                 "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET",
                 "DROPBOX_REFRESH_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DROPBOX_POLLING", "false")


def make_toa5(hours: int = 24 * 14, start: datetime | None = None,
              station: str = "TestSite", step_minutes: int = 30,
              wind_unit: str = "m/s", *,
              airshed: bool = False, photovoltaic: bool = False,
              air_quality: bool = False, inversion: bool = True) -> str:
    """A synthetic but realistic TOA5 export.

    Realistic matters: a diurnal temperature curve, a dew point that tracks it,
    pressure that drifts, and wind that crosses north so the circular handling
    is genuinely exercised.

    The three sensor groups are opt-in, one keyword each, so a station that has
    never carried these channels is still the default and every test written
    against that default keeps passing unchanged:

      airshed      adds Temp8m_Avg and DeltaTemp_Avg, the 8 m air temperature
                   and its difference from the 2 m screen. `inversion` decides
                   which night this is. With inversion=True the 8 m air sits
                   warmer than the surface overnight, the radiative-frost regime
                   where the ground decouples and frost fans can help. With
                   inversion=False the night is well mixed and the difference is
                   near zero, the regime where they cannot. Both have to be
                   reachable or only one branch of the frost typing is ever
                   tested, and the untested branch is the one that decides
                   whether a grower spends money on fans.
      photovoltaic adds MOD_TEMP_Avg and MPPT_SolP_Avg, a measured module
                   temperature and a measured DC power, so the cell-temperature
                   and yield models can be scored against measurement.
      air_quality  adds PM2_5_Avg and PM10_Avg for the soiling model. Under a
                   nocturnal inversion the particulates build up near the
                   surface, so they track `inversion` too.

    Nothing here is written to disk. A checked-in sample would be demo data by
    another name and would drift from what the parser claims to support.
    """
    start = start or datetime(2026, 1, 1, 0, 0)

    # Optional channel groups, each a list of (header, unit, aggregation). Held
    # in order so the header rows and the data cells stay aligned.
    extra: list[tuple[str, str, str]] = []
    if airshed:
        extra += [("Temp8m_Avg", "Deg C", "Avg"),
                  ("DeltaTemp_Avg", "Deg C", "Avg")]
    if photovoltaic:
        extra += [("MOD_TEMP_Avg", "Deg C", "Avg"),
                  ("MPPT_SolP_Avg", "W", "Avg")]
    if air_quality:
        extra += [("PM2_5_Avg", "ug/m3", "Avg"),
                  ("PM10_Avg", "ug/m3", "Avg")]

    names_extra = "".join(f',"{h}"' for h, _u, _a in extra)
    units_extra = "".join(f',"{u}"' for _h, u, _a in extra)
    aggs_extra = "".join(f',"{a}"' for _h, _u, a in extra)

    lines = [
        f'"TOA5","{station}","CR1000X","1234","CR1000X.Std.13.02",'
        f'"CPU:Test.CR1X","51201","WeatherData"',
        '"TIMESTAMP","RECORD","AirTC_Avg","RH","DewPt_Avg","BP_mbar_Avg",'
        '"WS_ms_Avg","WS_Max","WindDir","SlrW_Avg","Rain_mm_Tot",'
        '"SoilTC_Avg","BattV_Avg"' + names_extra,
        f'"TS","RN","Deg C","%","Deg C","mbar","{wind_unit}","{wind_unit}",'
        f'"Deg","W/m^2","mm","Deg C","V"' + units_extra,
        '"","","Avg","Smp","Avg","Avg","Avg","Max","Smp","Avg","Tot","Avg",'
        '"Avg"' + aggs_extra,
    ]
    steps = int(hours * 60 / step_minutes)
    for i in range(steps):
        when = start + timedelta(minutes=i * step_minutes)
        h = when.hour + when.minute / 60.0
        day = i * step_minutes / 1440.0
        night = h < 6.0 or h >= 19.0
        # Diurnal curve with a slow synoptic drift on top.
        temp = 18.0 + 8.0 * math.sin((h - 9.0) / 24.0 * 2 * math.pi) \
            + 2.0 * math.sin(day / 5.0 * 2 * math.pi)
        rh = max(12.0, min(99.0, 70.0 - 2.2 * (temp - 18.0)))
        dew = temp - (100.0 - rh) / 5.0
        press = 860.0 + 3.0 * math.sin(day / 4.0 * 2 * math.pi)
        wind = max(0.2, 2.4 + 1.9 * math.sin((h - 14.0) / 24.0 * 2 * math.pi))
        gust = wind * 1.7
        # Sweeps through north so the wrap is exercised.
        wdir = (330.0 + 40.0 * math.sin(day / 3.0 * 2 * math.pi)) % 360.0
        solar = max(0.0, 850.0 * math.sin((h - 6.0) / 12.0 * math.pi)) \
            if 6.0 <= h <= 18.0 else 0.0
        soil = 17.0 + 2.0 * math.sin((h - 14.0) / 24.0 * 2 * math.pi)
        row = (
            f'"{when.strftime("%Y-%m-%d %H:%M:%S")}","{i + 1}",'
            f'"{temp:.2f}","{rh:.1f}","{dew:.2f}","{press:.2f}",'
            f'"{wind:.2f}","{gust:.2f}","{wdir:.1f}","{solar:.1f}",'
            f'"0.00","{soil:.2f}","12.80"')

        if airshed:
            # 8 m minus 2 m. Positive overnight under an inversion (surface
            # colder than the air above), near zero on a mixed night, and a
            # gentle daytime lapse when the sun mixes the layer.
            if not night:
                delta = -0.5
            else:
                delta = 3.5 if inversion else 0.1
            t8 = temp + delta
            row += f',"{t8:.2f}","{delta:.2f}"'

        if photovoltaic:
            # Module runs hot in the sun and radiates below air temperature at
            # night. DC power tracks irradiance.
            module = temp + 0.03 * solar - (2.0 if solar < 5.0 else 0.0)
            dc_power = 0.42 * solar
            row += f',"{module:.2f}","{dc_power:.1f}"'

        if air_quality:
            pm25 = max(2.0, 12.0 + 6.0 * math.cos((h - 6.0) / 24.0 * 2 * math.pi))
            if inversion and night:
                pm25 += 5.0
            pm10 = pm25 * 1.7
            row += f',"{pm25:.1f}","{pm10:.1f}"'

        lines.append(row)
    return "\n".join(lines) + "\n"


@pytest.fixture
def toa5_text():
    return make_toa5()


@pytest.fixture
def database(tmp_path):
    from app.db import Database
    return Database(tmp_path / "test.db")


@pytest.fixture
def loaded_station(database, toa5_text):
    """A station with two weeks of half-hourly data, ready to forecast."""
    from app import ingest
    observations, report = ingest.parse_dat(toa5_text)
    sid = database.upsert_station("testsite", report.station_name,
                                  report.logger_model)
    database.update_station_position(sid, -26.7145, 27.0977, 1350.0, 2.0)
    database.insert_observations(sid, observations)
    return database.get_station(sid)
