"""One-pass check that every change made this session is actually live.

Read-only. Sends no SMS and no email. The only POST is an unauthenticated one to
the heartbeat endpoint, which is refused by verify_token before any row is
written, so it proves the route is live without creating data.

    python deploy/verify_all_live.py
"""
from __future__ import annotations

import base64
import os
import sys
import time
from pathlib import Path

import paramiko

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

SC, PC = "stratus-app", "lightning-alert-panel"
DIR = "/opt/stratus"

log: list[str] = []
results: list[tuple[bool, str, str]] = []


def say(m: str = "") -> None:
    print(m, flush=True)
    log.append(m)


def section(t: str) -> None:
    say()
    say("=" * 76)
    say(t)
    say("=" * 76)


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((ok, label, detail))
    say(f"  {'PASS' if ok else 'FAIL':<5} {label:<52} {detail}")


def sh(cmd: str, timeout: int = 600) -> str:
    for attempt in (1, 2, 3):
        try:
            c = paramiko.SSHClient()
            c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            c.connect(HOST, username=USER, password=PW, timeout=60,
                      look_for_keys=False, allow_agent=False,
                      banner_timeout=60, auth_timeout=60)
            try:
                _i, o, e = c.exec_command(cmd, timeout=timeout)
                out = o.read().decode(errors="replace")
                err = e.read().decode(errors="replace")
                o.channel.recv_exit_status()
                return (out or err).rstrip()
            finally:
                c.close()
        except Exception as exc:
            if attempt == 3:
                return f"[conn failed: {type(exc).__name__}]"
            time.sleep(8)
    return ""


def psql(sql: str) -> str:
    b64 = base64.b64encode(sql.encode()).decode()
    return sh(f"cd {DIR} && U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-) && "
              "echo " + b64 + " | base64 -d | "
              "docker run --rm -i postgres:17-alpine psql \"$U\" -P pager=off "
              "-t -A -F'|' 2>&1", timeout=300)


def http(url: str, method: str = "GET") -> str:
    m = "-X POST" if method == "POST" else ""
    return sh(f"curl -s -o /dev/null -w %{{http_code}} --max-time 25 {m} " + url)


def py(ct: str, code: str) -> str:
    b64 = base64.b64encode(code.encode()).decode()
    return sh(f"echo {b64} | base64 -d | docker exec -i {ct} python - 2>&1",
              timeout=300)


