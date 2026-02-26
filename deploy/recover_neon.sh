#!/bin/bash
# Try to recover any missing data from Neon DB
# Run this when Neon quota resets (usually start of billing period)
# Usage: NEON_URL="postgresql://..." ./recover_neon.sh

if [ -z "$NEON_URL" ]; then
    echo "ERROR: Set NEON_URL environment variable"
    echo "  export NEON_URL='postgresql://user:password@host/db?sslmode=require'"
    exit 1
fi
LOCAL_DUMP="/opt/stratus/backups/neon_recovery_$(date +%Y%m%d_%H%M%S).sql.gz"

echo "=== Attempting Neon DB recovery ==="
echo "Testing connection..."

# Test connection first
docker run --rm postgres:17-alpine psql "$NEON_URL" -c "SELECT 1" 2>&1
if [ $? -ne 0 ]; then
    echo "ERROR: Cannot connect to Neon. Quota may still be exceeded."
    exit 1
fi

echo "Connection OK! Dumping Neon database..."
docker run --rm postgres:17-alpine pg_dump "$NEON_URL" --clean --if-exists --no-owner --no-privileges | gzip > "$LOCAL_DUMP"

SIZE=$(du -h "$LOCAL_DUMP" | cut -f1)
echo "Neon dump saved: $LOCAL_DUMP ($SIZE)"
echo ""
echo "To restore into local postgres, run:"
echo "  cd /opt/stratus"
echo "  docker compose stop stratus"
echo "  docker exec stratus-postgres psql -U stratus -d postgres -c 'DROP DATABASE stratus'"
echo "  docker exec stratus-postgres psql -U stratus -d postgres -c 'CREATE DATABASE stratus OWNER stratus'"
echo "  zcat $LOCAL_DUMP | docker exec -i stratus-postgres psql -U stratus -d stratus"
echo "  docker compose up -d stratus"
