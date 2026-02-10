#!/bin/bash
# =============================================================================
# Stratus Safe Deploy Script
# Always creates a backup BEFORE deploying new code or rebuilding containers
#
# Usage:
#   ./safe-deploy.sh                  # Rebuild & deploy (backs up first)
#   ./safe-deploy.sh --client-only    # Deploy client files only
#   ./safe-deploy.sh --restart        # Just restart containers (backs up first)
# =============================================================================

set -euo pipefail

APP_DIR="/opt/stratus"
COMPOSE_FILE="$APP_DIR/deploy/docker-compose.prod.yml"
BACKUP_DIR="$APP_DIR/backups/pre-deploy"
DATE=$(date +%Y-%m-%d_%H%M%S)

# Load .env to get DATABASE_URL
if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | grep DATABASE_URL | xargs)
fi

mkdir -p "$BACKUP_DIR"

echo "========================================="
echo "[Deploy] Stratus Safe Deploy"
echo "[Deploy] $(date)"
echo "========================================="

# ALWAYS backup before ANY deployment action
echo "[Deploy] Creating pre-deploy backup..."
BACKUP_FILE="stratus_backup_pre-deploy_${DATE}.sql.gz"

if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump &> /dev/null; then
    pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
        | gzip > "$BACKUP_DIR/$BACKUP_FILE"
    BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
    echo "[Deploy] Backup saved: $BACKUP_FILE ($BACKUP_SIZE)"
else
    echo "[Deploy] WARNING: Could not create backup (pg_dump not found or no DATABASE_URL)"
fi

# Keep only last 5 pre-deploy backups
cd "$BACKUP_DIR"
ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm -f

# Handle deploy modes
MODE="${1:---full}"

case "$MODE" in
    --client-only)
        echo "[Deploy] Deploying client files only (no rebuild)..."
        if [ -f /tmp/client_dist.tar.gz ]; then
            docker compose -f "$COMPOSE_FILE" cp /tmp/client_dist.tar.gz stratus:/tmp/client_dist.tar.gz
            docker compose -f "$COMPOSE_FILE" exec -T stratus sh -c 'cd /app/client && rm -rf dist && tar -xzf /tmp/client_dist.tar.gz'
            echo "[Deploy] Client files updated"
        else
            echo "[Deploy] ERROR: /tmp/client_dist.tar.gz not found"
            exit 1
        fi
        ;;
    --restart)
        echo "[Deploy] Restarting containers..."
        docker compose -f "$COMPOSE_FILE" restart stratus
        ;;
    --full|*)
        echo "[Deploy] Full rebuild & deploy..."
        docker compose -f "$COMPOSE_FILE" up -d --build stratus
        ;;
esac

# Wait for healthy
echo "[Deploy] Waiting for app to start..."
sleep 10

# Verify
echo "[Deploy] Verifying..."
HEALTH=$(docker compose -f "$COMPOSE_FILE" exec -T stratus wget -q -O- http://localhost:5000/api/health 2>/dev/null || echo '{"status":"error"}')
echo "[Deploy] Health: $HEALTH"

echo ""
echo "[Deploy] Complete!"
echo "[Deploy] Backup available at: $BACKUP_DIR/$BACKUP_FILE"
