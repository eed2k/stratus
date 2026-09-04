"""Ship the style pass to the live panel, and prove it from the served bytes.

WHY THIS SCRIPT EXISTS

  The earlier panel deploys upload a curated file list. deploy_panel_fixes.py
  carried the artwork, deploy_client_login_stages.py carried the client door and
  the alert stages. Neither list covered app/metrics.py, app/charts.py,
  app/auth.py, app/reports.py, app/static/* or most of app/templates/*, so the
  color -> color rename and the rest of the style pass sat in the repository
  while the live site kept serving the British spellings. Both of those deploys
  reported every check green, because their checks look at routes, the database
  and the message log, never at the spelling of a served asset.

  So this one uploads the whole app tree and then re-fetches the assets over
  HTTPS and asserts on their actual content.

WHAT IT DOES NOT DO

  It does not touch the schema. No migration, no seeding, no row is written.
  The database is still backed up first and row counts compared, because the
  container is restarted and that is when a startup migration would run.

  It does not upload app/static/vendor/. That directory holds the bundled
  Recharts and React builds. An earlier blunt pass had rewritten Recharts'
  color table, turning the CSS color name 'gray' into a duplicate 'gray' key,
  and renamed the Brush component's 'traveller' prop on one side of the
  reference only. Those files were restored from git and are excluded here so a
  spelling rule can never reach them again.

NOTHING HERE SENDS AN SMS OR AN EMAIL. The verification asserts the message log
is still empty afterwards.
"""
from __future__ import annotations

import base64
import io
import os
import re
import ssl
import sys
import tarfile
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

import paramiko
from scp import SCPClient

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HOST = os.environ.get("DEPLOY_HOST", "139.84.242.126")
USER = os.environ.get("DEPLOY_USER", "root")
PW = os.environ.get("DEPLOY_PW", "")
if not PW:
    sys.exit("Set DEPLOY_PW")

PANEL_DIR, PANEL_CF, PANEL_SVC, PANEL_CT = ("/opt/lightning-panel",
                                            "docker-compose.traefik.yml",
                                            "panel", "lightning-alert-panel")
BASE = "https://adminpanel.stratusweather.co.za"
DEMO = "https://lightningdemo.stratusweather.co.za"
INFO = "https://info.stratusweather.co.za"
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
LOG, DONE = "/root/stylepass.log", "/root/stylepass.done"
OUT = Path("backups/_deploy_style_pass.txt")

ROOT = Path("LDS ADMIN")

# Everything the running image needs, discovered from the tree rather than
# hand-listed, because a hand-listed set is exactly what caused this problem.
SKIP_PARTS = ("__pycache__", "app/static/vendor", ".pyc")


def collect() -> list[str]:
    out: list[str] = []
    for p in sorted((ROOT / "app").rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ROOT).as_posix()
        if any(s in rel for s in SKIP_PARTS):
            continue
        out.append(rel)
    for extra in ("requirements.txt", "Dockerfile", ".env.example"):
        if (ROOT / extra).is_file():
            out.append(extra)
    return out


log: list[str] = []
checks: list[tuple[bool, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)
    try:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text("\n".join(log), encoding="utf-8")
    except Exception:
        pass


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


def ck(ok: bool, label: str, detail: str = "") -> None:
    checks.append((bool(ok), label))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<54} {detail}")


def fresh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PW, timeout=60,
              look_for_keys=False, allow_agent=False,
              banner_timeout=60, auth_timeout=60)
    return c


