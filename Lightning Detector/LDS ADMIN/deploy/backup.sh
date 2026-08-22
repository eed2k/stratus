#!/usr/bin/env bash
#
# Database backup for the Lightning Alert admin panel.
#
# Works for the default SQLite database (./data/panel.db on the VPS volume)
# and for Postgres (Neon) if DATABASE_URL is switched later. Produces a
# timestamped, gzipped backup under deploy/backups and prunes old ones.
#
# Run manually:
#   sudo bash deploy/backup.sh
# Scheduled automatically by deploy/INSTALL_BACKUP.sh (daily 02:10 SAST).
#
set -euo pipefail

# ----------------------------------------------------------------- settings
PANEL_DIR="${PANEL_DIR:-/opt/lightning-panel}"
CONTAINER="${CONTAINER:-lightning-alert-panel}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"     # keep this many days of backups
BACKUP_DIR="${BACKUP_DIR:-$PANEL_DIR/deploy/backups}"

cd "$PANEL_DIR"

say()  { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[fail]\033[0m %s\n' "$*"; exit 1; }

[ -f .env ] || die "No .env in $PANEL_DIR"
DB_URL="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2- || true)"
[ -n "$DB_URL" ] || die "DATABASE_URL not set in .env"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

case "$DB_URL" in
  sqlite:*)
    OUT="$BACKUP_DIR/panel-$STAMP.sqlite.gz"
    say "SQLite hot backup -> $OUT"
    # Use the SAME sqlite engine inside the container for a consistent online
    # backup (handles WAL correctly), then stream it out and gzip on the host.
    docker exec "$CONTAINER" python -c "import sqlite3; s=sqlite3.connect('/app/data/panel.db'); d=sqlite3.connect('/app/data/_backup.tmp'); s.backup(d); d.close(); s.close()"
    docker exec "$CONTAINER" cat /app/data/_backup.tmp | gzip -9 > "$OUT"
    docker exec "$CONTAINER" rm -f /app/data/_backup.tmp
    ;;
  postgres:*|postgresql:*)
    OUT="$BACKUP_DIR/panel-$STAMP.sql.gz"
    say "Postgres dump -> $OUT"
    if command -v pg_dump >/dev/null 2>&1; then
      pg_dump "$DB_URL" | gzip -9 > "$OUT"
    else
      # Fall back to a throwaway postgres client container.
      docker run --rm postgres:16 pg_dump "$DB_URL" | gzip -9 > "$OUT"
    fi
    ;;
  *)
    die "Unsupported DATABASE_URL: $DB_URL"
    ;;
esac

# ----------------------------------------------------------------- verify
[ -s "$OUT" ] || die "Backup file is empty: $OUT"
SIZE="$(du -h "$OUT" | cut -f1)"
say "Backup OK ($SIZE): $OUT"

# ----------------------------------------------------------------- prune
say "Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name 'panel-*.gz' -type f -mtime +"$RETENTION_DAYS" -print -delete || true

say "Current backups:"
ls -1t "$BACKUP_DIR"/panel-*.gz 2>/dev/null | head -n 10 || true
