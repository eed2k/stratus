/**
 * Serial Monitor Routes
 * REST API endpoints for serial monitor functionality
 */

import type { Express, RequestHandler } from "express";
import { Server } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { serialMonitorService, type SerialMonitorConfig } from "./serialMonitorService";
import { z } from "zod";

const connectSchema = z.object({
  port: z.string(),
  baudRate: z.number().default(115200),
  dataBits: z.union([z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional(),
  parity: z.enum(['none', 'even', 'odd', 'mark', 'space']).optional(),
  stopBits: z.union([z.literal(1), z.literal(1.5), z.literal(2)]).optional(),
  flowControl: z.boolean().optional()
});

const sendSchema = z.object({
  data: z.string(),
  format: z.enum(['ascii', 'hex']).default('ascii')
});

export function registerSerialMonitorRoutes(app: Express, httpServer: Server): void {
  // Create WebSocket server for serial monitor
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrade for serial monitor
  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url === '/ws/serial-monitor') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        serialMonitorService.addClient(ws);
      });
    }
  });

  // List available serial ports
  app.get("/api/serial-monitor/ports", async (req, res) => {
    try {
      const ports = await serialMonitorService.listPorts();
      res.json(ports);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Get current status
  app.get("/api/serial-monitor/status", (req, res) => {
    try {
      const status = serialMonitorService.getStatus();
      res.json(status);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Connect to a serial port
  app.post("/api/serial-monitor/connect", async (req, res) => {
    try {
      const config = connectSchema.parse(req.body) as SerialMonitorConfig;
      const result = await serialMonitorService.connect(config);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ success: false, message: 'Invalid configuration', errors: error.errors });
      } else {
        res.status(500).json({ success: false, message: error.message });
      }
    }
  });

  // Disconnect from serial port
  app.post("/api/serial-monitor/disconnect", async (req, res) => {
    try {
      const result = await serialMonitorService.disconnect();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Send data to serial port
  app.post("/api/serial-monitor/send", async (req, res) => {
    try {
      const { data, format } = sendSchema.parse(req.body);
      const result = await serialMonitorService.send(data, format);
      
      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error: any) {
      if (error.name === 'ZodError') {
        res.status(400).json({ success: false, message: 'Invalid data', errors: error.errors });
      } else {
        res.status(500).json({ success: false, message: error.message });
      }
    }
  });

  // Clear message history
  app.post("/api/serial-monitor/clear", (req, res) => {
    try {
      serialMonitorService.clearHistory();
      res.json({ success: true, message: 'History cleared' });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error.message });
    }
  });

  console.log('Serial monitor routes registered');
}
