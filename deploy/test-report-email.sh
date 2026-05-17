#!/bin/bash
set -e
PASS="8TLIxWAlJM85OrWfVAP4TBaX"
BASE="https://stratusweather.co.za"
JAR=/tmp/stratus-reports-jar
rm -f $JAR

echo "=== 1. Login ==="
curl -sk -c $JAR -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" $BASE/api/reports/auth
echo ""

echo "=== 2. List stations ==="
STATIONS=$(curl -sk -b $JAR $BASE/api/reports/stations)
echo "$STATIONS" | head -c 600
echo ""

# Pick first station id
FIRST_ID=$(echo "$STATIONS" | python3 -c "import sys,json; arr=json.load(sys.stdin); print(arr[0]['id'])")
echo "First station id: $FIRST_ID"

echo "=== 3. Create test schedule ==="
SCHED=$(curl -sk -b $JAR -X POST -H "Content-Type: application/json" -d "{
  \"name\": \"Test Email Delivery\",
  \"stationIds\": [$FIRST_ID],
  \"fields\": [\"temp_min\",\"temp_avg\",\"temp_max\",\"rainfall_total\",\"wind_speed_max\",\"lightning_strikes\"],
  \"recipients\": [\"esterhuizen2k@proton.me\"],
  \"frequency\": \"daily\",
  \"hour\": 8,
  \"enabled\": true
}" $BASE/api/reports/schedules)
echo "$SCHED"
SCHED_ID=$(echo "$SCHED" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "schedule id=$SCHED_ID"

echo "=== 4. Send now ==="
curl -sk -b $JAR -X POST $BASE/api/reports/schedules/$SCHED_ID/send-now
echo ""

echo "=== 5. Recent server logs (Reports + Email) ==="
docker logs --tail 60 stratus-app 2>&1 | grep -Ei 'report|email|mailersend' | tail -25 || true
