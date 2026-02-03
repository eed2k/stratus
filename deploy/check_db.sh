#!/bin/bash
# Query users and stations

echo "=== Users ==="
docker exec stratus-postgres psql -U stratus -d stratus -c "SELECT id, email, first_name, role FROM users;"

echo ""
echo "=== Stations ==="
docker exec stratus-postgres psql -U stratus -d stratus -c "SELECT id, name, connection_type FROM weather_stations;"

echo ""
echo "=== Dropbox Configs ==="
docker exec stratus-postgres psql -U stratus -d stratus -c "SELECT id, name, station_id, enabled FROM dropbox_sync_configs;"

echo ""
echo "=== Station 3 data count ==="
docker exec stratus-postgres psql -U stratus -d stratus -c "SELECT COUNT(*) FROM weather_data WHERE station_id = 3;"
