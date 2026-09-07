"""This console must never be indexed, on any response type.

It had none of the three mechanisms: no X-Robots-Tag header, no robots meta tag
and no robots.txt, which made adminpanel the one Stratus surface a crawler was
free to index. All three are asserted here so a later change cannot quietly drop
one of them.
"""
from app.main import NOINDEX

REQUIRED = ("noindex", "nofollow", "noarchive", "nosnippet",
            "noimageindex", "notranslate")


def test_the_policy_names_every_way_a_page_can_surface():
    """noindex alone still allows a cached copy, a snippet and image search."""
    for token in REQUIRED:
        assert token in NOINDEX


def test_the_header_is_on_the_login_page(client):
    r = client.get("/login")
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_the_header_is_on_a_redirect(client):
    """A logged-out visitor is bounced, and the bounce must refuse too."""
    r = client.get("/", follow_redirects=False)
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_the_header_is_on_a_static_asset(client):
    """Where a meta tag cannot reach: css, js, chart images, generated PDFs."""
    r = client.get("/static/style.css")
    assert r.status_code == 200
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_the_header_is_on_a_not_found(client):
    r = client.get("/definitely-not-a-page")
    assert r.status_code == 404
    assert "noindex" in r.headers.get("x-robots-tag", "")


def test_the_header_is_the_full_policy(client):
    r = client.get("/login")
    for token in REQUIRED:
        assert token in r.headers["x-robots-tag"]


def test_robots_txt_is_served_and_disallows_everything(client):
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert "text/plain" in r.headers["content-type"]
    body = r.text.lower()
    assert "user-agent: *" in body
    assert "disallow: /" in body


def test_robots_txt_needs_no_session(client):
    """A crawler has no cookie; a 303 to the login page would tell it nothing."""
    r = client.get("/robots.txt", follow_redirects=False)
    assert r.status_code == 200


def test_the_login_page_carries_the_meta_tag(client):
    body = client.get("/login").text.lower()
    assert 'name="robots"' in body
    assert "noindex" in body


def test_a_client_panel_page_carries_the_meta_tag(client, db_session):
    """The per-client panels render from the same base template."""
    from tests.util import seed_tenant, seed_user, login
    t = seed_tenant(db_session, "acme", "Acme Mine")
    seed_user(db_session, t.id, "boss@acme.test", role="admin")
    login(client, "/acme", "boss@acme.test")
    r = client.get("/acme/recipients")
    body = r.text.lower()
    assert 'name="robots"' in body
    assert "noindex" in r.headers.get("x-robots-tag", "")
