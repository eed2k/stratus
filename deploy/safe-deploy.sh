#!/bin/bash
# =============================================================================
# Stratus Safe Deploy Script
#
# Usage:
#   ./safe-deploy.sh                  # Rebuild & deploy (backs up the DB first)
#   ./safe-deploy.sh --client-only    # Swap in a new client build (no rebuild)
#   ./safe-deploy.sh --restart        # Just restart containers (backs up first)
#
# The database backup runs for the modes that can touch the database. It does
# NOT run for --client-only: replacing static assets cannot alter a row, and the
# dump took long enough to time out the SSH session it was being run over, which
# meant the safe path was the one people stopped using.
# --client-only takes a backup of the files it is about to replace instead,
# which is the thing that can actually go wrong there.
# =============================================================================

set -euo pipefail

APP_DIR="/opt/stratus"

# The compose file the live stack was ACTUALLY started from, per the
# com.docker.compose.project.config_files label on stratus-app.
#
# This used to point at $APP_DIR/deploy/docker-compose.prod.yml, which is not it.
# Compose derives its project name and project directory from the file it is
# given, so every compose command in this script addressed a project that has no
# containers and answered `no container found for service "stratus"`. All three
# modes were broken by it, not just one, and because the failure is a plain error
# rather than a wrong result it was easier to work around by hand than to notice.
#
# It also put the project directory in deploy/, where there is no .env, so every
# variable in the compose file resolved to an empty string.
COMPOSE_FILE="$APP_DIR/docker-compose.yml"

# The app container, addressed by name. container_name is fixed in the compose
# file, so this cannot drift with the project name the way `compose exec` does.
CONTAINER="stratus-app"
SERVICE="stratus"

BACKUP_DIR="$APP_DIR/backups/pre-deploy"
DATE=$(date +%Y-%m-%d_%H%M%S)
BACKUP_FILE=""

MODE="${1:---full}"

echo "========================================="
echo "[Deploy] Stratus Safe Deploy ($MODE)"
echo "[Deploy] $(date)"
echo "========================================="


backup_database() {
    mkdir -p "$BACKUP_DIR"
    # Load .env to get DATABASE_URL
    if [ -f "$APP_DIR/.env" ]; then
        export $(grep -v '^#' "$APP_DIR/.env" | grep DATABASE_URL | xargs)
    fi

    echo "[Deploy] Creating pre-deploy database backup..."
    BACKUP_FILE="stratus_backup_pre-deploy_${DATE}.sql.gz"

    if [ -n "${DATABASE_URL:-}" ] && command -v pg_dump &> /dev/null; then
        pg_dump "$DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
            | gzip > "$BACKUP_DIR/$BACKUP_FILE"
        BACKUP_SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
        echo "[Deploy] Backup saved: $BACKUP_FILE ($BACKUP_SIZE)"
    else
        echo "[Deploy] WARNING: Could not create backup (pg_dump not found or no DATABASE_URL)"
        BACKUP_FILE=""
    fi

    # Keep only the last 5 pre-deploy backups
    ( cd "$BACKUP_DIR" && ls -1t stratus_backup_*.sql.gz 2>/dev/null | tail -n +6 | xargs -r rm -f )
}


# -----------------------------------------------------------------------------
# Client asset swap, run inside the container.
#
# The old version did `rm -rf dist` and then extracted the local build over the
# top. Anything living in the deployed dist that the build does not produce was
# destroyed by that, silently, and two files are in exactly that position:
# embed-example.html and landing.html are maintained on the server and are not
# build outputs. They were lost on every client deploy and had to be restored by
# hand afterwards, which is why this script stopped being the way deploys were
# done.
#
# So: stage the new build, carry forward any file the new build does not contain,
# then swap. Written generically rather than naming those two files, because the
# next hand-placed file would hit the same fault and nobody would think to add it
# to a list.
# -----------------------------------------------------------------------------
read -r -d '' CLIENT_SWAP <<'EOS' || true
set -eu
cd /app/client
STAMP=$(date +%Y-%m-%d_%H%M%S)

