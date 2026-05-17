#!/bin/bash
set -e
PASS="8TLIxWAlJM85OrWfVAP4TBaX"
JAR=/tmp/stratus-jar
rm -f $JAR
echo "--- login ---"
curl -sk -c $JAR -X POST -H "Content-Type: application/json" -d "{\"password\":\"$PASS\"}" https://stratusweather.co.za/api/reports/auth
echo ""
echo "--- send-demo ---"
curl -sk -b $JAR -X POST -H "Content-Type: application/json" \
  -d '{"recipients":["esterhuizen2k@proton.me"]}' \
  https://stratusweather.co.za/api/reports/send-demo
echo ""
echo "--- logs ---"
docker logs --tail 30 stratus-app 2>&1 | grep -Ei 'reports|email|mailersend|error' | tail -15
