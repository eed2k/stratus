"""Report SVG chart builders (Task 8).

Each builder must return well-formed XML, use the Arial font, and contain no
em dash characters.
"""
import types
import xml.etree.ElementTree as ET
from datetime import timedelta

from app import charts
from app.timeutil import now_sast

EM_DASH = "\u2014"


def _valid_svg(svg):
    # Parses as XML (raises on malformed) and is an <svg> root.
    root = ET.fromstring(svg)
    assert root.tag.endswith("svg")
    assert "Arial" in svg
    assert EM_DASH not in svg


def _samples(n=6):
    base = now_sast() - timedelta(hours=5)
    return [types.SimpleNamespace(ts=base + timedelta(hours=i),
                                  cpu_temp_c=40 + i, cpu_load_pct=10 + i)
            for i in range(n)]


def test_cpu_trend_svg_valid():
    _valid_svg(charts.cpu_trend_svg(_samples(), hours=24))


def test_cpu_trend_svg_empty_state():
    svg = charts.cpu_trend_svg([], hours=24)
    _valid_svg(svg)
    assert "Collecting data" in svg


def test_distance_histogram_valid():
    svg = charts.distance_histogram_svg([2.0, 8.0, 12.0, 39.0, 40.0])
    _valid_svg(svg)


def test_distance_histogram_empty():
    _valid_svg(charts.distance_histogram_svg([]))


def test_energy_band_histogram_valid_and_bands():
    # One in each band: Low, Moderate, High, Extreme.
    svg = charts.energy_band_histogram_svg([100, 600000, 1100000, 2000000])
    _valid_svg(svg)
    for name in ("Low", "Moderate", "High", "Extreme"):
        assert name in svg


def test_uptime_gauge_valid_and_clamped():
    for pct in (-5, 0, 42.5, 99.9, 150):
        svg = charts.uptime_gauge_svg(pct)
        _valid_svg(svg)


def test_storm_rings_valid():
    strikes = [{"distance_km": 5, "energy": 600000, "colour": "#1b3a5b"},
               {"distance_km": 22, "energy": 1600000},
               {"distance_km": 40, "energy": 100}]
    svg = charts.storm_rings_svg(strikes, radius_km=40)
    _valid_svg(svg)
    assert "bearing not measured" in svg


def test_storm_rings_empty():
    _valid_svg(charts.storm_rings_svg([], radius_km=40))
