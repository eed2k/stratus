"""Task 13: non-regression and Content-Security-Policy checks.

Three things are asserted here:

1. Every page that existed before the chart work still returns 200 after
   login, so adding the CPU chart and the storm view to the dashboard has not
   broken any existing route.
2. No template or static asset references an external origin. The panel sends
   "script-src 'self'", so a CDN reference would be silently blocked by the
   browser and the feature would appear broken in production while passing
   every server-side test.
3. Report generation runs in the request path and never touches the alert
   worker, so producing a PDF cannot dispatch an SMS.
"""
import re
from pathlib import Path

import pytest

from tests.util import (login, get_csrf, seed_tenant, seed_user, seed_unit,
                        seed_heartbeat, seed_strike)

APP_DIR = Path(__file__).resolve().parent.parent / "app"
TEMPLATES = APP_DIR / "templates"
STATIC = APP_DIR / "static"


# ---------------------------------------------------------------------------
# 1. Existing pages still load
# ---------------------------------------------------------------------------

def _seed(db):
    from app.timeutil import now_sast
    t = seed_tenant(db, "acme", "Acme Mine", "Acme Site")
    seed_user(db, t.id, "admin@acme.test", role="admin")
    seed_unit(db, t.id, "ACME1", site_label="Acme Pit", lat=-26.7, lon=27.1)
    seed_heartbeat(db, t.id, "ACME1", now_sast(), temp=41.0, load=12.0)
    seed_strike(db, t.id, "ACME1", now_sast(), distance_km=8.0, energy=600000)
    return t


@pytest.mark.parametrize("path", [
    "/acme/",
    "/acme/recipients",
    "/acme/groups",
    "/acme/stations",
    "/acme/events",
    "/acme/reports",
    "/acme/test",
    "/acme/users",
    "/acme/settings",
])
def test_existing_pages_still_return_200(client, db_session, path):
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    r = client.get(path)
    assert r.status_code == 200, f"{path} returned {r.status_code}"


def test_dashboard_still_renders_the_server_side_svg_fallback(client, db_session):
    """The inline SVG must survive: it is the no-JavaScript baseline."""
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    r = client.get("/acme/")
    assert r.status_code == 200
    assert "data-cpu-fallback" in r.text, "SVG fallback wrapper missing"
    assert "<svg" in r.text, "server-rendered chart SVG missing"


def test_dashboard_wires_the_chart_containers(client, db_session):
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    r = client.get("/acme/")
    # The interactive host starts hidden so the SVG stays visible until the
    # chart has actually rendered.
    assert "data-cpu-chart" in r.text
    assert "/acme/data/cpu?station=ACME1" in r.text
    assert "data-storm-view" in r.text
    assert "/acme/data/strikes" in r.text
    # The bearing caveat has to be on the page, not just in the SVG.
    assert "does not measure bearing" in r.text


def test_chart_endpoints_are_reachable_and_shaped_as_the_charts_expect(client, db_session):
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")

    cpu = client.get("/acme/data/cpu?station=ACME1&range=24h")
    assert cpu.status_code == 200
    body = cpu.json()
    # cpu-chart.js reads warn/crit off the payload rather than hardcoding them.
    for key in ("station", "site", "warn", "crit", "points"):
        assert key in body, f"/data/cpu payload missing {key}"
    assert body["warn"] == 70
    assert body["crit"] == 78

    strikes = client.get("/acme/data/strikes?window=1440")
    assert strikes.status_code == 200
    sbody = strikes.json()
    for key in ("radius_km", "rings", "bearing_measured", "strikes",
                "bands", "total", "unplaced", "window_min"):
        assert key in sbody, f"/data/strikes payload missing {key}"
    assert sbody["bearing_measured"] is False
    assert sbody["radius_km"] == 40
    # storm-view.js colors each dot from the payload, so the color must be there.
    if sbody["strikes"]:
        assert "color" in sbody["strikes"][0]
        assert "band" in sbody["strikes"][0]

    # storm-view.js renders one cell per band and reads every one of these keys
    # off the payload, so all five bands must always be present, even empty.
    assert len(sbody["bands"]) == 5
    for band in sbody["bands"]:
        for key in ("key", "label", "range", "count", "peak", "mean", "low",
                    "band", "color", "share"):
            assert key in band, f"/data/strikes band missing {key}"
    assert sum(b["count"] for b in sbody["bands"]) == sbody["total"]


def test_strikes_window_is_honored_and_bands_stay_consistent(client, db_session):
    """The 1H..24H selector works by passing `window`, so a narrower window has
    to return a subset, and the band counts must keep summing to the total."""
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")

    wide = client.get("/acme/data/strikes?window=1440").json()
    narrow = client.get("/acme/data/strikes?window=60").json()

    assert narrow["window_min"] == 60
    assert wide["window_min"] == 1440
    assert narrow["total"] <= wide["total"]
    for payload in (wide, narrow):
        assert sum(b["count"] for b in payload["bands"]) == payload["total"]
        assert payload["total"] == len(payload["strikes"]) - payload["unplaced"]


