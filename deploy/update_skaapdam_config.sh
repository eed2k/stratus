#!/bin/bash
# Update Skaapdam Dropbox config with station ID

cat > /tmp/update.json << 'EOF'
{"stationId":3}
EOF

echo "JSON content:"
cat /tmp/update.json

echo ""
echo "Updating config..."
curl -s -X PUT http://localhost:5000/api/dropbox-sync/configs/3 \
  -H "Content-Type: application/json" \
  -H "X-User-Email: esterhuizen2k@proton.me" \
  -d @/tmp/update.json

echo ""
echo "Triggering sync..."
curl -s -X POST http://localhost:5000/api/dropbox-sync/sync \
  -H "X-User-Email: esterhuizen2k@proton.me"

echo ""
echo "Current configs:"
curl -s http://localhost:5000/api/dropbox-sync/configs \
  -H "X-User-Email: esterhuizen2k@proton.me"
