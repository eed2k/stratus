#!/bin/bash
set -e
cd /opt/stratus

# Usage: NEON_URL="postgresql://..." ./merge_import.sh
if [ -z "$NEON_URL" ]; then
    echo "ERROR: Set NEON_URL environment variable"
    echo "  export NEON_URL='postgresql://user:password@host/db?sslmode=require'"
    exit 1
fi

NEON="$NEON_URL"
COLS="station_id,table_name,record_number,timestamp,data,collected_at,wind_dir_std_dev,sdi12_wind_vector,pump_select_well,pump_select_bore,port_status_c1,port_status_c2,mppt_solar_voltage,mppt_solar_current,mppt_solar_power,mppt_load_voltage,mppt_load_current,mppt_battery_voltage,mppt_charger_state,mppt_absi_avg,mppt_board_temp,mppt_mode,mppt2_solar_voltage,mppt2_solar_current,mppt2_solar_power,mppt2_load_voltage,mppt2_load_current,mppt2_battery_voltage,mppt2_charger_state,mppt2_board_temp,mppt2_mode"

# Write the import SQL script into the container
docker compose exec -T postgres sh -c "cat > /tmp/import_neon.sh << 'INNEREOF'
#!/bin/sh
set -e
NEON="$NEON_URL"
COLS='station_id,table_name,record_number,timestamp,data,collected_at,wind_dir_std_dev,sdi12_wind_vector,pump_select_well,pump_select_bore,port_status_c1,port_status_c2,mppt_solar_voltage,mppt_solar_current,mppt_solar_power,mppt_load_voltage,mppt_load_current,mppt_battery_voltage,mppt_charger_state,mppt_absi_avg,mppt_board_temp,mppt_mode,mppt2_solar_voltage,mppt2_solar_current,mppt2_solar_power,mppt2_load_voltage,mppt2_load_current,mppt2_battery_voltage,mppt2_charger_state,mppt2_board_temp,mppt2_mode'

echo 'Importing Station 1...'
psql \"\$NEON\" -c \"\\COPY weather_data(\$COLS) FROM '/tmp/s1.csv' CSV\"

echo 'Importing Station 2...'
psql \"\$NEON\" -c \"\\COPY weather_data(\$COLS) FROM '/tmp/s2.csv' CSV\"

echo 'Remapping Station 3 -> 15...'
sed 's/^3,/15,/' /tmp/s3.csv > /tmp/s3_mapped.csv
echo 'Importing Station 3->15...'
psql \"\$NEON\" -c \"\\COPY weather_data(\$COLS) FROM '/tmp/s3_mapped.csv' CSV\"

echo 'Remapping Station 4 -> 17...'
sed 's/^4,/17,/' /tmp/s4.csv > /tmp/s4_mapped.csv
echo 'Importing Station 4->17...'
psql \"\$NEON\" -c \"\\COPY weather_data(\$COLS) FROM '/tmp/s4_mapped.csv' CSV\"

echo 'Import complete!'

echo '--- Neon data counts ---'
psql \"\$NEON\" -c 'SELECT station_id, COUNT(*), MIN(timestamp) as earliest, MAX(timestamp) as latest FROM weather_data GROUP BY station_id ORDER BY station_id;'

echo '--- Neon stations ---'
psql \"\$NEON\" -c 'SELECT id, name, is_active FROM stations ORDER BY id;'

echo '--- Neon users ---'
psql \"\$NEON\" -c 'SELECT id, email, role FROM users ORDER BY id;'
INNEREOF
chmod +x /tmp/import_neon.sh
"

echo "Running import inside container..."
docker compose exec -e NEON_URL="$NEON" -T postgres sh /tmp/import_neon.sh

echo ""
echo "=== Update station 15 name ==="
docker compose exec -T postgres psql "$NEON" -c "UPDATE stations SET name = 'Quaggasklip 50 m' WHERE id = 15;"

echo "=== MERGE COMPLETE ==="
