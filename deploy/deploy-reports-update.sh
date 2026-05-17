#!/bin/bash
set -e
HOST_BASE=/opt/stratus
TGZ=/tmp/reports-update.tgz
WORK=/tmp/reports-update
rm -rf $WORK
mkdir -p $WORK/server $WORK/client
cd $WORK
# Extract: tar created with -C dist server (-> ./server) and -C client/dist . (-> ./assets, ./index.html, etc)
mkdir -p extracted
tar -xzf $TGZ -C extracted
echo "=== Extracted layout ==="
ls extracted

echo "=== 1. Copy server files into container ==="
docker cp extracted/server/services/reportRoutes.js          stratus-app:/app/dist/server/services/reportRoutes.js
docker cp extracted/server/services/reportSchedulerService.js stratus-app:/app/dist/server/services/reportSchedulerService.js

echo "=== 2. Mirror to host bind path ==="
cp extracted/server/services/reportRoutes.js          $HOST_BASE/dist/server/services/reportRoutes.js
cp extracted/server/services/reportSchedulerService.js $HOST_BASE/dist/server/services/reportSchedulerService.js

echo "=== 3. Push client bundle (atomic swap) ==="
docker exec stratus-app sh -c 'rm -rf /app/client/dist.new && mkdir -p /app/client/dist.new'
docker cp extracted/index.html  stratus-app:/app/client/dist.new/index.html
docker cp extracted/favicon.svg stratus-app:/app/client/dist.new/favicon.svg
docker cp extracted/robots.txt  stratus-app:/app/client/dist.new/robots.txt
docker cp extracted/assets      stratus-app:/app/client/dist.new/assets
docker exec stratus-app sh -c 'rm -rf /app/client/dist && mv /app/client/dist.new /app/client/dist'

rm -rf $HOST_BASE/client/dist.new
mkdir -p $HOST_BASE/client/dist.new
cp -r extracted/index.html extracted/favicon.svg extracted/robots.txt extracted/assets $HOST_BASE/client/dist.new/
rm -rf $HOST_BASE/client/dist
mv $HOST_BASE/client/dist.new $HOST_BASE/client/dist

echo "=== 4. Verify before restart ==="
docker exec stratus-app sh -c "grep -c 'buildDemoLightningReport' /app/dist/server/services/reportRoutes.js"
docker exec stratus-app sh -c "grep -c 'buildDemoLightningReport' /app/dist/server/services/reportSchedulerService.js"

echo "=== 5. Restart ==="
docker restart stratus-app
sleep 14

echo "=== 6. Health ==="
curl -sk https://stratusweather.co.za/api/health
echo ""
curl -sk https://stratusweather.co.za/api/reports/auth
echo ""

echo "=== 7. Login + send demo to esterhuizen2k@proton.me ==="
PASS="8TLIxWAlJM85OrWfVAP4TBaX"
JAR=/tmp/stratus-jar
rm -f $JAR
curl -sk -c $JAR -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" https://stratusweather.co.za/api/reports/auth
echo ""
curl -sk -b $JAR -X POST -H "Content-Type: application/json" \
  -d '{"recipients":["esterhuizen2k@proton.me"]}' \
  https://stratusweather.co.za/api/reports/send-demo
echo ""

echo "=== 8. Recent log ==="
docker logs --tail 30 stratus-app 2>&1 | grep -Ei 'reports|email|mailersend|error' | tail -15 || true