def test_dashboard_has_a_loader_and_a_unit_range_selector(client, db_session):
    """Both fixes have to be in the served markup, not just in the source."""
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    r = client.get("/acme/")

    # The loader's critical CSS must be inline, because an external stylesheet
    # arrives too late to cover the unstyled flash it exists to hide.
    assert 'id="page-loader"' in r.text
    assert "#page-loader{" in r.text
    # It must be able to clear itself without JavaScript.
    assert "pl-auto" in r.text

    # Range selector lives in the unit block and ships hidden, so it cannot show
    # up as a dead control when the interactive chart never renders.
    assert "data-cpu-range" in r.text
    assert 'data-range="7d"' in r.text
    assert 'data-range="30d"' in r.text


def test_loader_is_self_contained(client, db_session):
    """The overlay must not depend on /static/style.css for anything visual.

    Regression: the bolt's fill and size lived in style.css, so for one frame
    before that file arrived the SVG rendered with a default black fill at its
    intrinsic size - a big black lightning bolt, which is exactly the kind of
    flash the loader exists to prevent. `fill: var(--white)` could not have
    worked either, because :root is declared in that same late-arriving file.
    """
    import re
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    html = client.get("/acme/").text

    inline = re.search(r"<style>(.*?)</style>", html, re.S)
    assert inline, "the loader's critical CSS must be inline in the head"
    css = inline.group(1)

    # Colors and sizes must be literals: a custom property would resolve to
    # nothing until the external stylesheet lands.
    body = re.sub(r"/\*.*?\*/", "", css, flags=re.S)   # drop comments
    assert "var(" not in body, "inline loader CSS must not rely on custom properties"

    for rule in ("page-loader-bolt", "page-loader-name", "page-loader-track"):
        assert rule in css, f"{rule} must be styled inline, not in style.css"
    assert "fill:#ffffff" in css

    # Belt and braces: presentation attributes apply while the element is being
    # parsed, before any CSS at all is in play.
    assert re.search(r'class="page-loader-bolt"[^>]*fill="#ffffff"', html), \
        "the bolt needs an explicit fill attribute, not only a CSS rule"
    assert re.search(r'class="page-loader-bolt"[^>]*width="34"', html)


# ---------------------------------------------------------------------------
# 2. No external asset references (CSP would block them in the browser)
# ---------------------------------------------------------------------------

# Matches src="..." / href="..." pointing at an absolute or protocol-relative
# URL. Anything same-origin starts with "/" but not "//".
_EXTERNAL_REF = re.compile(
    r"""(?:src|href)\s*=\s*["'](\s*(?:https?:)?//[^"']+)["']""",
    re.IGNORECASE,
)


def _template_files():
    return sorted(TEMPLATES.rglob("*.html"))


def test_templates_reference_no_external_assets():
    offenders = []
    for path in _template_files():
        text = path.read_text(encoding="utf-8")
        for match in _EXTERNAL_REF.finditer(text):
            url = match.group(1).strip()
            # Links a reader clicks are fine; only fetched subresources are
            # governed by script-src / style-src. Restrict the check to tags
            # that pull a subresource in.
            line_start = text.rfind("<", 0, match.start())
            tag = text[line_start:match.start()].lower()
            if tag.startswith(("<script", "<link", "<img", "<iframe", "<source")):
                offenders.append(f"{path.name}: {url}")
    assert not offenders, "external subresources found:\n" + "\n".join(offenders)


# XML namespace identifiers look like URLs but are never fetched: they are
# opaque strings the DOM compares by value. document.createElementNS needs the
# SVG one, so it is not a CSP concern.
_NAMESPACE_URIS = {
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/1999/xlink",
}


def test_static_js_makes_no_cross_origin_requests():
    offenders = []
    for path in sorted(STATIC.rglob("*.js")):
        # Vendor bundles are third-party code and are allowed to contain URLs in
        # comments and license headers; what matters is that we serve them from
        # our own origin, which test_vendor_bundles_are_present covers.
        if "vendor" in path.parts:
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in re.finditer(r"""["'](\s*(?:https?:)?//[^"']+)["']""", text):
            url = match.group(1).strip()
            if url in _NAMESPACE_URIS:
                continue
            offenders.append(f"{path.name}: {url}")
    assert not offenders, "cross-origin URLs in first-party JS:\n" + "\n".join(offenders)


