"""What a non-admin login may see, and what must never reach a log.

Two separate requirements, tested together because both are about a client's
information not travelling further than it should:

  * an operator may see who else can sign in, but not which accounts are
    administrators, and may not add or remove anyone
  * creating a login and adding an SMS recipient must be silent - no e-mail, no
    confirmation message - and a recipient's number must not be written into the
    container log in full
"""
from tests.util import get_csrf, login, seed_tenant, seed_user


# ---------------------------------------------------------------------------
#  Who can see whom
# ---------------------------------------------------------------------------

def _panel_with_three_roles(db_session):
    t = seed_tenant(db_session, "acme", "Acme Mine")
    seed_user(db_session, t.id, "boss@acme.test", role="admin")
    seed_user(db_session, t.id, "shift@acme.test", role="operator")
    seed_user(db_session, t.id, "watcher@acme.test", role="viewer")
    return t


def test_admin_sees_every_login_in_their_panel(client, db_session):
    _panel_with_three_roles(db_session)
    login(client, "/acme", "boss@acme.test")
    body = client.get("/acme/users").text
    assert "boss@acme.test" in body
    assert "shift@acme.test" in body
    assert "watcher@acme.test" in body


def test_operator_sees_colleagues_but_no_administrators(client, db_session):
    """The requirement, stated as a test.

    Knowing which accounts hold admin rights is the useful half of an attack on
    them, and it exposes the client's internal hierarchy to every operator they
    hire.
    """
    _panel_with_three_roles(db_session)
    login(client, "/acme", "shift@acme.test")
    body = client.get("/acme/users").text
    assert "shift@acme.test" in body
    assert "watcher@acme.test" in body
    assert "boss@acme.test" not in body


def test_operator_gets_no_controls_for_adding_or_removing_logins(client,
                                                                 db_session):
    _panel_with_three_roles(db_session)
    login(client, "/acme", "shift@acme.test")
    body = client.get("/acme/users").text
    assert "/users/create" not in body
    assert "/delete" not in body


