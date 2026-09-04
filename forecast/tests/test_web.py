"""Route tests: the access gate, the upload flow and every rendered page.

main.py reads its configuration and opens the database at import time, so each
test gets a freshly reloaded module pointed at a temporary file.
"""
from __future__ import annotations

import importlib
import sys

import pytest
from fastapi.testclient import TestClient

from conftest import make_toa5

PASSWORD = "test-operator-password"
# The sign-in page matches the alert console's, which labels its button "Log In".
# Asserted on the form class rather than the wording, so a copy change does not
# break every access-control test.
LOGIN_MARKER = 'class="auth-form"'


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FORECAST_DB", str(tmp_path / "web.db"))
    monkeypatch.setenv("FORECAST_PASSWORD", PASSWORD)
    monkeypatch.setenv("FORECAST_SECRET", "fixed-secret-for-tests")
    monkeypatch.setenv("FORECAST_CACHE_DIR", str(tmp_path / "cache"))
    # Clear every third-party credential. Without this the suite picks up
    # whatever is set in the shell, and a test that expects an unconfigured
    # service instead makes a real API call: an earlier run of this file
    # genuinely reached Dropbox and was told the folder did not exist. Tests
    # must not depend on, or spend, live credentials.
    for leaked in ("XWEATHER_ENABLED", "XWEATHER_CLIENT_ID",
                   "XWEATHER_CLIENT_SECRET", "XWEATHER_KEY",
                   "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET",
                   "DROPBOX_REFRESH_TOKEN"):
        monkeypatch.delenv(leaked, raising=False)
    # The background poller is not wanted in a request-level test.
    monkeypatch.setenv("DROPBOX_POLLING", "false")
    for name in [m for m in list(sys.modules) if m.startswith("app.")]:
        del sys.modules[name]
    if "app" in sys.modules:
        del sys.modules["app"]
    main = importlib.import_module("app.main")
    with TestClient(main.app, base_url="https://testserver") as c:
        c._main = main                    # type: ignore[attr-defined]
        yield c


@pytest.fixture
def signed_in(client):
    r = client.post("/login", data={"password": PASSWORD},
                    follow_redirects=False)
    assert r.status_code == 303
    # Every state-changing route is CSRF-protected. The token is an HMAC of the
    # session cookie under the app secret, so it is stable for the session:
    # compute it once and send it as the X-CSRF-Token header, the programmatic
    # channel verify_csrf accepts, so the existing write tests do not each have
    # to scrape a hidden field. The hidden-field browser path is exercised by
    # its own tests below.
    main = client._main
    session = client.cookies.get("forecast_session")
    client.headers.update({"X-CSRF-Token": main._sign("csrf." + session)})
    return client


def _upload(c, text, slug=""):
    return c.post("/upload",
                  files={"file": ("site.dat", text, "text/plain")},
                  data={"station_slug": slug})


# ---------------------------------------------------------------------------
#  Access control
# ---------------------------------------------------------------------------

