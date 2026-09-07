"""Nothing on this service may be indexed, on any response type.

The meta tag in base.html only reaches a crawler that parses HTML. This service
also serves a stylesheet, a script and server-rendered SVG, so the header is the
mechanism that matters and it is the one that was missing.
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

REQUIRED = ("noindex", "nofollow", "noarchive", "nosnippet",
            "noimageindex", "notranslate")


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Same construction as test_web.py: main.py opens its database at import,
    so the module is reloaded against a temporary file."""
    monkeypatch.setenv("FORECAST_DB", str(tmp_path / "noindex.db"))
    monkeypatch.setenv("FORECAST_PASSWORD", "test-operator-password")
    monkeypatch.setenv("FORECAST_SECRET", "fixed-secret-for-tests")
    monkeypatch.setenv("FORECAST_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("DROPBOX_POLLING", "false")
    for leaked in ("XWEATHER_ENABLED", "XWEATHER_CLIENT_ID",
                   "XWEATHER_CLIENT_SECRET", "XWEATHER_KEY",
                   "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET",
                   "DROPBOX_REFRESH_TOKEN"):
        monkeypatch.delenv(leaked, raising=False)
    for name in [m for m in list(sys.modules) if m.startswith("app.")]:
        del sys.modules[name]
    if "app" in sys.modules:
        del sys.modules["app"]
    main = importlib.import_module("app.main")
    with TestClient(main.app, base_url="https://testserver") as c:
        c.noindex_policy = main.NOINDEX
        yield c


def test_the_header_is_on_a_page(client):
    r = client.get("/login")
    assert r.headers.get("x-robots-tag")
    for token in REQUIRED:
        assert token in r.headers["x-robots-tag"]


def test_the_header_is_on_a_static_asset(client):
    """Where the meta tag cannot help."""
    r = client.get("/static/style.css")
    assert r.status_code == 200
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_the_header_is_on_a_redirect(client):
    """A logged-out visitor gets a 303, and it must refuse indexing too."""
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (200, 303)
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_the_header_is_on_a_not_found(client):
    r = client.get("/no-such-page-here")
    assert r.status_code == 404
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_robots_txt_disallows_everything_without_a_session(client):
    r = client.get("/robots.txt", follow_redirects=False)
    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    body = r.text.lower()
    assert "user-agent: *" in body
    assert "disallow: /" in body


def test_the_pages_still_carry_the_meta_tag(client):
    """Belt and braces: the tag is the layer a document-only crawler reads."""
    body = client.get("/login").text.lower()
    assert 'name="robots"' in body
    assert "noindex" in body


def test_the_policy_string_matches_the_rest_of_the_estate(client):
    """One policy across five surfaces, or it is not a policy."""
    for token in REQUIRED:
        assert token in client.noindex_policy
