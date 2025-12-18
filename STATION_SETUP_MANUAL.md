# STRATUS Weather Station Setup Manual

This guide covers how to configure weather stations with different manufacturers and communication protocols in the STRATUS monitoring platform.

---

## Table of Contents

1. [Supported Manufacturers](#supported-manufacturers)
2. [Campbell Scientific Stations](#campbell-scientific-stations)
3. [Davis Instruments Stations](#davis-instruments-stations)
4. [Rika Weather Stations](#rika-weather-stations)
5. [Generic/IoT Platforms](#genericiiot-platforms)
6. [Connection Types Reference](#connection-types-reference)
7. [Step-by-Step Setup Guide](#step-by-step-setup-guide)
8. [Troubleshooting](#troubleshooting)

---

## Supported Manufacturers

STRATUS supports three main categories of weather stations:

| Manufacturer | Datalogger Models | Connection Types |
|--------------|-------------------|------------------|
| **Campbell Scientific** | CR1000X, CR1000XE, CR6, CR300, CR310, CR350, CR800, CR850, CR3000, Aspen 10 | 9 protocols |
| **Davis Instruments** | Vantage Pro2, Vantage Pro2 Plus, Vantage Vue, WeatherLink Live, AirLink | 6 protocols |
| **Rika** | RK900-01, RK600-02, RK500-01 | 3 protocols |
| **Generic/IoT** | ESP32, ESP8266, Arduino, Raspberry Pi, Custom | 7 protocols |

---

## Campbell Scientific Stations

### Supported Dataloggers

| Model | Description | Typical Use |
|-------|-------------|-------------|
| **CR1000X** | Flagship datalogger, high-speed I/O | Research, complex networks |
| **CR1000XE** | Enhanced CR1000X with more memory | Long-term remote deployments |
| **CR6** | Universal measurement platform | Multi-sensor networks |
| **CR300** | Compact, low-power | Simple remote stations |
| **CR310** | CR300 with Ethernet | IP-connected stations |
| **CR350** | CR300 with WiFi/cellular | Wireless stations |
| **CR800** | Mid-range datalogger | Agricultural monitoring |
| **CR850** | CR800 with extended channels | Larger sensor arrays |
| **CR3000** | High-channel count | Complex research stations |
| **Aspen 10** | Edge computing datalogger | IoT and AI applications |

### Connection Types for Campbell Scientific

#### 1. CampbellCloud API
**Best for:** Remote stations already using Campbell's cloud service

**Configuration:**
- API Key: Obtain from CampbellCloud dashboard
- API Endpoint: `https://api.campbellcloud.io/v1`
- Station ID: Your registered station ID

```
Connection Type: campbell_cloud
API Key: your-api-key-here
API Endpoint: https://api.campbellcloud.io/v1
Poll Interval: 60 seconds
```

#### 2. HTTP/IP Direct
**Best for:** Stations with Ethernet connectivity (CR310, NL240, etc.)

**Configuration:**
- IP Address: Static IP of the datalogger
- Port: 6785 (default PakBus/TCP)
- PakBus Address: 1-4094 (usually 1)
- Security Code: 0 (or your configured code)

```
Connection Type: http
IP Address: 192.168.1.100
Port: 6785
PakBus Address: 1
Security Code: 0
Data Table: OneMin
```

#### 3. WiFi Direct (CR6/Aspen)
**Best for:** CR6 or Aspen 10 with WiFi module

**Configuration:**
- SSID: Datalogger's WiFi network name
- IP Address: Usually 192.168.1.1 in AP mode
- Port: 6785
- Security: WPA2 password

```
Connection Type: wifi
IP Address: 192.168.1.1
Port: 6785
SSID: CR6_Station_01
Password: your-wifi-password
```

#### 4. BLE/NFC
**Best for:** Short-range mobile configuration

**Configuration:**
- Device Name: Bluetooth device identifier
- PIN: Pairing code

```
Connection Type: ble_nfc
Device Name: CR6-BLE-001
PIN: 1234
```

#### 5. Serial RS232
**Best for:** Direct wired connection, legacy systems

**Configuration:**
- Serial Port: COM port or /dev/ttyUSB0
- Baud Rate: 115200 (or as configured)
- PakBus Address: 1

```
Connection Type: serial
Serial Port: /dev/ttyUSB0
Baud Rate: 115200
PakBus Address: 1
Security Code: 0
```

#### 6. LoRa
**Best for:** Long-range, low-power remote stations

**Configuration:**
- LoRa Gateway IP: Gateway server address
- Device EUI: Unique device identifier
- App Key: Application encryption key

```
Connection Type: lora
Gateway IP: 192.168.1.50
Device EUI: 0011223344556677
App Key: your-app-key-here
Spreading Factor: SF7
```

#### 7. GSM/GPRS (2G/3G)
**Best for:** Remote areas with cellular coverage

**Configuration:**
- APN: Mobile carrier APN
- SIM PIN: If required
- Static IP or Dynamic DNS hostname

```
Connection Type: gsm_gprs
APN: internet.carrier.com
SIM PIN: 1234
IP Address: station.dyndns.org
Port: 6785
```

#### 8. 4G/LTE
**Best for:** High-bandwidth remote stations

**Configuration:**
- APN: LTE carrier APN
- Static IP or Dynamic DNS
- VPN settings if applicable

```
Connection Type: 4g_lte
APN: lte.carrier.com
IP Address: 203.0.113.50
Port: 6785
VPN: optional-vpn-endpoint
```

#### 9. MQTT
**Best for:** IoT integration, real-time streaming

**Configuration:**
- Broker URL: MQTT broker address
- Topic: Data topic pattern
- Client ID: Unique identifier
- Username/Password: If authenticated

```
Connection Type: mqtt
Broker URL: mqtt://broker.example.com:1883
Topic: stations/campbell/+/data
Client ID: stratus-client-001
Username: mqtt-user
Password: mqtt-password
QoS: 1
```

---

## Davis Instruments Stations

### Supported Models

| Model | Description | Sensors | Wireless |
|-------|-------------|---------|----------|
| **Vantage Pro2** | Professional-grade AWS | 8+ parameters | 900MHz |
| **Vantage Pro2 Plus** | With UV and Solar sensors | 10+ parameters | 900MHz |
| **Vantage Vue** | Consumer-grade compact | 6 parameters | 900MHz |
| **WeatherLink Live** | WiFi/Ethernet hub | Data aggregator | WiFi/LAN |
| **AirLink** | Air quality sensor | PM1, PM2.5, PM10, AQI | WiFi |

### Connection Types for Davis Instruments

#### 1. WeatherLink Cloud API v2
**Best for:** Modern Davis stations with WeatherLink Live or Console

**Configuration:**
- API Key: From weatherlink.com developer portal
- API Secret: For authentication
- Station ID: Registered station ID

```
Connection Type: weatherlink_cloud
API Key: your-api-key
API Secret: your-api-secret
Station ID: 123456
API Endpoint: https://api.weatherlink.com/v2
Poll Interval: 60 seconds
```

#### 2. WeatherLink Live (Local API)
**Best for:** Direct LAN access to WeatherLink Live device

**Configuration:**
- IP Address: WeatherLink Live device IP
- Port: 80 (HTTP)
- No authentication required locally

```
Connection Type: weatherlink_local
IP Address: 192.168.1.50
Port: 80
Poll Interval: 10 seconds
```

**Local API Endpoints:**
- Real-time: `http://{ip}/v1/current_conditions`
- Real-time broadcast: UDP port 22222

#### 3. Serial/USB (WeatherLink Cable)
**Best for:** Direct connection to Vantage console via serial cable

**Configuration:**
- Serial Port: COM port or /dev/ttyUSB0
- Baud Rate: 19200 (Davis default)
- Protocol: LOOP/LOOP2 packets

```
Connection Type: serial
Serial Port: /dev/ttyUSB0
Baud Rate: 19200
Protocol: davis_loop2
```

**Serial Commands:**
- `LOOP n`: Request n LOOP packets
- `LPS 2 n`: Request n LOOP2 packets
- `GETTIME`: Get console time
- `RXCHECK`: Radio diagnostics

#### 4. IP Data Logger (6555)
**Best for:** Vantage stations with IP Data Logger accessory

**Configuration:**
- IP Address: Data logger IP
- Port: 22222 (default)
- Protocol: TCP streaming

```
Connection Type: tcp_ip
IP Address: 192.168.1.60
Port: 22222
Protocol: davis_tcp
```

#### 5. RF Receiver (900MHz Wireless)
**Best for:** Receiving data directly from Davis ISS sensors

**Configuration:**
- Receiver: rtl_433 compatible SDR or Davis Envoy
- Frequency: 902-928 MHz (US) or 868 MHz (EU)
- Transmitter ID: ISS sensor suite ID

```
Connection Type: rf_receiver
Receiver Type: rtl_433
Frequency: 902.4 MHz
Transmitter ID: 1
```

**Supported Sensors via RF:**
- Temperature/Humidity (ISS)
- Wind speed/direction
- Rain collector
- UV/Solar (if equipped)

#### 6. MQTT (via WeatherLink Live)
**Best for:** IoT integration with home automation

**Configuration:**
- Broker: MQTT broker address
- Topic: Custom topic structure
- Data format: JSON

```
Connection Type: mqtt
Broker URL: mqtt://broker.example.com:1883
Topic: weather/davis/+/data
Client ID: stratus-davis-001
Data Format: json
```

### Davis Data Fields Reference

| Parameter | LOOP2 Field | Units | Description |
|-----------|-------------|-------|-------------|
| Temperature | OutsideTemp | °F (convert to °C) | Outside temperature |
| Humidity | OutsideHum | % | Outside humidity |
| Pressure | Barometer | inHg (convert to hPa) | Barometric pressure |
| Wind Speed | WindSpeed | mph (convert to km/h) | Current wind |
| Wind Direction | WindDir | degrees | Wind direction 0-359 |
| Wind Gust | WindGust10 | mph | 10-minute gust |
| Rain Rate | RainRate | in/hr | Current rain rate |
| Daily Rain | DayRain | in | Rain since midnight |
| Solar Radiation | SolarRad | W/m² | Solar radiation |
| UV Index | UV | index | UV index |
| Dew Point | DewPoint | °F | Calculated dew point |
| Battery Status | TxBatteryStatus | bitmap | Transmitter battery |
| Console Battery | ConsoleBatteryVolt | volts | Console battery |

### AirLink Air Quality Integration

Davis AirLink provides PM1, PM2.5, PM10, and AQI data.

**Configuration:**
```
Connection Type: weatherlink_cloud
Device Type: airlink
API Key: your-api-key
Station ID: airlink-device-id
```

**AirLink Data Fields:**
| Parameter | Field | Units | Description |
|-----------|-------|-------|-------------|
| PM1 | pm_1 | µg/m³ | Particulate < 1µm |
| PM2.5 | pm_2p5 | µg/m³ | Particulate < 2.5µm |
| PM10 | pm_10 | µg/m³ | Particulate < 10µm |
| AQI | aqi | index | Air Quality Index |
| Temperature | temp | °F | Sensor temperature |
| Humidity | hum | % | Sensor humidity |

---

## Rika Weather Stations

### Supported Dataloggers

| Model | Description | Sensors |
|-------|-------------|---------|
| **RK900-01** | Professional AWS | 6-8 parameters |
| **RK600-02** | Compact station | 5-6 parameters |
| **RK500-01** | Basic station | 4-5 parameters |

### Connection Types for Rika

#### 1. RikaCloud API
**Best for:** Stations registered with Rika's cloud platform

**Configuration:**
- API Key: From RikaCloud dashboard
- Station Serial: Device serial number

```
Connection Type: rika_cloud
API Key: your-rika-api-key
API Endpoint: https://api.rikacloud.com/v1
Station Serial: RK900-2024-001
Poll Interval: 60 seconds
```

#### 2. HTTP/IP Direct
**Best for:** Rika stations with Ethernet module

**Configuration:**
- IP Address: Station's IP
- Port: 80 (HTTP) or 8080

```
Connection Type: http
IP Address: 192.168.1.101
Port: 80
Protocol: HTTP REST
Data Format: JSON
```

#### 3. MQTT
**Best for:** IoT integration

**Configuration:**
- Broker: MQTT server
- Topic: rika/stations/+/telemetry

```
Connection Type: mqtt
Broker URL: mqtt://broker.example.com:1883
Topic: rika/stations/{serial}/telemetry
Client ID: rika-client-001
```

---

## Generic/IoT Platforms

### Supported Platforms

| Platform | Use Case | Connectivity |
|----------|----------|--------------|
| **ESP32** | DIY weather stations | WiFi, BLE |
| **ESP8266** | Budget IoT sensors | WiFi |
| **Arduino MKR WiFi 1010** | Educational/hobby | WiFi |
| **Arduino Nano 33 IoT** | Compact projects | WiFi, BLE |
| **Arduino Portenta H7** | Industrial IoT | WiFi, Ethernet |
| **Raspberry Pi Pico W** | Python-based | WiFi |
| **Davis Vantage Pro2** | Consumer-grade pro | Serial, IP |
| **Davis Vantage Vue** | Entry-level | Serial |
| **Custom GSM/4G/LoRa/Sigfox/NB-IoT** | Specialized deployments | Various |

### Connection Types for Generic/IoT

#### 1. Arduino IoT Cloud
**Best for:** Arduino-based stations using Arduino Cloud

**Configuration:**
- Device ID: Arduino Cloud device ID
- API Key: Cloud API credentials
- Thing ID: IoT Thing identifier

```
Connection Type: arduino_iot_cloud
Device ID: abc123-device-id
API Key: your-arduino-api-key
Thing ID: weather-station-thing
```

#### 2. Blynk IoT
**Best for:** Blynk-connected devices

**Configuration:**
- Auth Token: Blynk device token
- Server: Blynk server URL

```
Connection Type: blynk_iot
Auth Token: your-blynk-token
Server: blynk.cloud
Virtual Pins: V0-V10
```

#### 3. HTTP/IP
**Best for:** RESTful API endpoints

**Configuration:**
- API Endpoint: Your station's HTTP endpoint
- Authentication: API key or Basic auth

```
Connection Type: http
API Endpoint: http://192.168.1.105/api/weather
API Key: optional-api-key
Data Format: JSON
Poll Interval: 60 seconds
```

#### 4. WiFi Direct (ESP32/ESP8266)
**Best for:** Direct WiFi connection to ESP devices

**Configuration:**
- SSID: Device's AP network
- IP: Usually 192.168.4.1
- Endpoint: /data or /api/sensors

```
Connection Type: wifi
IP Address: 192.168.4.1
Port: 80
Endpoint: /api/sensors
SSID: ESP32-Weather
Password: esp32-password
```

#### 5. BLE (Bluetooth Low Energy)
**Best for:** Short-range mobile data collection

**Configuration:**
- Device Name: BLE advertisement name
- Service UUID: Weather data service
- Characteristic UUID: Data characteristic

```
Connection Type: ble
Device Name: WeatherSensor-001
Service UUID: 0000181A-0000-1000-8000-00805F9B34FB
Characteristic UUID: 00002A6E-0000-1000-8000-00805F9B34FB
```

#### 6. MQTT
**Best for:** All IoT platforms supporting MQTT

**Configuration:**
- Broker: Public or private MQTT broker
- Topic: Station data topic

```
Connection Type: mqtt
Broker URL: mqtt://mqtt.example.com:1883
Topic: weather/sensors/{device_id}/data
Client ID: generic-weather-001
TLS: true (recommended)
```

#### 7. LoRa/LoRaWAN
**Best for:** Long-range, low-power remote sensors

**Configuration:**
- Network Server: TTN, ChirpStack, etc.
- Device EUI: 16-character hex
- App EUI: Application identifier
- App Key: Encryption key

```
Connection Type: lora
Network Server: https://eu1.cloud.thethings.network
Device EUI: 0011223344556677
App EUI: 70B3D57ED0000000
App Key: your-128-bit-app-key
```

---

## Connection Types Reference

| Connection Type | Manufacturers | Range | Power | Bandwidth | Use Case |
|-----------------|---------------|-------|-------|-----------|----------|
| HTTP/IP | All | LAN/WAN | Mains | High | Office/Lab |
| WiFi Direct | Campbell, Generic | 50m | Battery/Mains | Medium | Short-range |
| Serial RS232 | Campbell | 15m | Mains | Low | Legacy systems |
| LoRa | Campbell, Generic | 15km | Low | Low | Remote rural |
| GSM/GPRS | Campbell | Global | Medium | Low | Remote cellular |
| 4G/LTE | Campbell | Global | Medium | High | High-data remote |
| MQTT | All | Internet | Varies | Medium | IoT integration |
| BLE/NFC | Campbell, Generic | 10m | Very Low | Low | Mobile config |
| Cloud APIs | All | Internet | N/A | High | Managed services |

---

## Step-by-Step Setup Guide

### Adding a New Station

1. **Navigate to Stations Page**
   - Click "Stations" in the sidebar
   - Click "Add Station" button

2. **Enter Basic Information**
   - Station Name: Descriptive name (e.g., "Farm North Field")
   - Location: Physical address or description
   - Latitude/Longitude: GPS coordinates
   - Altitude: Elevation in meters
   - Timezone: Station's local timezone

3. **Select Manufacturer**
   - Choose from: Campbell Scientific, Rika, or Generic/IoT
   - This determines available datalogger models and connection options

4. **Select Datalogger Model**
   - Choose the specific model installed at your station
   - This affects available connection protocols

5. **Configure Connection**
   - Select connection type from available options
   - Fill in required fields based on connection type:
     - **IP-based**: IP address, port, credentials
     - **Serial**: Port, baud rate, PakBus settings
     - **Cloud API**: API key, endpoint, station ID
     - **MQTT**: Broker URL, topic, client ID
     - **LoRa**: Gateway, device EUI, app key

6. **Set Data Collection Parameters**
   - Data Table: Table name in datalogger (e.g., "OneMin")
   - Poll Interval: How often to fetch data (seconds)
   - Data Format: JSON, XML, or binary

7. **Test Connection**
   - Click "Test Connection" to verify settings
   - Check for successful data retrieval
   - Review error messages if connection fails

8. **Save Station**
   - Click "Save" to create the station
   - Station will appear in your dashboard

### Example Configurations

#### Campbell Scientific CR1000X via HTTP
```
Manufacturer: Campbell Scientific
Datalogger: CR1000X
Connection Type: HTTP/IP
IP Address: 192.168.1.100
Port: 6785
PakBus Address: 1
Security Code: 0
Data Table: OneMin
Poll Interval: 60
```

#### Rika RK900-01 via Cloud API
```
Manufacturer: Rika
Datalogger: RK900-01
Connection Type: RikaCloud API
API Key: rk_api_key_abc123
API Endpoint: https://api.rikacloud.com/v1
Station Serial: RK900-2024-001
Poll Interval: 60
```

#### ESP32 DIY Station via MQTT
```
Manufacturer: Generic/IoT
Platform: ESP32
Connection Type: MQTT
Broker URL: mqtt://broker.hivemq.com:1883
Topic: home/weather/esp32-001/data
Client ID: stratus-esp32-client
TLS: false
QoS: 1
Poll Interval: 60
```

---

## Troubleshooting

### Connection Issues

| Problem | Possible Cause | Solution |
|---------|---------------|----------|
| Connection timeout | Firewall blocking | Open port 6785 (or configured port) |
| Authentication failed | Wrong credentials | Verify API key/password |
| No data received | Wrong data table | Check datalogger program for table names |
| Intermittent connection | Network instability | Use retry mechanism, check signal strength |
| TLS/SSL errors | Certificate issues | Verify CA certificates, check date/time |

### Campbell Scientific Specific

- **PakBus errors**: Verify PakBus address matches datalogger setting
- **Security code rejected**: Check security code in datalogger
- **Table not found**: Ensure data table exists and has records

### Rika Specific

- **API rate limiting**: Reduce poll interval to 120+ seconds
- **Invalid serial**: Verify station serial number format

### Generic/IoT Specific

- **MQTT not connecting**: Check broker URL and port
- **JSON parse errors**: Verify data format matches expected schema
- **BLE pairing failed**: Ensure device is in pairing mode

---

## Data Format Requirements

STRATUS expects the following parameters (all optional except timestamp):

| Parameter | Unit | Description |
|-----------|------|-------------|
| temperature | °C | Air temperature |
| temperatureMin | °C | Minimum temperature |
| temperatureMax | °C | Maximum temperature |
| humidity | % | Relative humidity |
| pressure | hPa | Station pressure |
| pressureSeaLevel | hPa | Sea level pressure |
| windSpeed | km/h | Wind speed |
| windDirection | ° | Wind direction (0-360) |
| windGust | km/h | Wind gust |
| rainfall | mm | Current rainfall |
| rainfall24h | mm | 24-hour total |
| solarRadiation | W/m² | Solar radiation |
| uvIndex | index | UV index |
| dewPoint | °C | Dew point temperature |
| soilTemperature | °C | Soil temperature |
| soilMoisture | % | Soil moisture |
| batteryVoltage | V | Logger battery |
| panelTemperature | °C | Solar panel temperature |

---

## Supabase Database Setup

To persist your stations when deploying to Netlify:

1. Create a Supabase account at https://supabase.com
2. Create a new project
3. Go to Project Settings > Database
4. Copy the "Connection string" (URI format)
5. In Replit, add `SUPABASE_DATABASE_URL` secret with this value
6. Run schema migration: `npx drizzle-kit push`

Your stations and data will now persist across deployments.

---

## Support

For additional help:
- Email: esterhuizen2k@proton.me
- Documentation: See app Settings page

Credit: Lukas Esterhuizen 2025
