#!/bin/bash
# =============================================================================
# Stratus estate backup - main app + subdomains + configs
#
# Runs every 6 hours from cron:
#   0 */6 * * * /bin/bash /opt/stratus/deploy/backup.sh >> /opt/stratus/backups/backup.log 2>&1
#
# WHAT IT BACKS UP (and why it is tiered)
#
#   The raw weather .dat files already live in Dropbox, so these backups are
#   about Stratus itself: its setup, and the per-subdomain state that is NOT in
#   Dropbox (admin-panel logins and recipients, forecast station/feed config,
#   compose files and .env secrets). Those are small, so they are kept for a
#   long window. The full Postgres dump is large (mostly weather_data), so it is
#   kept for a short window for quick recovery while Neon's own point-in-time
#   backups and Dropbox cover the rest.
#
#   daily/stratus_backup_<date>.sql.gz   Full Neon dump                (keep 8 = ~2 days + weekly)
#   daily/stratus_config_<date>.sql.gz   Neon WITHOUT weather_data rows (keep >= 14 days)
#   daily/panel_<date>.sql.gz            Admin-panel SQLite: logins/recipients/tenants (keep >= 14 days)
#   daily/forecast_<date>.sql.gz         Forecast SQLite setup (no bulk observations)  (keep >= 14 days)
#   daily/config_<date>.tar.gz           compose files + .env for all three services   (keep >= 14 days)
#
# Every artifact lands in /opt/stratus/backups so the daily Stratus Report email
# (weeklyDigestService) reports it.
# =============================================================================

set -uo pipefail

BACKUP_DIR="/opt/stratus/backups"
ENV_FILE="/opt/stratus/.env"
DATE=$(date +%Y-%m-%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)          # 1=Monday .. 7=Sunday

# Retention.
FULL_KEEP=8                      # full Neon dumps to keep in daily/ (6h -> ~2 days)
WEEKLY_KEEP=8                    # weekly full dumps (Sundays) to keep
LONG_DAYS=15                     # small setup/logins dumps: delete older than this (>= 14 days kept)

PG_IMAGE="postgres:17-alpine"
PANEL_CTR="lightning-alert-panel"
FORECAST_CTR="stratus-forecast"

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/pre-deploy"

log() { echo "[Backup] $*"; }
ok=0; fail=0
step_ok()   { ok=$((ok+1));   log "OK   $1"; }
step_fail() { fail=$((fail+1)); log "FAIL $1"; }

# A dump is only accepted if it is larger than this - a near-empty file means
# the command failed even if it exited zero (e.g. a broken pipe into gzip).
min_bytes() {  # $1=file  $2=min
    local n; n=$(stat -c%s "$1" 2>/dev/null || echo 0)
    [ "${n:-0}" -ge "$2" ]
}

log "========================================="
log "Starting estate backup at $(date -Is)"
log "========================================="

DB_URL=""
if [ -f "$ENV_FILE" ]; then
    DB_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- || true)
fi

docker pull -q "$PG_IMAGE" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
# 1. Full Neon dump (complete recovery).
# ---------------------------------------------------------------------------
if [ -n "${DB_URL:-}" ]; then
    F="$BACKUP_DIR/daily/stratus_backup_${DATE}.sql.gz"
    if docker run --rm --network host "$PG_IMAGE" \
            pg_dump "$DB_URL" --clean --if-exists --no-owner --no-privileges \
            2>/dev/null | gzip > "$F" && min_bytes "$F" 100000; then
        step_ok "full Neon dump ($(du -h "$F" | cut -f1))"
        if [ "$DAY_OF_WEEK" -eq 7 ]; then
            cp "$F" "$BACKUP_DIR/weekly/stratus_backup_${DATE}.sql.gz" \
                && log "weekly copy saved"
        fi
    else
        rm -f "$F"; step_fail "full Neon dump"
    fi

    # -----------------------------------------------------------------------
    # 2. Config-only Neon dump: everything EXCEPT the bulk weather_data rows.
    #    Small, so it is kept for the long window. Captures users, stations,
    #    shares, alarms, report schedules, dropbox configs, organizations, etc.
    # -----------------------------------------------------------------------
    C="$BACKUP_DIR/daily/stratus_config_${DATE}.sql.gz"
    if docker run --rm --network host "$PG_IMAGE" \
            pg_dump "$DB_URL" --clean --if-exists --no-owner --no-privileges \
            --exclude-table-data='weather_data' \
            --exclude-table-data='*.weather_data' \
            2>/dev/null | gzip > "$C" && min_bytes "$C" 2000; then
        step_ok "Neon config dump ($(du -h "$C" | cut -f1))"
    else
        rm -f "$C"; step_fail "Neon config dump"
    fi
else
    step_fail "DATABASE_URL not found in $ENV_FILE (skipped both Neon dumps)"
fi