if [ ! -d dist ]; then
    echo "  no existing dist, nothing to preserve"
    mkdir -p /tmp/stage && rm -rf /tmp/stage/dist
    tar -xzf /tmp/client_dist.tar.gz -C /tmp/stage
    mv /tmp/stage/dist dist
    exit 0
fi

# Rollback point for the files about to be replaced.
tar -czf "/tmp/dist_before_$STAMP.tar.gz" dist
echo "  rollback point: /tmp/dist_before_$STAMP.tar.gz"

rm -rf /tmp/stage
mkdir -p /tmp/stage
tar -xzf /tmp/client_dist.tar.gz -C /tmp/stage

# Carry forward whatever the new build does not contain, EXCEPT under assets/.
#
# assets/ is Vite's content-hashed output: every file in it is named after a hash
# of its own contents, so a name the new build does not produce is by definition
# last build's chunk and not something anybody placed there. Preserving those
# carried 63 dead bundles forward on the first run of this and would have added
# another set on every deploy after it.
#
# Everything else is fair game, which is what protects embed-example.html and
# landing.html - and anything else hand-placed later, without needing a list.
cd dist
find . -type f ! -path './assets/*' | while IFS= read -r f; do
    if [ ! -e "/tmp/stage/dist/$f" ]; then
        mkdir -p "/tmp/stage/dist/$(dirname "$f")"
        cp -p "$f" "/tmp/stage/dist/$f"
        echo "  preserved: ${f#./}"
    fi
done
# Say what is being dropped, so a build that silently stopped emitting something
# is visible rather than just absent.
dropped=$(find assets -type f 2>/dev/null | while IFS= read -r f; do
    [ -e "/tmp/stage/dist/$f" ] || echo "$f"
done | wc -l)
echo "  superseded asset bundles dropped: $dropped"
cd /app/client

rm -rf dist
mv /tmp/stage/dist dist
rm -rf /tmp/stage
echo "  dist replaced, $(find dist -type f | wc -l) file(s) in place"
EOS


case "$MODE" in
    --client-only)
        echo "[Deploy] Deploying client files only (no rebuild, no DB backup)..."
        if [ ! -f /tmp/client_dist.tar.gz ]; then
            echo "[Deploy] ERROR: /tmp/client_dist.tar.gz not found"
            echo "[Deploy] Build locally, then:"
            echo "[Deploy]   tar -czf client_dist.tar.gz -C client dist"
            echo "[Deploy]   scp client_dist.tar.gz <host>:/tmp/"
            exit 1
        fi
        docker cp /tmp/client_dist.tar.gz "$CONTAINER:/tmp/client_dist.tar.gz"
        docker exec -i "$CONTAINER" sh -c "$CLIENT_SWAP"
        echo "[Deploy] Client files updated"
        ;;
    --restart)
        backup_database
        echo "[Deploy] Restarting containers..."
        ( cd "$APP_DIR" && docker compose -f "$COMPOSE_FILE" restart "$SERVICE" )
        ;;
    --full|*)
        backup_database
        echo "[Deploy] Full rebuild & deploy..."
        # cd first: compose reads .env from the project directory, and $APP_DIR is
        # where it lives.
        ( cd "$APP_DIR" && docker compose -f "$COMPOSE_FILE" up -d --build "$SERVICE" )
        ;;
esac

# Wait for healthy
echo "[Deploy] Waiting for app to start..."
sleep 10

# Verify.
#
# 127.0.0.1, not localhost: inside this image localhost resolves to ::1 first and
# the app listens on IPv4 only, so the check answered "connection refused" on a
# perfectly healthy container and every deploy ended by reporting an error.
#
# The timeout is generous because this host also runs a scheduled pg_dump of the
# production database, and under that load a 5 second probe fails on an app that
# is fine.
echo "[Deploy] Verifying..."
HEALTH=$(docker exec -i "$CONTAINER" wget -q -T 25 -O- http://127.0.0.1:5000/api/health 2>/dev/null \
         || echo '{"status":"no answer from /api/health"}')
echo "[Deploy] Health: $HEALTH"

echo ""
echo "[Deploy] Complete!"
if [ -n "$BACKUP_FILE" ]; then
    echo "[Deploy] Database backup: $BACKUP_DIR/$BACKUP_FILE"
fi
