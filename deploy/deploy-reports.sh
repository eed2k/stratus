#!/bin/bash
set -e
STAGE=/tmp/stratus-reports-deploy/dist
HOST_BASE=/opt/stratus
PASS="8TLIxWAlJM85OrWfVAP4TBaX"
TS=$(date +%s)
COMPOSE=$HOST_BASE/docker-compose.yml

echo "==> 1. Ensure REPORTS_PASSWORD is in $HOST_BASE/.env"
ENVF=$HOST_BASE/.env
touch $ENVF
grep -v '^REPORTS_PASSWORD=' $ENVF > $ENVF.new || true
echo "REPORTS_PASSWORD=$PASS" >> $ENVF.new
mv $ENVF.new $ENVF
chmod 600 $ENVF
grep '^REPORTS_PASSWORD' $ENVF

echo "==> 2. Patch docker-compose.yml to inject REPORTS_PASSWORD into stratus service"
if grep -q 'REPORTS_PASSWORD=' $COMPOSE; then
  echo "  already present, skipping"
else
  cp $COMPOSE $COMPOSE.bak.$TS
  sed -i '/MAILERSEND_API_KEY=\${MAILERSEND_API_KEY}/a\      - REPORTS_PASSWORD=${REPORTS_PASSWORD}' $COMPOSE
  echo "  patched."
  grep -n 'REPORTS_PASSWORD\|MAILERSEND_API_KEY' $COMPOSE | head -5
fi

echo "==> 3. Recreate the container so the new env var is injected"
cd $HOST_BASE
docker compose up -d --force-recreate --no-deps stratus 2>&1 | tail -10
sleep 8

echo "==> 4. Verify env var is inside container"
docker exec stratus-app printenv REPORTS_PASSWORD || echo "MISSING IN CONTAINER"

echo "==> 5. docker cp new code AFTER recreate so writable layer keeps it"
docker cp $STAGE/server/services/reportRoutes.js          stratus-app:/app/dist/server/services/reportRoutes.js
docker cp $STAGE/server/services/reportSchedulerService.js stratus-app:/app/dist/server/services/reportSchedulerService.js
docker cp $STAGE/server/db-postgres.js                    stratus-app:/app/dist/server/db-postgres.js
docker cp $STAGE/server/index.js                          stratus-app:/app/dist/server/index.js
docker cp $STAGE/server/routes.js                         stratus-app:/app/dist/server/routes.js

echo "==> 6. Mirror to host bind path"
mkdir -p $HOST_BASE/dist/server/services
cp $STAGE/server/services/reportRoutes.js          $HOST_BASE/dist/server/services/reportRoutes.js
cp $STAGE/server/services/reportSchedulerService.js $HOST_BASE/dist/server/services/reportSchedulerService.js
cp $STAGE/server/db-postgres.js                    $HOST_BASE/dist/server/db-postgres.js
cp $STAGE/server/index.js                          $HOST_BASE/dist/server/index.js
cp $STAGE/server/routes.js                         $HOST_BASE/dist/server/routes.js

echo "==> 7. Push client bundle (atomic swap)"
docker exec stratus-app sh -c 'rm -rf /app/client/dist.new && mkdir -p /app/client/dist.new'
docker cp $STAGE/index.html  stratus-app:/app/client/dist.new/index.html
docker cp $STAGE/favicon.svg stratus-app:/app/client/dist.new/favicon.svg
docker cp $STAGE/robots.txt  stratus-app:/app/client/dist.new/robots.txt
docker cp $STAGE/assets      stratus-app:/app/client/dist.new/assets
docker exec stratus-app sh -c 'rm -rf /app/client/dist && mv /app/client/dist.new /app/client/dist'

rm -rf $HOST_BASE/client/dist.new
mkdir -p $HOST_BASE/client/dist.new
cp -r $STAGE/index.html $STAGE/favicon.svg $STAGE/robots.txt $STAGE/assets $HOST_BASE/client/dist.new/
rm -rf $HOST_BASE/client/dist
mv $HOST_BASE/client/dist.new $HOST_BASE/client/dist

echo "==> 8. Verify code in container BEFORE restart"
docker exec stratus-app sh -c "grep -c reportRoutes /app/dist/server/routes.js"
docker exec stratus-app sh -c "grep -c initReportScheduler /app/dist/server/index.js"

echo "==> 9. Restart container (preserves writable layer)"
docker restart stratus-app
sleep 12

echo "==> 10. Verify"
curl -sk https://stratusweather.co.za/api/health
echo ""
curl -sk https://stratusweather.co.za/api/reports/auth
echo ""

echo "==> 11. Filtered logs"
docker logs --tail 80 stratus-app 2>&1 | grep -Ei 'report|cron|scheduler|error|listen' | tail -25 || true

echo "==> Done."
