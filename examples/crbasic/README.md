# Stratus Weather Server - Campbell Scientific Integration Guide

## Overview

Stratus Weather Server supports multiple methods for connecting to Campbell Scientific dataloggers. This guide explains each connection method and provides example CRBASIC programs.

> **CLOUD DEPLOYMENT NOTE**
> Stratus is designed for cloud deployment on Oracle Cloud or similar platforms.
> All connections use TCP/IP - serial/RS232 is not available in cloud environments.

**Cloud Server:** Deploy to Oracle Cloud for free 24/7 access (see ORACLE_CLOUD_DEPLOYMENT.md)  
**API Endpoint:** `http://YOUR_VM_IP:5000/api/ingest/{stationId}`

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
| **HTTP POST** | Remote stations with internet | CR1000X, CR6, CR300 with Ethernet/WiFi/Cellular | REST API |
| **PakBus/TCP** | Stations with Ethernet | Any CR series with NL121 or built-in Ethernet | Campbell Connection Manager |
| **LoRaWAN** | Long-range remote stations | LoRa-equipped stations | LoRa Protocol Manager |
| **Cellular** | 4G/LTE connected stations | CR series with CELL210/220 modem | Cellular Gateway |

---

## Method 1: HTTP POST (Recommended for Cloud)

**How it works:** The datalogger pushes data to Stratus's REST API at regular intervals. Best for remote stations with cellular or WiFi connectivity. Works with Oracle Cloud deployment.

### CRBASIC Program
Use `stratus_http_post_station.cr1x` - Configure your Oracle Cloud server IP and station ID.

### Configuration in CRBASIC
```basic
' For Oracle Cloud deployment (recommended for 24/7 access):
Const STRATUS_SERVER = "YOUR_ORACLE_VM_IP"  ' Your Oracle Cloud VM public IP
Const STRATUS_PORT = 5000
Const USE_TLS = False  ' Set True if you configure Nginx + SSL
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
5. Upload program to datalogger with Ethernet/WiFi/Cellular connection

---

## Method 2: PakBus over TCP/IP

**How it works:** Stratus acts as a PakBus client and polls data from your datalogger's data tables over TCP/IP. This uses the native Campbell Scientific protocol over an Ethernet connection.

### CRBASIC Program
Use `stratus_pakbus_station.cr1x` - No special communication code needed! Just create your data tables and Stratus will poll them.

### Stratus Configuration

1. **Add Station** → Select "Campbell Scientific"
2. **Connection Settings:**
   ```
   Protocol: PakBus
   Connection: TCP/IP
   Host: 192.168.1.100 (datalogger IP)
   Port: 6785 (default PakBus TCP port)
   PakBus Address: 1
   Security Code: 0 (or your code)
   ```
3. **Data Collection:**
   ```
   Table: WeatherData
   Poll Interval: 60 seconds
   Collect Mode: Since Last Collection
   ```

### Network Setup
- Connect datalogger Ethernet port (or NL121) to network
- Configure static IP or DHCP
- Enable PakBus/TCP on port 6785
- For remote access, configure port forwarding or VPN

---

## Method 3: Cellular (4G/LTE) via TCP Gateway

**How it works:** The datalogger connects through a cellular modem that provides TCP/IP connectivity. Stratus connects to the modem's public IP or gateway service.

### Hardware Options
- Campbell CELL210/CELL220 modem
- Sierra Wireless RV50/RV55 with Aleos gateway
- Any cellular modem with TCP-to-PakBus bridge

### Stratus Configuration
```
Connection Type: GSM/Cellular
Gateway Host: your-static-ip or gateway-service.com
Gateway Port: 6785
PakBus Address: 1
```

### Setup Steps
1. Install and configure cellular modem at station
2. Obtain static IP or configure gateway service
3. Configure modem's TCP server mode
4. Add station in Stratus with gateway details

---

## Method 4: LoRaWAN

**How it works:** Data is transmitted via LoRa radio to a LoRaWAN gateway, then to a network server (like The Things Network). Stratus connects to the network server via MQTT.

### Stratus Configuration
```
Connection Type: LoRa
Network Server: eu1.cloud.thethings.network
Application ID: your-ttn-app-id
Application Key: your-app-key
Device EUI: your-device-eui
```

### Setup Steps
1. Register device on The Things Network or ChirpStack
2. Configure device credentials (EUI, keys)
3. Program datalogger to encode and transmit via LoRa
4. Enter network server credentials in Stratus

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

Stratus will automatically discover and poll the `WeatherData` table over TCP/IP!

---

## Typical Setup Workflow

1. **Install CRBASIC Program**
   - Use Device Configuration Utility or LoggerNet
   - Upload appropriate `.cr1x` file to datalogger

2. **Configure Datalogger Network**
   - Set static IP or DHCP
   - Configure PakBus settings
   - Set security code if needed

3. **Ensure Network Connectivity**
   - Direct Ethernet: Connect to LAN
   - Cellular: Install SIM, configure APN
   - LoRaWAN: Ensure gateway coverage

4. **Configure Stratus**
   - Add new station
   - Select connection type (TCP, GSM, LoRa)
   - Configure field mapping
   - Set polling interval

5. **Verify Connection**
   - Check Campbell Dashboard in Stratus
   - Verify data appears on main Dashboard
   - Test historical data collection

---

## Troubleshooting

### TCP/IP Connection Issues
- Verify IP address is correct and reachable
- Check PakBus address matches
- Verify security code
- Ensure firewall allows port 6785 (default PakBus)
- Test with ping command

### HTTP POST Issues
- Verify server URL is correct
- Check HTTPS/TLS configuration
- Review HTTPStatus in datalogger public table
- Check Stratus server logs

### Cellular Connection Issues
- Verify SIM card is active with data plan
- Check APN configuration
- Verify gateway service is running
- Check signal strength at station location

### LoRaWAN Issues
- Verify device is registered on network server
- Check gateway coverage and signal
- Verify application credentials
- Check for interference

---

## Support

- **Documentation:** See STATION_SETUP.md in project root
- **Issues:** GitHub Issues
- **Campbell Scientific:** https://www.campbellsci.com/support
