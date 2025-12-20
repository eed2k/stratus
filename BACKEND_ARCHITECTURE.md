# System Architecture Overview

## Complete Backend System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND APPLICATION                                 │
│                    (React/Vue/Svelte/Angular)                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Station Setup Form        • Real-time Data Display      • Settings Panel  │
│  • WebSocket Subscription    • Sensor Monitoring           • Provider Config │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 │ HTTP/WebSocket
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    API LAYER: Express.js Routes                              │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  ┌──────────────────────────────────────────────────────────────────────────┐
│  │ Station Setup Routes (/api/station-setup/*)                              │
│  ├──────────────────────────────────────────────────────────────────────────┤
│  │ [1] Validation        → validation.ts        → Config validators         │
│  │ [2] Connection Test   → integrationService.ts→ testStationConnection()  │
│  │ [3] Provider Detect   → serviceDetector.ts   → 15+ provider patterns    │
│  │ [4] Configuration     → integrationService.ts→ Data normalization       │
│  │ [5] Setup Complete    → storage.ts           → Database persistence     │
│  │ [6] Registration      → protocolManager.ts   → Active connection mgmt   │
│  │
│  │ Endpoints: /validate /test /detect-service /setup /setup-bulk            │
│  │            /configure/* /providers/* /discover /types /template          │
│  └──────────────────────────────────────────────────────────────────────────┘
│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SERVICE ORCHESTRATION LAYER                               │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  ┌──────────────────────────┐  ┌──────────────────────────┐
│  │  integrationService.ts   │  │  serviceDetector.ts      │
│  │  ────────────────────────┤  │  ──────────────────────  │
│  │ • setupStation()         │  │ • detectFromEndpoint()   │
│  │ • testConnection()       │  │ • detectFromResponse()   │
│  │ • fetchCampbell()        │  │ • testEndpoint()         │
│  │ • fetchRika()            │  │ • 15+ provider patterns  │
│  │ • setupMultiple()        │  │ • Confidence scoring     │
│  │ • updateConnection()     │  │ • Response analysis      │
│  └──────────────────────────┘  └──────────────────────────┘
│           │                              │
│           └──────────────┬───────────────┘
│                          │
│                   validation.ts
│                   • validateHTTP()
│                   • validateMQTT()
│                   • validateLoRa()
│                   • validateSatellite()
│                   • validateModbus()
│                   • validateDNP3()
│                   • validateBLE()
│                   • validateGSM()
│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    DATA PARSER & CLOUD SERVICE LAYER                         │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
│  │  campbellCloud.ts    │  │  rikaCloud.ts        │  │ genericWeather.ts    │
│  │  ────────────────────┤  │  ────────────────────┤  │ ──────────────────── │
│  │ Campbell API Client  │  │  Rika API Client     │  │ Field Aliasing       │
│  │ • Organization nav   │  │ • Station enum       │  │ • 30+ field vars     │
│  │ • Location nav       │  │ • Alert mgmt         │  │ • Unit conversion    │
│  │ • Station nav        │  │ • Data retrieval     │  │ • Range validation   │
│  │ • Data fetch         │  │ • Hist. data         │  │ • Service parsers:   │
│  │ • 15+ field mapping  │  │ • 12+ field mapping  │  │   - WeatherLink      │
│  │                      │  │                      │  │   - Blynk            │
│  │                      │  │                      │  │   - ThingSpeak       │
│  │                      │  │                      │  │   - Arduino IoT      │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────────┘
│
│  ┌──────────────────────────────────────────────────────────────────────────┐
│  │ Data Normalization Schema (All parsers normalize to this):                │
│  │ • temperature (°C)      • humidity (%)         • pressure (hPa)          │
│  │ • windSpeed (m/s)       • windDirection (°)    • rainfall (mm)           │
│  │ • solarRadiation (W/m²) • dewPoint (°C)        • batteryLevel (%)        │
│  │ • signalStrength (dBm)  • timestamp            • quality (0-100)         │
│  └──────────────────────────────────────────────────────────────────────────┘
│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PROTOCOL MANAGEMENT LAYER                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│
│                         protocolManager.ts
│                    ┌────────────────────────┐
│                    │  createAdapter()       │
│                    │  factory method        │
│                    └────────────┬───────────┘
│                                 │
│          ┌──────────────────────┼──────────────────────┬─────────────┐
│          ▼                      ▼                      ▼             ▼
│    ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
│    │ httpAdapter  │  │  mqttAdapter     │  │ loraAdapter  │  │  bleAdapter  │
│    │ (REST APIs)  │  │  (Pub/Sub)       │  │  (TTN)       │  │  (BLE GATT)  │
│    └──────────────┘  └──────────────────┘  └──────────────┘  └──────────────┘
│    ┌──────────────┐  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
│    │  dnp3Adapter │  │ modbusAdapter    │  │ satAdapter   │  │ gsmAdapter   │
│    │  (DNP3)      │  │ (Modbus TCP/RTU) │  │ (Iridium)    │  │ (AT Commands)│
│    └──────────────┘  └──────────────────┘  └──────────────┘  └──────────────┘
│
│  All adapters implement: IProtocolAdapter
│  • connect()                    • disconnect()
│  • sendData()                   • receiveData()
│  • subscribe()                  • unsubscribe()
│  • emit('data', normalizedData) • emit('error', error)
│  • emit('connected')            • emit('disconnected')
│
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    CONNECTION TRANSPORT LAYER                                │
├─────────────────────────────────────────────────────────────────────────────┤
│
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  │  HTTPS   │  │  MQTT    │  │  LoRa    │  │   BLE    │  │ Modbus   │
│  │ (TCP 443)│  │(TCP 1883)│  │ (LoRa PY)│  │ (BLE GW) │  │(TCP/RTU) │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  │   DNP3   │  │ Satellite│  │   GSM    │  │ WebSocket│
│  │(TCP 20000)│ │ (Radio)  │  │ (AT Cmds)│  │(WS 8080) │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘
│
│                        ▼
│         ┌──────────────────────────────┐
│         │  Weather Stations/Devices    │
│         │  ──────────────────────────  │
│         │ • Campbell Scientific         │
│         │ • Rika Cloud Stations         │
│         │ • Generic HTTP Services       │
│         │ • IoT Devices (LoRa, BLE)     │
│         │ • Cellular Modems (GSM/4G)    │
│         │ • Satellite Terminals         │
│         │ • Legacy Equipment (Modbus)   │
│         └──────────────────────────────┘
│
└──────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

### Setup Workflow
```
User Input
    │
    ▼
[Validation Layer]
    validateConnectionConfig()
    ✓ Check type, URL, credentials format
    │
    ├─✗ Return validation errors
    │
    ▼ ✓
[Connection Test]
    integrationService.testStationConnection()
    ✓ Establish connection
    ✓ Verify credentials
    ✓ Receive sample data
    │
    ├─✗ Return connection errors
    │
    ▼ ✓
[Service Detection] (if HTTP)
    serviceDetector.detectFromResponse()
    ✓ Analyze response structure
    ✓ Match against 15+ patterns
    ✓ Score confidence
    │
    ├─✗ Mark as "generic"
    │
    ▼ ✓
[Data Normalization]
    selectParser(detectedService)
    ✓ campbellCloud.ts
    ✓ rikaCloud.ts
    ✓ genericWeather.ts
    ✓ Sample data mapping
    │
    ▼
[Database Persistence]
    storage.createStation()
    ✓ Insert station record
    ✓ Store connection config
    ✓ Store provider info
    │
    ▼
[Protocol Manager Registration]
    protocolManager.createAdapter()
    ✓ Instantiate adapter
    ✓ Initialize connection
    ✓ Start data collection
    │
    ▼
[Real-time Updates]
    adapter.on('data', (normalized) => {
        // Store in DB
        // Broadcast via WebSocket
        // Update dashboard
    })
```

### Real-time Data Flow
```
Weather Station (every minute)
    │
    ▼
Protocol Adapter
    httpAdapter.receiveData()
    OR
    mqttAdapter.receiveData()
    OR
    loraAdapter.receiveData()
    │
    ▼
Data Normalization
    parser.parse(rawData)
    ✓ Extract fields
    ✓ Unit conversion
    ✓ Range validation
    │
    ▼
Event Emission
    adapter.emit('data', {
        temperature: 23.5,
        humidity: 65,
        pressure: 1013,
        ...
    })
    │
    ▼
Database Update
    storage.saveReading(stationId, normalizedData)
    │
    ▼
WebSocket Broadcast
    wss.emit('station-data', {
        stationId,
        timestamp,
        normalizedData
    })
    │
    ▼
Frontend Display
    Component subscribes to WebSocket
    Updates real-time data display
```

## Component Interaction Map

```
┌─────────────────────────────────────────────────────────┐
│                    User Request                          │
│            POST /api/station-setup/setup                │
└────────────────────────────┬────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         [Validate]   [Detect Service] [Integration]
              │              │              │
         validation    serviceDetector  integration
            .ts            .ts           Service.ts
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              [Data Parser]    [Storage Layer]
            genericWeather.ts    storage.ts
            campbellCloud.ts
              rikaCloud.ts
                    │                 │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    ▼                 ▼
              [Protocol Manager] [Database]
              protocolManager.ts
                    │
                    ▼
              [Active Connection]
              Adapter instance
              (HTTP, MQTT, LoRa, BLE, etc.)
```

## Service Layer Dependencies

```
Routes (18 endpoints)
    ├── Validation
    ├── Integration Service
    │   ├── Service Detector
    │   ├── Data Parsers
    │   │   ├── Campbell Cloud Client
    │   │   ├── Rika Cloud Client
    │   │   └── Generic Weather Parser
    │   ├── Protocol Manager
    │   │   └── Protocol Adapters (8 types)
    │   └── Storage Layer
    │       └── Database (PostgreSQL)
    │
    └── WebSocket Handler
        └── Protocol Manager (Event Emitter)
            └── Active Adapters
```

## Technology Stack

```
Frontend ─────────► Express.js API ─────────► Node.js Runtime
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
    HTTP Routes    WebSocket Handler  Static Files
         │               │
    station-setup/    /ws/protocols/*
    routes.ts         (Real-time updates)
         │
    ┌────┴────────────────────────────┐
    ▼                                  ▼
Services                        External Services
    ├── Integration Service       ├── Campbell Scientific
    ├── Service Detector          ├── Rika Cloud
    └── Data Parsers             ├── Weather Services
                                 └── IoT Platforms
                                    
    Adapters                    Connection Protocols
    ├── HTTP/REST              ├── HTTPS (TLS)
    ├── MQTT                   ├── MQTT (TLS)
    ├── LoRa                   ├── LoRa
    ├── BLE                    ├── BLE GATT
    ├── Modbus                 ├── Modbus TCP/RTU
    ├── DNP3                   ├── DNP3
    ├── Satellite              ├── Satellite
    └── GSM/4G                 └── GSM AT Commands
    
    Database                    Libraries
    └── PostgreSQL             ├── express
                               ├── axios
                               ├── mqtt
                               ├── serialport
                               ├── noble
                               ├── drizzle-orm
                               └── ws (WebSocket)
```

## Configuration Flow

```
┌─────────────────────────────────────────────────────┐
│         User Selects Connection Type                 │
└────────────────┬────────────────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
    HTTP/REST         Other Type
    Credentials       Protocol-specific
    Endpoint URL      Configuration
         │
         ▼
   [Validation.ts]
   validateHTTPConfig()
   ├── Check URL format
   ├── Validate credentials
   ├── Check timeout/retry settings
   │
   ▼
   [Test Connection]
   integrationService.testStationConnection()
   ├── Make test request
   ├── Parse response
   ├── Extract sample data
   │
   ▼
   [Detect Service]
   serviceDetector.detectFromResponse()
   ├── Analyze field names
   ├── Check response structure
   ├── Match patterns (15+)
   ├── Score confidence
   │
   ├── If Campbell → use campbellCloud.ts
   ├── If Rika → use rikaCloud.ts
   └── Else → use genericWeather.ts
         │
         ▼
   [Normalize Data]
   parser.parse(sampleData)
   ├── Map fields
   ├── Convert units
   ├── Validate ranges
   │
   ▼
   [Store Configuration]
   storage.createStation()
   ├── Station record
   ├── Connection config
   ├── Provider info
   ├── Field mapping
   │
   ▼
   [Register with Manager]
   protocolManager.createAdapter()
   ├── Instantiate adapter
   ├── Connect to station
   ├── Start polling
   │
   ▼
   [Monitor & Update]
   Real-time data flow
   └── WebSocket broadcast
```

---

## Key Integration Points

### 1. Express Routes → Services
```typescript
// routes.ts
POST /api/station-setup/setup
  → integrationService.setupStation(config)
    → validation.validateConnectionConfig(config)
    → integrationService.testStationConnection(config)
    → serviceDetector.detectFromEndpoint(config.url)
    → selectParser(detectedService)
    → storage.createStation(stationData)
    → protocolManager.createAdapter(...)
```

### 2. Data Parser → WebSocket Broadcast
```typescript
// Adapter event handlers
adapter.on('data', (rawData) => {
  const normalized = parser.parse(rawData);
  storage.saveReading(stationId, normalized);
  wss.broadcast({
    event: 'station-data',
    stationId,
    data: normalized
  });
});
```

### 3. Service Detection → Configuration
```typescript
// If Campbell detected:
const client = new CampbellCloudClient(apiKey);
const orgs = await client.listOrganizations();
const locations = await client.listLocations(orgId);
const stations = await client.listStations(locationId);

// Auto-populate configuration
```

---

## Performance & Scalability

```
Single Server Instance
├── 100-1000 concurrent WebSocket connections
├── 50-100 active protocol adapters
├── 10,000+ readings per minute
└── Sub-100ms response times

Horizontal Scaling
├── API layer: Stateless (load balancer)
├── WebSocket layer: Sticky sessions per server
├── Data layer: Shared PostgreSQL database
├── Storage layer: Connection pooling
└── Cache layer: Redis (optional)
```

---

*Architecture Complete - Ready for Frontend Integration*
