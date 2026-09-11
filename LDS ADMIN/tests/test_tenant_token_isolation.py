"""Per-tenant ingest token isolation.

Each detector's ingest token is bound to its own client's URL. A token minted
for one site is rejected on another site's path, and on the platform path, so a
leaked or misconfigured credential cannot cross the tenant boundary. Tenants
without their own token keep using the global ALERT_WEBHOOK_TOKEN, so existing
single-token deployments are unchanged.

The global token in the test environment is "test-token" (set in conftest).
"""


def _hb(client, path, token):
    return client.post(
        path,
        headers={"X-Auth-Token": token},
        json={"station_id": "QK", "cpu_temp_c": 40.0},
    )


def test_per_tenant_token_is_required_and_isolated(client, db_session, monkeypatch):
    from tests.util import seed_tenant

    seed_tenant(db_session, "quaggasklip", "Quaggasklip", "Quaggasklip")
    monkeypatch.setenv("ALERT_WEBHOOK_TOKEN_QUAGGASKLIP", "qk-secret")

    # The tenant's own token is accepted on its own URL.
    assert _hb(client, "/quaggasklip/api/v1/heartbeat", "qk-secret").status_code == 200
    # The global token is NOT accepted on a tenant that has its own token.
    assert _hb(client, "/quaggasklip/api/v1/heartbeat", "test-token").status_code == 401
    # The tenant token is NOT accepted on the platform (global) path.
    assert _hb(client, "/api/v1/heartbeat", "qk-secret").status_code == 401
    # The global token still works on the platform path.
    assert _hb(client, "/api/v1/heartbeat", "test-token").status_code == 200


def test_two_tenants_do_not_share_tokens(client, db_session, monkeypatch):
    from tests.util import seed_tenant

    seed_tenant(db_session, "quaggasklip", "Quaggasklip", "Quaggasklip")
    seed_tenant(db_session, "gwld1", "Glencore Wonderkop", "Glencore")
    # Only Quaggasklip has its own token; Glencore falls back to the global one.
    monkeypatch.setenv("ALERT_WEBHOOK_TOKEN_QUAGGASKLIP", "qk-secret")

    # Quaggasklip's token is rejected on Glencore's URL...
    assert _hb(client, "/gwld1/api/v1/heartbeat", "qk-secret").status_code == 401
    # ...and Glencore's (global) token is rejected on Quaggasklip's URL.
    assert _hb(client, "/quaggasklip/api/v1/heartbeat", "test-token").status_code == 401
    # Each works on its own path.
    assert _hb(client, "/gwld1/api/v1/heartbeat", "test-token").status_code == 200
    assert _hb(client, "/quaggasklip/api/v1/heartbeat", "qk-secret").status_code == 200


def test_tenant_without_own_token_uses_global(client, db_session):
    from tests.util import seed_tenant

    seed_tenant(db_session, "gwld1", "Glencore Wonderkop", "Glencore")
    # No ALERT_WEBHOOK_TOKEN_GWLD1 set -> the global token applies unchanged.
    assert _hb(client, "/gwld1/api/v1/heartbeat", "test-token").status_code == 200
    assert _hb(client, "/gwld1/api/v1/heartbeat", "nope").status_code == 401
