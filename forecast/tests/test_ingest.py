"""Ingest tests: the format, the unit conversions and the failure modes."""
from __future__ import annotations

from datetime import datetime

import pytest

from app import ingest

from conftest import make_toa5


def test_reads_a_toa5_header():
    obs, rep = ingest.parse_dat(make_toa5(hours=48))
    assert rep.file_format == "TOA5"
    assert rep.station_name == "TestSite"
    assert rep.logger_model == "CR1000X"
    assert rep.table_name == "WeatherData"
    assert rep.rows_kept == 96
    assert rep.rows_skipped == 0
    assert len(obs) == 96


def test_maps_every_engine_variable_present():
    _obs, rep = ingest.parse_dat(make_toa5(hours=48))
    for expected in ("temperature", "humidity", "dew_point", "pressure",
                     "wind_speed", "wind_gust", "wind_direction",
                     "solar_radiation", "soil_temperature"):
        assert expected in rep.mapped, expected
    assert rep.mapped["temperature"] == "AirTC_Avg"
    assert rep.mapped["wind_gust"] == "WS_Max"


def test_metres_per_second_becomes_kilometres_per_hour():
    """The conversion that quietly ruins everything downstream if missed."""
    obs, rep = ingest.parse_dat(make_toa5(hours=4, step_minutes=60))
    assert any("m/s to km/h" in c for c in rep.conversions)
    # The generator's first wind value, times 3.6.
    raw_first = 0.0
    for line in make_toa5(hours=4, step_minutes=60).splitlines()[4:5]:
        raw_first = float(line.split(",")[6].strip('"'))
    assert obs[0].values["wind_speed"] == pytest.approx(raw_first * 3.6,
                                                       abs=1e-6)


def test_kph_column_is_not_converted_again():
    obs, _rep = ingest.parse_dat(make_toa5(hours=4, step_minutes=60,
                                           wind_unit="kph"))
    raw = float(make_toa5(hours=4, step_minutes=60,
                          wind_unit="kph").splitlines()[4].split(",")[6]
                .strip('"'))
    assert obs[0].values["wind_speed"] == pytest.approx(raw)


def test_station_pressure_is_kept_as_measured():
    obs, rep = ingest.parse_dat(make_toa5(hours=48))
    pressures = [o.values["pressure"] for o in obs]
    assert 850.0 < min(pressures) < 870.0
    # An 860 hPa median must not trip the sea-level warning.
    assert not any("sea-level" in w for w in rep.warnings)


def test_sea_level_pressure_is_flagged():
    """A reduced series would blend against a model's station pressure badly."""
    text = make_toa5(hours=48).replace('"860', '"1013').replace(
        '"861', '"1014').replace('"862', '"1015').replace('"863', '"1016')
    _obs, rep = ingest.parse_dat(text)
    assert any("sea-level" in w for w in rep.warnings), rep.warnings


def test_nan_becomes_a_gap_not_a_zero():
    lines = make_toa5(hours=6, step_minutes=60).splitlines()
    cells = lines[4].split(",")
    cells[2] = '"NAN"'
    lines[4] = ",".join(cells)
    obs, _rep = ingest.parse_dat("\n".join(lines))
    assert "temperature" not in obs[0].values
    assert obs[0].values["humidity"] is not None


def test_ragged_header_rows_are_tolerated():
    """One real file in this repo has more units than column names."""
    lines = make_toa5(hours=6, step_minutes=60).splitlines()
    lines[2] = lines[2] + ',"extra","extra","extra"'
    obs, rep = ingest.parse_dat("\n".join(lines))
    assert obs
    assert any("disagree" in w for w in rep.warnings), rep.warnings


def test_duplicate_timestamps_keep_the_first_reading():
    lines = make_toa5(hours=6, step_minutes=60).splitlines()
    lines.append(lines[4])
    obs, rep = ingest.parse_dat("\n".join(lines))
    assert rep.rows_skipped == 1
    stamps = [o.observed_at for o in obs]
    assert len(stamps) == len(set(stamps))


