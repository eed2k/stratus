# Debug: Lightning Data Not Showing

## Problem
Imported `lightning_demo_station8.dat` but lightning data doesn't appear on the dashboard.

## Troubleshooting Steps

### Step 1: Verify File Was Actually Imported

Did you complete the import? The steps are:
1. Open https://stratusweather.co.za
2. Login
3. Click on **SAWS Testbed** station
4. Click **Data Import** in sidebar  
5. Upload `lightning_demo_station8.dat`
6. Wait for "Import successful" message

**If you haven't done this yet**, that's why no data shows - the file needs to be uploaded through the dashboard.

### Step 2: Check Database (if you have access)

Run `check_lightning_import.sql` to verify data was inserted:

```bash
# Local Postgres
psql -U stratus -d stratus -f check_lightning_import.sql

# Or via Supabase SQL editor
# Copy/paste contents of check_lightning_import.sql
```

Expected output:
```
Total lightning records: 33
Earliest: 2026-08-09 00:28:20
Latest: 2026-08-09 03:13:20
```

### Step 3: Check Dashboard Date Range

The demo data is from **August 9, 2026** (3 days ago from August 12).

On the dashboard:
- Look for the **date range selector** at the top
- Make sure it's set to **"Last 7 Days"** or **"Last 30 Days"**
- If it's set to "Last 24 Hours", the demo won't show

### Step 4: Check if Lightning Card is Enabled

The Lightning card might not be visible by default. To enable it:

1. On the dashboard, click **Configure** (gear icon)
2. Scroll to **"Lightning Proximity"** section
3. Make sure it's **checked/enabled**
4. Click **Save**
5. Refresh dashboard

### Step 5: Verify Station Has Coordinates

The Lightning card requires station coordinates to show the map. Check:

1. Go to **Stations** page
2. Find **SAWS Testbed** (ID 8)
3. Make sure **Latitude** and **Longitude** are set

If coordinates are missing:
- Edit station
- Set Latitude: `-33.923` (Cape Town approximate)
- Set Longitude: `18.423`
- Save

### Step 6: Check Browser Console

Open browser Developer Tools (F12):
1. Go to **Console** tab
2. Look for errors related to "lightning" or "data"
3. Share any error messages

### Step 7: Check if Data Import Worked

Look at the Data Import page after uploading:
- Did it show "Import successful"?
- Did it show the number of records imported (should be ~33)?
- Any error messages?

### Step 8: Alternative - Direct Database Import

If dashboard import isn't working, import directly to database:

```bash
# Generate SQL format
python generate_lightning_demo.py
# Choose: Station 8, Scenario 1, Format 2 (SQL)

# Import to database
psql -U stratus -d stratus -f lightning_demo_station8.sql
```

Or via Supabase SQL editor:
1. Open Supabase dashboard
2. Go to SQL Editor
3. Paste contents of `lightning_demo_station8.sql`
4. Run query

## Common Issues

### Issue: "No data" in dashboard
**Cause**: Date range too narrow  
**Fix**: Change date range to "Last 7 Days"

### Issue: Lightning card not visible
**Cause**: Card disabled in config  
**Fix**: Enable in Dashboard Config panel

### Issue: Map shows "Coordinates not set"
**Cause**: Station missing lat/long  
**Fix**: Add coordinates to station settings

### Issue: Import shows error
**Cause**: Wrong station ID or file format  
**Fix**: Regenerate with correct station ID:
```bash
python generate_lightning_demo.py
# Enter correct station ID when prompted
```

## Quick Test: Does Station Have ANY Lightning Data?

Open browser console and run this API test:

```javascript
// Replace with your actual station ID and auth token
fetch('/api/stations/8/data?timeRange=7d')
  .then(r => r.json())
  .then(data => {
    const withLightning = data.filter(d => d.lightning != null || d.lightningDistance != null);
    console.log('Records with lightning:', withLightning.length);
    console.log('Sample:', withLightning.slice(0, 3));
  });
```

If this returns 0 records, the data wasn't imported.

## What to Check Now

Please confirm:
1. ✓ Did you upload the file via Data Import? (Yes/No)
2. ✓ What date range is selected on dashboard?
3. ✓ Is Lightning Proximity section enabled in config?
4. ✓ Does station have coordinates set?
5. ✓ Any errors in browser console?

Let me know the answers and we can debug further!
