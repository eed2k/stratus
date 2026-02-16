#!/bin/bash
# =============================================================================
# Stratus Database Backup Script - Neon PostgreSQL
# Automated backup with daily + weekly rotation
#
# Schedule: Run via cron (every 6 hours)
#   0 */6 * * * /opt/stratus/deploy/backup.sh >> /opt/stratus/backups/backup.log 2>&1
#
# Keeps:
#   - Last 7 daily backups
#   - Last 4 weekly backups (every Sunday)
# =============================================================================

set -uo pipefail

# Configuration
BACKUP_DIR="/opt/stratus/backups"
ENV_FILE="/opt/stratus/.env"
MAX_DAILY=7
MAX_WEEKLY=4
DATE=$(date +%Y-%m-%d_%H%M%S)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday

# Load DATABASE_URL from .env
if [ -f "$ENV_FILE" ]; then
    DB_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
fi

if [ -z "${DB_URL:-}" ]; then
    echo "[Backup] ERROR: DATABASE_URL not set in $ENV_FILE"
    exit 1
fi

# Ensure backup directories exist
mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly" "$BACKUP_DIR/pre-deploy"

echo "========================================="
echo "[Backup] Starting at $(date)"
echo "========================================="

# Create backup using pg_dump via a temporary PostgreSQL 17 container
# This avoids version mismatch with Neon (which runs PG 17)
BACKUP_FILE="stratus_backup_${DATE}.sql.gz"
echo "[Backup] Creating backup: $BACKUP_FILE"

# Pull image quietly first to avoid stderr in backup
docker pull postgres:17-alpine -q > /dev/null 2>&1

docker run --rm \
    --network host \
    postgres:17-alpine \
    pg_dump "$DB_URL" \
    --clean --if-exists \
    --no-owner --no-privileges \
    | gzip > "$BACKUP_DIR/daily/$BACKUP_FILE"

# Verify backup is not empty
BACKUP_SIZE=$(du -h "$BACKUP_DIR/daily/$BACKUP_FILE" | cut -f1)
BACKUP_BYTES=$(stat -c%s "$BACKUP_DIR/daily/$BACKUP_FILE" 2>/dev/null)
BACKUP_BYTES=${BACKUP_BYTES:-0}

if [ "$BACKUP_BYTES" -lt 1000 ]; then
    echo "[Backup] ERROR: Backup file is too small ($BACKUP_SIZE / $BACKUP_BYTES bytes)"
    echo "[Backup] pg_dump may have failed. Check network/credentials."
    exit 1
fi

echo "[Backup] Daily backup complete: $BACKUP_FILE ($BACKUP_SIZE)"

# If Sunday, copy to weekly backups
if [ "$DAY_OF_WEEK" -eq 7 ]; then
    cp "$BACKUP_DIR/daily/$BACKUP_FILE" "$BACKUP_DIR/weekly/$BACKUP_FILE"
    echo "[Backup] Weekly backup saved"
fi

# Rotate daily backups - keep last N
cd "$BACKUP_DIR/daily"
DAILY_FILES=$(ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +$((MAX_DAILY + 1)))
if [ -n "$DAILY_FILES" ]; then
    echo "$DAILY_FILES" | xargs rm -f
fi
DAILY_COUNT=$(ls -1 stratus_backup_*.sql.gz 2>/dev/null | wc -l)
echo "[Backup] Daily backups retained: $DAILY_COUNT"

# Rotate weekly backups - keep last N
cd "$BACKUP_DIR/weekly"
WEEKLY_FILES=$(ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +$((MAX_WEEKLY + 1)))
if [ -n "$WEEKLY_FILES" ]; then
    echo "$WEEKLY_FILES" | xargs rm -f
fi
WEEKLY_COUNT=$(ls -1 stratus_backup_*.sql.gz 2>/dev/null | wc -l)
echo "[Backup] Weekly backups retained: $WEEKLY_COUNT"

# Summary
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo "[Backup] Total backup storage: $TOTAL_SIZE"
echo "[Backup] Completed at $(date)"
echo ""
