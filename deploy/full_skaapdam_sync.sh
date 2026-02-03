#!/bin/bash
# Full setup - login and sync

cd /root/stratus

echo "Logging in..."
curl -s -c /tmp/cookie.txt -X POST "http://localhost:3000/api/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"esterhuizen2k@proton.me","password":"Stratus@2025!"}'

echo ""

COOKIE=$(cat /tmp/cookie.txt | grep connect.sid | awk '{print $6"="$7}')
echo "Cookie: $COOKIE"

echo ""
echo "Triggering sync for Skaapdam (config 3)..."
SYNC_RESULT=$(curl -s -X POST "http://localhost:3000/api/dropbox-sync/configs/3/sync" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE")
echo "$SYNC_RESULT"

echo ""
echo "Waiting 5 seconds for sync..."
sleep 5

echo ""
echo "Config status after sync:"
curl -s "http://localhost:3000/api/dropbox-sync/configs/3" \
  -H "Cookie: $COOKIE" | python3 -m json.tool

echo ""
echo "Station 3 data count:"
curl -s "http://localhost:3000/api/stations/3/data?limit=5" \
  -H "Cookie: $COOKIE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Total records: {len(d.get(\"data\", d))}')" 2>/dev/null || echo "No data yet"
