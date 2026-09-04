"""Sector configuration and the assembled per-sector reports.

The property under test throughout is P15: a station that lacks a sensor gets a
page that names what is missing, never a page of zeros and never a traceback.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app import forecasting, sector_report
from app.ingest import Observation

from conftest import make_toa5


# ---------------------------------------------------------------------------
#  Configuration (R8.1, R8.4)
# ---------------------------------------------------------------------------

def test_sectors_can_be_enabled_in_any_combination(database):
    sid = database.upsert_station("s1", "Site One", "CR1000X")
    assert database.enabled_sectors(sid) == []
    database.upsert_sector_config(sid, solar=True, agriculture=True)
    assert database.enabled_sectors(sid) == ["solar", "agriculture"]
    database.upsert_sector_config(sid, wind=True)
    assert database.enabled_sectors(sid) == ["wind"]


def test_configuration_round_trips(database):
    sid = database.upsert_station("s2", "Site Two", "CR1000X")
    database.upsert_sector_config(
        sid, solar=True, tilt_deg=30.0, surface_azimuth_deg=0.0,
        rated_w=5000.0, hub_height_m=80.0, crop="maize")
    cfg = database.get_sector_config(sid)
    assert cfg["solar"] == 1
    assert cfg["tilt_deg"] == 30.0
    assert cfg["rated_w"] == 5000.0
    assert cfg["hub_height_m"] == 80.0
    assert cfg["crop"] == "maize"
    assert cfg["tracking"] == "fixed"


@pytest.mark.parametrize("field,value", [
    ("tilt_deg", 120.0),
    ("tilt_deg", -5.0),
    ("surface_azimuth_deg", 400.0),
    ("hub_height_m", 0.0),
    ("row_pitch_m", -1.0),
])
def test_out_of_range_values_are_rejected(database, field, value):
    """R8.4: a typo is refused, not clamped, so the page cannot disagree with
    what was stored."""
    sid = database.upsert_station(f"bad-{field}-{value}", "Bad", "CR1000X")
    with pytest.raises(ValueError):
        database.upsert_sector_config(sid, solar=True, **{field: value})


def test_an_unknown_tracking_mode_is_rejected(database):
    sid = database.upsert_station("track", "Track", "CR1000X")
    with pytest.raises(ValueError):
        database.upsert_sector_config(sid, solar=True, tracking="dual_axis")


# ---------------------------------------------------------------------------
#  Reports
# ---------------------------------------------------------------------------

@pytest.fixture
def station_with_run(database):
    """A station with real observations and a forecast run to build from."""
    from app import ingest
    obs, _rep = ingest.parse_dat(make_toa5(hours=24 * 20))
    sid = database.upsert_station("built", "Built Site", "CR1000X")
    database.update_station_position(sid, -26.7145, 27.0977, 1350.0, 2.0)
    database.insert_observations(sid, obs)
    station = database.get_station(sid)
    forecasting.run_forecast(database, station, 24)
    return sid


def test_an_unknown_sector_is_none(database, station_with_run):
    assert sector_report.build(database, station_with_run, "quantum") is None


def test_a_station_without_a_run_is_none(database):
    sid = database.upsert_station("norun", "No Run", "CR1000X")
    assert sector_report.build(database, sid, "solar") is None


def test_solar_report_builds_and_carries_the_method_version(database,
                                                           station_with_run):
    database.upsert_sector_config(station_with_run, solar=True,
                                  tilt_deg=30.0, surface_azimuth_deg=0.0,
                                  rated_w=5000.0)
    rep = sector_report.build(database, station_with_run, "solar")
    assert rep is not None
    assert rep.sector == "solar"
    assert rep.method_version                     # stamped at issue time
    assert rep.usable
    poa = rep.sections[0]
    assert poa.available
    assert poa.data["rows"]
    assert poa.data["poa_kwh_per_m2"] > 0.0
    assert poa.data["dc_kwh"] is not None


def test_solar_without_a_rating_says_what_is_missing(database,
                                                    station_with_run):
    database.upsert_sector_config(station_with_run, solar=True, tilt_deg=30.0,
                                  surface_azimuth_deg=0.0)
    rep = sector_report.build(database, station_with_run, "solar")
    dc = next(s for s in rep.sections if s.title == "DC yield")
    assert dc.available is False
    assert any("rating" in m for m in dc.missing)


def test_wind_report_names_a_missing_hub_height(database, station_with_run):
    database.upsert_sector_config(station_with_run, wind=True)
    rep = sector_report.build(database, station_with_run, "wind")
    resource = rep.sections[0]
    assert resource.available
    assert resource.data["power_density_wm2"] > 0.0
    # P8 ordering survives into the report.
    assert (resource.data["p90_speed_kmh"] <= resource.data["p50_speed_kmh"]
            <= resource.data["p10_speed_kmh"])
    hub = next(s for s in rep.sections if s.title == "Hub height")
    assert hub.available is False
    assert any("hub height" in m for m in hub.missing)


def test_wind_gust_section_reports_a_gust_factor_not_turbulence(
        database, station_with_run):
    database.upsert_sector_config(station_with_run, wind=True,
                                  hub_height_m=80.0)
    rep = sector_report.build(database, station_with_run, "wind")
    gust = next(s for s in rep.sections if s.title == "Gust factor")
    if gust.available:
        t = gust.data["turbulence"]
        # P20: no wind-speed sigma is available, so no turbulence intensity.
        assert t.turbulence_intensity is None
        assert t.iec_class is None


def test_agriculture_report_presents_one_frost_probability(database,
                                                          station_with_run):
    database.upsert_sector_config(station_with_run, agriculture=True,
                                  crop="maize", livestock="dairy_cattle")
    rep = sector_report.build(database, station_with_run, "agriculture")
    frost = next(s for s in rep.sections if s.title == "Frost")
    assert frost.available
    assessment = frost.data["assessment"]
    # P19: the assessment contributes a band and a score, never a rival
    # probability, and the note says which number is the probability.
    assert hasattr(assessment, "heuristic_score")
    assert not hasattr(assessment, "probability")
    assert "ensemble" in frost.note


def test_agrivoltaics_without_geometry_invites_configuration(database,
                                                            station_with_run):
    """R6.10 / R8.6: unconfigured geometry names the settings needed rather than
    rendering a page of zeros."""
    database.upsert_sector_config(station_with_run, agrivoltaics=True)
    rep = sector_report.build(database, station_with_run, "agrivoltaics")
    assert rep.usable is False
    section = rep.sections[0]
    assert section.available is False
    assert any("row pitch" in m for m in section.missing)
    assert any("collector width" in m for m in section.missing)


def test_agrivoltaics_with_geometry_builds_the_tradeoff(database,
                                                        station_with_run):
    database.upsert_sector_config(
        station_with_run, agrivoltaics=True, row_pitch_m=5.0,
        collector_width_m=2.0, tilt_deg=25.0, surface_azimuth_deg=0.0)
    rep = sector_report.build(database, station_with_run, "agrivoltaics")
    assert rep.usable
    light = next(s for s in rep.sections
                 if s.title == "Crop light under the array")
    assert light.available
    assert light.data["budget"].dli_open > 0.0
    trade = next(s for s in rep.sections
                 if s.title == "Energy against crop light")
    assert trade.available
    assert trade.data["tradeoff"].dc_energy_given_up_wh_per_m2 >= 0.0


# ---------------------------------------------------------------------------
#  P15: a bare station degrades cleanly across every sector
# ---------------------------------------------------------------------------

def test_a_temperature_only_station_never_raises(database):
    """The hardest case for P15: one channel, every sector enabled."""
    sid = database.upsert_station("bare", "Bare Site", "CR1000X")
    base = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        Observation(observed_at=base + timedelta(hours=i),
                    values={"temperature": 15.0 + (i % 12)})
        for i in range(24 * 15)])
    station = database.get_station(sid)
    forecasting.run_forecast(database, station, 24)
    database.upsert_sector_config(sid, solar=True, wind=True,
                                  agriculture=True, agrivoltaics=True)

    for sector in ("solar", "wind", "agriculture", "agrivoltaics"):
        rep = sector_report.build(database, sid, sector)
        assert rep is not None, sector
        for section in rep.sections:
            if not section.available:
                assert section.missing or section.note, (sector, section.title)


def test_missing_sensors_are_named_in_operator_words(database):
    """R8.6: the message names a sensor, not an internal field."""
    sid = database.upsert_station("named", "Named", "CR1000X")
    base = datetime(2026, 1, 1, 0, 0)
    database.insert_observations(sid, [
        Observation(observed_at=base + timedelta(hours=i),
                    values={"temperature": 15.0 + (i % 10)})
        for i in range(24 * 15)])
    station = database.get_station(sid)
    forecasting.run_forecast(database, station, 24)
    database.upsert_sector_config(sid, solar=True, wind=True)

    solar_rep = sector_report.build(database, sid, "solar")
    missing = " ".join(solar_rep.sections[0].missing)
    assert "pyranometer" in missing
    assert "solar_radiation" not in missing

    wind_rep = sector_report.build(database, sid, "wind")
    wind_missing = " ".join(wind_rep.sections[0].missing)
    assert "anemometer" in wind_missing
    assert "wind_speed" not in wind_missing


def test_nothing_derived_is_stored(database, station_with_run):
    """R8.7: sector quantities are recomputed, so no table holds them. The only
    sector-related value captured at issue time is the method version."""
    with database.connect() as c:
        tables = {r["name"] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table'")}
    for derived in ("plane_of_array", "sector_results", "dli_cache",
                    "sector_quantities"):
        assert derived not in tables
    with database.connect() as c:
        cfg_columns = {r["name"] for r in
                       c.execute("PRAGMA table_info(sector_config)")}
    # Configuration only: no computed outputs parked alongside it.
    for derived in ("poa_wm2", "dli", "dc_kwh", "power_density"):
        assert derived not in cfg_columns
