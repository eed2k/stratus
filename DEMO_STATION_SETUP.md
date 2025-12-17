# Demo Station Setup Guide

## Quick Start - Get Demo Data Showing

Follow these steps to see the demo station data in your dashboard:

### Step 1: Update Local Environment Variables

1. Open the `.env` file in your project root
2. Go to your Netlify Dashboard → Site settings → Environment variables
3. Copy the value of `SUPABASE_DATABASE_URL`
4. Replace line 3 in `.env` with the actual connection string:

```env
DATABASE_URL=postgresql://postgres.xxxxx:your-password@aws-0-region.pooler.supabase.com:6543/postgres
```

**Important**: Make sure you're using the **pooler** connection string (port 6543), not the direct connection.

### Step 2: Run Database Migration

This creates all the new tables (sensors, calibration_records, maintenance_events, etc.):

```bash
npm run db:push
```

You should see output confirming tables were created.

### Step 3: Start Development Server

```bash
npm run dev
```

The server will start on http://localhost:5000

### Step 4: Initialize Demo Station

**Option A - Using the script** (easiest):
```bash
node scripts/init-demo.js
```

**Option B - Using curl**:
```bash
curl -X POST http://localhost:5000/api/demo/initialize
```

**Option C - Using PowerShell**:
```powershell
Invoke-WebRequest -Uri http://localhost:5000/api/demo/initialize -Method POST
```

You should see a success message confirming the demo station was created.

### Step 5: View Demo Station in Browser

1. Open http://localhost:5000 in your browser
2. Log in with your Netlify Identity account
3. You should see the demo station in your dashboard

## What Gets Created

The demo station initialization creates:

### Station Details
- **Name**: Demo Weather Station - Pretoria
- **Location**: Pretoria, South Africa (-25.7479°S, 28.2293°E)
- **Elevation**: 1,339 meters
- **Status**: Active and Online

### Sensors (7 total)
1. Temperature Sensor (2m height)
2. Humidity Sensor (2m height)
3. Pressure Sensor (1.5m height)
4. Wind Speed Sensor (10m height)
5. Wind Direction Sensor (10m height)
6. Solar Radiation Sensor (2m height)
7. Precipitation Sensor (1.2m height)

### Data
- **30 days** of historical weather data
- **4,320 data points** (10-minute intervals)
- Realistic weather patterns including:
  - Diurnal temperature cycles (12-35°C)
  - Weather fronts and storms
  - Wind patterns with direction changes
  - Solar radiation (zero at night, peak 1100 W/m²)
  - Precipitation events

### Calibration Records
- All sensors calibrated 3 months ago
- Next calibration due in 9 months
- NIST-traceable certificates

### Maintenance History
- Installation event (6 months ago)
- Routine inspections
- Calibration events
- Solar panel cleaning
- Rain gauge repair

### Configuration Changes
- Initial setup
- Software updates
- Calibration coefficient updates
- Sampling rate changes

## Troubleshooting

### Error: "Cannot connect to database"

**Solution**: Check your `DATABASE_URL` in `.env` file:
- Make sure it's the pooler connection (port 6543)
- Verify the password is correct
- Test connection: `psql $DATABASE_URL`

### Error: "Table does not exist"

**Solution**: Run the migration:
```bash
npm run db:push
```

### Error: "Demo station already exists"

**Solution**: The demo station can only be created once. To recreate it:
1. Delete the existing demo station from Supabase dashboard
2. Run the initialization again

### Server not starting

**Solution**: 
- Check if port 5000 is already in use
- Kill any existing node processes
- Try a different port: `PORT=5001 npm run dev`

### No data showing in dashboard

**Solution**:
1. Verify demo station was created: Check Supabase dashboard → `weather_stations` table
2. Check browser console for errors
3. Verify API endpoints are responding: `curl http://localhost:5000/api/stations`
4. Check server logs for errors

## Verify Demo Station

### Check Database Tables

After migration, you should have these tables in Supabase:
- `weather_stations`
- `weather_data`
- `sensors`
- `calibration_records`
- `maintenance_events`
- `configuration_changes`
- `data_quality_flags`
- `alarms`
- `alarm_events`
- `datalogger_programs`
- `station_groups`
- `station_group_members`

### Check Demo Data

Query to verify demo station exists:
```sql
SELECT * FROM weather_stations WHERE name LIKE '%Demo%';
```

Query to verify weather data:
```sql
SELECT COUNT(*) FROM weather_data WHERE station_id = (
  SELECT id FROM weather_stations WHERE name LIKE '%Demo%'
);
```

Should return approximately 4,320 records.

### Check API Endpoints

Test these endpoints to verify everything is working:

```bash
# Get all stations
curl http://localhost:5000/api/stations

# Get latest data for station 1
curl http://localhost:5000/api/stations/1/data/latest

# Get station status
curl http://localhost:5000/api/campbell/stations/1/status

# Get sensors
curl http://localhost:5000/api/stations/1/sensors

# Get calibration records
curl http://localhost:5000/api/stations/1/calibrations
```

## Next Steps

Once demo station is showing:

1. ✅ View real-time data in dashboard
2. ✅ Test dark blue theme
3. ⏳ Build 2D wind rose visualization
4. ⏳ Build 3D wind rose with Three.js
5. ⏳ Create calibration tracking UI
6. ⏳ Build maintenance logging interface
7. ⏳ Create alarm management dashboard

## Production Deployment

To use demo station in production (Netlify):

1. Add `DATABASE_URL` to Netlify environment variables:
   - Key: `DATABASE_URL`
   - Value: Same as `SUPABASE_DATABASE_URL`

2. Deploy to Netlify (automatic via GitHub push)

3. Initialize demo station on production:
   ```bash
   curl -X POST https://your-app.netlify.app/api/demo/initialize
   ```

4. Demo station will be available to all users

## Support

If you encounter issues:
1. Check server logs: Look at terminal where `npm run dev` is running
2. Check browser console: Press F12 in browser
3. Check Supabase logs: Supabase Dashboard → Logs
4. Verify environment variables are set correctly

---

**Last Updated**: December 2024  
**Status**: Demo Station Ready
