#!/bin/bash
# Login and sync Skaapdam

cd /root/stratus

# Create login JSON
cat > /tmp/login.json << 'EOF'
{"email":"esterhuizen2k@proton.me","password":"Stratus@2025!"}
EOF

echo "Login JSON:"
cat /tmp/login.json

echo ""
echo "Logging in..."
RESULT=$(curl -s -c /tmp/cookies3.txt -b /tmp/cookies3.txt -X POST "http://localhost:5000/api/login" -H "Content-Type: application/json" -d @/tmp/login.json)
echo "$RESULT"

echo ""
echo "Triggering sync for config 3..."
SYNC_RESULT=$(curl -s -b /tmp/cookies3.txt -X POST "http://localhost:5000/api/dropbox-sync/configs/3/sync" -H "Content-Type: application/json")
echo "$SYNC_RESULT"

sleep 3

echo ""
echo "Station 3 status:"
curl -s -b /tmp/cookies3.txt "http://localhost:5000/api/stations/3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Station: {d.get(\"name\")}'); print(f'Status: {d.get(\"status\")}')" 2>/dev/null || echo "Error getting station"

echo ""
echo "Station 3 data:"
curl -s -b /tmp/cookies3.txt "http://localhost:5000/api/stations/3/data?limit=3" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Records: {len(d)}')" 2>/dev/null || echo "No data yet"
