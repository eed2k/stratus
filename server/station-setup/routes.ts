/**
 * Station Setup Routes
 * Handles all station setup and configuration endpoints for different protocols
 */

import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { protocolManager } from "../protocols/protocolManager";
import {
  validateConnectionConfig,
  buildProtocolConfig,
} from "./validation";
import { ServiceDetector } from "./serviceDetector";
import { StationIntegrationService } from "./integrationService";

export async function registerStationSetupRoutes(app: Express): Promise<void> {
  /**
   * Validate connection configuration without saving
   * POST /api/station-setup/validate
   * Body: { connectionType, config }
   */
  app.post("/api/station-setup/validate", async (req, res) => {
    try {
      const { connectionType, config } = req.body;

      if (!connectionType) {
        return res.status(400).json({
          valid: false,
          errors: ["connectionType is required"],
        });
      }

      const validation = validateConnectionConfig(connectionType, config || {});
      res.json(validation);
    } catch (error: any) {
      res.status(500).json({
        valid: false,
        errors: [error.message || "Validation error"],
      });
    }
  });

  /**
   * Test connection without saving station
   * POST /api/station-setup/test
   * Body: { connectionType, config }
   */
  app.post("/api/station-setup/test", async (req, res) => {
    try {
      const { connectionType, config } = req.body;

      if (!connectionType) {
        return res.status(400).json({
          success: false,
          message: "connectionType is required",
        });
      }

      // First validate
      const validation = validateConnectionConfig(connectionType, config || {});
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          errors: validation.errors,
        });
      }

      // Create temporary config with a fake station ID for testing
      const testConfig = buildProtocolConfig(9999, connectionType, config);

      // Try to create and test adapter without persistence
      try {
        let adapter: any = null;

        switch (connectionType.toLowerCase()) {
          case "http":
          case "ip":
          case "wifi":
            const { HTTPAdapter } = await import("../protocols/httpAdapter");
            adapter = new HTTPAdapter(testConfig);
            break;

          case "mqtt":
            const { MQTTAdapter } = await import("../protocols/mqttAdapter");
            adapter = new MQTTAdapter(testConfig);
            break;

          case "lora":
            const { LoRaAdapter } = await import("../protocols/loraAdapter");
            adapter = new LoRaAdapter(testConfig);
            break;

          case "satellite":
            const { SatelliteAdapter } = await import(
              "../protocols/satelliteAdapter"
            );
            adapter = new SatelliteAdapter(testConfig);
            break;

          case "modbus":
          case "serial":
            const { ModbusAdapter } = await import(
              "../protocols/modbusAdapter"
            );
            adapter = new ModbusAdapter(testConfig);
            break;

          case "dnp3":
            const { DNP3Adapter } = await import("../protocols/dnp3Adapter");
            adapter = new DNP3Adapter(testConfig);
            break;

          case "ble":
            // BLE requires special handling (device discovery)
            return res.json({
              success: true,
              message:
                "BLE configuration valid. Run device discovery to complete setup.",
              warnings: [
                "BLE requires device to be powered and in discoverable mode",
              ],
            });

          case "gsm":
          case "4g":
            // GSM/4G requires device availability
            return res.json({
              success: true,
              message:
                "GSM/4G configuration valid. Test depends on device availability.",
              warnings: [
                "Ensure GSM/4G modem is powered and has carrier signal",
              ],
            });

          default:
            return res.status(400).json({
              success: false,
              message: `Unknown connection type: ${connectionType}`,
            });
        }

        if (!adapter) {
          return res.status(500).json({
            success: false,
            message: "Failed to create adapter",
          });
        }

        // Attempt connection
        const connected = await Promise.race([
          adapter.connect(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Connection timeout")), 30000)
          ),
        ]);

        if (connected) {
          try {
            const data = await adapter.readData();
            await adapter.disconnect();
            res.json({
              success: true,
              message: "Connection successful and data received",
              dataAvailable: !!data,
            });
          } catch (dataError: any) {
            await adapter.disconnect();
            res.json({
              success: true,
              message: "Connection successful but no data available yet",
              dataAvailable: false,
              warning: dataError.message,
            });
          }
        } else {
          await adapter.disconnect();
          res.status(400).json({
            success: false,
            message: "Connection failed",
          });
        }
      } catch (error: any) {
        res.status(400).json({
          success: false,
          message: error.message || "Connection test failed",
        });
      }
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Test error",
      });
    }
  });

  /**
   * Discover devices (for BLE, GSM, etc.)
   * GET /api/station-setup/discover?type=ble
   */
  app.get("/api/station-setup/discover", async (req, res) => {
    try {
      const { type } = req.query as { type?: string };

      if (!type) {
        return res.status(400).json({
          devices: [],
          message: "Discovery type is required (ble, gsm, lora, etc.)",
        });
      }

      const devices: any[] = [];

      switch (type.toLowerCase()) {
        case "ble":
          // BLE device discovery would require noble or similar
          // For now, return placeholder
          return res.json({
            devices: [],
            message:
              "BLE discovery requires device to be in range and advertiser",
            status: "ready",
          });

        case "wifi":
          // WiFi network discovery
          return res.json({
            devices: [],
            message: "WiFi discovery requires access to network interfaces",
            status: "ready",
          });

        case "serial":
          // Serial port discovery
          try {
            const { SerialPort } = await import("serialport");
            const ports = await SerialPort.list();
            return res.json({
              devices: ports.map((p) => ({
                path: p.path,
                manufacturer: p.manufacturer,
                serialNumber: p.serialNumber,
                productId: p.productId,
                vendorId: p.vendorId,
              })),
              message: "Serial ports detected",
              status: "success",
            });
          } catch (error: any) {
            return res.json({
              devices: [],
              message: error.message,
              status: "error",
            });
          }

        default:
          return res.status(400).json({
            devices: [],
            message: `Unknown discovery type: ${type}`,
          });
      }
    } catch (error: any) {
      res.status(500).json({
        devices: [],
        message: error.message || "Discovery error",
      });
    }
  });

  /**
   * Get available connection types and their capabilities
   * GET /api/station-setup/types
   */
  app.get("/api/station-setup/types", (req, res) => {
    const types = [
      {
        name: "HTTP/REST",
        types: ["http", "ip", "wifi"],
        description: "Direct REST API endpoints, cloud services (Campbell, WeatherLink, etc.)",
        requiredFields: ["apiEndpoint"],
        optionalFields: ["apiKey", "port"],
        examples: [
          "Campbell Cloud",
          "WeatherLink Cloud",
          "RikaCloud",
          "Arduino IoT",
          "Blynk",
          "ThingSpeak",
        ],
      },
      {
        name: "MQTT",
        types: ["mqtt"],
        description: "MQTT broker-based messaging",
        requiredFields: ["broker", "topic"],
        optionalFields: ["port", "apiKey", "username", "password"],
        defaultPort: 1883,
        examples: ["Mosquitto", "AWS IoT Core", "Azure IoT Hub"],
      },
      {
        name: "LoRa",
        types: ["lora"],
        description: "LoRaWAN Long-Range Wide-Area Network",
        requiredFields: ["deviceEUI"],
        optionalFields: ["appEUI", "apiKey", "apiEndpoint"],
        examples: ["The Things Network", "LoRa Cloud", "AWS IoT LoRaWAN"],
      },
      {
        name: "Satellite",
        types: ["satellite"],
        description: "Satellite data communication",
        requiredFields: ["imei"],
        optionalFields: ["apiKey", "apiEndpoint", "deviceId"],
        examples: ["Inmarsat", "Iridium", "SatComm services"],
      },
      {
        name: "Modbus",
        types: ["modbus", "serial"],
        description: "Serial Modbus RTU/ASCII protocol",
        requiredFields: ["serialPort"],
        optionalFields: ["baudRate", "slaveId", "host"],
        defaultBaudRate: 9600,
        examples: ["Modbus RTU over Serial", "Modbus over TCP"],
      },
      {
        name: "DNP3",
        types: ["dnp3"],
        description: "DNP3 SCADA protocol",
        requiredFields: ["host", "port", "masterAddress", "outstationAddress"],
        optionalFields: [],
        examples: ["SCADA systems", "Utility monitoring"],
      },
      {
        name: "BLE",
        types: ["ble"],
        description: "Bluetooth Low Energy for short-range wireless",
        requiredFields: ["deviceAddress"],
        optionalFields: ["deviceId", "serviceUUID"],
        examples: ["BLE weather sensors", "IoT devices"],
      },
      {
        name: "GSM/4G",
        types: ["gsm", "4g"],
        description: "Cellular network communication",
        requiredFields: [],
        optionalFields: ["serialPort", "phoneNumber", "apiEndpoint"],
        examples: ["Cellular modems", "IoT gateways"],
      },
    ];

    res.json(types);
  });

  /**
   * Get configuration template for a specific connection type
   * GET /api/station-setup/template/:type
   */
  app.get("/api/station-setup/template/:type", (req, res) => {
    const { type } = req.params;

    const templates: Record<string, any> = {
      http: {
        connectionType: "http",
        apiEndpoint: "https://api.example.com/weather",
        apiKey: "",
        host: "",
        port: 443,
        timeout: 30000,
      },
      ip: {
        connectionType: "ip",
        host: "192.168.1.100",
        port: 80,
        apiEndpoint: "/api/weather",
        timeout: 30000,
      },
      mqtt: {
        connectionType: "mqtt",
        broker: "mqtt.example.com",
        port: 1883,
        topic: "weather/station/data",
        username: "",
        password: "",
        qos: 1,
      },
      lora: {
        connectionType: "lora",
        deviceEUI: "",
        appEUI: "",
        apiKey: "",
        apiEndpoint: "https://api.thethingsnetwork.org",
      },
      satellite: {
        connectionType: "satellite",
        imei: "",
        deviceId: "",
        apiKey: "",
        apiEndpoint: "",
      },
      modbus: {
        connectionType: "modbus",
        serialPort: "COM3",
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        slaveId: 1,
      },
      serial: {
        connectionType: "serial",
        serialPort: "/dev/ttyUSB0",
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
      },
      dnp3: {
        connectionType: "dnp3",
        host: "192.168.1.1",
        port: 20000,
        masterAddress: 0,
        outstationAddress: 1,
      },
      ble: {
        connectionType: "ble",
        deviceAddress: "XX:XX:XX:XX:XX:XX",
        deviceId: "",
        serviceUUID: "",
        characteristicUUID: "",
      },
      gsm: {
        connectionType: "gsm",
        serialPort: "COM4",
        phoneNumber: "",
        apiEndpoint: "",
      },
      "4g": {
        connectionType: "4g",
        serialPort: "COM4",
        apn: "",
        apiEndpoint: "",
      },
    };

    const template = templates[type.toLowerCase()];
    if (!template) {
      return res.status(404).json({
        message: `No template found for connection type: ${type}`,
      });
    }

    res.json(template);
  });

  /**
   * Get supported service providers for HTTP connections
   * GET /api/station-setup/providers
   */
  app.get("/api/station-setup/providers", (req, res) => {
    const providers = [
      {
        id: "campbell_cloud",
        name: "Campbell Scientific Cloud",
        type: "http",
        description: "Campbell Scientific dataloggers connected via Campbell Cloud",
        apiEndpoint: "https://api.campbellcloud.com",
        requiredFields: ["apiKey"],
        documentationUrl:
          "https://www.campbellsci.com/",
      },
      {
        id: "weatherlink_cloud",
        name: "Davis WeatherLink Cloud",
        type: "http",
        description: "Davis Instruments weather stations via WeatherLink",
        apiEndpoint: "https://api.weatherlink.com/v2",
        requiredFields: ["apiKey"],
        documentationUrl: "https://www.weatherlink.com/",
      },
      {
        id: "rika_cloud",
        name: "Rika Cloud",
        type: "http",
        description: "Rika weather station solutions",
        apiEndpoint: "https://cloud.rika.co",
        requiredFields: ["apiKey"],
        documentationUrl: "https://www.rika.co",
      },
      {
        id: "arduino_iot",
        name: "Arduino IoT Cloud",
        type: "http",
        description: "Arduino MKR WiFi 1010 and compatible devices",
        apiEndpoint: "https://api2.arduino.cc/iot",
        requiredFields: ["apiKey"],
        documentationUrl: "https://create.arduino.cc/iot",
      },
      {
        id: "blynk",
        name: "Blynk IoT Platform",
        type: "http",
        description: "Blynk IoT platform for connected devices",
        apiEndpoint: "https://blynk.cloud",
        requiredFields: ["apiKey"],
        documentationUrl: "https://blynk.io",
      },
      {
        id: "thingspeak",
        name: "ThingSpeak",
        type: "http",
        description: "MathWorks ThingSpeak for IoT applications",
        apiEndpoint: "https://api.thingspeak.com",
        requiredFields: ["apiKey"],
        documentationUrl: "https://thingspeak.com",
      },
      {
        id: "thenetwork",
        name: "The Things Network",
        type: "lora",
        description: "Open LoRaWAN network",
        apiEndpoint: "https://api.thethingsnetwork.org",
        requiredFields: ["deviceEUI", "apiKey"],
        documentationUrl: "https://www.thethingsnetwork.org",
      },
    ];

    res.json(providers);
  });

  /**
   * Auto-detect provider from API endpoint
   * POST /api/station-setup/detect
   * Body: { apiEndpoint, host }
   */
  app.post("/api/station-setup/detect", async (req, res) => {
    try {
      const { apiEndpoint, host } = req.body;
      const endpoint = (apiEndpoint || host || "").toLowerCase();

      const detections: Record<string, string> = {
        campbellcloud: "campbell_cloud",
        konect: "campbell_cloud",
        weatherlink: "weatherlink_cloud",
        rika: "rika_cloud",
        arduino: "arduino_iot",
        blynk: "blynk",
        thingspeak: "thingspeak",
        thethingsnetwork: "thenetwork",
      };

      let detectedProvider = null;
      for (const [key, provider] of Object.entries(detections)) {
        if (endpoint.includes(key)) {
          detectedProvider = provider;
          break;
        }
      }

      res.json({
        detected: !!detectedProvider,
        provider: detectedProvider,
        connectionType: detectedProvider ? "http" : "unknown",
      });
    } catch (error: any) {
      res.status(500).json({
        detected: false,
        message: error.message,
      });
    }
  });

  /**
   * Detect service provider from endpoint and test
   * POST /api/station-setup/detect-service
   * Body: { apiEndpoint, apiKey? }
   */
  app.post("/api/station-setup/detect-service", async (req, res) => {
    try {
      const { apiEndpoint, apiKey } = req.body;

      if (!apiEndpoint) {
        return res.status(400).json({
          success: false,
          message: "apiEndpoint is required",
        });
      }

      // Detect from endpoint string
      const endpointDetection = ServiceDetector.detectFromEndpoint(apiEndpoint);

      // Test endpoint if apiKey provided
      const testResult = apiKey
        ? await ServiceDetector.testEndpoint(apiEndpoint, apiKey)
        : null;

      // Combine detections
      const finalDetection = testResult?.provider
        ? {
            provider: testResult.provider,
            confidence: 0.95,
            connectionType: "http",
          }
        : endpointDetection;

      res.json({
        detected: !!finalDetection,
        provider: finalDetection?.provider,
        confidence: finalDetection?.confidence || 0,
        connectionType: finalDetection?.connectionType || "http",
        suggestedConfig: (finalDetection as any)?.suggestedConfig || {},
        testResult: testResult ? { success: testResult.success } : null,
      });
    } catch (error: any) {
      res.status(500).json({
        detected: false,
        message: error.message,
      });
    }
  });

  /**
   * Auto-configure Campbell Cloud
   * POST /api/station-setup/configure/campbell
   * Body: { apiKey }
   */
  app.post("/api/station-setup/configure/campbell", async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: "apiKey is required",
        });
      }

      const result = await ServiceDetector.configureCampbellCloud(apiKey);

      if (!result.success) {
        return res.status(400).json(result);
      }

      // Extract and format available stations
      const stations = result.organizations?.map((org) => ({
        id: org.uid,
        name: org.name,
        type: "organization",
      })) || [];

      res.json({
        success: true,
        organizations: stations,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  });

  /**
   * Auto-configure Rika Cloud
   * POST /api/station-setup/configure/rika
   * Body: { apiKey }
   */
  app.post("/api/station-setup/configure/rika", async (req, res) => {
    try {
      const { apiKey } = req.body;

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: "apiKey is required",
        });
      }

      const result = await ServiceDetector.configureRikaCloud(apiKey);

      if (!result.success) {
        return res.status(400).json(result);
      }

      res.json({
        success: true,
        stations: result.stations,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  });

  /**
   * List available providers and their capabilities
   * GET /api/station-setup/providers/info
   */
  app.get("/api/station-setup/providers/info", (req, res) => {
    const providersInfo = [
      {
        id: "campbell_cloud",
        name: "Campbell Scientific Cloud",
        description:
          "Official cloud service for Campbell Scientific dataloggers",
        icon: "🔬",
        capabilities: [
          "Real-time data streaming",
          "Historical data access",
          "Device management",
          "Alert configuration",
        ],
        setup: "Quick Setup Available",
        documentation:
          "https://www.campbellsci.com/cloud-connect",
      },
      {
        id: "weatherlink_cloud",
        name: "Davis WeatherLink Cloud",
        description: "WeatherLink cloud platform for Davis weather stations",
        icon: "🌤️",
        capabilities: [
          "Real-time weather data",
          "Historical graphs",
          "Storm tracking",
          "API access",
        ],
        setup: "Requires WeatherLink account",
        documentation: "https://www.weatherlink.com/",
      },
      {
        id: "rika_cloud",
        name: "Rika Cloud",
        description: "Rika weather station cloud services",
        icon: "☁️",
        capabilities: [
          "Real-time monitoring",
          "Alert thresholds",
          "Data export",
          "Mobile access",
        ],
        setup: "Quick Setup Available",
        documentation: "https://www.rika.co",
      },
      {
        id: "arduino_iot",
        name: "Arduino IoT Cloud",
        description: "Arduino MKR WiFi 1010 and IoT cloud platform",
        icon: "🤖",
        capabilities: [
          "Cloud storage",
          "Dashboard creation",
          "API access",
          "Mobile app",
        ],
        setup: "Requires Arduino account",
        documentation: "https://create.arduino.cc/iot",
      },
      {
        id: "blynk",
        name: "Blynk IoT Platform",
        description: "Blynk IoT platform for connected devices",
        icon: "💡",
        capabilities: [
          "Real-time monitoring",
          "Custom dashboards",
          "Mobile notifications",
          "Hardware support",
        ],
        setup: "Requires Blynk account",
        documentation: "https://blynk.io",
      },
      {
        id: "thingspeak",
        name: "ThingSpeak",
        description: "MathWorks ThingSpeak IoT analytics",
        icon: "📊",
        capabilities: [
          "Data storage",
          "Visualizations",
          "MATLAB analysis",
          "Real-time alerts",
        ],
        setup: "Requires ThingSpeak account",
        documentation: "https://thingspeak.com",
      },
      {
        id: "mqtt",
        name: "MQTT Broker",
        description: "Generic MQTT message broker",
        icon: "📡",
        capabilities: [
          "Publish/Subscribe",
          "Multiple devices",
          "Custom topics",
          "TLS support",
        ],
        setup: "Custom Configuration",
        documentation: "https://mqtt.org",
      },
      {
        id: "http_generic",
        name: "Generic HTTP API",
        description: "Any HTTP/REST endpoint",
        icon: "🌐",
        capabilities: [
          "Custom endpoints",
          "API key support",
          "POST/GET methods",
          "JSON payloads",
        ],
        setup: "Custom Configuration",
        documentation: "https://www.postman.com/",
      },
    ];

    res.json(providersInfo);
  });

  /**
   * Setup new station with complete workflow
   * POST /api/station-setup/setup
   * Body: { name, stationType, connectionType, ... }
   */
  app.post("/api/station-setup/setup", async (req, res) => {
    try {
      const result = await StationIntegrationService.setupStation(req.body);
      const statusCode = result.success ? 201 : 400;
      res.status(statusCode).json(result);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Setup failed",
      });
    }
  });

  /**
   * Setup multiple stations from provider
   * POST /api/station-setup/setup-bulk
   * Body: { provider, apiKey, basePayload }
   */
  app.post("/api/station-setup/setup-bulk", async (req, res) => {
    try {
      const { provider, apiKey, basePayload } = req.body;

      if (!provider || !apiKey) {
        return res.status(400).json({
          success: false,
          message: "provider and apiKey are required",
        });
      }

      const results = await StationIntegrationService.setupMultipleStations(
        provider,
        apiKey,
        basePayload || {}
      );

      const successCount = results.filter((r) => r.success).length;
      res.json({
        success: results.length > 0 && successCount === results.length,
        totalStations: results.length,
        successCount,
        results,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Bulk setup failed",
      });
    }
  });

  /**
   * Update station connection settings
   * PATCH /api/station-setup/:stationId
   * Body: { connectionType, apiEndpoint, ... }
   */
  app.patch("/api/station-setup/:stationId", async (req, res) => {
    try {
      const stationId = parseInt(req.params.stationId);
      const result = await StationIntegrationService.updateStationConnection(
        stationId,
        req.body
      );
      const statusCode = result.success ? 200 : 400;
      res.status(statusCode).json(result);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message || "Update failed",
      });
    }
  });

  /**
   * List stations from Campbell Cloud
   * GET /api/station-setup/campbell/stations?apiKey=...&orgUid=...&locUid=...
   */
  app.get("/api/station-setup/campbell/stations", async (req, res) => {
    try {
      const { apiKey, orgUid, locUid } = req.query;

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: "apiKey query parameter is required",
        });
      }

      const stations = await StationIntegrationService.fetchCampbellStations(
        apiKey as string,
        orgUid as string,
        locUid as string
      );

      res.json({
        success: true,
        stations,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  });

  /**
   * List stations from Rika Cloud
   * GET /api/station-setup/rika/stations?apiKey=...
   */
  app.get("/api/station-setup/rika/stations", async (req, res) => {
    try {
      const { apiKey } = req.query;

      if (!apiKey) {
        return res.status(400).json({
          success: false,
          message: "apiKey query parameter is required",
        });
      }

      const stations = await StationIntegrationService.fetchRikaStations(
        apiKey as string
      );

      res.json({
        success: true,
        stations,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  });
}

