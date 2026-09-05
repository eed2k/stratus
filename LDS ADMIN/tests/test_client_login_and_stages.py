"""Client sign-in, panel management and multi-stage alerts.

Nothing here sends a message. The gateway is monkeypatched in every test that
could reach it, and the tests assert on what would have been sent rather than
letting anything leave the process.
"""
import types

import pytest

from tests.util import login, get_csrf, seed_tenant, seed_user


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _platform_admin(db, email="staff@stratus.test"):
    """A platform admin on the tenant bootstrap created."""
    from app.config import settings
    from app.models import Tenant
    t = (db.query(Tenant)
         .filter(Tenant.slug == settings.PLATFORM_TENANT_SLUG).first())
    assert t is not None, "startup should have created the platform tenant"
    return seed_user(db, t.id, email, role="admin", platform_admin=True)


def _client_site(db, slug="gwld1", username="GWLD1", password="pw"):
    """A client tenant with one admin carrying a sign-in name."""
    t = seed_tenant(db, slug, slug.upper(), f"{slug} site")
    u = seed_user(db, t.id, f"admin@{slug}.test", role="admin",
                  password=password)
    u.username = username
    db.commit()
    return t, u


def _no_send(monkeypatch):
    """Replace the gateway with a recorder. Returns the list of sends."""
    import app.sms_gateway as gw
    sent = []

    def _fake(to, body):
        sent.append((to, body))
        return "queued", "fake-id"

    monkeypatch.setattr(gw, "send_sms", _fake)
    return sent


# ---------------------------------------------------------------------------
# The /client sign-in page
# ---------------------------------------------------------------------------

def test_client_page_is_served_on_the_platform_panel(client):
    r = client.get("/client")
    assert r.status_code == 200
    assert "Site sign-in name" in r.text


def test_client_page_does_not_ask_for_an_email(client):
    """A site knows itself as GWLD1, not as an e-mail address."""
    r = client.get("/client")
    assert 'name="username"' in r.text
    assert 'type="email"' not in r.text