def test_rows_are_sorted_even_when_the_file_is_not():
    lines = make_toa5(hours=6, step_minutes=60).splitlines()
    body = lines[4:]
    body.reverse()
    obs, _rep = ingest.parse_dat("\n".join(lines[:4] + body))
    assert obs == sorted(obs, key=lambda o: o.observed_at)


def test_plain_csv_without_a_toa5_header():
    csv = ("TIMESTAMP,AirTC_Avg,RH\n"
           "2026-01-01 00:00:00,15.2,60\n"
           "2026-01-01 01:00:00,14.8,63\n")
    obs, rep = ingest.parse_dat(csv)
    assert rep.file_format == "CSV"
    assert len(obs) == 2
    assert obs[0].values["temperature"] == 15.2


def test_empty_file_is_rejected_clearly():
    with pytest.raises(ingest.IngestError, match="empty"):
        ingest.parse_dat("")


def test_file_with_no_forecastable_columns_is_rejected_clearly():
    """A file whose only recognized column is a tier-3 diagnostic (here a
    lightning count) has nothing the forecast can use, so it is refused even
    though the column is now in the vocabulary."""
    text = ('"TOA5","X","CR1000","1","OS","P","1","T"\n'
            '"TIMESTAMP","RECORD","Lightning_Tot"\n'
            '"TS","RN","count"\n'
            '"","","Tot"\n'
            '"2026-01-01 00:00:00","1","0"\n')
    with pytest.raises(ingest.IngestError, match="No forecastable weather"):
        ingest.parse_dat(text)


def test_unparseable_timestamps_are_skipped_not_fatal():
    lines = make_toa5(hours=6, step_minutes=60).splitlines()
    cells = lines[5].split(",")
    cells[0] = '"not a date"'
    lines[5] = ",".join(cells)
    obs, rep = ingest.parse_dat("\n".join(lines))
    assert rep.rows_skipped == 1
    assert len(obs) == 5


def test_out_of_range_values_are_flagged_but_kept():
    lines = make_toa5(hours=6, step_minutes=60).splitlines()
    cells = lines[4].split(",")
    cells[3] = '"140.0"'                     # humidity of 140 percent
    lines[4] = ",".join(cells)
    obs, rep = ingest.parse_dat("\n".join(lines))
    assert obs[0].values["humidity"] == 140.0
    assert any("humidity" in w for w in rep.warnings)


@pytest.mark.parametrize("raw,expected", [
    ("2026-08-12 04:50:00", datetime(2026, 8, 12, 4, 50)),
    ("2026-08-12 04:50", datetime(2026, 8, 12, 4, 50)),
    ("2026/08/12 04:50:00", datetime(2026, 8, 12, 4, 50)),
    ("2026-08-12T04:50:00", datetime(2026, 8, 12, 4, 50)),
    ("2026-08-12 04:50:00.25", datetime(2026, 8, 12, 4, 50)),
])
def test_timestamp_formats(raw, expected):
    assert ingest.parse_timestamp(raw) == expected


def test_timestamps_stay_naive():
    """Logger time is local standard time and must not gain a tzinfo."""
    obs, _rep = ingest.parse_dat(make_toa5(hours=4, step_minutes=60))
    assert obs[0].observed_at.tzinfo is None


# ---------------------------------------------------------------------------
#  Full parameter vocabulary parity with the Stratus TypeScript parser
# ---------------------------------------------------------------------------

def _parser_source():
    """The TypeScript Campbell parser, or None when the forecast is checked out
    on its own. The repo root is two levels above this test file."""
    from pathlib import Path
    return (Path(__file__).resolve().parents[2] / "server" / "parsers"
            / "campbellScientific.ts")


