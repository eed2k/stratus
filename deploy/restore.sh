#!/bin/bash
# =============================================================================
# Stratus Database Restore Script
# Works with Vultr Managed PostgreSQL (external DB)
#
# Usage:
#   ./restore.sh                          # List available backups
#   ./restore.sh <backup_file>            # Restore specific backup
#   ./restore.sh latest                   # Restore most recent backup
#
# Requires: postgresql-client (apt install postgresql-client)
# =============================================================================

set -euo pipefail

APP_DIR="/opt/stratus"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
BACKUP_DIR="$APP_DIR/backups"

# Load .env to get DATABASE_URL
if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | grep DATABASE_URL | xargs)
fi

if [ -z "${DATABASE_URL:-}" ]; then
    echo "ERROR: DATABASE_URL not set! Check .env file."
    exit 1
fi

# List available backups
list_backups() {
    echo "=== Available Backups ==="
    echo ""
    echo "--- Daily ---"
    if [ -d "$BACKUP_DIR/daily" ]; then
        ls -lh "$BACKUP_DIR/daily"/stratus_backup_*.sql.gz 2>/dev/null | awk '{print NR". "$NF, "("$5")", $6, $7, $8}' || echo "  (none)"
    fi
    echo ""
    echo "--- Weekly ---"
    if [ -d "$BACKUP_DIR/weekly" ]; then
        ls -lh "$BACKUP_DIR/weekly"/stratus_backup_*.sql.gz 2>/dev/null | awk '{print NR". "$NF, "("$5")", $6, $7, $8}' || echo "  (none)"
    fi
    echo ""
    echo "--- Pre-Deploy ---"
    if [ -d "$BACKUP_DIR/pre-deploy" ]; then
        ls -lh "$BACKUP_DIR/pre-deploy"/stratus_backup_*.sql.gz 2>/dev/null | awk '{print NR". "$NF, "("$5")", $6, $7, $8}' || echo "  (none)"
    fi
    echo ""
}

# Find backup file
find_backup() {
    local query="$1"
    
    if [ "$query" = "latest" ]; then
        find "$BACKUP_DIR" -name "stratus_backup_*.sql.gz" -type f | sort -r | head -1
    elif [ -f "$query" ]; then
        echo "$query"
    elif [ -f "$BACKUP_DIR/daily/$query" ]; then
        echo "$BACKUP_DIR/daily/$query"
    elif [ -f "$BACKUP_DIR/weekly/$query" ]; then
        echo "$BACKUP_DIR/weekly/$query"
    elif [ -f "$BACKUP_DIR/pre-deploy/$query" ]; then
        echo "$BACKUP_DIR/pre-deploy/$query"
    else
        echo ""
    fi
}

# No arguments - list backups
if [ $# -eq 0 ]; then
    list_backups
    echo "Usage: $0 <backup_file|latest>"
    exit 0
fi

BACKUP_PATH=$(find_backup "$1")

if [ -z "$BACKUP_PATH" ]; then
    echo "ERROR: Backup file not found: $1"
    echo ""
    list_backups
    exit 1
fi

echo "========================================="
echo "[Restore] Stratus Database Restore"
echo "========================================="
echo "Backup file: $BACKUP_PATH"
echo "Size: $(du -h "$BACKUP_PATH" | cut -f1)"
echo ""

# Safety: create a backup of current state before restoring
echo "[Restore] Creating safety backup of current database..."
SAFETY_FILE="stratus_backup_pre-restore_$(date +%Y-%m-%d_%H%M%S).sql.gz"
mkdir -p "$BACKUP_DIR/pre-deploy"

# Use Docker postgres:17 container (same as backup script) to avoid version mismatch
docker pull postgres:17-alpine -q > /dev/null 2>&1
docker run --rm \
    --network host \
    postgres:17-alpine \
    pg_dump "$DATABASE_URL" \
    --clean --if-exists \
    --no-owner --no-privileges \
    | gzip > "$BACKUP_DIR/pre-deploy/$SAFETY_FILE"

SAFETY_SIZE=$(du -h "$BACKUP_DIR/pre-deploy/$SAFETY_FILE" | cut -f1)
SAFETY_BYTES=$(stat -c%s "$BACKUP_DIR/pre-deploy/$SAFETY_FILE" 2>/dev/null)
if [ "${SAFETY_BYTES:-0}" -lt 1000 ]; then
    echo "[Restore] WARNING: Safety backup seems too small ($SAFETY_SIZE). Aborting restore."
    exit 1
fi
echo "[Restore] Safety backup saved: $SAFETY_FILE ($SAFETY_SIZE)"

# Confirm
echo ""
echo "WARNING: This will REPLACE all current data with the backup."
read -p "Type 'RESTORE' to confirm: " confirm
if [ "$confirm" != "RESTORE" ]; then
    echo "[Restore] Cancelled."
    exit 0
fi

# Stop the stratus app to prevent writes during restore
echo "[Restore] Stopping stratus app..."
docker compose -f "$COMPOSE_FILE" stop stratus

# Restore using Docker postgres:17 container (matches Neon PG version)
echo "[Restore] Restoring database from backup..."
gunzip -c "$BACKUP_PATH" | docker run --rm -i \
    --network host \
    postgres:17-alpine \
    psql "$DATABASE_URL" --quiet

echo "[Restore] Database restored successfully!"

# Restart the app
echo "[Restore] Starting stratus app..."
docker compose -f "$COMPOSE_FILE" start stratus

# Verify
sleep 5
echo "[Restore] Verifying..."
docker run --rm \
    --network host \
    postgres:17-alpine \
    psql "$DATABASE_URL" -c "
    SELECT 'Users' as table_name, COUNT(*) as count FROM users
    UNION ALL
    SELECT 'Stations', COUNT(*) FROM stations
    UNION ALL
    SELECT 'Weather Data', COUNT(*) FROM weather_data
    UNION ALL
    SELECT 'Alarms', COUNT(*) FROM alarms
    ORDER BY table_name;
    "

echo ""
echo "[Restore] Complete! Check https://stratusweather.co.za to verify."
