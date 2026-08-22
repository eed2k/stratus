#!/usr/bin/env bash
#
# Install a scheduled daily database backup for the Lightning Alert panel.
# Creates a cron job that runs deploy/backup.sh every day at 02:10 server
# time and logs to deploy/backups/backup.log.
#
# Run ON THE VPS once:
#   sudo bash deploy/INSTALL_BACKUP.sh
#
set -euo pipefail

PANEL_DIR="${PANEL_DIR:-/opt/lightning-panel}"
CRON_FILE="/etc/cron.d/lightning-panel-backup"

[ -d "$PANEL_DIR" ] || { echo "Panel dir $PANEL_DIR not found"; exit 1; }
chmod +x "$PANEL_DIR/deploy/backup.sh"
mkdir -p "$PANEL_DIR/deploy/backups"

cat > "$CRON_FILE" <<EOF
# Lightning Alert panel - daily database backup (server local time).
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
10 2 * * * root PANEL_DIR=$PANEL_DIR bash $PANEL_DIR/deploy/backup.sh >> $PANEL_DIR/deploy/backups/backup.log 2>&1
EOF

chmod 0644 "$CRON_FILE"
# Reload cron so the new file is picked up immediately.
if command -v systemctl >/dev/null 2>&1; then
  systemctl restart cron 2>/dev/null || systemctl restart crond 2>/dev/null || true
fi

echo "Installed daily backup cron: $CRON_FILE"
echo "Running one backup now to verify..."
PANEL_DIR="$PANEL_DIR" bash "$PANEL_DIR/deploy/backup.sh"
echo
echo "Done. Backups are in $PANEL_DIR/deploy/backups (kept 30 days)."
echo "Log: $PANEL_DIR/deploy/backups/backup.log"