def sh(cmd, timeout=1200):
    for attempt in (1, 2, 3):
        try:
            c = fresh()
            try:
                _i, o, e = c.exec_command(cmd, timeout=timeout)
                a = o.read().decode(errors="replace")
                b = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (a or b).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[conn failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


def bash(script: str, timeout=1200):
    return sh(f"echo {base64.b64encode(script.encode()).decode()} "
              f"| base64 -d | bash -s", timeout=timeout)


CTX = ssl.create_default_context()


def get(url: str, timeout=30) -> tuple[int, str]:
    req = urllib.request.Request(
        url, headers={"User-Agent": "stratus-deploy-verify",
                      "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception:
        return 0, ""


# Spellings that must not survive in anything we author and serve.
#
# These are DATA, not prose. They are the British forms this check looks for,
# and they must stay British or the check inverts and flags every correctly
# spelled word instead. A style pass over this repository once rewrote this
# list and the pre-flight then rejected the whole tree for containing "color".
#
# The strings are assembled from fragments so no find-and-replace over this
# file can rewrite them, whatever it is looking for.
_U = "u"
_UU = _U.upper()
BRITISH = [
    "colo" + _U + "r", "Colo" + _U + "r", "COLO" + _UU + "R",
    "behavio" + _U + "r", "Behavio" + _U + "r",
    "hono" + _U + "r", "favo" + _U + "r", "neighbo" + _U + "r",
    "cent" + "re", "Cent" + "re", "cent" + "red",
    "met" + "res", "lit" + "res",
    "initialis", "Initialis", "normalis", "Normalis",
    "authoris", "recognis", "organis", "optimis",
    "summaris", "serialis", "synchronis", "customis", "sanitis", "utilis",
    "gre" + "y", "Gre" + "y",
    "licen" + "ce", "Licen" + "ce", "defen" + "ce",
    "cancel" + "led", "label" + "led", "model" + "led", "travel" + "led",
    "whil" + "st", "among" + "st", "catalog" + "ue", "judge" + "ment",
    "program" + "me", "ful" + "fil", "enqui" + "r", "store" + "y",
]


def british_in(text: str) -> list[str]:
    return sorted({w for w in BRITISH
                   if re.search(r"(?<![A-Za-z])" + re.escape(w), text)})


def main() -> None:
    section("0. Pre-flight: what will be shipped")
    files = collect()
    missing = [f for f in files if not (ROOT / f).is_file()]
    ck(not missing, "every collected file exists", f"{len(files)} files")
    if missing:
        raise SystemExit("missing: " + ", ".join(missing))

    # The whole point: assert the local tree is already clean before shipping.
    dirty: list[str] = []
    for f in files:
        if f.endswith((".png", ".ico", ".woff", ".woff2", ".ttf")):
            continue
        try:
            txt = (ROOT / f).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        hits = british_in(txt)
        dashes = [d for d in ("\u2014", "\u2013") if d in txt]
        if hits or dashes:
            dirty.append(f"{f}: {hits} {dashes}")
    ck(not dirty, "local app tree is free of British spellings and em dashes",
       "clean" if not dirty else f"{len(dirty)} files still dirty")
    for d in dirty[:10]:
        say("      " + d)
    if dirty:
        raise SystemExit("local tree not clean; fix before deploying")

    ck(not any("static/vendor" in f for f in files),
       "vendored bundles excluded from the upload")

    section("1. Back up the database and tag a rollback image")
    say(bash(f"""
mkdir -p /root/panel-backups
if [ -f {PANEL_DIR}/data/panel.db ]; then
  cp {PANEL_DIR}/data/panel.db /root/panel-backups/panel-{STAMP}.db
  echo "  db backup /root/panel-backups/panel-{STAMP}.db"
fi
docker tag lightning-alert-panel:latest \
  lightning-alert-panel:rollback-{STAMP} 2>/dev/null \
  && echo "  rollback image lightning-alert-panel:rollback-{STAMP}"
"""))
    before = sh(f"docker exec -i {PANEL_CT} sh -lc "
                f"'python - <<\"PY\"\nimport sqlite3\n"
                f"c=sqlite3.connect(\"/app/data/panel.db\")\n"
                f"for t in (\"tenants\",\"users\",\"groups\",\"recipients\","
                f"\"message_log\",\"alert_stages\"):\n"
                f"    try: print(t, c.execute(f\"select count(*) from {{t}}\")"
                f".fetchone()[0])\n"
                f"    except Exception as e: print(t, \"n/a\")\nPY'")
    say("--- row counts before ---")
    say(before)

    section("2. Upload the whole app tree")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for f in files:
            tf.add(ROOT / f, arcname=f)
    payload = buf.getvalue()
    say(f"  tarball {len(payload):,} B across {len(files)} files")
    c = fresh()
    try:
        with SCPClient(c.get_transport(), socket_timeout=600) as scp:
            scp.putfo(io.BytesIO(payload), f"/tmp/style-{STAMP}.tar.gz")
    finally:
        c.close()
    say(bash(f"""
cd {PANEL_DIR}
tar -czf /root/panel-backups/before-style-{STAMP}.tar.gz app 2>/dev/null \
  && echo "  code backup /root/panel-backups/before-style-{STAMP}.tar.gz"
tar -xzf /tmp/style-{STAMP}.tar.gz && echo "  extract ok"
rm -f /tmp/style-{STAMP}.tar.gz
echo "  vendor dir still present:"; ls app/static/vendor | head -5
"""))

    section("3. Rebuild")
    sh(f"rm -f {LOG} {DONE}")
    say("  " + sh(f"cd {PANEL_DIR} && setsid nohup sh -c "
                  f"'docker compose -f {PANEL_CF} build {PANEL_SVC} "
                  f"> {LOG} 2>&1; echo $? > {DONE}' "
                  f">/dev/null 2>&1 </dev/null & echo LAUNCHED"))
    code = None
    for _ in range(120):
        time.sleep(15)
        got = sh(f"cat {DONE} 2>/dev/null").strip()
        if got.isdigit():
            code = int(got)
            break
    say(sh(f"tail -6 {LOG}"))
    ck(code == 0, "image rebuilt", f"exit {code}")
    if code != 0:
        raise SystemExit("build failed")

    section("4. Recreate and wait for health")
    say(sh(f"cd {PANEL_DIR} && docker compose -f {PANEL_CF} up -d --no-deps "
           f"{PANEL_SVC} 2>&1 | tail -5"))
    healthy = False
    for _ in range(40):
        time.sleep(10)
        st = sh(f"docker inspect -f '{{{{.State.Health.Status}}}}' "
                f"{PANEL_CT} 2>/dev/null").strip()
        if st == "healthy":
            healthy = True
            break
    ck(healthy, "panel container healthy")

    section("5. Row counts unchanged")
    after = sh(f"docker exec -i {PANEL_CT} sh -lc "
               f"'python - <<\"PY\"\nimport sqlite3\n"
               f"c=sqlite3.connect(\"/app/data/panel.db\")\n"
               f"for t in (\"tenants\",\"users\",\"groups\",\"recipients\","
               f"\"message_log\",\"alert_stages\"):\n"
               f"    try: print(t, c.execute(f\"select count(*) from {{t}}\")"
               f".fetchone()[0])\n"
               f"    except Exception as e: print(t, \"n/a\")\nPY'")
    say("--- row counts after ---")
    say(after)
    ck(before.strip() == after.strip(),
       "no row counts changed by this deploy",
       "identical" if before.strip() == after.strip() else "DIFFERENT")

    section("6. The served assets are what proves it")
    assets = [
        (f"{BASE}/login", "panel login page"),
        (f"{BASE}/client", "panel client door"),
        (f"{BASE}/static/style.css", "panel stylesheet"),
        (f"{BASE}/static/js/storm-view.js", "storm view script"),
        (f"{BASE}/static/js/cpu-chart.js", "cpu chart script"),
        (f"{BASE}/static/app.js", "app script"),
    ]
    served: dict[str, str] = {}
    for url, label in assets:
        status, body = get(url)
        ck(status == 200, f"{label} served", f"HTTP {status}")
        if status == 200:
            served[url] = body

    for url, label in assets:
        body = served.get(url)
        if body is None:
            continue
        hits = british_in(body)
        ck(not hits, f"no British spelling served in {label}",
           "clean" if not hits else ", ".join(hits))
        bad = [d for d in ("\u2014", "\u2013") if d in body]
        ck(not bad, f"no em/en dash served in {label}",
           "clean" if not bad else repr(bad))

    css = served.get(f"{BASE}/static/style.css", "")
    storm = served.get(f"{BASE}/static/js/storm-view.js", "")
    ck("--band-color" in css, "live stylesheet reads --band-color")
    ck("--band-color" in storm, "live storm script sets --band-color")
    # Assembled from fragments so a style pass cannot rewrite the thing being
    # searched for. A previous pass turned this into "--band-color", which made
    # the check assert that the NEW name was absent and fail on a correct deploy.
    old_property = "--band-colo" + _U + "r"
    ck(old_property not in css and old_property not in storm,
       f"old {old_property} is gone from both sides")
    ck("rgb(234,244,255)" in storm or "234, 244, 255" in storm
       or "#eaf4ff" in storm.lower() or "eaf4ff" in css.lower(),
       "bolt is still the blue-white channel")

    section("7. The vendored bundle is intact")
    st, rc = get(f"{BASE}/static/vendor/recharts.js", timeout=60)
    ck(st == 200, "vendored recharts served", f"HTTP {st}")
    if st == 200:
        ck("gray:8421504" in rc,
           "recharts still knows the CSS color name 'gray'",
           "present" if "gray:8421504" in rc else "MISSING: bundle corrupted")
        ck("recharts-brush-traveller" in rc,
           "recharts Brush traveller class intact")
        ck("renderTraveller" in rc, "recharts renderTraveller intact")

    section("8. Role name")
    for url, label in assets:
        body = served.get(url)
        if body is None:
            continue
        # The stale role name, in fragments for the same reason as above: a
        # pass rewrote this to "Stratus Admin", so it asserted the CORRECT new
        # name was absent and failed wherever the rename had worked.
        old_role_lower = "Stratus " + "st" + "aff"
        old_role_title = "Stratus " + "St" + "aff"
        ck(old_role_lower not in body and old_role_title not in body,
           f"no '{old_role_lower}' in {label}")

    section("9. Nothing disturbed, and nothing was sent")
    for u in (f"https://stratusweather.co.za/", f"{BASE}/login",
              f"{BASE}/client", f"{DEMO}/", f"{INFO}/"):
        st, _ = get(u)
        say(f"  {u:<56} HTTP {st}")
        ck(st == 200, f"still 200: {u}", f"HTTP {st}")

    say("--- 5xx since restart ---")
    say(sh(f"docker logs --since 20m {PANEL_CT} 2>&1 "
           f"| grep -cE ' 5[0-9][0-9] ' || true"))
    tb = sh(f"docker logs --since 20m {PANEL_CT} 2>&1 "
            f"| grep -c 'Traceback' || true").strip()
    say(f"--- tracebacks since restart: {tb}")
    ck(tb in ("0", ""), "no tracebacks since the restart", tb)

    msg = sh(f"docker exec -i {PANEL_CT} sh -lc "
             f"'python - <<\"PY\"\nimport sqlite3\n"
             f"c=sqlite3.connect(\"/app/data/panel.db\")\n"
             f"print(c.execute(\"select count(*) from message_log\")"
             f".fetchone()[0])\nPY'").strip()
    say(f"  message_log rows: {msg}")
    ck(msg == "0", "message log still empty: nothing was sent", msg)

    say(sh("docker ps --format '{{.Names}}  {{.Status}}'"))
    say(sh("df -h / | tail -1"))

    section("Result")
    bad = [c for c in checks if not c[0]]
    say(f"  {len(checks) - len(bad)} of {len(checks)} checks passed")
    for _, label in bad:
        say(f"    FAIL  {label}")
    say(f"  db backup   /root/panel-backups/panel-{STAMP}.db")
    say(f"  code backup /root/panel-backups/before-style-{STAMP}.tar.gz")
    say(f"  rollback    docker tag lightning-alert-panel:rollback-{STAMP} "
        f"lightning-alert-panel:latest && cd {PANEL_DIR} && "
        f"docker compose -f {PANEL_CF} up -d {PANEL_SVC}")
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