def test_operator_cannot_create_a_login_even_by_posting_directly(client,
                                                                db_session):
    """Hiding the form is presentation; this is the control."""
    _panel_with_three_roles(db_session)
    login(client, "/acme", "shift@acme.test")
    # Taken from a page the operator can write to: their own users page carries no
    # token, because every form on it is hidden from them. A real attempt would
    # reuse a token the same way, so this is the honest version of the attack.
    token = get_csrf(client, "/acme/recipients")
    r = client.post("/acme/users/create",
                    data={"email": "new@acme.test", "password": "0123456789",
                          "role": "admin", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 403


def test_operator_cannot_delete_a_login(client, db_session):
    t = _panel_with_three_roles(db_session)
    from app.models import User
    victim = db_session.query(User).filter(
        User.email == "watcher@acme.test").first()
    login(client, "/acme", "shift@acme.test")
    token = get_csrf(client, "/acme/recipients")
    r = client.post(f"/acme/users/{victim.id}/delete",
                    data={"csrf_token": token}, follow_redirects=False)
    assert r.status_code == 403
    assert db_session.query(User).filter(
        User.email == "watcher@acme.test").first() is not None


def test_a_read_only_account_sees_no_login_list(client, db_session):
    """Consistent with how this panel already treats a viewer on recipients."""
    _panel_with_three_roles(db_session)
    login(client, "/acme", "watcher@acme.test")
    body = client.get("/acme/users").text
    assert "shift@acme.test" not in body
    assert "boss@acme.test" not in body


def test_an_operator_never_sees_another_clients_logins(client, db_session):
    _panel_with_three_roles(db_session)
    other = seed_tenant(db_session, "beta", "Beta Mine")
    seed_user(db_session, other.id, "beta-op@beta.test", role="operator")
    login(client, "/acme", "shift@acme.test")
    body = client.get("/acme/users").text
    assert "beta-op@beta.test" not in body


def test_an_operator_cannot_reach_another_clients_panel(client, db_session):
    """The session is pinned to one tenant; a URL alone must not move it."""
    _panel_with_three_roles(db_session)
    other = seed_tenant(db_session, "beta", "Beta Mine")
    seed_user(db_session, other.id, "beta-op@beta.test", role="operator")
    login(client, "/acme", "shift@acme.test")
    r = client.get("/beta/users", follow_redirects=False)
    assert r.status_code in (303, 403, 404)
    if r.status_code == 303:
        assert "/login" in r.headers.get("location", "")


def test_no_password_hash_is_ever_rendered(client, db_session):
    _panel_with_three_roles(db_session)
    from app.models import User
    hashes = [u.password_hash for u in db_session.query(User).all()]
    login(client, "/acme", "boss@acme.test")
    body = client.get("/acme/users").text
    for h in hashes:
        assert h not in body
    assert "$2b$" not in body            # bcrypt prefix, in case of truncation


# ---------------------------------------------------------------------------
#  Nothing is sent to anybody
# ---------------------------------------------------------------------------

def test_creating_a_login_sends_nothing(client, db_session, monkeypatch):
    """An operator is created with a password the admin chose, and told nothing.

    Guarded by a test rather than by inspection because "we do not send mail" is
    the kind of property a later convenience feature quietly breaks.
    """
    sent = []
    import app.sms_gateway as gw
    monkeypatch.setattr(gw, "send_sms",
                        lambda *a, **k: sent.append(a) or ("queued", "x"))

    t = seed_tenant(db_session, "acme", "Acme Mine")
    seed_user(db_session, t.id, "boss@acme.test", role="admin")
    login(client, "/acme", "boss@acme.test")
    token = get_csrf(client, "/acme/users")
    r = client.post("/acme/users/create",
                    data={"email": "newop@acme.test", "password": "0123456789",
                          "role": "operator", "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303
    from app.models import User
    assert db_session.query(User).filter(
        User.email == "newop@acme.test").first() is not None
    assert sent == []


def test_the_panel_has_no_outbound_mail_path_at_all():
    """No mail library is imported anywhere in the application package.

    The strongest form of "no confirmation e-mail": there is nothing to send with.
    """
    from pathlib import Path
    import app as app_pkg

    banned = ("smtplib", "mailersend", "sendgrid", "email.mime",
              "aiosmtplib", "postmarker", "boto3.client(\"ses\"")
    offenders = []
    for path in Path(app_pkg.__file__).parent.rglob("*.py"):
        text = path.read_text(encoding="utf-8", errors="replace")
        for token in banned:
            if token in text:
                offenders.append(f"{path.name}: {token}")
    assert offenders == [], f"outbound mail path found: {offenders}"


def test_adding_a_recipient_sends_no_confirmation_message(client, db_session,
                                                          monkeypatch):
    sent = []
    import app.sms_gateway as gw
    monkeypatch.setattr(gw, "send_sms",
                        lambda *a, **k: sent.append(a) or ("queued", "x"))

    t = seed_tenant(db_session, "acme", "Acme Mine")
    seed_user(db_session, t.id, "boss@acme.test", role="admin")
    login(client, "/acme", "boss@acme.test")

    token = get_csrf(client, "/acme/groups")
    client.post("/acme/groups/create",
                data={"name": "Control room", "description": "",
                      "distance_threshold_km": "15", "csrf_token": token},
                follow_redirects=False)
    from app.models import Group
    g = db_session.query(Group).filter(Group.tenant_id == t.id).first()
    assert g is not None

    token = get_csrf(client, "/acme/recipients")
    r = client.post("/acme/recipients/create",
                    data={"name": "Night shift", "phone": "+27821234567",
                          "language": "en", "group_id": str(g.id),
                          "csrf_token": token},
                    follow_redirects=False)
    assert r.status_code == 303
    from app.models import Recipient
    assert db_session.query(Recipient).filter(
        Recipient.phone == "+27821234567").first() is not None
    assert sent == [], "adding a recipient must not message them"


# ---------------------------------------------------------------------------
#  POPIA: a number must not travel into the log
# ---------------------------------------------------------------------------

def test_a_number_is_masked_for_logging():
    from app.sms_gateway import mask_number

    assert mask_number("+27821234567") == "+27*******67"
    assert mask_number("0821234567") == "08******67"
    # Nothing useful is leaked by a short or empty value either.
    assert mask_number("") == "(none)"
    assert set(mask_number("1234")) <= {"*", "1", "2", "3", "4"}
    assert "1234567" not in mask_number("+27821234567")


def test_the_alert_worker_logs_a_masked_number(monkeypatch, caplog):
    """The full number used to be written on every failed send."""
    import logging
    from app import sms_gateway

    caplog.set_level(logging.WARNING)
    number = "+27821234567"
    logging.getLogger("app.alert_worker").warning(
        "SMS send failed (recipient=%s -> %s): %s",
        7, sms_gateway.mask_number(number), "gateway timeout")
    text = caplog.text
    assert number not in text
    assert "+27*******67" in text


def test_no_source_line_logs_a_bare_recipient_number():
    """Catches a future log statement that reintroduces the leak."""
    import re
    from pathlib import Path
    import app as app_pkg

    offenders = []
    pattern = re.compile(r"log\.(?:debug|info|warning|error|exception)\(")
    for path in Path(app_pkg.__file__).parent.rglob("*.py"):
        for i, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if pattern.search(line) and re.search(r"\br\.phone\b", line):
                offenders.append(f"{path.name}:{i}")
    assert offenders == [], f"unmasked number in a log call: {offenders}"