def test_client_login_with_a_site_name_lands_in_that_panel(client, db_session):
    _client_site(db_session)
    token = get_csrf(client, "/client")
    r = client.post("/client",
                    data={"username": "GWLD1", "password": "pw",
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/gwld1/"


def test_client_sign_in_name_is_case_insensitive(client, db_session):
    """The name is a label, not a secret; case is not a credential."""
    _client_site(db_session)
    token = get_csrf(client, "/client")
    r = client.post("/client",
                    data={"username": "gwld1", "password": "pw",
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/gwld1/"


def test_client_login_also_accepts_an_email(client, db_session):
    """A client admin who knows their e-mail is not turned away."""
    _client_site(db_session)
    token = get_csrf(client, "/client")
    r = client.post("/client",
                    data={"username": "admin@gwld1.test", "password": "pw",
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/gwld1/"


def test_client_login_reaches_the_panel_after_redirect(client, db_session):
    _client_site(db_session)
    token = get_csrf(client, "/client")
    client.post("/client", data={"username": "GWLD1", "password": "pw",
                                 "csrf_token": token}, follow_redirects=False)
    r = client.get("/gwld1/")
    assert r.status_code == 200


def test_wrong_password_is_refused(client, db_session):
    _client_site(db_session)
    token = get_csrf(client, "/client")
    r = client.post("/client",
                    data={"username": "GWLD1", "password": "wrong",
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "Invalid credentials" in r.text


def test_unknown_site_name_gives_the_same_message_as_a_wrong_password(client,
                                                                     db_session):
    """This page must not reveal which sites exist."""
    _client_site(db_session)
    token = get_csrf(client, "/client")
    unknown = client.post("/client",
                          data={"username": "NOSUCHSITE", "password": "pw",
                                "csrf_token": token}, follow_redirects=False)
    token = get_csrf(client, "/client")
    wrong = client.post("/client",
                        data={"username": "GWLD1", "password": "nope",
                              "csrf_token": token}, follow_redirects=False)
    assert unknown.status_code == wrong.status_code == 200
    assert "Invalid credentials" in unknown.text
    assert "Invalid credentials" in wrong.text


def test_a_platform_admin_cannot_use_the_client_door(client, db_session):
    """Staff have their own page; this one must not grant cross-tenant reach."""
    admin = _platform_admin(db_session)
    admin.username = "STAFF"
    db_session.commit()
    token = get_csrf(client, "/client")
    r = client.post("/client",
                    data={"username": "STAFF", "password": "pw",
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "staff sign-in" in r.text.lower()


def test_a_disabled_panel_cannot_be_signed_into(client, db_session):
    t, _u = _client_site(db_session)
    t.is_active = False
    db_session.commit()
    token = get_csrf(client, "/client")
    r = client.post("/client",
                    data={"username": "GWLD1", "password": "pw",
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "Invalid credentials" in r.text


def test_client_post_requires_csrf(client, db_session):
    """A token-less POST must not sign anyone in.

    It is answered with a redirect back to the client sign-in page rather than a
    bare 403 body: a stale token is the ordinary result of leaving a page open
    past the session lifetime, and an operator needs a way forward. What matters
    for security is that the credentials were never accepted, which is asserted
    by the absence of a session cookie.
    """
    _client_site(db_session)
    r = client.post("/client", data={"username": "GWLD1", "password": "pw"},
                    follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/client?expired=1"
    # Nothing was granted: no session was established by the rejected POST.
    assert "session" not in r.headers.get("set-cookie", "").lower()


def test_client_is_a_reserved_slug():
    """Otherwise a tenant slugged "client" would swallow the login page."""
    from app.tenancy import RESERVED_SLUGS
    assert "client" in RESERVED_SLUGS


def test_a_tenant_cannot_be_created_with_the_client_slug():
    from fastapi import HTTPException
    from app.tenancy import validate_slug
    with pytest.raises(HTTPException):
        validate_slug("client")


# ---------------------------------------------------------------------------
# Where a sign-in lands
# ---------------------------------------------------------------------------

def test_platform_admin_lands_on_the_client_list(client, db_session):
    _platform_admin(db_session)
    r = login(client, "", "staff@stratus.test")
    assert r.status_code == 303
    assert r.headers["location"] == "/tenants"


def test_platform_admin_signing_in_at_a_client_stays_there(client, db_session):
    _client_site(db_session)
    _platform_admin(db_session)
    r = login(client, "/gwld1", "staff@stratus.test")
    assert r.status_code == 303
    assert r.headers["location"] == "/gwld1"


def test_client_using_the_staff_page_still_reaches_its_own_panel(client,
                                                                db_session):
    _client_site(db_session)
    r = login(client, "", "admin@gwld1.test")
    assert r.status_code == 303
    assert r.headers["location"] == "/gwld1/"


# ---------------------------------------------------------------------------
# Sign-in name backfill
# ---------------------------------------------------------------------------

def test_backfill_names_a_single_admin_after_its_panel(db_session):
    from app.bootstrap import ensure_client_usernames
    t = seed_tenant(db_session, "quaggasklip", "Quaggasklip")
    u = seed_user(db_session, t.id, "admin@qk.test", role="admin")
    assert u.username is None
    ensure_client_usernames(db_session)
    db_session.refresh(u)
    assert u.username == "QUAGGASKLIP"


def test_backfill_leaves_an_ambiguous_panel_alone(db_session):
    """Two admins means no single account the site's name belongs to."""
    from app.bootstrap import ensure_client_usernames
    t = seed_tenant(db_session, "twoadmins", "Two Admins")
    a = seed_user(db_session, t.id, "a@two.test", role="admin")
    b = seed_user(db_session, t.id, "b@two.test", role="admin")
    ensure_client_usernames(db_session)
    db_session.refresh(a)
    db_session.refresh(b)
    assert a.username is None and b.username is None


def test_backfill_is_idempotent(db_session):
    from app.bootstrap import ensure_client_usernames
    t = seed_tenant(db_session, "once", "Once")
    u = seed_user(db_session, t.id, "admin@once.test", role="admin")
    ensure_client_usernames(db_session)
    ensure_client_usernames(db_session)
    db_session.refresh(u)
    assert u.username == "ONCE"


def test_backfill_does_not_touch_the_platform_admin(client, db_session):
    # `client` is required: the platform tenant is created by app startup, which
    # only runs when the TestClient context is entered.
    from app.bootstrap import ensure_client_usernames
    admin = _platform_admin(db_session)
    ensure_client_usernames(db_session)
    db_session.refresh(admin)
    assert admin.username is None


# ---------------------------------------------------------------------------
# Managing a client panel
# ---------------------------------------------------------------------------

def test_admin_can_rename_a_panel(client, db_session):
    t, _u = _client_site(db_session)
    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    token = get_csrf(client, f"/tenants/{t.id}/edit")
    r = client.post(f"/tenants/{t.id}/update",
                    data={"name": "Glencore Wonderkop",
                          "site_name": "Wonderkop", "client_username": "GWLD1",
                          "csrf_token": token}, follow_redirects=False)
    assert r.status_code == 200
    db_session.refresh(t)
    assert t.name == "Glencore Wonderkop"
    assert t.site_name == "Wonderkop"


def test_the_panel_address_is_not_editable(client, db_session):
    """It is embedded in the detector's webhook URL."""
    t, _u = _client_site(db_session)
    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    r = client.get(f"/tenants/{t.id}/edit")
    assert r.status_code == 200, r.text[:400]
    assert "Panel settings" in r.text
    # Collapse whitespace: the explanation is line-wrapped in the template, so a
    # literal substring match would depend on where the source happens to break.
    flat = " ".join(r.text.split())
    assert "cannot be changed" in flat
    # No input for it, so it cannot be submitted even by hand.
    assert 'name="slug"' not in r.text


def test_a_duplicate_sign_in_name_is_refused(client, db_session):
    _client_site(db_session, slug="gwld1", username="GWLD1")
    other, _u = _client_site(db_session, slug="second", username="SECOND")
    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    token = get_csrf(client, f"/tenants/{other.id}/edit")
    r = client.post(f"/tenants/{other.id}/update",
                    data={"name": "Second", "site_name": "",
                          "client_username": "GWLD1", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "already in use" in r.text


def test_delete_requires_the_address_typed_exactly(client, db_session):
    from app.models import Tenant
    t, _u = _client_site(db_session)
    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    token = get_csrf(client, f"/tenants/{t.id}/edit")
    r = client.post(f"/tenants/{t.id}/delete",
                    data={"confirm_slug": "wrong", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    assert "Nothing was deleted" in r.text
    assert db_session.get(Tenant, t.id) is not None


def test_delete_removes_the_panel_and_its_data(client, db_session):
    from app.models import (Tenant, User, Group, Recipient, AlertEvent,
                            AlertStage, Setting)
    t, _u = _client_site(db_session)
    db_session.add(Group(tenant_id=t.id, name="control", is_active=True))
    db_session.commit()
    grp = db_session.query(Group).filter(Group.tenant_id == t.id).first()
    db_session.add(Recipient(tenant_id=t.id, name="Ops", phone="+27820000000",
                             group_id=grp.id, is_active=True))
    db_session.add(AlertStage(tenant_id=t.id, name="Warning", distance_km=20,
                              is_active=True))
    db_session.add(AlertEvent(tenant_id=t.id, station_id="GWLD1",
                              distance_km=5.0, energy=100))
    db_session.add(Setting(key=f"t{t.id}:alert_cooldown_min", value="5"))
    db_session.commit()
    tid = t.id

    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    token = get_csrf(client, f"/tenants/{tid}/edit")
    r = client.post(f"/tenants/{tid}/delete",
                    data={"confirm_slug": "gwld1", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303

    assert db_session.get(Tenant, tid) is None
    for model in (User, Group, Recipient, AlertEvent, AlertStage):
        assert db_session.query(model).filter(model.tenant_id == tid).count() == 0
    # Per-tenant runtime settings have no foreign key and must be cleared too,
    # or a future tenant reusing the id would inherit them.
    assert db_session.query(Setting).filter(
        Setting.key.like(f"t{tid}:%")).count() == 0


def test_delete_releases_detectors_instead_of_deleting_them(client, db_session):
    """The hardware is still out there transmitting."""
    from app.models import UnitStatus
    from app.bootstrap import platform_tenant_id
    t, _u = _client_site(db_session)
    db_session.add(UnitStatus(station_id="GWLD1", tenant_id=t.id))
    db_session.commit()
    tid = t.id
    platform_id = platform_tenant_id(db_session)

    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    token = get_csrf(client, f"/tenants/{tid}/edit")
    client.post(f"/tenants/{tid}/delete",
                data={"confirm_slug": "gwld1", "csrf_token": token},
                follow_redirects=False)

    unit = db_session.get(UnitStatus, "GWLD1")
    assert unit is not None, "a live detector must not be deleted with its panel"
    db_session.refresh(unit)
    assert unit.tenant_id == platform_id


def test_the_platform_panel_cannot_be_deleted(client, db_session):
    from app.config import settings
    from app.models import Tenant
    _platform_admin(db_session)
    login(client, "", "staff@stratus.test")
    platform = (db_session.query(Tenant)
                .filter(Tenant.slug == settings.PLATFORM_TENANT_SLUG).first())
    token = get_csrf(client, "/tenants")
    r = client.post(f"/tenants/{platform.id}/delete",
                    data={"confirm_slug": platform.slug, "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code in (400, 404)
    assert db_session.get(Tenant, platform.id) is not None


def test_a_client_cannot_reach_the_management_pages(client, db_session):
    """require_platform_admin 404s rather than 403s, so nothing is revealed."""
    t, _u = _client_site(db_session)
    login(client, "/gwld1", "admin@gwld1.test")
    for path in ("/tenants", f"/tenants/{t.id}/edit"):
        r = client.get(path, follow_redirects=False)
        assert r.status_code in (303, 404), path


# ---------------------------------------------------------------------------
# Stage selection
# ---------------------------------------------------------------------------

def _stages(db, tenant_id, *bands):
    from app.models import AlertStage
    made = []
    for name, km in bands:
        s = AlertStage(tenant_id=tenant_id, name=name, distance_km=km,
                       is_active=True)
        db.add(s)
        made.append(s)
    db.commit()
    return made


@pytest.mark.parametrize("distance,expected", [
    (0.5, "Stop work"),     # overhead falls in the nearest band
    (8.0, "Stop work"),
    (10.0, "Stop work"),    # the edge belongs to the band it names
    (10.5, "Warning"),
    (20.0, "Warning"),
    (25.0, "Advisory"),
    (30.0, "Advisory"),
    (31.0, None),           # beyond the plan: nothing fires
    (40.0, None),
])
def test_a_strike_raises_the_nearest_covering_stage(db_session, distance,
                                                    expected):
    from app.alert_worker import select_stage
    t = seed_tenant(db_session, "bands", "Bands")
    _stages(db_session, t.id, ("Advisory", 30), ("Warning", 20),
            ("Stop work", 10))
    stage = select_stage(db_session, t.id, distance)
    assert (stage.name if stage else None) == expected


def test_no_stages_means_no_stage_selected(db_session):
    """The signal to fall back to group thresholds."""
    from app.alert_worker import select_stage
    t = seed_tenant(db_session, "nostages", "No Stages")
    assert select_stage(db_session, t.id, 5.0) is None


def test_a_disabled_stage_never_fires(db_session):
    from app.alert_worker import select_stage
    t = seed_tenant(db_session, "disabled", "Disabled")
    made = _stages(db_session, t.id, ("Stop work", 10), ("Warning", 20))
    made[0].is_active = False
    db_session.commit()
    stage = select_stage(db_session, t.id, 5.0)
    assert stage is not None and stage.name == "Warning"


def test_stages_are_scoped_to_their_tenant(db_session):
    from app.alert_worker import select_stage
    a = seed_tenant(db_session, "alpha", "Alpha")
    b = seed_tenant(db_session, "beta", "Beta")
    _stages(db_session, a.id, ("Alpha only", 10))
    assert select_stage(db_session, b.id, 5.0) is None


# ---------------------------------------------------------------------------
# Who a stage notifies
# ---------------------------------------------------------------------------

def _recipient(db, tenant_id, group, name, phone="+27820000001"):
    from app.models import Recipient
    r = Recipient(tenant_id=tenant_id, name=name, phone=phone,
                  group_id=group.id, is_active=True)
    db.add(r)
    db.commit()
    return r


def _group(db, tenant_id, name, threshold=15):
    from app.models import Group
    g = Group(tenant_id=tenant_id, name=name, is_active=True,
              distance_threshold_km=threshold)
    db.add(g)
    db.commit()
    return g


def test_a_stage_naming_a_group_notifies_only_that_group(db_session):
    from app.alert_worker import select_stage, select_targets
    t = seed_tenant(db_session, "named", "Named")
    control = _group(db_session, t.id, "control")
    everyone = _group(db_session, t.id, "everyone")
    _recipient(db_session, t.id, control, "Controller")
    _recipient(db_session, t.id, everyone, "Everyone", "+27820000002")
    made = _stages(db_session, t.id, ("Stop work", 10))
    made[0].group_id = control.id
    db_session.commit()

    stage = select_stage(db_session, t.id, 5.0)
    targets = select_targets(db_session, t.id, 5.0, stage)
    assert [r.name for r in targets] == ["Controller"]


def test_a_stage_without_a_group_notifies_every_active_group(db_session):
    from app.alert_worker import select_stage, select_targets
    t = seed_tenant(db_session, "allgroups", "All Groups")
    a = _group(db_session, t.id, "a")
    b = _group(db_session, t.id, "b")
    _recipient(db_session, t.id, a, "A")
    _recipient(db_session, t.id, b, "B", "+27820000003")
    _stages(db_session, t.id, ("Warning", 20))
    stage = select_stage(db_session, t.id, 15.0)
    targets = select_targets(db_session, t.id, 15.0, stage)
    assert sorted(r.name for r in targets) == ["A", "B"]


def test_a_stage_overrides_the_group_threshold(db_session):
    """Otherwise a stage could fire while its own recipients were filtered out."""
    from app.alert_worker import select_stage, select_targets
    t = seed_tenant(db_session, "override", "Override")
    # Threshold of 5 km would exclude a 15 km strike under the old rules.
    g = _group(db_session, t.id, "narrow", threshold=5)
    _recipient(db_session, t.id, g, "Ops")
    _stages(db_session, t.id, ("Warning", 20))
    stage = select_stage(db_session, t.id, 15.0)
    targets = select_targets(db_session, t.id, 15.0, stage)
    assert [r.name for r in targets] == ["Ops"]


def test_without_stages_the_group_threshold_still_decides(db_session):
    """The existing behavior, unchanged for any panel that has not opted in."""
    from app.alert_worker import select_targets
    t = seed_tenant(db_session, "legacy", "Legacy")
    near = _group(db_session, t.id, "near", threshold=10)
    far = _group(db_session, t.id, "far", threshold=30)
    _recipient(db_session, t.id, near, "Near")
    _recipient(db_session, t.id, far, "Far", "+27820000004")

    assert sorted(r.name for r in
                  select_targets(db_session, t.id, 8.0, None)) == ["Far", "Near"]
    assert [r.name for r in
            select_targets(db_session, t.id, 20.0, None)] == ["Far"]
    assert select_targets(db_session, t.id, 35.0, None) == []


def test_a_recipient_without_a_number_is_never_targeted(db_session):
    from app.alert_worker import select_stage, select_targets
    t = seed_tenant(db_session, "nophone", "No Phone")
    g = _group(db_session, t.id, "g")
    _recipient(db_session, t.id, g, "Silent", phone="")
    _stages(db_session, t.id, ("Warning", 20))
    stage = select_stage(db_session, t.id, 10.0)
    assert select_targets(db_session, t.id, 10.0, stage) == []


# ---------------------------------------------------------------------------
# Message wording
# ---------------------------------------------------------------------------

def test_the_stage_name_leads_the_message(db_session):
    from app.messages import build_lightning_sms
    payload = {"station_id": "GWLD1", "distance_km": 8, "energy": 120000}
    body = build_lightning_sms(payload, stage_name="Stop work")
    assert body.startswith("LIGHTNING STOP WORK")
    assert "8km" in body


def test_without_a_stage_the_wording_is_unchanged(db_session):
    from app.messages import build_lightning_sms
    payload = {"station_id": "GWLD1", "distance_km": 8, "energy": 120000}
    assert build_lightning_sms(payload).startswith("LIGHTNING ALERT")


# ---------------------------------------------------------------------------
# Per-stage cooldown
# ---------------------------------------------------------------------------

def test_each_stage_counts_its_own_cooldown(db_session):
    """A distant strike must not silence the near strike behind it."""
    from app.runtime import mark_alert_sent, get_last_alert_sent
    t = seed_tenant(db_session, "cooldowns", "Cooldowns")
    mark_alert_sent(db_session, tenant_id=t.id, stage_id=1)
    assert get_last_alert_sent(db_session, tenant_id=t.id, stage_id=1) is not None
    assert get_last_alert_sent(db_session, tenant_id=t.id, stage_id=2) is None


def test_the_unstaged_cooldown_marker_is_separate(db_session):
    """A panel with no stages keeps its existing cooldown state."""
    from app.runtime import mark_alert_sent, get_last_alert_sent
    t = seed_tenant(db_session, "unstaged", "Unstaged")
    mark_alert_sent(db_session, tenant_id=t.id, stage_id=None)
    assert get_last_alert_sent(db_session, tenant_id=t.id) is not None
    assert get_last_alert_sent(db_session, tenant_id=t.id, stage_id=7) is None


# ---------------------------------------------------------------------------
# The stages UI
# ---------------------------------------------------------------------------

def test_a_client_operator_can_create_a_stage(client, db_session):
    from app.models import AlertStage
    t, _u = _client_site(db_session)
    seed_user(db_session, t.id, "op@gwld1.test", role="operator")
    login(client, "/gwld1", "op@gwld1.test")
    token = get_csrf(client, "/gwld1/stages")
    r = client.post("/gwld1/stages/create",
                    data={"name": "Warning", "distance_km": "20",
                          "group_id": "", "cooldown_min": "",
                          "csrf_token": token}, follow_redirects=False)
    assert r.status_code == 303
    s = db_session.query(AlertStage).filter(AlertStage.tenant_id == t.id).one()
    assert (s.name, s.distance_km, s.group_id) == ("Warning", 20, None)


def test_two_stages_cannot_share_a_distance(client, db_session):
    """The second could never fire, so it is refused rather than left dead."""
    t, _u = _client_site(db_session)
    login(client, "/gwld1", "admin@gwld1.test")
    token = get_csrf(client, "/gwld1/stages")
    client.post("/gwld1/stages/create",
                data={"name": "Warning", "distance_km": "20", "group_id": "",
                      "cooldown_min": "", "csrf_token": token},
                follow_redirects=False)
    token = get_csrf(client, "/gwld1/stages")
    r = client.post("/gwld1/stages/create",
                    data={"name": "Second", "distance_km": "20",
                          "group_id": "", "cooldown_min": "",
                          "csrf_token": token}, follow_redirects=False)
    assert r.status_code == 200
    assert "already a stage at 20 km" in r.text


def test_a_distance_beyond_the_detector_is_refused(client, db_session):
    _client_site(db_session)
    login(client, "/gwld1", "admin@gwld1.test")
    token = get_csrf(client, "/gwld1/stages")
    r = client.post("/gwld1/stages/create",
                    data={"name": "Too far", "distance_km": "60",
                          "group_id": "", "cooldown_min": "",
                          "csrf_token": token}, follow_redirects=False)
    assert r.status_code == 200
    assert "between 1 and 40" in r.text


def test_the_preset_creates_the_three_usual_stages(client, db_session):
    from app.models import AlertStage
    t, _u = _client_site(db_session)
    login(client, "/gwld1", "admin@gwld1.test")
    token = get_csrf(client, "/gwld1/stages")
    r = client.post("/gwld1/stages/preset", data={"csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 200
    bands = sorted(s.distance_km for s in db_session.query(AlertStage)
                   .filter(AlertStage.tenant_id == t.id).all())
    assert bands == [10, 20, 30]


def test_the_preset_does_not_disturb_an_existing_distance(client, db_session):
    from app.models import AlertStage
    t, _u = _client_site(db_session)
    _stages(db_session, t.id, ("Mine", 20))
    login(client, "/gwld1", "admin@gwld1.test")
    token = get_csrf(client, "/gwld1/stages")
    client.post("/gwld1/stages/preset", data={"csrf_token": token},
                follow_redirects=False)
    at20 = (db_session.query(AlertStage)
            .filter(AlertStage.tenant_id == t.id,
                    AlertStage.distance_km == 20).all())
    assert len(at20) == 1 and at20[0].name == "Mine"


def test_a_stage_cannot_point_at_another_clients_group(client, db_session):
    other = seed_tenant(db_session, "other", "Other")
    foreign = _group(db_session, other.id, "theirs")
    _client_site(db_session)
    login(client, "/gwld1", "admin@gwld1.test")
    token = get_csrf(client, "/gwld1/stages")
    r = client.post("/gwld1/stages/create",
                    data={"name": "Sneaky", "distance_km": "15",
                          "group_id": str(foreign.id), "cooldown_min": "",
                          "csrf_token": token}, follow_redirects=False)
    assert r.status_code == 200
    assert "valid group" in r.text


def test_a_viewer_cannot_create_a_stage(client, db_session):
    t, _u = _client_site(db_session)
    seed_user(db_session, t.id, "view@gwld1.test", role="viewer")
    login(client, "/gwld1", "view@gwld1.test")
    # A viewer is shown no write forms anywhere, so the only page with a token is
    # their own password change. The point of this test is the route's guard, not
    # where the token came from.
    token = get_csrf(client, "/gwld1/account/password")
    r = client.post("/gwld1/stages/create",
                    data={"name": "Nope", "distance_km": "20", "group_id": "",
                          "cooldown_min": "", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# End to end, with the gateway stubbed
# ---------------------------------------------------------------------------

def test_one_strike_produces_one_message_per_recipient(client, db_session,
                                                       monkeypatch):
    """Three stages must not mean three messages for a single flash."""
    from app.models import MessageLog
    from app.alert_worker import _dispatch
    from app.models import AlertEvent
    sent = _no_send(monkeypatch)

    t, _u = _client_site(db_session)
    g = _group(db_session, t.id, "ops")
    _recipient(db_session, t.id, g, "Ops")
    _stages(db_session, t.id, ("Advisory", 30), ("Warning", 20),
            ("Stop work", 10))

    event = AlertEvent(tenant_id=t.id, station_id="GWLD1", distance_km=8.0,
                       energy=100)
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)

    _dispatch(event.id, {"station_id": "GWLD1", "distance_km": 8.0,
                         "energy": 100})

    rows = db_session.query(MessageLog).filter(
        MessageLog.event_id == event.id).all()
    assert len(rows) == 1
    assert len(sent) == 1
    # The nearest band, and its name in the text.
    assert "STOP WORK" in sent[0][1]


def test_nothing_is_sent_when_alerts_are_switched_off(client, db_session,
                                                     monkeypatch):
    from app.models import AlertEvent, MessageLog
    from app.alert_worker import _dispatch
    from app.runtime import set_alerts_enabled
    sent = _no_send(monkeypatch)

    t, _u = _client_site(db_session)
    g = _group(db_session, t.id, "ops")
    _recipient(db_session, t.id, g, "Ops")
    _stages(db_session, t.id, ("Warning", 20))
    set_alerts_enabled(db_session, False, tenant_id=t.id)

    event = AlertEvent(tenant_id=t.id, station_id="GWLD1", distance_km=8.0,
                       energy=100)
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    _dispatch(event.id, {"station_id": "GWLD1", "distance_km": 8.0,
                         "energy": 100})

    assert sent == []
    row = db_session.query(MessageLog).filter(
        MessageLog.event_id == event.id).one()
    assert row.status == "skipped"


def test_a_strike_beyond_every_stage_notifies_nobody(client, db_session,
                                                     monkeypatch):
    from app.models import AlertEvent, MessageLog
    from app.alert_worker import _dispatch
    sent = _no_send(monkeypatch)

    t, _u = _client_site(db_session)
    g = _group(db_session, t.id, "ops")
    _recipient(db_session, t.id, g, "Ops")
    _stages(db_session, t.id, ("Stop work", 10))

    event = AlertEvent(tenant_id=t.id, station_id="GWLD1", distance_km=35.0,
                       energy=100)
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    _dispatch(event.id, {"station_id": "GWLD1", "distance_km": 35.0,
                         "energy": 100})

    assert sent == []
    assert db_session.query(MessageLog).filter(
        MessageLog.event_id == event.id).count() == 0


# ---------------------------------------------------------------------------
# The supplier is never named to a user
# ---------------------------------------------------------------------------

def test_no_template_names_the_sms_supplier():
    from pathlib import Path
    import app as app_pkg
    tpl_dir = Path(app_pkg.__file__).resolve().parent / "templates"
    offenders = [p.name for p in tpl_dir.glob("*.html")
                 if "clickatell" in p.read_text(encoding="utf-8").lower()]
    assert not offenders, f"supplier named in: {offenders}"


def test_the_gateway_error_text_does_not_name_the_supplier(monkeypatch):
    """These strings land on the message log, which a client can read."""
    import app.sms_gateway as gw
    from app.config import settings
    monkeypatch.setattr(settings, "SMS_GATEWAY_API_KEY", "", raising=False)
    monkeypatch.setattr(settings, "CLICKATELL_API_KEY", "", raising=False)
    with pytest.raises(RuntimeError) as exc:
        gw.send_sms("+27820000000", "body")
    assert "clickatell" not in str(exc.value).lower()
    assert "SMS gateway" in str(exc.value)


def test_the_legacy_env_names_are_still_honored(monkeypatch):
    """Renaming a variable must never be why alerts stop."""
    from app.config import settings
    monkeypatch.setattr(settings, "SMS_GATEWAY_API_KEY", "", raising=False)
    monkeypatch.setattr(settings, "CLICKATELL_API_KEY", "legacy-key",
                        raising=False)
    assert settings.sms_api_key == "legacy-key"


def test_the_new_env_name_wins_over_the_legacy_one(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "SMS_GATEWAY_API_KEY", "new", raising=False)
    monkeypatch.setattr(settings, "CLICKATELL_API_KEY", "old", raising=False)
    assert settings.sms_api_key == "new"


def test_both_delivery_receipt_paths_are_accepted(client):
    """The live path must keep working while setups migrate to the new one."""
    for path in ("/api/sms/dlr", "/api/clickatell/dlr"):
        r = client.post(path, json={"messages": []})
        assert r.status_code == 200, path