def _parser_aliases(text: str) -> set[str]:
    """Every alias string in the parser's fieldMappings object."""
    import re
    start = text.index("const fieldMappings")
    brace = text.index("{", start)
    depth, end = 0, brace
    for i in range(brace, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    block = text[brace + 1:end]
    aliases: set[str] = set()
    for m in re.finditer(r"\w+\s*:\s*\[([^\]]*)\]", block):
        for a in m.group(1).split(","):
            a = a.strip().strip('"').strip("'")
            if a:
                aliases.add(a)
    return aliases


def test_vocabulary_parity_with_the_stratus_parser():
    """P17 vocabulary parity: every column alias the TypeScript parser
    recognizes is recognized here too, read from the parser source so the two
    cannot drift apart unnoticed.

    Skipped, not failed, when the parser is absent, so the forecast test suite
    still runs on its own.
    """
    parser = _parser_source()
    if not parser.exists():
        pytest.skip(f"parser source not found at {parser}; "
                    "the forecast suite runs standalone")
    ts_aliases = _parser_aliases(parser.read_text(encoding="utf-8"))
    ours = {a for al in ingest.ALIASES.values() for a in al}
    missing = sorted(ts_aliases - ours)
    assert not missing, (
        f"{len(missing)} aliases the parser knows but ingest does not: "
        f"{missing}")


def test_the_shared_battery_alias_is_mirrored_not_fixed():
    """P17, the ambiguity half. SolarCharger_BatteryVoltage_2_Avg is the one
    alias the parser assigns to two fields; the table mirrors that rather than
    diverging. Either owner may win the column at parse time."""
    owners = [v for v, al in ingest.ALIASES.items()
              if "SolarCharger_BatteryVoltage_2_Avg" in al]
    assert set(owners) == {"batteryVoltage2", "mppt2BatteryVoltage"}


def test_the_three_tiers_partition_the_vocabulary():
    engine = set(ingest.ENGINE_VARIABLES)
    product = set(ingest.PRODUCT_VARIABLES)
    stored = set(ingest.STORED_VARIABLES)
    assert engine.isdisjoint(product)
    assert engine.isdisjoint(stored)
    assert product.isdisjoint(stored)
    # Together the tiers are exactly the alias keys: nothing recognized is
    # left out of a tier, and no tier names a field that has no aliases.
    assert engine | product | stored == set(ingest.ALIASES)
    # The product tier is the twelve inputs the sector products consume.
    assert len(ingest.PRODUCT_VARIABLES) == 12


def test_tier_two_and_three_channels_store_alongside_weather():
    """A module temperature and an MPPT power (tier 2) and a charger state
    (tier 3) are recognized and stored when they arrive with the weather."""
    text = ('"TOA5","X","CR1000X","1","OS","P","1","T"\n'
            '"TIMESTAMP","RECORD","AirTC_Avg","MOD_TEMP_Avg","MPPT_SolP_Avg",'
            '"SolarCharger_State_1"\n'
            '"TS","RN","Deg C","Deg C","W","unitless"\n'
            '"","","Avg","Avg","Avg","Smp"\n'
            '"2026-01-01 00:00:00","1","15.0","28.5","240.0","3"\n')
    obs, rep = ingest.parse_dat(text)
    assert rep.mapped.get("moduleTemperature") == "MOD_TEMP_Avg"
    assert rep.mapped.get("mpptSolarPower") == "MPPT_SolP_Avg"
    assert rep.mapped.get("mpptChargerState") == "SolarCharger_State_1"
    assert obs[0].values["moduleTemperature"] == pytest.approx(28.5)
    assert obs[0].values["mpptSolarPower"] == pytest.approx(240.0)
    assert obs[0].values["mpptChargerState"] == pytest.approx(3.0)


def test_an_unrecognized_column_is_listed_not_fatal():
    """R1.7: a column the forecast cannot interpret is reported, not a reason to
    reject a file that also carries real weather."""
    text = ('"TOA5","X","CR1000","1","OS","P","1","T"\n'
            '"TIMESTAMP","RECORD","AirTC_Avg","Gizmo_Avg"\n'
            '"TS","RN","Deg C","widgets"\n'
            '"","","Avg","Avg"\n'
            '"2026-01-01 00:00:00","1","15.0","42"\n')
    obs, rep = ingest.parse_dat(text)
    assert "temperature" in rep.mapped
    assert "Gizmo_Avg" in rep.unmapped_columns
    assert obs[0].values["temperature"] == 15.0
