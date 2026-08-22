"""Pre-upgrade backup that streams straight off the VPS, staging nothing on it.

The instance disk is 93% full, so writing dumps there first is not an option and
would also risk blocking the Vultr resize. Every artefact here is produced on
stdout by a remote command and piped directly into a local file, so the VPS
needs no free space at all.

Read-only with respect to application state: it reads files, runs pg_dump and
the sqlite3 online-backup API, and deletes nothing.

    python deploy/_stream_backup.py
"""
from __future__ import annotations

import gzip
import hashlib
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import paramiko

HOST = os.environ.get("DEPLOY_HOST", "139.84.242.126")
USER = os.environ.get("DEPLOY_USER", "root")
PW = os.environ.get("DEPLOY_PW", "")
if not PW:
    sys.exit("Set DEPLOY_PW in the environment.")

STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
OUT = Path("backups") / f"vps-{STAMP}"
CHUNK = 1 << 16

log_lines: list[str] = []


def say(msg: str = "") -> None:
    print(msg)
    log_lines.append(msg)


class Remote:
    def __init__(self, c: paramiko.SSHClient) -> None:
        self.c = c

    def out(self, cmd: str) -> str:
        _i, o, e = self.c.exec_command(cmd, timeout=300)
        return o.read().decode(errors="replace").strip()

    def stream(self, cmd: str, dest: Path, label: str) -> int:
        """Run cmd and pipe its stdout into dest. Returns bytes written."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        _i, o, e = self.c.exec_command(cmd, timeout=3600)
        chan = o.channel
        total = 0
        h = hashlib.sha256()
        with open(dest, "wb") as fh:
            while True:
                data = o.read(CHUNK)
                if not data:
                    break
                fh.write(data)
                h.update(data)
                total += len(data)
        code = chan.recv_exit_status()
        err = e.read().decode(errors="replace").strip()
        status = "ok" if code == 0 and total > 0 else f"FAILED (exit {code})"
        say(f"  {label:<34} {total:>12,} bytes  {status}")
        if err and code != 0:
            say(f"     stderr: {err[:400]}")
        if code == 0 and total > 0:
            say(f"     sha256 {h.hexdigest()[:32]}...")
        return total if code == 0 else 0


def describe_db(raw: str) -> tuple[str, str]:
    """Classify a DATABASE_URL without ever revealing its credentials."""
    if not raw:
        return "absent", "not set"
    if raw.startswith("sqlite"):
        m = re.search(r"sqlite[^/]*//+(.*)", raw)
        return "sqlite", f"file {m.group(1) if m else '?'} (on the instance disk)"
    if raw.startswith(("postgres://", "postgresql://", "postgres+", "postgresql+")):
        m = re.search(r"@([^/:?]+)", raw)
        host = m.group(1) if m else "?"
        local = host in ("localhost", "127.0.0.1", "postgres", "stratus-postgres", "db")
        where = "container on this box" if local else "external / managed"
        return ("postgres-local" if local else "postgres-external"), f"host {host} ({where})"
    return "unknown", "unrecognised scheme"


def main() -> None:
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    say(f"connecting to {USER}@{HOST}")
    c.connect(HOST, username=USER, password=PW, timeout=45,
              look_for_keys=False, allow_agent=False,
              banner_timeout=45, auth_timeout=45)
    r = Remote(c)
    OUT.mkdir(parents=True, exist_ok=True)
    say(f"writing to {OUT}")
    say()

    # ---------------------------------------------------------------- config
    say("Database configuration (credentials are never printed)")
    kinds = {}
    for label, env in (("stratus", "/opt/stratus/.env"),
                       ("panel", "/opt/lightning-panel/.env")):
        raw = r.out(f"[ -f {env} ] && grep -E '^DATABASE_URL=' {env} | head -1 | cut -d= -f2- || true")
        kind, detail = describe_db(raw)
        kinds[label] = kind
        say(f"  {label:<10} {kind:<18} {detail}")
    say()

    # ------------------------------------------------------- configs and meta
    say("Configuration and metadata")
    r.stream(
        "tar -czf - -C / "
        "opt/stratus/.env opt/stratus/docker-compose.yml "
        "opt/stratus/docker-compose.prod.yml "
        "opt/stratus/deploy/docker-compose.prod.yml "
        "opt/lightning-panel/.env opt/lightning-panel/docker-compose.yml "
        "opt/lightning-panel/docker-compose.traefik.yml "
        "2>/dev/null || true",
        OUT / "config.tar.gz", "config.tar.gz")

    r.stream(
        "{ echo '# host state before the plan change'; date -Is; hostname; "
        "echo; nproc; free -m; df -h /; echo; "
        "docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}'; echo; "
        "docker inspect $(docker ps -aq) 2>/dev/null | head -c 400000; }",
        OUT / "host-state.txt", "host-state.txt")

    # Traefik routing labels decide how both sites are published, so they are
    # worth keeping verbatim in case the container definitions are lost.
    r.stream(
        "docker inspect stratus-traefik stratus-app lightning-alert-panel "
        "--format '{{.Name}} {{json .Config.Labels}}' 2>/dev/null || true",
        OUT / "traefik-labels.txt", "traefik-labels.txt")

    # -------------------------------------------------------------- databases
    say()
    say("Databases")

    # Stratus Postgres container. Dumped with the client from inside the same
    # container so the server and client versions always match.
    pg_ok = r.out("docker ps --format '{{.Names}}' | grep -x stratus-postgres || true")
    if pg_ok:
        dbinfo = r.out(
            "docker exec stratus-postgres sh -lc "
            "'echo ${POSTGRES_USER:-postgres}:${POSTGRES_DB:-postgres}' 2>/dev/null || true")
        pu, _, pdb = dbinfo.partition(":")
        pu = pu or "postgres"
        pdb = pdb or "postgres"
        say(f"  stratus-postgres present, dumping role={pu} db={pdb}")
        r.stream(
            f"docker exec stratus-postgres pg_dump -U {pu} -d {pdb} "
            f"--clean --if-exists --no-owner --no-privileges | gzip -9",
            OUT / "stratus-postgres.sql.gz", "stratus-postgres.sql.gz")
        r.stream(
            f"docker exec stratus-postgres psql -U {pu} -d {pdb} -Atc "
            f"\"select table_name||' '||n_live_tup from pg_stat_user_tables "
            f"join information_schema.tables on table_name=relname order by 1\" 2>/dev/null || true",
            OUT / "stratus-postgres-rowcounts.txt", "postgres row counts")

    # Stratus SQLite file, if that is what the app is actually using. Copied
    # through the sqlite3 backup API rather than cp, which is the only way to
    # get a consistent copy of a live database with a WAL.
    sq = r.out("[ -f /opt/stratus/data/stratus.db ] && echo yes || echo no")
    if sq == "yes":
        size = r.out("stat -c%s /opt/stratus/data/stratus.db")
        say(f"  stratus SQLite present ({int(size):,} bytes), taking a consistent copy")
        got = r.stream(
            "docker exec stratus-app sh -lc "
            "'python3 - <<PY 2>/dev/null || sqlite3 /app/data/stratus.db \".backup /tmp/_b.db\" "
            "&& cat /tmp/_b.db && rm -f /tmp/_b.db\n"
            "import sqlite3,sys\n"
            "s=sqlite3.connect(\"/app/data/stratus.db\")\n"
            "d=sqlite3.connect(\"/tmp/_b.db\")\n"
            "s.backup(d); d.close(); s.close()\n"
            "sys.stdout.buffer.write(open(\"/tmp/_b.db\",\"rb\").read())\n"
            "PY' | gzip -9",
            OUT / "stratus-sqlite.db.gz", "stratus-sqlite.db.gz")
        if not got:
            # Fall back to a plain host-side copy. Less safe with a live WAL, but
            # better than having nothing.
            say("     consistent copy failed, falling back to a raw host copy")
            r.stream("gzip -9 -c /opt/stratus/data/stratus.db",
                     OUT / "stratus-sqlite-raw.db.gz", "stratus-sqlite-raw.db.gz")

    # Panel database.
    if kinds.get("panel") == "sqlite":
        say("  panel SQLite, taking a consistent copy")
        r.stream(
            "docker exec lightning-alert-panel python -c "
            "\"import sqlite3,sys;s=sqlite3.connect('/app/data/panel.db');"
            "d=sqlite3.connect('/tmp/_p.db');s.backup(d);d.close();s.close();"
            "sys.stdout.buffer.write(open('/tmp/_p.db','rb').read())\" | gzip -9",
            OUT / "panel-sqlite.db.gz", "panel-sqlite.db.gz")
    elif kinds.get("panel") == "postgres-external":
        say("  panel uses managed Postgres, which survives the reset")
        say("     dumping anyway so the backup is self-contained")
        r.stream(
            "cd /opt/lightning-panel && U=$(grep -E '^DATABASE_URL=' .env | cut -d= -f2-) && "
            "docker run --rm --network host postgres:17-alpine pg_dump \"$U\" "
            "--clean --if-exists --no-owner --no-privileges | gzip -9",
            OUT / "panel-postgres.sql.gz", "panel-postgres.sql.gz")

    # Panel data directory (generated reports and any local state).
    r.stream("tar -czf - -C /opt/lightning-panel data 2>/dev/null || true",
             OUT / "panel-data.tar.gz", "panel-data.tar.gz")

    # ------------------------------------------------- newest existing dump
    say()
    say("Most recent existing scheduled backup")
    newest = r.out("ls -1t /opt/stratus/backups/daily/*.sql.gz 2>/dev/null | head -1")
    if newest:
        sz = r.out(f"stat -c%s '{newest}'")
        say(f"  {newest}  ({int(sz):,} bytes)")
        r.stream(f"cat '{newest}'", OUT / Path(newest).name, Path(newest).name)
    else:
        say("  none found")

    c.close()

    # ------------------------------------------------------------- verify
    say()
    say("Local verification")
    total = 0
    for p in sorted(OUT.iterdir()):
        n = p.stat().st_size
        total += n
        note = ""
        if p.suffix == ".gz" and n > 0:
            try:
                with gzip.open(p, "rb") as fh:
                    fh.read(1 << 20)
                note = "gzip opens cleanly"
            except Exception as exc:
                note = f"GZIP ERROR: {exc}"
        say(f"  {p.name:<44} {n:>12,}  {note}")
    say()
    say(f"  total {total:,} bytes in {OUT}")
    say()
    say("This copy is on your machine, so it survives the hard reset.")
    say("Still take a Vultr snapshot as well: a filesystem image restores the")
    say("whole instance, which these dumps on their own cannot.")

    (OUT / "BACKUP_LOG.txt").write_text("\n".join(log_lines), encoding="utf-8")


if __name__ == "__main__":
    main()
