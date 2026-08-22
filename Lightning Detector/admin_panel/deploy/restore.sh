#!/usr/bin/env bash
#
# Restore the Lightning Alert panel database from a backup made by backup.sh.
#
# SQLite usage (default deployment):
#   sudo bash deploy/restore.sh deploy/backups/panel-YYYYMMDD-HHMMSS.sqlite.gz
#
# This stops the panel, replaces data/panel.db, then starts it again.
# A safety copy of the current DB is saved first.
#
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/lightning-panel}"
CONTAINER="${CONTAINER:-lightning-alert-panel}"
cd "$PANEL_DIR"

SRC="${1:-}"
[ -n "$SRC" ] || { echo "Usage: bash deploy/restore.sh <backup-file.sqlite.gz>"; exit 1; }
[ -f "$SRC" ] || { echo "Backup file not found: $SRC"; exit 1; }

DB_URL="$(grep -E '^DATABASE_URL=' .env | head -n1 | cut -d= -f2- || true)"
case "$DB_URL" in
  sqlite:*) : ;;
  *) echo "This script restores SQLite only. Current DATABASE_URL=$DB_URL"; exit 1 ;;
esac

echo "==> Stopping panel"
docker compose stop panel 2>/dev/null || docker stop "$CONTAINER" 2>/dev/null || true

if [ -f data/panel.db ]; then
  SAFETY="data/panel.db.before-restore-$(date +%Y%m%d-%H%M%S)"
  cp data/panel.db "$SAFETY"
  echo "==> Saved current DB to $SAFETY"
fi

echo "==> Restoring $SRC -> data/panel.db"
gunzip -c "$SRC" > data/panel.db

echo "==> Starting panel"
docker compose up -d panel 2>/dev/null || docker start "$CONTAINER" 2>/dev/null || true

echo "Done. Verify the panel loads and events/recipients look correct."
