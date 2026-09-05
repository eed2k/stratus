"""The chart SVG is injected into templates with `|safe`, so charts.py is the
only thing standing between a hostile string and stored XSS on those pages.

Every text insertion in charts.py currently routes through `_esc()`. That is a
real invariant but it was undocumented and untested, so one careless edit adding
an unescaped f-string would break it silently. These tests pin it.

The station name is the worst case: it is operator-supplied, it is stored, and it
is echoed back on several pages, so it is used here as the hostile payload.
"""
import re
from datetime import datetime, timedelta

import pytest

from app import charts

# Payloads chosen to break out of each context the SVG uses: element text, a
# double-quoted attribute, and a comment.
HOSTILE = [
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    "</text><script>alert(1)</script>",
    '" onload="alert(1)',
    "<!--<script>alert(1)</script>-->",
    "<img src=x onerror=alert(1)>",
]


def _points(n=8):
    start = datetime(2026, 9, 7, 0, 0)
    out = []
    for i in range(n):
        out.append({
            "valid_at": start + timedelta(hours=i),
            "value": 20.0 + i,
            "p10": 18.0 + i,
            "p90": 22.0 + i,
            "lead_hours": i,
            "persistence": 20.0,
            "climatology": 19.5,
        })
    return out


# The only elements charts.py ever emits. Anything else in the output means a
# payload succeeded in opening a new element.
ALLOWED_TAGS = {
    "svg", "rect", "text", "tspan", "line", "path", "circle", "ellipse",
    "polyline", "polygon", "g", "defs", "clippath", "title", "desc",
}


def _assert_no_live_markup(svg: str, payload: str):
    """The payload may appear only as inert, escaped text.

    The meaningful invariant is NOT "the string onerror never appears": escaped
    text inside a quoted attribute is inert, and asserting on substrings would
    fail on harmless output. What matters is that the payload cannot open a new
    element or break out of an attribute. So this checks the element whitelist
    and that the payload's metacharacters were escaped.
    """
    assert payload not in svg, f"raw payload survived into the SVG: {payload!r}"

    tags = {t.lower() for t in re.findall(r"<\s*/?\s*([A-Za-z][\w:-]*)", svg)}
    unexpected = tags - ALLOWED_TAGS
    assert not unexpected, f"payload opened unexpected elements: {unexpected}"

    if "<" in payload:
        assert "&lt;" in svg, "the payload's < must be escaped"
    if '"' in payload:
        assert "&quot;" in svg, "the payload's quote must be escaped"


# ---------------------------------------------------------------------------
# The escaping helper itself
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("payload", HOSTILE)
def test_esc_escapes_angle_brackets_and_quotes(payload):
    out = charts._esc(payload)
    assert "<" not in out
    assert ">" not in out
    assert '"' not in out


def test_esc_escapes_quotes_because_output_lands_in_attributes():
    """aria-label="..." means an unescaped quote is an attribute break-out."""
    assert '"' not in charts._esc('a "quoted" name')


# ---------------------------------------------------------------------------
# series_chart: title and unit are the operator-influenced strings
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("payload", HOSTILE)
def test_series_chart_escapes_a_hostile_title(payload):
    svg = charts.series_chart(_points(), "temperature", unit="C", title=payload)
    _assert_no_live_markup(svg, payload)


@pytest.mark.parametrize("payload", HOSTILE)
def test_series_chart_escapes_a_hostile_unit(payload):
    svg = charts.series_chart(_points(), "temperature", unit=payload,
                              title="Temperature")
    _assert_no_live_markup(svg, payload)


@pytest.mark.parametrize("payload", HOSTILE)
def test_series_chart_escapes_the_aria_label_too(payload):
    """The title is also written into aria-label, a quoted attribute."""
    svg = charts.series_chart(_points(), "temperature", title=payload)
    label = re.search(r'aria-label="([^"]*)"', svg)
    assert label, "the chart should carry an aria-label"
    assert "<" not in label.group(1)


# ---------------------------------------------------------------------------
# The empty-state box renders a message straight into the SVG
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("payload", HOSTILE)
def test_empty_box_escapes_its_message(payload):
    svg = charts._empty_box(400, 200, payload)
    _assert_no_live_markup(svg, payload)


# ---------------------------------------------------------------------------
# A chart with no usable data must still be safe
# ---------------------------------------------------------------------------

def test_series_chart_with_no_points_is_still_well_formed():
    svg = charts.series_chart([], "temperature", title="<script>x</script>")
    assert "<script" not in svg.lower()
    assert svg.strip().startswith("<svg")


# The end-to-end counterpart (a hostile station name through a real request)
# lives in test_web.py, where the signed-in client fixture is defined.
