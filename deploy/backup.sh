#!/bin/bash
# =============================================================================
# Stratus Database Backup Script
# Automated PostgreSQL backup with daily + weekly rotation
# Works with both local and managed (Vultr) PostgreSQL
# 
# Schedule: Run via cron (recommended: every 6 hours)
#   0 */6 * * * /opt/stratus/deploy/backup.sh >> /opt/stratus/backups/backup.log 2>&1
#
# Keeps:
#   - Last 7 daily backups
#   - Last 4 weekly backups (every Sunday)
#   - Last backup before any container rebuild (manual trigger)
# =============================================================================

set -uo pipefail

# Configuration
APP_DIR="/opt/stratus"
BACKUP_DIR="/opt/stratus/backups"
MAX_DAILY=7
MAX_WEEKLY=4
DATE=$(date +%Y-%m-%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday

# Load .env to get DATABASE_URL
if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | grep DATABASE_URL | xargs)
fi

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/pre-deploy"

echo "========================================="
echo "[Backup] Starting at $(date)"
echo "========================================="

if [ -z "${DATABASE_URL:-}" ]; then
    echo "[Backup] ERROR: DATABASE_URL not set! Check .env file."
    exit 1
fi

# Create backup using pg_dump with DATABASE_URL (works for both local and managed DB)
BACKUP_FILE="stratus_backup_${DATE}.sql.gz"
echo "[Backup] Creating backup: $BACKUP_FILE"

# Use docker exec to run pg_dump inside the stratus container (it has psql-compatible tools)
# Or use pg_dump directly if installed on host
if command -v pg_dump &> /dev/null; then
    pg_dump "$DATABASE_URL" \
        --clean --if-exists \
        --no-owner --no-privileges \
        | gzip > "$BACKUP_DIR/daily/$BACKUP_FILE"
else
    # Fallback: run pg_dump inside the stratus container
    COMPOSE_FILE="$APP_DIR/deploy/docker-compose.prod.yml"
    docker compose -f "$COMPOSE_FILE" exec -T -e DATABASE_URL="$DATABASE_URL" stratus \
        sh -c 'apk add --no-cache postgresql-client > /dev/null 2>&1; pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges' \
        | gzip > "$BACKUP_DIR/daily/$BACKUP_FILE"
fi

BACKUP_SIZE=$(du -h "$BACKUP_DIR/daily/$BACKUP_FILE" | cut -f1)
echo "[Backup] Daily backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# If Sunday, copy to weekly backups
if [ "$DAY_OF_WEEK" -eq 7 ]; then
    cp "$BACKUP_DIR/daily/$BACKUP_FILE" "$BACKUP_DIR/weekly/$BACKUP_FILE"
    echo "[Backup] Weekly backup saved"
fi

# Rotate daily backups - keep last N
cd "$BACKUP_DIR/daily"
ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +$((MAX_DAILY + 1)) | xargs -r rm -f
DAILY_COUNT=$(ls -1 stratus_backup_*.sql.gz 2>/dev/null | wc -l || true)
echo "[Backup] Daily backups retained: $DAILY_COUNT"

# Rotate weekly backups - keep last N
cd "$BACKUP_DIR/weekly"
ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +$((MAX_WEEKLY + 1)) | xargs -r rm -f
WEEKLY_COUNT=$(ls -1 stratus_backup_*.sql.gz 2>/dev/null | wc -l || true)
echo "[Backup] Weekly backups retained: $WEEKLY_COUNT"

# Summary
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "[Backup] Total backup storage: $TOTAL_SIZE"
echo "[Backup] Completed at $(date)"
echo ""
