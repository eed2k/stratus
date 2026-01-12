/**
 * Station Setup Routes
 * Handles all station setup and configuration endpoints for different protocols
 */

import type { Express, RequestHandler } from "express";
import { storage } from "../localStorage";
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
      // Campbell Scientific stations use HTTP/TCP for 4G/cellular and LoRa for remote
      try {
        let adapter: any = null;

        switch (connectionType.toLowerCase()) {
          case "http":
          case "ip":
          case "wifi":
          case "4g":
          case "tcp":
          case "pakbus":
            const { HTTPAdapter } = await import("../protocols/httpAdapter");
            adapter = new HTTPAdapter(testConfig);
            break;

          case "lora":
            const { LoRaAdapter } = await import("../protocols/loraAdapter");
            adapter = new LoRaAdapter(testConfig);
            break;

          default:
            return res.status(400).json({
              success: false,
              message: `Unknown connection type: ${connectionType}. Supported: http, ip, wifi, 4g, tcp, pakbus, lora`,
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
          // Serial port discovery - NOT available in cloud deployment
          return res.json({
            devices: [],
            message: "Serial port discovery is not available in cloud deployment. Use TCP/IP, cellular, or LoRa connections instead.",
            status: "unsupported",
          });

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
        name: "Modbus TCP",
        types: ["modbus"],
        description: "Modbus TCP protocol over IP",
        requiredFields: ["host", "port"],
        optionalFields: ["slaveId"],
        examples: ["Modbus TCP devices", "Industrial sensors"],
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
        name: "GSM/4G",
        types: ["gsm", "4g"],
        description: "Cellular network via TCP gateway",
        requiredFields: ["gatewayHost"],
        optionalFields: ["gatewayPort", "apiEndpoint"],
        examples: ["Cellular modems with TCP gateway", "4G IoT gateways"],
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
        host: "192.168.1.100",
        port: 502,
        slaveId: 1,
        timeout: 5000,
      },
      dnp3: {
        connectionType: "dnp3",
        host: "192.168.1.1",
        port: 20000,
        masterAddress: 0,
        outstationAddress: 1,
      },
      gsm: {
        connectionType: "gsm",
        gatewayHost: "your-gateway.com",
        gatewayPort: 6785,
        apiEndpoint: "",
      },
      "4g": {
        connectionType: "4g",
        gatewayHost: "your-gateway.com",
        gatewayPort: 6785,
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
    // Desktop app focused on Campbell Scientific dataloggers
    const providers = [
      {
        id: "campbell_serial",
        name: "Campbell Scientific (RS232)",
        type: "serial",
        description: "Direct RS232 serial connection to Campbell dataloggers",
        requiredFields: ["serialPort", "baudRate"],
        documentationUrl: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_tcp",
        name: "Campbell Scientific (TCP/IP)",
        type: "tcp",
        description: "TCP/IP connection to Campbell dataloggers with ethernet/WiFi",
        requiredFields: ["ipAddress", "port"],
        documentationUrl: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_lora",
        name: "Campbell Scientific (LoRa)",
        type: "lora",
        description: "LoRa radio connection to remote Campbell dataloggers",
        requiredFields: ["loraFrequency", "deviceEUI"],
        documentationUrl: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_gsm",
        name: "Campbell Scientific (GSM/4G)",
        type: "cellular",
        description: "Cellular connection to Campbell dataloggers via GSM/4G",
        requiredFields: ["apn"],
        documentationUrl: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_mqtt",
        name: "Campbell Scientific (MQTT)",
        type: "mqtt",
        description: "MQTT protocol for Campbell dataloggers",
        requiredFields: ["broker", "topic"],
        documentationUrl: "https://www.campbellsci.com/",
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

      // For desktop Campbell Scientific focus, only detect relevant endpoints
      const detections: Record<string, string> = {
        campbellcloud: "campbell_tcp",
        konect: "campbell_tcp",
        campbell: "campbell_tcp",
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

      // Use detection result
      const finalDetection = endpointDetection;

      res.json({
        detected: !!finalDetection,
        provider: finalDetection?.provider,
        confidence: finalDetection?.confidence || 0,
        connectionType: finalDetection?.connectionType || "serial",
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
   * Auto-configure Campbell Scientific connection
   * POST /api/station-setup/configure/campbell
   * Body: { connectionType, serialPort, ipAddress, port }
   */
  app.post("/api/station-setup/configure/campbell", async (req, res) => {
    try {
      const { connectionType, serialPort, ipAddress, port } = req.body;

      if (!connectionType) {
        return res.status(400).json({
          success: false,
          message: "connectionType is required (serial, tcp_ip, lora, gsm, mqtt)",
        });
      }

      // Configure the connection using ServiceDetector
      const result = await ServiceDetector.configureCampbellConnection(connectionType, {
        serialPort,
        ipAddress,
        port,
      });

      res.json(result);
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
    // Desktop app focused on Campbell Scientific dataloggers
    const providersInfo = [
      {
        id: "campbell_serial",
        name: "Campbell Scientific (RS232)",
        description: "Direct RS232 serial connection to Campbell Scientific dataloggers like CR300, CR1000X, CR6",
        icon: "🔌",
        capabilities: [
          "Direct PakBus communication",
          "Real-time data collection",
          "Table data retrieval",
          "Program upload",
        ],
        setup: "Connect via RS232 serial cable",
        documentation: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_tcp",
        name: "Campbell Scientific (TCP/IP)",
        description: "TCP/IP connection to Campbell dataloggers with ethernet or WiFi modules",
        icon: "🌐",
        capabilities: [
          "Network-based communication",
          "Remote data access",
          "Multiple station support",
          "PakBus over TCP",
        ],
        setup: "Enter IP address and port (default: 6785)",
        documentation: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_lora",
        name: "Campbell Scientific (LoRa)",
        description: "LoRa radio connection for remote Campbell dataloggers",
        icon: "📡",
        capabilities: [
          "Long-range communication",
          "Low power consumption",
          "Remote site access",
          "Mesh networking",
        ],
        setup: "Configure LoRa frequency band",
        documentation: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_gsm",
        name: "Campbell Scientific (GSM/4G)",
        description: "Cellular connection to Campbell dataloggers via GSM or 4G/LTE",
        icon: "📱",
        capabilities: [
          "Cellular connectivity",
          "Remote site access",
          "SMS alerts",
          "Global coverage",
        ],
        setup: "Configure APN settings",
        documentation: "https://www.campbellsci.com/",
      },
      {
        id: "campbell_mqtt",
        name: "Campbell Scientific (MQTT)",
        description: "MQTT protocol for Campbell dataloggers with IoT gateway",
        icon: "📨",
        capabilities: [
          "Publish/Subscribe model",
          "Lightweight protocol",
          "Cloud integration",
          "Real-time streaming",
        ],
        setup: "Configure MQTT broker and topic",
        documentation: "https://www.campbellsci.com/",
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
   * List stations from Rika Cloud (Not supported in desktop version)
   * GET /api/station-setup/rika/stations
   */
  app.get("/api/station-setup/rika/stations", async (req, res) => {
    res.status(501).json({
      success: false,
      message: "Rika Cloud integration is not supported. This application focuses on Campbell Scientific dataloggers.",
    });
  });
}