def test_vendor_bundles_are_present():
    """The dashboard references these by path; a missing file is a 404 and a
    silently broken chart, which the SVG fallback would mask."""
    expected = [
        "react.production.min.js",
        "prop-types.min.js",
        "react-dom.production.min.js",
        "recharts.js",
    ]
    vendor = STATIC / "vendor"
    missing = [n for n in expected if not (vendor / n).is_file()]
    assert not missing, f"vendored bundles missing: {missing}"

    # Guard against committing an empty or truncated download.
    for name in expected:
        size = (vendor / name).stat().st_size
        assert size > 1024, f"{name} is only {size} bytes, looks truncated"


def test_dashboard_script_tags_are_all_same_origin_and_correctly_ordered(client, db_session):
    """Recharts' UMD factory resolves React, PropTypes and ReactDOM at
    evaluation time, so those three must be requested before it."""
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    html = client.get("/acme/").text

    srcs = re.findall(r"""<script[^>]+src=["']([^"']+)["']""", html)
    assert srcs, "no script tags rendered"
    for src in srcs:
        assert src.startswith("/static/"), f"non-local script: {src}"

    def idx(name):
        for i, s in enumerate(srcs):
            if name in s:
                return i
        raise AssertionError(f"{name} not referenced on the dashboard")

    assert idx("react.production.min.js") < idx("recharts.js")
    assert idx("prop-types.min.js") < idx("recharts.js")
    assert idx("react-dom.production.min.js") < idx("recharts.js")
    assert idx("recharts.js") < idx("cpu-chart.js")


def test_csp_header_still_restricts_scripts_to_self(client, db_session):
    _seed(db_session)
    login(client, "/acme", "admin@acme.test")
    r = client.get("/acme/")
    csp = r.headers.get("Content-Security-Policy", "")
    assert "script-src 'self'" in csp
    assert "connect-src 'self'" in csp
    # An 'unsafe-inline' script source would defeat the point of external files.
    script_directive = [d for d in csp.split(";") if d.strip().startswith("script-src")]
    assert script_directive, "no script-src directive"
    assert "unsafe-inline" not in script_directive[0]
    assert "unsafe-eval" not in script_directive[0]


def test_no_inline_event_handlers_in_templates():
    """Inline handlers need 'unsafe-inline' to run, which we do not grant."""
    offenders = []
    for path in _template_files():
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"\son(?:click|load|change|submit|error)\s*=", text, re.I):
            offenders.append(f"{path.name}: {match.group(0).strip()}")
    assert not offenders, "inline event handlers found:\n" + "\n".join(offenders)


# ---------------------------------------------------------------------------
# 3. Report generation stays off the alert-worker path
# ---------------------------------------------------------------------------

def test_report_generation_never_dispatches_an_alert(client, db_session, monkeypatch):
    """Generating a PDF must not be able to send an SMS.

    The alert worker's dispatch entry points are replaced with something that
    fails loudly, so any accidental coupling shows up as a test failure rather
    than as a message on a client's phone.
    """
    import app.alert_worker as worker
    import app.reports as reports_mod

    calls = []

    def _tripwire(*args, **kwargs):
        calls.append(args)
        raise AssertionError("report generation reached the alert worker")

    for name in ("dispatch_event", "dispatch", "send_alert", "fan_out"):
        if hasattr(worker, name):
            monkeypatch.setattr(worker, name, _tripwire, raising=False)

    # Also trip on the SMS gateway itself, which is the thing that costs money.
    import app.sms_gateway as sender
    for name in ("send_sms", "send"):
        if hasattr(sender, name):
            monkeypatch.setattr(sender, name, _tripwire, raising=False)

    monkeypatch.setattr(reports_mod, "build_report", lambda *a, **k: b"%PDF-1.4\nstub\n")

    _seed(db_session)
    login(client, "/acme", "admin@acme.test")

    from app.timeutil import now_sast
    month = now_sast().strftime("%Y-%m")

    # Generating and then downloading both run in the request path.
    csrf = get_csrf(client, "/acme/reports")
    gen = client.post("/acme/reports/generate", data={
        "station_id": "ACME1", "month": month,
        "report_type": "technical", "csrf_token": csrf,
    }, follow_redirects=False)
    assert gen.status_code in (200, 303), f"generate returned {gen.status_code}"

    dl = client.get(f"/acme/reports/download?station=ACME1&month={month}&type=technical")
    assert dl.status_code == 200, f"download returned {dl.status_code}"
    assert not calls, "report generation touched the alert dispatch path"


def test_reports_module_does_not_import_the_alert_worker():
    """A static guarantee to back up the runtime tripwire above."""
    source = (APP_DIR / "reports.py").read_text(encoding="utf-8")
    assert "alert_worker" not in source
    assert "clickatell" not in source.lower()
