#!/bin/bash
# Trigger sync for Skaapdam station

cd /root/stratus

# Get the cookie
COOKIE=$(cat /tmp/cookie.txt | grep connect.sid | awk '{print $6"="$7}')

echo "Triggering sync for Skaapdam..."
curl -s -X POST "http://localhost:3000/api/dropbox-sync/configs/3/sync" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE"

echo ""
echo "Checking station data..."
curl -s "http://localhost:3000/api/stations/3" \
  -H "Cookie: $COOKIE" | head -c 500

echo ""
echo ""
echo "Config status:"
curl -s "http://localhost:3000/api/dropbox-sync/configs/3" \
  -H "Cookie: $COOKIE"
