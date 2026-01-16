# Dropbox Integration Setup Guide

This guide explains how to set up Dropbox as a data source for Stratus Weather Station. Dropbox integration allows you to automatically import weather data files from a Dropbox folder, which is useful when your datalogger uploads files directly to Dropbox.

## Overview

The Dropbox integration uses OAuth 2.0 with **refresh tokens** for long-term access. This means:
- You authenticate once during setup
- The system automatically refreshes access tokens as needed
- No manual re-authentication required

## Prerequisites

1. A Dropbox account
2. A Dropbox App (created in the Dropbox Developer Console)
3. Stratus server running with environment variables configured

---

## Step 1: Create a Dropbox App

1. Go to [Dropbox Developer Console](https://www.dropbox.com/developers/apps)

2. Click **Create app**

3. Configure your app:
   - **API**: Choose "Scoped access"
   - **Access type**: Choose "Full Dropbox" (recommended) or "App folder"
   - **Name**: Give it a unique name (e.g., `stratus-weather-yourname`)

4. Click **Create app**

5. On the app settings page, note the following values:
   - **App key** (also called Client ID)
   - **App secret** (also called Client Secret)

6. Under **OAuth 2** section:
   - Add `http://localhost:5000/api/station-setup/oauth/callback` to **Redirect URIs**
   - For production, also add your production URL (e.g., `https://yourdomain.com/api/station-setup/oauth/callback`)

7. Under **Permissions** tab, enable these scopes:
   - `files.metadata.read`
   - `files.content.read`

8. Click **Submit** to save permissions

---

## Step 2: Configure Environment Variables

Add the following to your `.env` file:

```bash
# Dropbox OAuth Configuration
DROPBOX_APP_KEY=your_app_key_here
DROPBOX_APP_SECRET=your_app_secret_here

# Optional: Pre-configured refresh token (for automated setups)
# DROPBOX_REFRESH_TOKEN=your_refresh_token_here
```

---

## Step 3: Generate a Refresh Token

### Option A: Using the Stratus UI (Recommended)

1. Start the Stratus server
2. Navigate to **Station Setup** → **Data Source Configuration**
3. Select **Dropbox** as the data source
4. Click **Authorize with Dropbox**
5. Log in to Dropbox and grant permissions
6. The refresh token will be automatically stored

### Option B: Manual Token Generation

If you need to generate a token manually:

1. Open your browser and go to:
   ```
   https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&response_type=code&token_access_type=offline
   ```
   Replace `YOUR_APP_KEY` with your actual app key.

2. Log in and authorize the app

3. Copy the authorization code

4. Exchange the code for tokens using curl:
   ```bash
   curl -X POST https://api.dropboxapi.com/oauth2/token \
     -u "YOUR_APP_KEY:YOUR_APP_SECRET" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "code=AUTHORIZATION_CODE&grant_type=authorization_code"
   ```

5. The response contains your `refresh_token`. Add it to `.env`:
   ```bash
   DROPBOX_REFRESH_TOKEN=your_refresh_token_here
   ```

---

## Step 4: Configure Station for Dropbox Import

1. In Stratus, create or edit a station

2. Set **Connection Type** to `http` (import-only mode)

3. In connection config, specify the Dropbox folder:
   ```json
   {
     "type": "http",
     "dropboxFolder": "/YOUR_FOLDER_NAME"
   }
   ```

4. The folder path should match where your datalogger uploads files

---

## File Format Requirements

Stratus expects TOA5 format files (Campbell Scientific standard):

```csv
"TOA5","StationName","CR300","12345","CR300.Std.04.02","CPU:program.CR3X","54321"
"TIMESTAMP","RECORD","AirTC","RH","BP","Wind_Spd_Max","Wind_Spd_S_WVT","Wind_Dir_D1_WVT"
"TS","RN","Deg C","%","mbar","km/hr","km/hr","Degrees"
""
"2024-01-15 10:00:00",1,25.3,65,1013.2,12.5,8.2,180
```

### Supported Fields

| Field Name | Description | Unit |
|------------|-------------|------|
| `TIMESTAMP` | Record timestamp | ISO format |
| `AirTC` / `AirTK_Avg` | Air temperature | °C |
| `RH` / `RH_Avg` | Relative humidity | % |
| `BP` / `BP_mbar_Avg` | Barometric pressure | mbar |
| `Wind_Spd_S_WVT` | Wind speed (scalar) | km/h |
| `Wind_Dir_D1_WVT` | Wind direction | degrees |
| `Wind_Spd_Max` | Wind gust | km/h |
| `Rain_mm_Tot` | Rainfall | mm |
| `SlrW_Avg` | Solar radiation | W/m² |
| `BattV` / `BattV_Avg` | Battery voltage | V |

---

## Automatic Data Collection

Once configured, Stratus will:

1. Check the Dropbox folder periodically for new files
2. Parse and import new data records
3. Deduplicate records based on timestamp and record number
4. Update the station's last data timestamp

### Import Interval

The default import interval is **5 minutes**. You can adjust this in the station settings.

---

## Troubleshooting

### "Invalid refresh token" error

- The refresh token may have been revoked in Dropbox
- Re-authorize the app using Option A above

### "Folder not found" error

- Verify the folder path starts with `/`
- Check the folder exists in Dropbox
- Ensure the app has the correct permissions

### "Rate limited" error

- Dropbox has API rate limits
- Increase the import interval to reduce API calls

### No data appearing

1. Check the server logs for import errors
2. Verify the file format matches TOA5 standard
3. Ensure timestamp column is parseable
4. Check that field names match expected patterns

### Token refresh issues

- Verify `DROPBOX_APP_KEY` and `DROPBOX_APP_SECRET` are correct
- Check that offline access was granted during authorization

---

## Security Notes

- Never commit `.env` files with tokens to version control
- Use environment variables for production deployments
- Refresh tokens provide long-term access - treat them like passwords
- Revoke tokens in Dropbox if compromised

---

## API Reference

### Dropbox Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `/oauth2/token` | Token refresh |
| `/2/files/list_folder` | List files in folder |
| `/2/files/download` | Download file content |

### Stratus Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/station-setup/oauth/callback` | GET | OAuth callback |
| `/api/station-setup/dropbox/connect` | POST | Initiate OAuth flow |
| `/api/station-setup/dropbox/status` | GET | Check connection status |

---

## Example Datalogger Program

See [examples/crbasic/92000_3_stratus.CR300](examples/crbasic/92000_3_stratus.CR300) for a CRBasic program that outputs data in the correct format for Dropbox/Stratus import.

---

## Support

For issues with Dropbox integration:
1. Check the server logs (`logs/` directory)
2. Verify environment variables are set correctly
3. Test the OAuth flow manually
4. Open an issue on GitHub with log excerpts