# ---------------------------------------------------------------------------
# 3. Admin-panel SQLite: logins, recipients, tenants, settings, groups.
#    Copied through the sqlite3 online-backup API for a consistent snapshot,
#    then dumped as SQL text so it is portable and inspectable.
# ---------------------------------------------------------------------------
P="$BACKUP_DIR/daily/panel_${DATE}.sql.gz"
if docker exec -i "$PANEL_CTR" python - <<'PYEOF' 2>/dev/null | gzip > "$P" && min_bytes "$P" 300; then
import sqlite3, sys, os
src = sqlite3.connect('/app/data/panel.db')
tmp = '/tmp/_panel_backup.db'
dst = sqlite3.connect(tmp)
src.backup(dst)
src.close()
for line in dst.iterdump():
    sys.stdout.write(line + '\n')
dst.close()
os.unlink(tmp)
PYEOF
    step_ok "admin-panel SQLite dump ($(du -h "$P" | cut -f1))"
else
    rm -f "$P"; step_fail "admin-panel SQLite dump"
fi

# ---------------------------------------------------------------------------
# 4. Forecast SQLite setup: schema for everything + data for every table
#    EXCEPT the bulk observations (those are rebuildable from the Dropbox .dat
#    files). Keeps station/feed config, sector config and forecast state small.
# ---------------------------------------------------------------------------
FC="$BACKUP_DIR/daily/forecast_${DATE}.sql.gz"
if docker exec -i "$FORECAST_CTR" python - <<'PYEOF' 2>/dev/null | gzip > "$FC" && min_bytes "$FC" 300; then
import sqlite3, sys, os
EXCLUDE_DATA = {'observations', 'sqlite_sequence', 'sqlite_stat1'}
src = sqlite3.connect('/app/data/forecast.db')
tmp = '/tmp/_forecast_backup.db'
dst = sqlite3.connect(tmp)
src.backup(dst)
src.close()
cur = dst.cursor()

def lit(v):
    if v is None:
        return 'NULL'
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v)
    if isinstance(v, bytes):
        return "X'" + v.hex() + "'"
    return "'" + str(v).replace("'", "''") + "'"

out = sys.stdout
out.write('PRAGMA foreign_keys=OFF;\n')
out.write('BEGIN TRANSACTION;\n')
# Full schema (so a restore recreates every table, including an empty
# observations ready for Dropbox to refill).
for (sql,) in cur.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL "
        "AND type IN ('table','index','trigger','view')"):
    out.write(sql + ';\n')
# Data for every table except the bulk/internal ones.
tables = [r[0] for r in cur.execute(
    "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
for t in tables:
    if t in EXCLUDE_DATA:
        continue
    for row in cur.execute('SELECT * FROM "%s"' % t):
        out.write('INSERT INTO "%s" VALUES(%s);\n'
                  % (t, ','.join(lit(x) for x in row)))
out.write('COMMIT;\n')
dst.close()
os.unlink(tmp)
PYEOF
    step_ok "forecast SQLite setup dump ($(du -h "$FC" | cut -f1))"
else
    rm -f "$FC"; step_fail "forecast SQLite setup dump"
fi

# ---------------------------------------------------------------------------
# 5. Configuration: compose files and .env for all three services. Contains
#    secrets, so it is written 0600.
# ---------------------------------------------------------------------------
G="$BACKUP_DIR/daily/config_${DATE}.tar.gz"
if tar -czf "$G" -C / \
        opt/stratus/.env \
        opt/stratus/docker-compose.yml \
        opt/lightning-panel/.env \
        opt/lightning-panel/docker-compose.traefik.yml \
        opt/stratus-forecast/.env \
        opt/stratus-forecast/docker-compose.yml \
        2>/dev/null && min_bytes "$G" 200; then
    chmod 600 "$G"
    step_ok "config tarball ($(du -h "$G" | cut -f1))"
else
    rm -f "$G"; step_fail "config tarball"
fi

# ---------------------------------------------------------------------------
# Rotation
# ---------------------------------------------------------------------------
cd "$BACKUP_DIR/daily" || exit 1

# Full dumps: keep the most recent FULL_KEEP by time.
ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +$((FULL_KEEP + 1)) | xargs -r rm -f

# Small setup/logins dumps + configs: keep everything newer than LONG_DAYS.
for pat in "stratus_config_*.sql.gz" "panel_*.sql.gz" "forecast_*.sql.gz" "config_*.tar.gz"; do
    find "$BACKUP_DIR/daily" -maxdepth 1 -name "$pat" -type f -mtime +$LONG_DAYS -delete 2>/dev/null || true
done

# Weekly full dumps.
cd "$BACKUP_DIR/weekly" || true
ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +$((WEEKLY_KEEP + 1)) | xargs -r rm -f

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log "counts: full=$(ls -1 "$BACKUP_DIR"/daily/stratus_backup_*.sql.gz 2>/dev/null | wc -l) \
config=$(ls -1 "$BACKUP_DIR"/daily/stratus_config_*.sql.gz 2>/dev/null | wc -l) \
panel=$(ls -1 "$BACKUP_DIR"/daily/panel_*.sql.gz 2>/dev/null | wc -l) \
forecast=$(ls -1 "$BACKUP_DIR"/daily/forecast_*.sql.gz 2>/dev/null | wc -l) \
config_tar=$(ls -1 "$BACKUP_DIR"/daily/config_*.tar.gz 2>/dev/null | wc -l)"
log "total backup storage: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
log "steps ok=$ok fail=$fail"
log "Completed at $(date -Is)"
log ""
[ "$fail" -eq 0 ]
