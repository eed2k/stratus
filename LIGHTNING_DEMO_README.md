# AS3935 Lightning Detector - Demo Data Generator

Generates realistic lightning strike demo data for the **Stratus Weather Dashboard** lightning panels (strike count, distance, energy/intensity).

**Hardware**: AMS AS3935 Franklin Lightning Sensor IC

## AS3935 Specifications

| Parameter | Value |
|-----------|-------|
| **Detection Range** | 1-40 km |
| **Distance Levels** | 14 discrete: 1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km |
| **Distance Accuracy** | ±4 km (manufacturer rated) |
| **Energy Scale** | 21-bit (0 to 2,097,151) relative measurement per event |
| **Detection Types** | Cloud-to-ground, intra-cloud |
| **Event Latency** | <2 seconds (detection to log) |
| **Antenna Frequency** | 500 kHz (±3.5%) |
| **Strike Threshold** | 1, 5, 9, or 16 events (programmable) |
| **Noise Floor** | 0-7 levels (programmable) |

## Quick Start

### Option 1: Quick Demo (3-hour storm, ~300 strikes)

```bash
python generate_demo_quick.py
```

Generates `lightning_demo_station8.dat` - a Campbell Scientific TOA5 CSV file ready for import.

### Option 2: Interactive Generator (custom scenarios)

```bash
python generate_lightning_demo.py
```

Interactive prompts let you choose:
- **Station ID** (default: 8 = SAWS Testbed)
- **Scenario**:
  1. Single severe thunderstorm (3 hours, 200+ strikes)
  2. Multiple storm cells (24 hours, 4 storms)
  3. Active week (7 days with 3 storms)
  4. Full month (30 days with 8 storms + quiet periods)
- **Output format**:
  1. Campbell TOA5 CSV (for dashboard import)
  2. SQL INSERT statements (for direct database import)
  3. Both

## Import Methods

### Method 1: Dashboard Data Import (Recommended)

1. Open Stratus dashboard: `https://stratusweather.co.za`
2. Navigate to your station (e.g., SAWS Testbed, ID 8)
3. Click **Data Import** in the sidebar
4. Select the generated `.dat` file (e.g., `lightning_demo_station8.dat`)
5. Upload → Data appears immediately in lightning cards

### Method 2: Direct Database Import (SQL)

```bash
# If you generated SQL format
psql -U stratus -d stratus -h 139.84.242.126 -f lightning_demo_station8.sql
```

Or via SSH:

```bash
ssh root@139.84.242.126
cat > /tmp/lightning.sql << 'EOF'
# Paste SQL content
EOF
docker exec -i stratus-postgres psql -U stratus -d stratus < /tmp/lightning.sql
```

## Data Format

The generator produces realistic AS3935 lightning detector data:

| Field | Description | Range |
|-------|-------------|-------|
| **Lightning_Tot** | Cumulative strike count | Increments with each strike |
| **LightningDist** | Distance to last strike (AS3935 discrete level) | 1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km |
| **LightningEnergy** | Strike intensity (21-bit) | 0 to 2,097,151 (relative scale) |

### Storm Characteristics

The generator creates realistic storm patterns:

- **Approach phase** (30%): Distance decreases 40km→14km, strikes increase
- **Peak phase** (40%): Distance 5-15km, high strike rate (8-20/interval), high energy
- **Dissipation phase** (30%): Distance increases 5km→40km, strikes decrease

**Note**: All distances snap to AS3935's 14 discrete hardware levels. The chip cannot report arbitrary distances.

## Dashboard Display

After import, data appears in these dashboard cards:

### Lightning Card (Main Dashboard)
- **Total Strikes**: Sum of all strikes in selected period
- **Closest Strike**: Minimum distance recorded
- **Average Distance**: Mean of all strike distances
- **Peak Intensity**: Maximum energy value
- **Average Intensity**: Mean energy value

### Lightning Chart
- Time-series plot of strike distance over time
- Shows storm approach/dissipation patterns

### Fire Danger Index
- Uses lightning data (among other factors) to calculate fire risk

## Example Output

```
Generated: lightning_demo_station8.dat
Records: 32, Total strikes: 261
Range: 2026-08-11 23:45 to 2026-08-12 02:25
AS3935 Specs: 14 discrete distances (1-40 km), 21-bit energy (0-2,097,151)

Sample (first 3):
  23:45 -   1 strikes, 40 km, energy 235,272
  23:50 -   2 strikes, 37 km, energy 354,564
  00:00 -   4 strikes, 34 km, energy 510,262
```

## File Structure

### Campbell TOA5 Format (`.dat`)

```csv
"TOA5","SAWS Testbed","CR1000X","12345","CR1000X.Std.03.02","CPU:AS3935_v1.CR1X","60000","WeatherData"
"TIMESTAMP","RECORD","Lightning_Tot","LightningDist","LightningEnergy"
"TS","RN","","km",""
"","","Tot","Smp","Smp"
"2026-08-11 23:45:32","1","1","40","235272"
"2026-08-11 23:50:32","2","2","37","354564"
...
```

### SQL Format (`.sql`)

```sql
-- AS3935 Lightning Detector Demo Data
-- AS3935 Specs: 14 discrete distances (1-40 km), 21-bit energy (0-2,097,151)
INSERT INTO weather_data (station_id, timestamp, lightning, lightning_distance, lightning_energy)
VALUES (8, '2026-08-11 23:45:32', 1, 40, 235272);
INSERT INTO weather_data (station_id, timestamp, lightning, lightning_distance, lightning_energy)
VALUES (8, '2026-08-11 23:50:32', 2, 37, 354564);
...
```

## Database Schema

The lightning data maps to these `weather_data` table columns:

```sql
lightning          REAL  -- Strike count (cumulative or per-interval)
lightning_distance REAL  -- Distance in km (1-40 range)
lightning_energy   REAL  -- Intensity/energy (dimensionless scale)
```

## Notes

- **AS3935 Discrete Distances**: The chip reports one of 14 fixed distance levels, not continuous values. The generator accurately reflects this hardware limitation.
- **21-bit Energy Scale**: The AS3935 provides a relative energy measurement (0 to 2,097,151), not absolute joules. Higher values indicate more intense strikes.
- **Cumulative vs Incremental**: Campbell loggers typically accumulate strike counts. The generator outputs cumulative totals that increase over time.
- **Distance Accuracy**: The AS3935 spec sheet states ±4 km accuracy. Real-world performance varies with environmental conditions.
- **Time Resolution**: Default 5-minute intervals match typical weather station logging rates.
- **Station ID**: Change the station ID to match your target station when generating data.

## Troubleshooting

### Import shows "No data" after upload
- Verify station ID matches (default is 8)
- Check timestamp range isn't outside your dashboard date filter
- Confirm file format is valid TOA5 (4 header lines, then data)

### SQL import fails
- Ensure station ID exists in `stations` table
- Check database connection and credentials
- Verify timestamp format: `YYYY-MM-DD HH:MM:SS`

### Dashboard cards show lightning as "no data"
- Refresh the dashboard (data loads on refresh)
- Check date range selector includes the demo data timestamps
- Verify weather_data table has lightning columns populated:
  ```sql
  SELECT timestamp, lightning, lightning_distance, lightning_energy 
  FROM weather_data 
  WHERE station_id = 8 AND lightning IS NOT NULL 
  ORDER BY timestamp DESC LIMIT 10;
  ```

## License

Demo data generator for Stratus Weather Dashboard.
Generated data is synthetic and for demonstration purposes only.
