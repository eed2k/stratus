#!/bin/bash
# Create Skaapdam station and add Dropbox sync config
# Uses the existing admin user

# Create station directly with existing session
echo '{"name":"Inteltronics Skaapdam","location":"Skaapdam, South Africa","connectionType":"dropbox","isActive":true}' > /tmp/station.json
STATION=$(curl -s -X POST http://localhost:5000/api/stations -H "Content-Type: application/json" -H "X-User-Email: esterhuizen2k@proton.me" -d @/tmp/station.json)
echo "Station: $STATION"

# Extract station ID from response
STATION_ID=$(echo $STATION | grep -o '"id":[0-9]*' | grep -o '[0-9]*')
echo "Station ID: $STATION_ID"

# Add Dropbox sync config for this station
cat > /tmp/dropbox.json << 'EOF'
{"name":"Skaapdam Sync","folderPath":"/HOPEFIELD_CR300","filePattern":"Inteltronics_Skaapdam_Table1.dat","stationId":0,"syncInterval":3600000,"enabled":true}
EOF
DROPBOX=$(curl -s -X POST http://localhost:5000/api/dropbox-sync/configs -H "Content-Type: application/json" -H "X-User-Email: esterhuizen2k@proton.me" -d @/tmp/dropbox.json)
echo "Dropbox Config: $DROPBOX"

# List current configs
echo ""
echo "Current Dropbox Configs:"
curl -s http://localhost:5000/api/dropbox-sync/configs -H "X-User-Email: esterhuizen2k@proton.me" | python3 -m json.tool 2>/dev/null || curl -s http://localhost:5000/api/dropbox-sync/configs -H "X-User-Email: esterhuizen2k@proton.me"

# Trigger a sync
echo ""
echo "Triggering sync..."
curl -s -X POST http://localhost:5000/api/dropbox-sync/sync -H "X-User-Email: esterhuizen2k@proton.me"
