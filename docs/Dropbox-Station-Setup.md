# Setting Up a Dropbox Station in Stratus

This guide explains how to add a new weather station that syncs data from Dropbox (for Campbell Scientific dataloggers using LoggerNet + Dropbox).

---

## Prerequisites

1. **LoggerNet** is configured to upload `.dat` files (TOA5 format) to a Dropbox folder
2. **Dropbox API App** created at [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)
   - Select **Scoped access** and **Full Dropbox** permissions
   - Note down your **App Key** and **App Secret**

---

## Step-by-Step Setup

### Step 1: Configure Dropbox Credentials (one-time)

1. Go to **Settings** in Stratus
2. Scroll to the **Dropbox Sync** section
3. If you see "Dropbox Not Configured":
   - Enter your **App Key** and **App Secret**
   - Click **Authorise with Dropbox** — this opens a Dropbox page in a new tab
   - After authorising, copy the **auth code** from Dropbox
   - Paste it into the auth code field and click **Get Token**
   - Click **Save & Test Credentials**
4. Once configured, you'll see a green "Configured" status

### Step 2: Browse & Verify Data Files

After credentials are configured, the **Dropbox Data Files** section appears in Settings:

1. Click the **refresh** button to load files from Dropbox
2. Files are grouped by folder — click a folder name to expand it
3. Each file shows:
   - **File name** and **size**
   - **Freshness indicator**: green (< 2h), amber (< 24h), red (> 24h)
4. **Click a file to preview it** — this downloads and shows:
   - **Record count** and **file size**
   - **Oldest and newest timestamps** in the file
   - **Freshness verdict**: "Active", "Recently updated", or "Stale"
   - **TOA5 headers** (station info, field names, units)
   - **Last 15 data records** so you can inspect the data

> **TIP:** If the newest timestamp is green (within 2 hours), the station is actively uploading and safe to add.

### Step 3: Create the Station (Everything Else is Automatic)

1. Go to **Stations** page
2. Click **Add Station**
3. Fill in station details:
   - **Station Name**: e.g. "Skaapdam"
   - **Connection Type**: Select **Dropbox Sync (Campbell Scientific)**
   - **Dropbox Folder Path**: The folder containing .dat files (e.g. `/HOPEFIELD_CR300`)
     - Use the exact folder path you saw in the file browser
   - **File Pattern** (optional): If the folder has multiple `.dat` files and you only want a specific one, enter the filename (e.g. `Inteltronics_Skaapdam_Table1.dat`). Leave blank to import all `.dat` files in the folder.
   - **Sync Interval**: How often to check for new data (recommended: 1 hour)
4. Fill in location (latitude, longitude) and other details
5. Click **Create Station**

**That's it!** Stratus automatically:
- Creates a sync configuration linked to your new station
- Triggers an immediate first sync
- Imports **all historical records** from the `.dat` file(s) on the first sync
- Subsequent syncs only import new data from the last 48 hours

### Step 4: Verify Data

1. Go to the station's **Dashboard** — you should see weather data appearing within a few minutes
2. Check **Settings** → **Dropbox Sync** to see the sync configuration with:
   - **Last sync** timestamp
   - **Status**: "success"
   - **Records imported** count

> **NOTE:** You do NOT need to manually create a sync configuration in Settings — it was auto-created when you added the station. Only use the Settings sync config panel to edit or manage existing configurations.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No files show in browser | Check Dropbox credentials are saved. Click refresh. |
| File shows "Stale" (red) | LoggerNet may not be uploading. Check LoggerNet schedule and Dropbox sync on the field PC. |
| Sync shows 0 records | The first sync imports all records. If still 0, verify the folder path matches exactly (case-sensitive). Check file pattern if set. |
| Station created but no data | Check Settings → Dropbox Sync for a sync config linked to your station. If missing, the Dropbox credentials may not have been configured when the station was created. Add a sync config manually. |
| Duplicate sync configs | Station creation auto-creates a sync config. Don't create another in Settings for the same station. Delete duplicates if present. |
| Old deleted station data still appears | Deleting a station now automatically cleans up its sync configs. |

---

## How It Works

```
LoggerNet → uploads .dat files → Dropbox folder
                                       ↓
Stratus (sync interval) → checks Dropbox folder for new/modified files
                                       ↓
Downloads .dat → parses TOA5 format → imports records to database
                                       ↓
Dashboard displays live weather data
```

The sync service runs on a timer (your configured interval). Each cycle:
1. Lists files in the configured Dropbox folder
2. Checks for files modified since the last sync
3. Downloads and parses new data
4. Imports records into the station's database

Multiple stations can sync independently from different Dropbox folders.
