# Stratus Weather Server - Campbell Scientific Integration Guide

## Overview

Stratus Weather Server supports multiple methods for connecting to Campbell Scientific dataloggers. This guide explains each connection method and provides example CRBASIC programs.

**Cloud Server:** Deploy to Railway for 24/7 access (https://railway.app)  
**API Endpoint:** `https://your-app.up.railway.app/api/ingest/{stationId}`

## WMO Compliance

All data transmitted to Stratus follows **WMO (World Meteorological Organization)** and **ISO** standards:

| Parameter | Unit | Standard |
|-----------|------|----------|
| Wind Speed | m/s | WMO-No. 8 |
| Wind Direction | 0-360° | Meteorological convention |
| Temperature | °C | SI/ISO |
| Pressure | hPa (mbar) | SI/ISO |
| Rainfall | mm | SI/ISO |
| Solar Radiation | W/m² | SI/ISO |
| Timestamps | ISO 8601 | UTC recommended |

## Connection Methods Comparison

| Method | Best For | Datalogger Requirements | Stratus Component |
|--------|----------|------------------------|-------------------|
| **PakBus** | Direct connection, reliable polling | Any CR series | Campbell Connection Manager |
| **HTTP POST** | Remote stations with internet | CR1000X, CR6, CR300 with Ethernet/WiFi | REST API |
| **Serial ASCII** | Simple setup, legacy systems | Any CR series | Serial Monitor |

---

## Method 1: PakBus Protocol (Recommended for Local)

**How it works:** Stratus acts as a PakBus client and polls data from your datalogger's data tables. This is the native Campbell Scientific protocol and provides the most reliable connection.

### CRBASIC Program
Use `stratus_pakbus_station.cr1x` - No special communication code needed! Just create your data tables and Stratus will poll them.

### Stratus Configuration

1. **Add Station** → Select "Campbell Scientific"
2. **Connection Settings:**
   ```
   Protocol: PakBus
   Connection: TCP/IP or Serial
   Address: 192.168.1.100 (or COM port)
   PakBus Address: 1
   Security Code: 0 (or your code)
   ```
3. **Data Collection:**
   ```
   Table: WeatherData
   Poll Interval: 60 seconds
   Collect Mode: Since Last Collection
   ```

### Wiring (TCP/IP)
```
Datalogger Ethernet → Network Switch → PC running Stratus
```

### Wiring (Serial RS-232)
```
Datalogger CS I/O Port → SC32B Interface → PC COM Port
```

---

## Method 2: HTTP POST (Recommended for Cloud/Remote Stations)

**How it works:** The datalogger pushes data to Stratus's REST API at regular intervals. Best for remote stations with cellular or WiFi connectivity. Works with Railway cloud deployment.

### CRBASIC Program
Use `stratus_http_post_station.cr1x` - Configure your Railway server URL and station ID.

### Configuration in CRBASIC
```basic
' For Railway cloud deployment (recommended for 24/7 access):
Const STRATUS_SERVER = "your-app.up.railway.app"  ' Get from Railway dashboard
Const STRATUS_PORT = 443
Const USE_TLS = True
Const STATION_ID = 1  ' Numeric ID from Stratus dashboard

' For local network testing:
Const STRATUS_SERVER = "192.168.1.100"
Const STRATUS_PORT = 5000
Const USE_TLS = False
Const STATION_ID = 1

Const API_KEY = ""  ' Optional, only if station has API key configured
```

### Stratus API Endpoint
```
POST https://your-app.up.railway.app/api/ingest/{stationId}

Headers:
  Content-Type: application/json
  X-API-Key: your-api-key (optional)

Body:
{
  "timestamp": "2025-01-04T12:00:00Z",
  "source": "campbell-crbasic",
  "data": {
    "temperature": 22.5,
    "humidity": 65,
    "windSpeed": 3.2,
    "windDirection": 180,
    ...
  }
}
```

### Setup Steps
1. Deploy Stratus to Railway (https://railway.app)
2. Get your Railway public URL from the deployment dashboard
3. Create a station in Stratus dashboard and note the numeric Station ID
4. Update `STRATUS_SERVER` and `STATION_ID` in the CRBASIC program
5. Upload program to datalogger
POST http://stratus-server:5000/api/weather-data

Headers:
  Content-Type: application/json
  X-Station-ID: CR1000X_001

Body:
{
  "stationId": "CR1000X_001",
  "timestamp": "2025-01-01T12:00:00",
  "data": {
    "temperature": 22.5,
    "humidity": 65.0,
    "windSpeed": 3.2,
    "windDirection": 180,
    "rainfall": 0.0,
    "pressure": 1013.25
  }
}
```

---

## Method 3: Serial ASCII Output

**How it works:** Datalogger outputs ASCII text (CSV or JSON) over RS-232. Stratus Serial Monitor reads and parses this data stream.

### CRBASIC Program
Use `stratus_serial_output_station.cr1x` - Outputs data in CSV, JSON, or Weather Underground format.

### Output Formats

**CSV Format:**
```
2025-01-01 12:00:00,22.50,65.0,3.20,180,0.00,1013.2,15.80,12.80
```

**JSON Format:**
```json
{"ts":"2025-01-01T12:00:00","t":22.5,"h":65,"ws":3.2,"wd":180,"r":0,"p":1013.2,"dp":15.8,"bv":12.8}
```

### Stratus Serial Monitor Configuration
1. Navigate to **Serial Monitor** page
2. Select COM port and baud rate (9600)
3. Set parser to CSV or JSON
4. Map fields to Stratus variables

### Wiring
```
Datalogger RS-232 Port → Null Modem Cable → PC COM Port
   (or)
Datalogger CS I/O → SC32B → PC COM Port
```

---

## Field Mapping Reference

| CRBASIC Variable | Stratus Field | Unit | Description |
|------------------|---------------|------|-------------|
| `AirTC` | temperature | °C | Air temperature |
| `RH` | humidity | % | Relative humidity |
| `WS_ms` | windSpeed | m/s | Wind speed |
| `WindDir` | windDirection | ° | Wind direction |
| `Rain_mm` | rainfall | mm | Rainfall |
| `BP_mbar` | pressure | mbar | Barometric pressure |
| `DewPoint_C` | dewPoint | °C | Dew point |
| `BattV` | battery | V | Battery voltage |

---

## Comparison with Weather Underground

| Feature | Weather Underground | Stratus |
|---------|--------------------| --------|
| **Protocol** | HTTP GET/POST | PakBus, HTTP, Serial |
| **Authentication** | Station ID + Password | API Key (optional) |
| **Data Storage** | Cloud only | Local SQLite + Optional cloud |
| **Real-time** | Yes | Yes (WebSocket) |
| **Historical** | Limited | Unlimited local storage |
| **Offline** | No | Yes - full offline operation |
| **Custom Sensors** | Limited | Fully configurable |
| **Cost** | Free (limited) | Free (self-hosted) |

---

## Typical Setup Workflow

1. **Install CRBASIC Program**
   - Use Device Configuration Utility or LoggerNet
   - Upload appropriate `.cr1x` file to datalogger

2. **Configure Datalogger Network** (for TCP/IP)
   - Set static IP or DHCP
   - Configure PakBus settings
   - Set security code if needed

3. **Configure Stratus**
   - Add new station
   - Select connection type
   - Configure field mapping
   - Set polling interval

4. **Verify Connection**
   - Check Campbell Dashboard in Stratus
   - Verify data appears on main Dashboard
   - Test historical data collection

---

## Troubleshooting

### PakBus Connection Issues
- Verify PakBus address matches
- Check security code
- Ensure datalogger is reachable (ping test)
- Check firewall allows port 6785 (default PakBus)

### HTTP POST Issues
- Verify server IP is correct
- Check port 5000 is open
- Review HTTPStatus in datalogger public table
- Check Stratus server logs

### Serial Connection Issues
- Verify correct COM port
- Check baud rate matches (9600)
- Use null modem cable for direct connection
- Check Device Manager for port conflicts

---

## Example: Complete Weather Station

```basic
' Minimum viable weather station for Stratus
Public AirTC, RH, WS_ms, WindDir, Rain_mm, BP_mbar

DataTable(WeatherData,True,-1)
  DataInterval(0,1,Min,10)
  Average(1,AirTC,FP2,False)
  Sample(1,RH,FP2)
  Average(1,WS_ms,FP2,False)
  Sample(1,WindDir,FP2)
  Totalize(1,Rain_mm,FP2,False)
  Average(1,BP_mbar,FP2,False)
EndTable

BeginProg
  Scan(5,Sec,1,0)
    ' Your sensor measurements here
    CallTable(WeatherData)
  NextScan
EndProg
```

Stratus will automatically discover and poll the `WeatherData` table!

---

## Support

- **Documentation:** See STATION_SETUP.md in project root
- **Issues:** GitHub Issues
- **Campbell Scientific:** https://www.campbellsci.com/support
