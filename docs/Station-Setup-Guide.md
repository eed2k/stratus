# Stratus Weather Station Setup Guide

A complete step-by-step guide for adding weather stations to Stratus via the web interface.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Adding a Dropbox-Synced Station (Campbell Scientific)](#adding-a-dropbox-synced-station-campbell-scientific)
3. [Adding a RikaCloud Station](#adding-a-rikacloud-station)
4. [Managing Dropbox Sync Configurations (Settings Page)](#managing-dropbox-sync-configurations-settings-page)
5. [File Pattern Reference](#file-pattern-reference)
6. [How Sync Works](#how-sync-works)
7. [Deleting a Station](#deleting-a-station)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before adding a station, ensure:

- You are logged in as an **admin** user.
- **For Dropbox sync:** The server has Dropbox credentials configured (`DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN` environment variables). Without these, no sync config will be created and data will not be imported.
- **For RikaCloud:** You have your RikaCloud account credentials.
- Your datalogger is already uploading `.dat` files to its Dropbox folder (for Campbell Scientific stations).

---

## Adding a Dropbox-Synced Station (Campbell Scientific)

This is the standard setup for Campbell Scientific dataloggers (CR300, CR1000X, etc.) that upload TOA5 `.dat` files to Dropbox.

### Step 1: Navigate to Station Setup

1. Log in to Stratus at `https://stratusweather.co.za`.
2. Click **Stations** in the left sidebar.
3. Click the **"Add New Station"** tab (or the **+ New Station** button).

### Step 2: Fill in Station Details

| Field | Required | Description | Example |
|---|---|---|---|
| **Station Name** | **Yes** | A descriptive name for the station. This is the only required field. | `SAWS TESTBED 5263` |
| **Location Description** | No | Descriptive location text. | `Pretoria, South Africa` |
| **Latitude** | No | GPS latitude (decimal degrees, negative for south). | `-25.7479` |
| **Longitude** | No | GPS longitude (decimal degrees, positive for east). | `28.2293` |
| **Altitude (m)** | No | Elevation above sea level in metres. | `1330` |

> **Note:** Additional details like site description, notes, calibration dates, and maintenance records can be configured later from the station's dashboard admin panel.

### Step 3: Select Connection Type

Choose **Dropbox Sync (Campbell Scientific)** from the Connection Type dropdown. This is the default selection.

### Step 4: Configure Dropbox Sync

Three fields appear for Dropbox configuration:

#### Dropbox Folder Path
Enter the **exact Dropbox folder path** where the datalogger uploads its `.dat` files.

- Must start with a `/`.
- This is the folder name as it appears in Dropbox.
- Examples: `/HOPEFIELD_CR300`, `/SAWS TESTBED`, `/FIELD_STATION_1`

> **Tip:** If you're unsure of the folder name, check the Dropbox Sync tab on the **Settings** page — it has a file browser that shows all folders in your connected Dropbox.

#### File Pattern (optional)
Controls which files in the folder are synced. Three options:

| What to enter | Effect | Example |
|---|---|---|
| **Leave blank** | Imports **all** `.dat` files in the folder | *(empty)* |
| **Station prefix** | Auto-appends `*` — matches all tables for that station | `Inteltronics_SAWS_TestBed_5263` |
| **Wildcard pattern** | Matches files using `*` (any characters) or `?` (single character) | `*Table5m*` or `HOPEFIELD_CR300_Table1.dat` |

> **Important:** If you enter a prefix without a wildcard or file extension, Stratus automatically appends `*` for you. So `Inteltronics_SAWS_TestBed_5263` becomes `Inteltronics_SAWS_TestBed_5263*` and matches all files like:
> - `Inteltronics_SAWS_TestBed_5263_Table5m.dat`
> - `Inteltronics_SAWS_TestBed_5263_Table10m.dat`
> - `Inteltronics_SAWS_TestBed_5263_TableHour.dat`
> - `Inteltronics_SAWS_TestBed_5263_TableDay.dat`

#### Sync Interval
How often Stratus checks Dropbox for new data. Select from:

| Option | Best for |
|---|---|
| **5 minutes** | Stations that transmit every few minutes |
| **10 minutes** | Stations that transmit every 5–10 minutes |
| **15 minutes** | Stations that transmit every 10–15 minutes |
| **30 minutes** | Standard near-real-time monitoring |
| **1 hour** (default) | Stations that transmit hourly — **recommended for most setups** |
| **2 hours** | Stations with infrequent uploads |

> **Note:** Setting the sync interval shorter than the file update frequency is fine — Stratus will check, see the file hasn't changed, and skip the download. There is no performance penalty.

### Step 5: Save

Click the **"Add Station"** button at the bottom of the form.

### What Happens Next (Automatically)

1. The station is created in the database.
2. A Dropbox sync configuration is auto-created and linked to the station.
3. The Dropbox sync service reloads its configurations.
4. After ~1 second, the **first sync starts automatically** — Stratus will:
   - List all files in the configured Dropbox folder.
   - Filter for files matching the folder path and file pattern.
   - Download each matching `.dat` file.
   - Parse the TOA5 data (headers, timestamps, sensor readings).
   - Import **all historical records** from the files into the database.
5. You will see a success toast: *"Weather station has been configured successfully."*
6. The page switches to the **Active Stations** tab where your new station appears.

> **First sync time:** The initial import of all historical data can take 5–15+ minutes depending on the number of files and records. Subsequent syncs are much faster (typically seconds) as only new data is imported.

### Step 6: Verify

After a few minutes, check:

- **Stations page:** The station should appear with an "Active" badge, a sync time, and a record count.
- **Dashboard:** Click "View" on the station to see the imported data and graphs.
- **Settings → Dropbox Sync:** The sync configuration should show the last sync time and record count.

---

## Adding a RikaCloud Station

For Rika wood pellet stoves/sensors that connect via RikaCloud.

### Step 1: Navigate to Station Setup

Same as above — go to **Stations** → **Add New Station** tab.

### Step 2: Fill in Station Details

Fill in the station name (required) and optional location/GPS fields.

### Step 3: Select Connection Type

Choose **RikaCloud HTTP API (Rika Weather Stations)** from the Connection Type dropdown.

> An info banner appears: *"Read-only integration: Stratus only fetches (reads) data from RikaCloud. It will never write, modify, or delete any data on your RikaCloud account."*

### Step 4: Configure RikaCloud

| Field | Required | Description | Example |
|---|---|---|---|
| **RikaCloud Account** | Yes | Your RikaCloud username/email | `user@example.com` |
| **RikaCloud Password** | Yes | Your RikaCloud password | *(your password)* |
| **Device Data URL** | No | Leave blank to use default (`cloud.rikacloud.com`). Stratus auto-discovers your devices. | *(leave blank)* |
| **Poll Interval** | No | How often to fetch new data (default: 1 minute) | `1 minute` |

**Poll Interval Options:**
- 1 minute (default)
- 5 minutes
- 10 minutes
- 30 minutes
- 1 hour

### Step 5: Save

Click **"Add Station"**. Stratus will connect to RikaCloud and start fetching data automatically.

---

## Managing Dropbox Sync Configurations (Settings Page)

You can also manage Dropbox sync configs separately from station creation, useful for:
- Adding sync configs for stations that already exist.
- Configuring multiple folder/pattern combinations for one station.
- Monitoring sync status.

### Accessing Dropbox Sync Settings

1. Go to **Settings** in the left sidebar.
2. Scroll to the **Dropbox Sync** section.

### Adding a New Sync Configuration

| Field | Required | Description |
|---|---|---|
| **Name** | Yes | A descriptive name for this sync config |
| **Folder Path** | Yes | Dropbox folder path (e.g. `/SAWS TESTBED`) |
| **Link to Station** | No | Select which existing station should receive the data, or "No station (create later)" |
| **File Pattern** | No | Same pattern rules as station setup (auto-wildcards prefix entries) |
| **Sync Interval** | No | 5 min / 10 min / 30 min / 1 hour (default) / 2 hours |

Click **"Add Configuration"**. The first sync starts automatically and imports all historical data.

### Monitoring Sync Status

Each sync configuration shows:
- **Status:** Active/Disabled badge
- **Folder & Pattern:** The configured Dropbox folder and file pattern
- **Last sync:** Timestamp, status (success/error), and number of records imported
- **Enable/Disable** toggle
- **Delete** button

---

## File Pattern Reference

| Pattern | Matches | Use Case |
|---|---|---|
| *(blank)* | All `.dat` files in the folder | Import everything |
| `HOPEFIELD_CR300_Table1.dat` | Exact file only | Single-table import |
| `Inteltronics_SAWS_TestBed_5263` | Auto-becomes `*5263*` — all files starting with this prefix | All tables for one station |
| `*Table5m*` | Any file containing "Table5m" | Only 5-minute data |
| `*TableHour*` | Any file containing "TableHour" | Only hourly data |
| `HOPEFIELD_CR300_*` | All files starting with `HOPEFIELD_CR300_` | All tables for HOPEFIELD |

### How Pattern Matching Works

1. Stratus lists **all** files in the Dropbox app folder recursively.
2. Files are filtered to `.dat` files only.
3. Files are filtered by **folder path** (must be in the configured folder).
4. If a pattern is set:
   - **No wildcards, no dot (`.`):** Treated as a prefix → `*` auto-appended → glob match.
   - **No wildcards, has dot:** Treated as an exact filename match.
   - **Has `*` or `?`:** Glob match (`*` = any characters, `?` = single character).
5. Files with "conflicted copy", "backup", "old", or "copy" in the name are automatically skipped.

---

## How Sync Works

### First Sync (Initial Import)

When a station is first created or a new sync config is added:
- **All historical records** from matching files are imported.
- This can take several minutes for large files with thousands of records.
- Progress is logged on the server.

### Subsequent Syncs (Incremental)

On each sync interval:

1. Stratus checks the **file modification date** on Dropbox.
2. If the file **hasn't changed** since the last sync → **skipped** (no download, minimal overhead).
3. If the file **has changed** → downloaded, parsed, and records from the **last 48 hours** are imported.
4. **Duplicate records are automatically rejected** by the database (based on station ID + timestamp + table name). Only new records are actually inserted.

### What if files update less frequently than the sync interval?

This is perfectly fine. Example: files update every 6 hours, sync is set to 1 hour:

- Hours 1–5: Sync fires, sees file hasn't changed → skips. Very fast (just a Dropbox API list call).
- Hour 6: File has changed → downloads, parses, imports only new data.
- **No duplicate data, no wasted bandwidth.**

### What if files update more frequently than the sync interval?

Also fine. You'll pick up data on the next sync tick. Set a shorter interval (5 or 10 minutes) if you need near-real-time data.

---

## Deleting a Station

1. Go to **Stations** page.
2. Find the station in the list.
3. Click the **red trash icon** (🗑) in the Actions column.
4. A confirmation dialog appears: *"Are you sure you want to delete [station name]? This will permanently remove the station and all its weather data."*
5. Click **Delete** to confirm.

> **Warning:** Deletion is permanent. All weather data records, Dropbox sync configurations, and alarms associated with the station are permanently deleted (cascade delete).

---

## Troubleshooting

### Station shows 0 records after setup

- **Wait a few minutes.** The first sync imports all historical data and can take 5–15 minutes.
- **Check the file pattern.** Go to Settings → Dropbox Sync and verify the pattern matches your files. Try leaving the pattern blank to see if all files import correctly.
- **Check the folder path.** Must be the exact Dropbox folder path (case-insensitive), starting with `/`.

### Sync shows "success" but 0 records

- The file pattern may not match any files. Verify the pattern against actual filenames in your Dropbox folder.
- If using a prefix pattern without `*`, Stratus auto-appends it — but double-check the server logs if unsure.

### Station is "Inactive"

- Check that the datalogger is still uploading to Dropbox.
- Check that sync is enabled in Settings → Dropbox Sync.
- A station is marked active when it has recent data.

### "No endpoint configured" warning in logs

This is **expected and harmless** for Dropbox-synced stations. It means the Protocol Manager has no direct TCP/IP endpoint for the station, which is correct for file-based import.

### Dropbox token expired

Stratus automatically refreshes the Dropbox OAuth2 token using the refresh token. If the refresh token itself is revoked:
1. Re-authenticate with Dropbox to get a new refresh token.
2. Update the `DROPBOX_REFRESH_TOKEN` environment variable.
3. Restart the container.