def test_healthz_is_open(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["configured"] is True


def test_index_redirects_when_not_signed_in(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/login"


def test_upload_is_refused_when_not_signed_in(client):
    r = _upload(client, make_toa5(hours=48))
    # Redirected to the sign-in page rather than accepting the file.
    assert LOGIN_MARKER in r.text


def test_wrong_password_is_rejected(client):
    r = client.post("/login", data={"password": "not-it"})
    assert r.status_code == 401
    assert "not accepted" in r.text


def test_sign_in_then_out(client):
    r = client.post("/login", data={"password": PASSWORD},
                    follow_redirects=False)
    assert r.status_code == 303
    assert client.get("/").status_code == 200
    client.post("/logout", follow_redirects=False)
    assert client.get("/", follow_redirects=False).status_code == 303


def test_session_cookie_is_hardened(client):
    r = client.post("/login", data={"password": PASSWORD},
                    follow_redirects=False)
    header = r.headers.get("set-cookie", "")
    assert "HttpOnly" in header
    assert "Secure" in header
    assert "samesite=lax" in header.lower()


def test_a_forged_cookie_is_rejected(client):
    client.cookies.set("forecast_session", "99999999999.deadbeef")
    assert client.get("/", follow_redirects=False).status_code == 303


def test_without_a_password_the_service_refuses(tmp_path, monkeypatch):
    monkeypatch.setenv("FORECAST_DB", str(tmp_path / "x.db"))
    monkeypatch.delenv("FORECAST_PASSWORD", raising=False)
    for name in [m for m in list(sys.modules) if m.startswith("app")]:
        del sys.modules[name]
    main = importlib.import_module("app.main")
    with TestClient(main.app, base_url="https://testserver") as c:
        r = c.get("/")
        assert r.status_code == 503
        assert "No operator password" in r.text


# ---------------------------------------------------------------------------
#  Empty state: there is no demo data
# ---------------------------------------------------------------------------

def test_empty_state_says_there_is_no_sample_data(signed_in):
    r = signed_in.get("/")
    assert r.status_code == 200
    assert "Nothing uploaded yet" in r.text
    assert "no sample data" in r.text


def test_no_station_exists_before_an_upload(signed_in):
    assert signed_in.get("/healthz").json()["stations"] == 0


# ---------------------------------------------------------------------------
#  A station can be created without hand-uploading a file first
# ---------------------------------------------------------------------------

def test_index_offers_the_dropbox_route(signed_in):
    """The gap this closes: the feed used to be reachable only from a station
    page, and a station only existed after a manual upload."""
    r = signed_in.get("/")
    assert "Feed a station from Dropbox" in r.text
    assert 'action="/stations/new"' in r.text
    assert 'name="folder_path"' in r.text
    assert "Or upload a file yourself" in r.text


def test_index_reports_whether_dropbox_is_connected(signed_in):
    r = signed_in.get("/")
    # Unconfigured in tests, and it says so rather than offering a dead form.
    assert "not connected" in r.text
    assert "DROPBOX_APP_KEY" in r.text


def test_creating_a_station_with_a_feed(signed_in):
    r = signed_in.post("/stations/new",
                       data={"name": "Quaggasklip",
                             "folder_path": "/StratusData/Quagga",
                             "file_pattern": "*.dat",
                             "interval_minutes": "15",
                             "dropbox_enabled": "on",
                             "auto_forecast": "on"},
                       follow_redirects=False)
    assert r.status_code == 303
    main = signed_in._main
    station = main.db.get_station_by_slug("quaggasklip")
    assert station is not None
    assert station.name == "Quaggasklip"
    source = main.db.get_dropbox_source(station.id)
    assert source["folder_path"] == "/StratusData/Quagga"
    assert source["enabled"] == 1
    assert source["interval_secs"] == 900
    assert source["auto_forecast"] == 1


def test_creating_a_station_without_a_feed(signed_in):
    r = signed_in.post("/stations/new", data={"name": "Manual Site"},
                       follow_redirects=False)
    assert r.status_code == 303
    main = signed_in._main
    station = main.db.get_station_by_slug("manual-site")
    assert station is not None
    # No folder given, so no feed row, or a disabled one.
    source = main.db.get_dropbox_source(station.id)
    assert source is None or source["enabled"] == 0


def test_a_new_station_appears_in_the_list(signed_in):
    signed_in.post("/stations/new", data={"name": "Listed Site"},
                   follow_redirects=False)
    r = signed_in.get("/")
    assert "Listed Site" in r.text
    assert "Nothing uploaded yet" not in r.text


def test_a_nameless_station_is_refused(signed_in):
    r = signed_in.post("/stations/new", data={"name": "   "},
                       follow_redirects=False)
    assert r.status_code == 303
    assert "name" in r.headers["location"].lower()
    assert signed_in.get("/healthz").json()["stations"] == 0


def test_duplicate_station_id_is_refused(signed_in):
    signed_in.post("/stations/new", data={"name": "Twice"},
                   follow_redirects=False)
    r = signed_in.post("/stations/new", data={"name": "Twice"},
                       follow_redirects=False)
    assert "already+exists" in r.headers["location"]
    assert signed_in.get("/healthz").json()["stations"] == 1


def test_creating_a_station_requires_a_session(client):
    r = client.post("/stations/new", data={"name": "Sneaky"},
                    follow_redirects=True)
    assert LOGIN_MARKER in r.text
    assert client.get("/healthz").json()["stations"] == 0


def test_a_new_station_lands_on_a_page_with_the_feed_settings(signed_in):
    r = signed_in.post("/stations/new",
                       data={"name": "Feedme",
                             "folder_path": "/D", "file_pattern": "*.dat",
                             "interval_minutes": "15",
                             "dropbox_enabled": "on"},
                       follow_redirects=True)
    assert r.status_code == 200
    assert "Continuous feed from Dropbox" in r.text
    assert "/D" in r.text


# ---------------------------------------------------------------------------
#  Upload
# ---------------------------------------------------------------------------

def test_upload_reads_the_file_and_reports_the_mapping(signed_in):
    r = _upload(signed_in, make_toa5(hours=24 * 14))
    assert r.status_code == 200
    assert "File read" in r.text
    assert "Columns understood" in r.text
    assert "AirTC_Avg" in r.text
    assert "m/s to km/h" in r.text


def test_upload_creates_the_station(signed_in):
    _upload(signed_in, make_toa5(hours=48))
    assert signed_in.get("/healthz").json()["stations"] == 1
    assert "TestSite" in signed_in.get("/").text


def test_re_uploading_the_same_file_is_recognized(signed_in):
    text = make_toa5(hours=48)
    _upload(signed_in, text)
    r = _upload(signed_in, text)
    assert "already been uploaded" in r.text
    assert signed_in.get("/healthz").json()["stations"] == 1


def test_unreadable_file_gets_a_clear_page(signed_in):
    r = signed_in.post("/upload",
                       files={"file": ("junk.dat", "not a logger file",
                                       "text/plain")},
                       data={"station_slug": ""})
    assert r.status_code == 400
    assert "could not be read" in r.text


def test_empty_upload_is_refused(signed_in):
    r = signed_in.post("/upload",
                       files={"file": ("empty.dat", "", "text/plain")},
                       data={"station_slug": ""},
                       follow_redirects=False)
    assert r.status_code == 303
    assert "empty" in r.headers["location"].lower()


# ---------------------------------------------------------------------------
#  Station, forecast and verification pages
# ---------------------------------------------------------------------------

@pytest.fixture
def station_id(signed_in):
    _upload(signed_in, make_toa5(hours=24 * 20), slug="testsite")
    return 1


def test_station_page_renders(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}")
    assert r.status_code == 200
    assert "Produce a forecast" in r.text
    assert "Model background" in r.text
    assert "Delete this station" in r.text


def test_forecast_page_before_any_run(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}/forecast?days=1")
    assert r.status_code == 200
    assert "No 1 day forecast yet" in r.text


@pytest.mark.parametrize("days", [1, 3, 5])
def test_run_then_view_each_horizon(signed_in, station_id, days):
    r = signed_in.post(f"/station/{station_id}/run", data={"days": days},
                       follow_redirects=False)
    assert r.status_code == 303
    page = signed_in.get(f"/station/{station_id}/forecast?days={days}")
    assert page.status_code == 200
    assert f"{days} day forecast" in page.text
    assert "<svg" in page.text
    assert "Hourly values" in page.text


def test_run_all_horizons_from_the_form(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/run", data={"days": 0},
                   follow_redirects=False)
    for days in (1, 3, 5):
        page = signed_in.get(f"/station/{station_id}/forecast?days={days}")
        assert "Hourly values" in page.text, days


def test_forecast_page_switches_variable(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/run", data={"days": 1},
                   follow_redirects=False)
    r = signed_in.get(f"/station/{station_id}/forecast?days=1"
                      f"&variable=wind_direction")
    assert r.status_code == 200
    assert "Wind direction" in r.text


def test_verify_page_is_empty_until_backfill(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}/verify")
    assert r.status_code == 200
    assert "Nothing scored yet" in r.text


def test_backfill_then_verify_shows_scores(signed_in, station_id):
    r = signed_in.post(f"/station/{station_id}/backfill",
                       data={"days": 1, "step_hours": 24},
                       follow_redirects=False)
    assert r.status_code == 303
    page = signed_in.get(f"/station/{station_id}/verify?days=1")
    assert page.status_code == 200
    assert "Scores by lead time" in page.text
    assert "Skill vs persistence" in page.text
    assert "average error" in page.text
    assert "<svg" in page.text


def test_verify_explains_how_to_read_it(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/backfill",
                   data={"days": 1, "step_hours": 24},
                   follow_redirects=False)
    page = signed_in.get(f"/station/{station_id}/verify?days=1")
    assert "Persistence" in page.text and "Climatology" in page.text


# ---------------------------------------------------------------------------
#  Settings and the model-background opt-in
# ---------------------------------------------------------------------------

def test_settings_accepts_coordinates(signed_in, station_id):
    r = signed_in.post(f"/station/{station_id}/settings",
                       data={"latitude": "-26.7145", "longitude": "27.0977",
                             "elevation_m": "1350", "utc_offset_hours": "2"},
                       follow_redirects=False)
    assert r.status_code == 303
    page = signed_in.get(f"/station/{station_id}")
    assert "-26.7145" in page.text


def test_settings_rejects_nonsense_coordinates(signed_in, station_id):
    r = signed_in.post(f"/station/{station_id}/settings",
                       data={"latitude": "not-a-number", "longitude": "27.0",
                             "elevation_m": "", "utc_offset_hours": "2"},
                       follow_redirects=False)
    assert r.status_code == 303
    assert "decimal" in r.headers["location"]


def test_settings_rejects_out_of_range_latitude(signed_in, station_id):
    r = signed_in.post(f"/station/{station_id}/settings",
                       data={"latitude": "120", "longitude": "27.0",
                             "elevation_m": "", "utc_offset_hours": "2"},
                       follow_redirects=False)
    assert "between" in r.headers["location"]


def test_background_is_off_by_default(signed_in, station_id):
    page = signed_in.get(f"/station/{station_id}")
    assert "Use a model background" in page.text
    # Neither provider is usable without configuration.
    assert "unavailable" in page.text


def test_opting_in_stores_only_known_names(signed_in, station_id):
    """A tampered form must not smuggle unknown providers or variables in."""
    r = signed_in.post(
        f"/station/{station_id}/nwp",
        data={"nwp_enabled": "on",
              "providers": ["xweather", "bogus_provider"],
              "variables": ["temperature", "not_a_variable"]},
        follow_redirects=False)
    assert r.status_code == 303
    main = signed_in._main
    station = main.db.get_station(station_id)
    assert station.nwp_enabled is True
    assert station.nwp_providers == ["xweather"]
    assert station.nwp_variables == ["temperature"]


# ---------------------------------------------------------------------------
#  Deletion
# ---------------------------------------------------------------------------

def test_delete_needs_the_exact_slug(signed_in, station_id):
    r = signed_in.post(f"/station/{station_id}/delete",
                       data={"confirm_slug": "wrong"},
                       follow_redirects=False)
    assert r.status_code == 303
    assert "confirm" in r.headers["location"]
    assert signed_in.get("/healthz").json()["stations"] == 1


def test_delete_removes_everything(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/run", data={"days": 1},
                   follow_redirects=False)
    r = signed_in.post(f"/station/{station_id}/delete",
                       data={"confirm_slug": "testsite"},
                       follow_redirects=False)
    assert r.status_code == 303
    assert signed_in.get("/healthz").json()["stations"] == 0
    main = signed_in._main
    assert main.db.observation_count(station_id) == 0


def test_unknown_station_redirects(signed_in):
    r = signed_in.get("/station/9999", follow_redirects=False)
    assert r.status_code == 303


# ---------------------------------------------------------------------------
#  No demo or third-party content leaks into the interface
# ---------------------------------------------------------------------------

def test_no_demo_or_external_branding_anywhere(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/run", data={"days": 0},
                   follow_redirects=False)
    signed_in.post(f"/station/{station_id}/backfill",
                   data={"days": 1, "step_hours": 24},
                   follow_redirects=False)
    pages = ["/", f"/station/{station_id}",
             f"/station/{station_id}/forecast?days=1",
             f"/station/{station_id}/forecast?days=5",
             f"/station/{station_id}/verify?days=1"]
    banned = ("lekwena", "potchefstroom", "demo data", "sample station",
              "example station", "lorem")
    for path in pages:
        text = signed_in.get(path).text.lower()
        for word in banned:
            assert word not in text, f"{word!r} appeared on {path}"


def test_pages_are_not_indexable(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}")
    assert 'name="robots"' in r.text
    assert "noindex" in r.text


# ---------------------------------------------------------------------------
#  Caching: a deploy must not leave an old stylesheet in front of new markup
# ---------------------------------------------------------------------------

def test_stylesheet_link_is_fingerprinted(client):
    r = client.get("/login")
    assert "/static/style.css?v=" in r.text, (
        "an unversioned stylesheet lets a browser keep a stale copy after a "
        "deploy")
    assert "/static/app.js?v=" in r.text


# ---------------------------------------------------------------------------
#  The loading gate, matched to the Stratus dashboards
# ---------------------------------------------------------------------------

def test_every_page_has_the_loading_gate(signed_in, station_id):
    for path in ("/login", "/", f"/station/{station_id}"):
        r = signed_in.get(path)
        assert 'id="page-loader"' in r.text, path
        assert 'class="pl-ring"' in r.text, path
        assert 'class="pl-track"' in r.text, path
        assert 'class="pl-spin"' in r.text, path
        assert 'class="pl-arc"' in r.text, path


def test_the_gate_uses_the_dashboard_geometry_and_colors(client):
    """Same ring as client/src/components/DashboardLoadingOverlay.tsx."""
    r = client.get("/login")
    assert 'viewBox="0 0 112 112"' in r.text
    assert 'r="46"' in r.text
    assert 'stroke-width="6"' in r.text
    assert "#1e3a5f" in r.text          # Stratus navy
    assert "#e5e7eb" in r.text          # track gray
    # Circumference 2*pi*46 and its quarter.
    assert "289.03" in r.text
    assert "72.26" in r.text


def test_the_gate_survives_scripting_being_off(client):
    """The CSS must dismiss it, so a script error cannot blank the page."""
    r = client.get("/login")
    assert "pl-auto" in r.text, "no CSS fallback animation"
    assert "visibility:hidden" in r.text
    # And the percentage span is empty in the markup rather than a fake 0%.
    assert '<span class="pl-pct" id="pl-pct"></span>' in r.text


def test_the_gate_respects_reduced_motion(client):
    r = client.get("/login")
    assert "prefers-reduced-motion" in r.text


def test_the_gate_is_hidden_from_assistive_technology(client):
    r = client.get("/login")
    loader = r.text.split('id="page-loader"')[1][:200]
    assert 'aria-hidden="true"' in r.text.split('id="page-loader"')[0][-60:] \
        or 'aria-hidden="true"' in loader


def test_loader_styles_are_inline_not_only_in_the_stylesheet(client):
    """Inlined so the gate covers the window before the CSS arrives."""
    page = client.get("/login").text
    head = page.split("</head>")[0]
    assert "#page-loader" in head
    assert "<style>" in head


def test_the_fingerprint_tracks_the_file_contents(client, tmp_path):
    main = client._main if hasattr(client, "_main") else None
    r = client.get("/login")
    import re
    version = re.search(r"/static/style\.css\?v=([0-9a-f]+)", r.text).group(1)
    assert len(version) == 12
    # Recomputing over the same files must give the same answer.
    import importlib
    mod = importlib.import_module("app.main")
    assert mod._asset_version() == version


def test_pages_are_not_cached(signed_in, station_id):
    for path in ("/", f"/station/{station_id}", "/login"):
        r = signed_in.get(path)
        cache = r.headers.get("cache-control", "")
        assert "no-store" in cache, (path, cache)


def test_versioned_static_is_cached_hard(client):
    r = client.get("/static/style.css?v=abc123")
    assert r.status_code == 200
    assert "immutable" in r.headers.get("cache-control", "")


def test_unversioned_static_must_revalidate(client):
    r = client.get("/static/style.css")
    assert r.status_code == 200
    assert "no-cache" in r.headers.get("cache-control", "")


def test_the_served_stylesheet_has_the_login_rules(client):
    """Guards the actual symptom: new markup, missing rules."""
    r = client.get("/static/style.css")
    assert r.status_code == 200
    for rule in (".login-wrap", ".auth-shell", ".auth-card", ".auth-field",
                 ".auth-submit"):
        assert rule in r.text, rule


# ---------------------------------------------------------------------------
#  The sign-in page matches the main stratusweather.co.za site
# ---------------------------------------------------------------------------

def test_login_page_matches_the_main_site_markup(client):
    r = client.get("/login")
    assert r.status_code == 200
    # Same structure as the main site sign-in: a navy-circle logo, a white auth
    # card, the "Welcome Back" heading and a full-width submit, so the three
    # products read as one product.
    assert 'class="auth-shell"' in r.text
    assert 'class="auth-logo"' in r.text
    assert 'class="auth-card"' in r.text
    assert "Stratus" in r.text
    assert "Welcome Back" in r.text
    assert 'class="auth-form"' in r.text
    assert "auth-submit" in r.text
    assert "Sign In" in r.text


def test_login_page_has_no_explanatory_note(client):
    """The login screen is clean: no explanatory note, like the main site."""
    r = client.get("/login")
    assert "not left open" not in r.text
    assert "stores uploaded logger data" not in r.text
    assert "hint" not in r.text.split('class="auth-card"')[1][:400]


def test_login_error_uses_the_auth_error_style(client):
    r = client.post("/login", data={"password": "wrong"})
    assert r.status_code == 401
    assert 'class="auth-error"' in r.text


# ---------------------------------------------------------------------------
#  Dropbox continuous feed
# ---------------------------------------------------------------------------

def test_healthz_reports_the_dropbox_state(client):
    body = client.get("/healthz").json()
    assert "dropbox_configured" in body
    assert body["dropbox_configured"] is False
    assert body["dropbox_feeds"] == 0


def test_station_page_offers_the_dropbox_feed(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}")
    assert "Continuous feed from Dropbox" in r.text
    assert 'name="folder_path"' in r.text
    assert 'name="file_pattern"' in r.text
    assert 'name="interval_minutes"' in r.text
    assert "Check the folder now" in r.text
    # Unconfigured on the server, and it says so rather than failing silently.
    assert "DROPBOX_APP_KEY" in r.text


def test_saving_feed_settings_round_trips(signed_in, station_id):
    r = signed_in.post(f"/station/{station_id}/dropbox",
                       data={"folder_path": "/StratusData/Potch",
                             "file_pattern": "*.dat",
                             "interval_minutes": "30",
                             "dropbox_enabled": "on",
                             "auto_forecast": "on"},
                       follow_redirects=False)
    assert r.status_code == 303
    main = signed_in._main
    source = main.db.get_dropbox_source(station_id)
    assert source["folder_path"] == "/StratusData/Potch"
    assert source["enabled"] == 1
    assert source["interval_secs"] == 1800
    assert source["auto_forecast"] == 1
    page = signed_in.get(f"/station/{station_id}")
    assert "/StratusData/Potch" in page.text


def test_feed_can_be_switched_off_again(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/dropbox",
                   data={"folder_path": "/x", "file_pattern": "*.dat",
                         "interval_minutes": "15", "dropbox_enabled": "on",
                         "auto_forecast": "on"}, follow_redirects=False)
    signed_in.post(f"/station/{station_id}/dropbox",
                   data={"folder_path": "/x", "file_pattern": "*.dat",
                         "interval_minutes": "15"},
                   follow_redirects=False)
    main = signed_in._main
    assert main.db.get_dropbox_source(station_id)["enabled"] == 0


def test_interval_is_clamped(signed_in, station_id):
    signed_in.post(f"/station/{station_id}/dropbox",
                   data={"folder_path": "/x", "file_pattern": "*.dat",
                         "interval_minutes": "0", "dropbox_enabled": "on"},
                   follow_redirects=False)
    main = signed_in._main
    assert main.db.get_dropbox_source(station_id)["interval_secs"] >= 60


def test_manual_poll_without_credentials_reports_clearly(signed_in,
                                                        station_id):
    signed_in.post(f"/station/{station_id}/dropbox",
                   data={"folder_path": "/x", "file_pattern": "*.dat",
                         "interval_minutes": "15", "dropbox_enabled": "on"},
                   follow_redirects=False)
    r = signed_in.post(f"/station/{station_id}/dropbox/poll", data={},
                       follow_redirects=False)
    assert r.status_code == 303
    assert "DROPBOX" in r.headers["location"]


def test_dropbox_routes_need_a_session(client, station_id=1):
    r = client.post("/station/1/dropbox",
                    data={"folder_path": "/x"}, follow_redirects=True)
    assert LOGIN_MARKER in r.text
    r2 = client.post("/station/1/dropbox/poll", data={},
                     follow_redirects=True)
    assert LOGIN_MARKER in r2.text


# ---------------------------------------------------------------------------
#  CSRF protection on state-changing routes
# ---------------------------------------------------------------------------

def test_write_forms_carry_a_csrf_field(signed_in, station_id):
    """Every server-rendered write form ships the hidden token, so the browser
    path works with scripting off and without any custom header."""
    index = signed_in.get("/").text
    # The Dropbox-create form and the upload form.
    assert index.count('name="csrf_token"') >= 2
    station = signed_in.get(f"/station/{station_id}").text
    # run, backfill, settings, nwp, dropbox, dropbox/poll, delete.
    assert station.count('name="csrf_token"') >= 7


def test_write_without_a_token_is_rejected(signed_in, station_id):
    """Clear the fixture's header and send no field: the write is refused and
    the station is not deleted."""
    r = signed_in.post(f"/station/{station_id}/delete",
                       data={"confirm_slug": "testsite"},
                       headers={"X-CSRF-Token": ""}, follow_redirects=False)
    assert r.status_code == 403
    assert signed_in.get("/healthz").json()["stations"] == 1


def test_write_with_a_wrong_token_is_rejected(signed_in, station_id):
    r = signed_in.post(
        f"/station/{station_id}/settings",
        data={"latitude": "-26.0", "longitude": "27.0", "elevation_m": "",
              "utc_offset_hours": "2", "csrf_token": "not-the-token"},
        headers={"X-CSRF-Token": "not-the-token"}, follow_redirects=False)
    assert r.status_code == 403


def test_write_with_the_form_token_is_accepted(signed_in, station_id):
    """The hidden-field value from a rendered page is accepted, with the
    convenience header cleared, so the real browser path is exercised."""
    import re
    page = signed_in.get(f"/station/{station_id}").text
    token = re.search(r'name="csrf_token" value="([^"]+)"', page).group(1)
    r = signed_in.post(
        f"/station/{station_id}/settings",
        data={"latitude": "-26.0", "longitude": "27.0", "elevation_m": "",
              "utc_offset_hours": "2", "csrf_token": token},
        headers={"X-CSRF-Token": ""}, follow_redirects=False)
    assert r.status_code == 303


def test_a_token_for_another_session_is_rejected(signed_in, station_id):
    """A correctly signed token for a different session is still refused, which
    is what "bound to the session" means: a token cannot be lifted from one
    session and replayed against another."""
    main = signed_in._main
    foreign = main._sign("csrf." + "a-different-session-value")
    r = signed_in.post(f"/station/{station_id}/run",
                       data={"days": 1, "csrf_token": foreign},
                       headers={"X-CSRF-Token": foreign},
                       follow_redirects=False)
    assert r.status_code == 403


def test_unauthenticated_write_still_redirects_not_403(client):
    """CSRF must not shadow the login gate: with no session there is no token
    to check, so the request lands on the sign-in page, not a bare 403."""
    r = client.post("/stations/new", data={"name": "NoSession"},
                    follow_redirects=True)
    assert LOGIN_MARKER in r.text
    assert client.get("/healthz").json()["stations"] == 0


# ---------------------------------------------------------------------------
#  Login throttling
# ---------------------------------------------------------------------------

def test_login_is_throttled_after_repeated_failures(client):
    """The default budget is eight failures per window; the next attempt is
    refused with 429 even though it is just another wrong guess, so a shared
    password cannot be brute-forced."""
    last = None
    for _ in range(9):
        last = client.post("/login", data={"password": "wrong"},
                           follow_redirects=False)
    assert last.status_code == 429
    assert "Too many" in last.text


def test_a_correct_password_still_works_under_the_budget(client):
    """A couple of typos must not lock out a legitimate operator."""
    client.post("/login", data={"password": "wrong"}, follow_redirects=False)
    client.post("/login", data={"password": "wrong"}, follow_redirects=False)
    r = client.post("/login", data={"password": PASSWORD},
                    follow_redirects=False)
    assert r.status_code == 303


# ---------------------------------------------------------------------------
#  Defense-in-depth security headers
# ---------------------------------------------------------------------------

def test_security_headers_are_present(client):
    r = client.get("/login")
    assert r.headers["X-Content-Type-Options"] == "nosniff"
    assert r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "no-referrer"
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "object-src 'none'" in csp
    assert "Permissions-Policy" in r.headers
    hsts = r.headers["Strict-Transport-Security"]
    assert "max-age=" in hsts
    # preload is intentionally omitted: it is a one-way, estate-wide commitment.
    assert "preload" not in hsts


def test_security_headers_do_not_clobber_caching(client):
    """The security middleware must leave the caching middleware's decisions
    intact: a page stays no-store, a fingerprinted asset stays immutable, and
    the CSP is present on both."""
    page = client.get("/login")
    assert "no-store" in page.headers.get("cache-control", "")
    assert "Content-Security-Policy" in page.headers
    asset = client.get("/static/style.css?v=abc123")
    assert "immutable" in asset.headers.get("cache-control", "")
    assert "Content-Security-Policy" in asset.headers


def test_the_style_allows_the_inline_loading_gate(client):
    """The gate's CSS is inlined in base.html, so the policy must permit inline
    styles or the loader would be blocked."""
    csp = client.get("/login").headers["Content-Security-Policy"]
    assert "style-src 'self' 'unsafe-inline'" in csp


# ---------------------------------------------------------------------------
#  Sector products: configuration, pages and graceful absence
# ---------------------------------------------------------------------------

def _enable(c, station_id, **fields):
    """Post the sector form, carrying the CSRF token the fixture holds."""
    data = {"csrf_token": c.headers.get("X-CSRF-Token", "")}
    data.update(fields)
    return c.post(f"/station/{station_id}/sectors", data=data,
                  follow_redirects=False)


def test_station_page_offers_the_sector_form(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}")
    assert r.status_code == 200
    assert "Sector products" in r.text
    assert 'name="solar_on"' in r.text
    assert 'name="hub_height_m"' in r.text
    assert 'name="crop"' in r.text


def test_enabling_a_sector_links_to_its_page(signed_in, station_id):
    r = _enable(signed_in, station_id, solar_on="on")
    assert r.status_code == 303
    page = signed_in.get(f"/station/{station_id}")
    assert f"/station/{station_id}/sector/solar" in page.text


def test_no_sector_enabled_leaves_the_station_page_working(signed_in,
                                                          station_id):
    """R8.2: with nothing enabled the existing views are unchanged."""
    r = signed_in.get(f"/station/{station_id}")
    assert r.status_code == 200
    assert "Produce a forecast" in r.text
    assert "Score against the record" in r.text


def test_out_of_range_sector_value_is_refused_with_a_message(signed_in,
                                                            station_id):
    """R8.4: a bad tilt comes back as an error, not a stored value."""
    r = _enable(signed_in, station_id, solar_on="on", tilt_deg="120")
    assert r.status_code == 303
    assert "error" in r.headers["location"]
    main = signed_in._main
    cfg = main.db.get_sector_config(station_id)
    assert cfg is None or cfg["tilt_deg"] != 120.0


def test_sector_page_needs_a_forecast_first(signed_in, station_id):
    _enable(signed_in, station_id, solar_on="on")
    r = signed_in.get(f"/station/{station_id}/sector/solar",
                      follow_redirects=False)
    assert r.status_code == 303
    assert "forecast" in r.headers["location"].lower()


def test_unknown_sector_redirects(signed_in, station_id):
    r = signed_in.get(f"/station/{station_id}/sector/quantum",
                      follow_redirects=False)
    assert r.status_code == 303
    assert "Unknown+sector" in r.headers["location"]


def test_sector_pages_need_a_session(client):
    r = client.get("/station/1/sector/solar", follow_redirects=True)
    assert LOGIN_MARKER in r.text


@pytest.fixture
def forecast_station(signed_in, station_id):
    """A station with a 1 day run, so sector pages have something to build on."""
    signed_in.post(f"/station/{station_id}/run", data={"days": 1},
                   follow_redirects=False)
    signed_in.post(f"/station/{station_id}/settings",
                   data={"latitude": "-26.7145", "longitude": "27.0977",
                         "elevation_m": "1350", "utc_offset_hours": "2"},
                   follow_redirects=False)
    return station_id


def test_solar_sector_page_renders_with_a_chart(signed_in, forecast_station):
    _enable(signed_in, forecast_station, solar_on="on", tilt_deg="30",
            surface_azimuth_deg="0", rated_w="5000")
    r = signed_in.get(f"/station/{forecast_station}/sector/solar")
    assert r.status_code == 200
    assert "Plane of array" in r.text
    assert "<svg" in r.text
    assert "Method version" in r.text


def test_wind_sector_page_renders_a_rose(signed_in, forecast_station):
    _enable(signed_in, forecast_station, wind_on="on", hub_height_m="80",
            measurement_height_m="10")
    r = signed_in.get(f"/station/{forecast_station}/sector/wind")
    assert r.status_code == 200
    assert "Wind resource" in r.text
    assert "<svg" in r.text
    # P8 wording is on the page, so P90 cannot be read as optimistic.
    assert "pessimistic" in r.text


def test_agriculture_sector_page_shows_one_frost_probability(signed_in,
                                                            forecast_station):
    _enable(signed_in, forecast_station, agriculture_on="on", crop="maize")
    r = signed_in.get(f"/station/{forecast_station}/sector/agriculture")
    assert r.status_code == 200
    assert "Frost" in r.text
    assert "Determined from" in r.text
    # P13: the fan claim is explicitly withheld without a measured inversion.
    assert "measured inversion" in r.text


def test_agrivoltaics_without_geometry_invites_configuration(signed_in,
                                                            forecast_station):
    """R6.10: the page states what to configure instead of drawing zeros."""
    _enable(signed_in, forecast_station, agrivoltaics_on="on")
    r = signed_in.get(f"/station/{forecast_station}/sector/agrivoltaics")
    assert r.status_code == 200
    assert "row pitch" in r.text
    assert "Not available at this station" in r.text


def test_agrivoltaics_with_geometry_shows_the_tradeoff(signed_in,
                                                      forecast_station):
    _enable(signed_in, forecast_station, agrivoltaics_on="on",
            row_pitch_m="5", collector_width_m="2", tilt_deg="25",
            surface_azimuth_deg="0")
    r = signed_in.get(f"/station/{forecast_station}/sector/agrivoltaics")
    assert r.status_code == 200
    assert "Energy against crop light" in r.text
    assert "Given up for the crop" in r.text
    assert "<svg" in r.text


def test_sector_pages_carry_no_script(signed_in, forecast_station):
    """R8.5: every sector page must render with scripting disabled, so no chart
    may depend on a script tag."""
    _enable(signed_in, forecast_station, solar_on="on", wind_on="on",
            agriculture_on="on", agrivoltaics_on="on", row_pitch_m="5",
            collector_width_m="2", rated_w="5000", hub_height_m="80")
    for sector in ("solar", "wind", "agriculture", "agrivoltaics"):
        r = signed_in.get(f"/station/{forecast_station}/sector/{sector}")
        assert r.status_code == 200, sector
        body = r.text.split("</head>")[-1]
        assert "<script" not in body, sector


def test_a_station_missing_sensors_names_them_in_plain_words(signed_in):
    """P15 end to end: a temperature-only station gets a page, not a 500, and it
    names a pyranometer rather than an internal field."""
    signed_in.post("/stations/new", data={"name": "Sparse Site",
                                          "csrf_token": signed_in.headers.get(
                                              "X-CSRF-Token", "")},
                   follow_redirects=False)
    main = signed_in._main
    station = main.db.get_station_by_slug("sparse-site")
    from datetime import datetime, timedelta
    from app.ingest import Observation
    base = datetime(2026, 1, 1, 0, 0)
    main.db.insert_observations(station.id, [
        Observation(observed_at=base + timedelta(hours=i),
                    values={"temperature": 15.0 + (i % 12)})
        for i in range(24 * 15)])
    signed_in.post(f"/station/{station.id}/run", data={"days": 1},
                   follow_redirects=False)
    _enable(signed_in, station.id, solar_on="on")

    r = signed_in.get(f"/station/{station.id}/sector/solar")
    assert r.status_code == 200
    assert "pyranometer" in r.text
    assert "solar_radiation" not in r.text