def main() -> None:
    say("#" * 76)
    say("# Is everything from this session live?")
    say("#" * 76)
    say(f"  VPS clock (UTC): {sh('date -u')}")

    # ---------------------------------------------------------------- runtime
    section("1. Containers")
    for name in (SC, PC, "stratus-postgres", "stratus-traefik"):
        st = sh("docker inspect -f "
                "'{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}"
                "{{else}}nohealth{{end}}' " + name)
        ok = st.startswith("running")
        check(ok, f"{name} running", st)

    # ---------------------------------------------------------------- stratus
    section("2. Stratus - daily report disarmed")
    v = sh(f"docker exec {SC} printenv DEFAULT_DAILY_REPORT 2>/dev/null || echo UNSET")
    check(v.strip() == "off", "DEFAULT_DAILY_REPORT=off in the process", v.strip())
    boot = sh(f"docker logs {SC} 2>&1 | grep -ci 'bootstrap disabled' || echo 0")
    check(boot.strip() not in ("0", ""), "scheduler logged 'bootstrap disabled'",
          f"{boot.strip()} line(s)")

    sched = psql("SELECT id,enabled FROM report_schedules ORDER BY id;")
    smap = dict(l.split("|") for l in sched.splitlines() if "|" in l)
    check(smap.get("24") == "f", "schedule 24 disabled", f"enabled={smap.get('24')}")
    check(all(smap.get(i) == "t" for i in ("6", "20", "23")),
          "your own reports 6/20/23 untouched",
          " ".join(f"{i}={smap.get(i)}" for i in ("6", "20", "23")))
    orphan = psql("SELECT count(*) FROM report_schedules WHERE 21 = ANY(station_ids);")
    check(orphan.strip() == "0", "no schedule references deleted station 21",
          orphan.strip())

    section("3. Stratus - AS3935 deleted")
    n = psql("SELECT count(*) FROM stations WHERE id=21 OR name='AS3935';")
    check(n.strip() == "0", "AS3935 gone (by id and name)", n.strip())
    wd = psql("SELECT count(*) FROM weather_data WHERE station_id=21;")
    check(wd.strip() == "0", "its 2304 readings gone", wd.strip())
    tot = psql("SELECT count(*) FROM stations;")
    check(tot.strip() == "9", "9 stations remain", tot.strip())

    section("4. Stratus - this cycle's features in the running image")
    for marker, where, what in (
        ("allowedChartTimeRanges", "client/dist/assets", "per-station chart ranges"),
        ("barCategoryGap", "client/dist/assets", "ETo bar alignment fix"),
        ("AMSL", "dist/server", "PDF site altitude"),
        ("formatSiteLine", "dist/server", "PDF site lat/long"),
        ("xBand", "dist/server", "PDF ETo banded x-axis"),
        ("record.data", "dist/server", "import keeps all channels"),
    ):
        hits = sh(f"docker exec {SC} sh -c \"grep -rl '{marker}' {where} "
                  "2>/dev/null | head -1 || true\"")
        ok = bool(hits.strip()) and "[" not in hits
        check(ok, f"{marker} ({what})", hits.strip().split("/")[-1] if ok else "absent")

    # ------------------------------------------------------------------ panel
    section("5. Panel - nothing has ever been sent")
    ml = py(PC, "import sys;sys.path.insert(0,'/app')\n"
                "from app.db import SessionLocal\n"
                "from app.models import MessageLog\n"
                "d=SessionLocal();print(d.query(MessageLog).count());d.close()")
    check(ml.strip() == "0", "message_log is empty", f"{ml.strip()} rows")

    al = py(PC, "import sys;sys.path.insert(0,'/app')\n"
                "from app.db import SessionLocal\n"
                "from app.models import Tenant\n"
                "from app.runtime import get_alerts_enabled\n"
                "d=SessionLocal()\n"
                "print(';'.join(f'{t.slug}={get_alerts_enabled(d,tenant_id=t.id)}'"
                " for t in d.query(Tenant).order_by(Tenant.id).all()))\n"
                "d.close()")
    check("True" not in al, "alerts OFF for every tenant", al.strip())

    rc = py(PC, "import sys;sys.path.insert(0,'/app')\n"
                "from app.db import SessionLocal\n"
                "from app.models import Recipient\n"
                "d=SessionLocal()\n"
                "rs=d.query(Recipient).all()\n"
                "bad=[r.phone for r in rs if not (r.phone or '').startswith('+2700000')]\n"
                "print(f'{len(rs)} recipients, {len(bad)} routable')\n"
                "d.close()")
    check(", 0 routable" in rc, "all recipients are non-routable placeholders",
          rc.strip())

    section("6. Panel - detector units")
    un = py(PC, "import sys;sys.path.insert(0,'/app')\n"
                "from app.db import SessionLocal\n"
                "from app.models import UnitStatus, Tenant, HeartbeatSample\n"
                "d=SessionLocal()\n"
                "tm={t.id:t.slug for t in d.query(Tenant).all()}\n"
                "for r in d.query(UnitStatus).order_by(UnitStatus.station_id).all():\n"
                "    n=d.query(HeartbeatSample).filter("
                "HeartbeatSample.station_id==r.station_id).count()\n"
                "    print(f'{r.station_id}|{tm.get(r.tenant_id)}|"
                "{r.last_seen or \"never\"}|{n}')\n"
                "d.close()")
    for line in un.splitlines():
        say(f"        {line}")
    check("GLENCORE WONDERKOP|gwld1" in un,
          "GLENCORE WONDERKOP assigned to gwld1", "so heartbeats land in the client panel")
    check("GWLD1-DEMO|gwld1" in un and "|192" in un,
          "GWLD1-DEMO still has its 192 demo samples", "")

    section("7. Panel - LDS task 11/12 assets serve")
    base = "https://adminpanel.stratusweather.co.za"
    for a in ("/static/js/cpu-chart.js", "/static/js/storm-view.js",
              "/static/vendor/react.production.min.js",
              "/static/vendor/react-dom.production.min.js",
              "/static/vendor/prop-types.min.js",
              "/static/vendor/recharts.js"):
        code = http(base + a)
        check(code == "200", f"asset {a.split('/')[-1]}", code)

    section("8. Endpoints")
    for url, want in (
        ("https://stratusweather.co.za/", "200"),
        ("https://stratusweather.co.za/api/health", "200"),
        (base + "/login", "200"),
        (base + "/api/v1/health", "200"),
        (base + "/gwld1/api/v1/health", "200"),
    ):
        code = http(url)
        check(code == want, url.replace("https://", ""), code)

    say()
    say("  ingest routes live and authenticated (no token -> 401, nothing written):")
    for path in ("/api/v1/heartbeat", "/gwld1/api/v1/heartbeat",
                 "/gwld1/api/v1/lightning"):
        code = http(base + path, "POST")
        check(code == "401", f"POST {path} refused", code)

    # ---------------------------------------------------------------- verdict
    section("Verdict")
    bad = [r for r in results if not r[0]]
    say(f"  {len(results) - len(bad)} of {len(results)} checks passed")
    if bad:
        say()
        for _, label, detail in bad:
            say(f"    FAIL  {label}  {detail}")
    else:
        say("  Everything from this session is live and behaving.")
    say()
    say(f"  disk: {sh('df -h / | tail -1')}")
    say(f"  mem : {sh('free -h | sed -n 2p')}")

    Path("backups").mkdir(exist_ok=True)
    Path("backups/_verify_all_live.txt").write_text("\n".join(log), encoding="utf-8")


if __name__ == "__main__":
    Path("backups").mkdir(exist_ok=True)
    try:
        main()
    except Exception:
        import traceback
        tb = traceback.format_exc()
        Path("backups/_verify_all_live.txt").write_text(
            "\n".join(log) + "\n\nFAILED\n\n" + tb, encoding="utf-8")
        print(tb)
        raise
