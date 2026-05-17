#!/bin/bash
set -e
docker stop stratus-app || true
sleep 2
docker start stratus-app
sleep 3
echo "=== ownership of /app/dist/server ==="
docker exec -u 0 stratus-app ls -ld /app/dist/server
docker exec -u 0 stratus-app ls -ld /app/dist/server/services
echo "=== fix permissions ==="
OWNER=$(docker exec -u 0 stratus-app stat -c '%u:%g' /app/dist/server/services)
echo "owner=$OWNER"
docker exec -u 0 stratus-app sh -c "chown -R $OWNER /app/dist/server/config && chmod -R a+rX /app/dist/server/config"
docker exec -u 0 stratus-app ls -la /app/dist/server/config
echo "=== restart ==="
docker restart stratus-app
sleep 12
echo "=== health ==="
curl -sk https://stratusweather.co.za/api/health
echo ""
curl -sk https://stratusweather.co.za/api/reports/auth
echo ""
docker logs --tail 60 stratus-app 2>&1 | grep -Ei 'report|scheduler|error|listen|ready' | tail -25 || true
