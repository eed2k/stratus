/**
 * Station Setup Validation
 * Validates connection configurations for all protocol types
 */

import { ProtocolConfig } from "../protocols/adapter";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export function validateHTTPConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.apiEndpoint && !config.host) {
    errors.push("Either apiEndpoint or host is required for HTTP connection");
  }

  if (!config.apiKey && config.apiEndpoint?.includes("cloud")) {
    warnings.push("API Key recommended for cloud endpoints");
  }

  if (config.port && (config.port < 1 || config.port > 65535)) {
    errors.push("Port must be between 1 and 65535");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateMQTTConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.broker && !config.host) {
    errors.push("[MQTT] Broker address is required for MQTT connection");
  }

  if (!config.topic && !config.apiEndpoint) {
    errors.push("[MQTT] Topic is required for MQTT subscription");
  }

  if (config.port && (config.port < 1 || config.port > 65535)) {
    errors.push("[MQTT] Port must be between 1 and 65535");
  }

  if (config.port && ![1883, 8883, 8084, 8085].includes(config.port)) {
    warnings.push(`[MQTT] Non-standard MQTT port ${config.port} detected`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateLoRaConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.deviceEUI) {
    errors.push("[LoRa] Device EUI is required for LoRa connection");
  } else if (!/^[0-9A-Fa-f]{16}$/.test(config.deviceEUI)) {
    errors.push("[LoRa] Device EUI must be a valid 16-character hex string");
  }

  if (!config.appEUI) {
    warnings.push("[LoRa] App EUI recommended for LoRa configuration");
  }

  if (!config.apiKey) {
    warnings.push("API Key recommended for LoRa cloud integration");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateSatelliteConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.imei && !config.deviceId) {
    errors.push("IMEI or Device ID is required for satellite connection");
  }

  if (!config.apiKey) {
    warnings.push("API Key recommended for satellite integration");
  }

  if (!config.apiEndpoint) {
    warnings.push("API Endpoint recommended for satellite cloud service");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateModbusConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.serialPort && !config.host) {
    errors.push("Either serial port or IP address is required for Modbus");
  }

  if (config.serialPort) {
    // Validate serial port format
    const portRegex = /^(COM\d+|\/dev\/ttyUSB\d+|\/dev\/ttyACM\d+)$/i;
    if (!portRegex.test(config.serialPort)) {
      errors.push(`Invalid serial port: ${config.serialPort}`);
    }

    if (!config.baudRate) {
      errors.push("Baud rate is required for serial Modbus");
    } else if (![9600, 19200, 38400, 57600, 115200].includes(config.baudRate)) {
      warnings.push(`Non-standard baud rate: ${config.baudRate}`);
    }
  }

  if (config.slaveId && (config.slaveId < 1 || config.slaveId > 247)) {
    errors.push("Modbus Slave ID must be between 1 and 247");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateDNP3Config(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.host) {
    errors.push("Host address is required for DNP3 connection");
  }

  if (!config.port) {
    errors.push("Port is required for DNP3 connection");
  }

  if (config.masterAddress === undefined) {
    errors.push("Master Address is required for DNP3");
  }

  if (config.outstationAddress === undefined) {
    errors.push("Outstation Address is required for DNP3");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateBLEConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.deviceAddress && !config.deviceId) {
    errors.push("Device Address or Device ID is required for BLE connection");
  }

  if (config.deviceAddress && !/^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/.test(config.deviceAddress)) {
    errors.push("Invalid BLE device address format (should be XX:XX:XX:XX:XX:XX)");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateGSMConfig(config: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.serialPort && !config.host) {
    errors.push("Either serial port or gateway host is required for GSM");
  }

  if (!config.phoneNumber && !config.apiEndpoint) {
    warnings.push("Phone number or API endpoint recommended for GSM configuration");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function validateConnectionConfig(
  connectionType: string,
  config: any
): ValidationResult {
  const typeMap: Record<string, (config: any) => ValidationResult> = {
    http: validateHTTPConfig,
    ip: validateHTTPConfig,
    wifi: validateHTTPConfig,
    mqtt: validateMQTTConfig,
    lora: validateLoRaConfig,
    satellite: validateSatelliteConfig,
    modbus: validateModbusConfig,
    serial: validateModbusConfig,
    dnp3: validateDNP3Config,
    ble: validateBLEConfig,
    gsm: validateGSMConfig,
    "4g": validateGSMConfig,
  };

  const validator = typeMap[connectionType.toLowerCase()];
  if (!validator) {
    return {
      valid: false,
      errors: [`Unknown connection type: ${connectionType}`],
    };
  }

  return validator(config);
}

export function buildProtocolConfig(
  stationId: number,
  connectionType: string,
  config: any
): ProtocolConfig {
  const protocolMap: Record<string, ProtocolConfig['protocol']> = {
    http: "http",
    ip: "http",
    wifi: "http",
    mqtt: "mqtt",
    lora: "lora",
    satellite: "satellite",
    modbus: "modbus",
    serial: "modbus",
    dnp3: "dnp3",
    ble: "http", // BLE adapter uses HTTP protocol for now
    gsm: "http",
    "4g": "http",
  };

  const connectionTypeMap: Record<string, ProtocolConfig['connectionType']> = {
    http: "http",
    ip: "http",
    wifi: "http",
    mqtt: "mqtt",
    lora: "lora",
    satellite: "satellite",
    modbus: "serial",
    serial: "serial",
    dnp3: "tcp",
    ble: "http",
    gsm: "tcp",
    "4g": "tcp",
  };

  return {
    stationId,
    protocol: protocolMap[connectionType] || "http",
    connectionType: connectionTypeMap[connectionType] || "http",
    ...config,
  };
}
