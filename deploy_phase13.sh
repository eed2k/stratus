#!/bin/bash
set -e
cd /opt/stratus
echo "=== Building image with --no-cache ==="
docker compose build --no-cache stratus
echo "=== Recreating container ==="
docker compose up -d --force-recreate stratus
echo "=== Verifying bundle ==="
sleep 5
docker exec stratus-app sh -c 'ls -la /app/client/dist/assets/SolarPositionCard*.js 2>/dev/null && grep -oE "compassSky|earthDisc" /app/client/dist/assets/SolarPositionCard*.js | head -5'
docker exec stratus-app sh -c 'ls -la /app/client/dist/assets/Dashboard*.js 2>/dev/null && grep -oE "ETo vs Rainfall" /app/client/dist/assets/Dashboard*.js | head -5'
docker exec stratus-app sh -c 'grep -oE "ETo vs Rainfall" /app/client/dist/assets/SharedDashboard*.js | head -5'
echo "=== Done ==="
