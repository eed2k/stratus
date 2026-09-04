// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Uplink normalizer for the HTTP POST ingest endpoint.
 *
 * Sigfox backend callbacks and LoRaWAN network servers all push JSON, but every
 * one of them uses a different envelope: the device identifier, the timestamp,
 * the decoded values and the raw payload sit in different places, and the raw
 * payload is hex on Sigfox and base64 on every LoRaWAN stack. This module
 * flattens all of them into one shape so the ingest route stays simple and a
 * new provider only needs a detector added here.
 *
 * Nothing in here talks to the database. It is pure parsing so it can be unit
 * tested and reused by the station-setup preview endpoint.
 */

export type UplinkFormat =
  | "stratus"     // native { data: {...} } body
  | "sigfox"      // Sigfox backend DATA_UPLINK callback
  | "ttn"         // The Things Stack v3 webhook
  | "chirpstack"  // ChirpStack v3 / v4 HTTP integration
  | "helium"      // Helium / generic console webhook
  | "flat"        // flat object of scalar readings
  | "unknown";

export interface UplinkMetadata {
  /** Received signal strength, dBm. */
  rssi?: number;
  /** Signal to noise ratio, dB. */
  snr?: number;
  /** LoRa spreading factor. */
  spreadingFactor?: number;
  /** LoRaWAN frame counter or Sigfox sequence number. */
  frameCounter?: number;
  /** LoRaWAN port. */
  port?: number;
  /** Number of gateways / base stations that heard the uplink. */
  gatewayCount?: number;
  /** Gateway or Sigfox base station identifier. */
  gatewayId?: string;
  /** Reported by Sigfox when another base station already delivered the message. */
  duplicate?: boolean;
}

export interface NormalizedUplink {
  format: UplinkFormat;
  /**
   * Candidate device identifiers, most specific first. The ingest route tries
   * each against the station's stored device ID / ingest ID.
   */
  deviceIds: string[];
  /** Device name if the provider supplies a friendly one. */
  deviceName?: string;
  /** Observation time, or null when the provider did not supply one. */
  timestamp: Date | null;
  /** Values the provider (or its own decoder) already decoded. */
  decoded: Record<string, unknown>;
  /** Raw uplink bytes, when present. */
  raw?: Buffer;
  /** Original encoding of the raw payload, for logging. */
  rawEncoding?: "hex" | "base64";
  metadata: UplinkMetadata;
}

const HEX_ONLY = /^[0-9a-fA-F]+$/;

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Parse a timestamp that may be ISO text, epoch seconds, or epoch millis. */
export function parseUplinkTime(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Sigfox sends epoch seconds; most LoRaWAN stacks send ISO text, but Helium
    // uses epoch millis. Anything past ~2001 in millis is above 1e12.
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function decodeHex(value: string): Buffer | undefined {
  const clean = value.replace(/[\s:]/g, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !HEX_ONLY.test(clean)) return undefined;
  return Buffer.from(clean, "hex");
}

function decodeBase64(value: string): Buffer | undefined {
  try {
    const buf = Buffer.from(value, "base64");
    // Reject strings that were not really base64 (Buffer is very forgiving).
    if (buf.length === 0) return undefined;
    return buf;
  } catch {
    return undefined;
  }
}

/**
 * Decode a payload string that may be hex or base64.
 * Hex is preferred when the string is unambiguously hex, since Sigfox always
 * sends hex and a short hex string is also valid base64.
 */
export function decodePayloadString(value: string): { raw: Buffer; encoding: "hex" | "base64" } | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const asHex = decodeHex(trimmed);
  if (asHex) return { raw: asHex, encoding: "hex" };
  const asB64 = decodeBase64(trimmed);
  if (asB64) return { raw: asB64, encoding: "base64" };
  return undefined;
}

/** Keep only scalar entries, which is all the weather mapper can use. */
function scalarsOnly(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    const t = typeof value;
    if (t === "number" || t === "boolean" || t === "string") out[key] = value;
  }
  return out;
}

/** Identify which provider sent this body. */
export function detectUplinkFormat(body: any): UplinkFormat {
  if (!body || typeof body !== "object") return "unknown";

  // Native Stratus body: { data: { ... } }
  if (body.data && typeof body.data === "object" && !Array.isArray(body.data)) return "stratus";

  // The Things Stack v3
  if (body.end_device_ids || body.uplink_message) return "ttn";

  // ChirpStack v4 (deviceInfo) and v3 (devEUI + applicationID)
  if (body.deviceInfo || (body.devEUI && (body.applicationID !== undefined || body.fPort !== undefined))) {
    return "chirpstack";
  }

  // Sigfox: device id plus a hex data string or a sequence number
  if (body.device && (typeof body.data === "string" || body.seqNumber !== undefined)) return "sigfox";

  // Helium / generic console
  if ((body.dev_eui || body.hotspots) && (body.payload !== undefined || body.decoded !== undefined)) {
    return "helium";
  }

  // A flat object of readings, e.g. { temperature: 21.4, humidity: 55 }
  const scalars = scalarsOnly(body);
  if (Object.keys(scalars).length > 0) return "flat";

  return "unknown";
}

/**
 * Flatten any supported uplink body into a single shape.
 * Never throws: an unrecognized body comes back as format "unknown".
 */
export function normalizeUplink(body: any): NormalizedUplink {
  const format = detectUplinkFormat(body);
  const result: NormalizedUplink = {
    format,
    deviceIds: [],
    timestamp: null,
    decoded: {},
    metadata: {},
  };
  if (!body || typeof body !== "object") return result;

  const pushId = (value: unknown) => {
    const s = str(value);
    if (s && !result.deviceIds.includes(s)) result.deviceIds.push(s);
  };

  switch (format) {
    case "stratus": {
      pushId(body.device);
      pushId(body.deviceId);
      result.deviceName = str(body.deviceName);
      result.timestamp = parseUplinkTime(body.timestamp ?? body.time);
      result.decoded = scalarsOnly(body.data);
      break;
    }

    case "sigfox": {
      // Sigfox device IDs are hex and case-insensitive; keep both cases so a
      // station configured either way still matches.
      const device = str(body.device);
      pushId(device);
      if (device) {
        pushId(device.toUpperCase());
        pushId(device.toLowerCase());
      }
      pushId(body.deviceTypeId);
      result.deviceName = str(body.deviceName ?? body.devicename);
      result.timestamp = parseUplinkTime(body.time ?? body.timestamp);

      if (typeof body.data === "string") {
        const decodedRaw = decodePayloadString(body.data);
        if (decodedRaw) {
          result.raw = decodedRaw.raw;
          result.rawEncoding = "hex";
        }
      }
      // Sigfox "custom payload config" variables arrive as extra top-level keys
      // when the callback body template includes them.
      const reserved = new Set([
        "device", "deviceTypeId", "deviceName", "devicename", "time", "timestamp", "data",
        "seqNumber", "seqNumberNext", "rssi", "snr", "avgSnr", "station", "duplicate",
        "lat", "lng", "operatorName", "countryCode", "computedLocation", "ack", "fixedLat", "fixedLng",
      ]);
      for (const [key, value] of Object.entries(scalarsOnly(body))) {
        if (!reserved.has(key)) result.decoded[key] = value;
      }
      // Some users nest their parsed variables instead.
      Object.assign(result.decoded, scalarsOnly(body.parsed ?? body.variables ?? body.payload));

      result.metadata = {
        rssi: num(body.rssi),
        snr: num(body.snr ?? body.avgSnr),
        frameCounter: num(body.seqNumber),
        gatewayId: str(body.station),
        duplicate: body.duplicate === true || body.duplicate === "true",
      };
      break;
    }

    case "ttn": {
      const ids = body.end_device_ids || {};
      pushId(ids.device_id);
      pushId(ids.dev_eui);
      pushId(ids.join_eui);
      result.deviceName = str(ids.device_id);

      const uplink = body.uplink_message || {};
      result.timestamp = parseUplinkTime(uplink.received_at ?? body.received_at ?? uplink.settings?.time);
      result.decoded = scalarsOnly(uplink.decoded_payload);

      if (typeof uplink.frm_payload === "string") {
        const raw = decodeBase64(uplink.frm_payload);
        if (raw) { result.raw = raw; result.rawEncoding = "base64"; }
      }

      const rx: any[] = Array.isArray(uplink.rx_metadata) ? uplink.rx_metadata : [];
      const best = rx.reduce((acc: any, cur: any) => {
        if (!acc) return cur;
        return (num(cur?.rssi) ?? -999) > (num(acc?.rssi) ?? -999) ? cur : acc;
      }, null);
      result.metadata = {
        rssi: num(best?.rssi),
        snr: num(best?.snr),
        spreadingFactor: num(uplink.settings?.data_rate?.lora?.spreading_factor),
        frameCounter: num(uplink.f_cnt),
        port: num(uplink.f_port),
        gatewayCount: rx.length || undefined,
        gatewayId: str(best?.gateway_ids?.gateway_id),
      };
      break;
    }

    case "chirpstack": {
      const info = body.deviceInfo || {};
      pushId(info.devEui ?? body.devEUI ?? body.devEui);
      pushId(info.deviceName ?? body.deviceName);
      pushId(body.devAddr);
      result.deviceName = str(info.deviceName ?? body.deviceName);
      result.timestamp = parseUplinkTime(body.time ?? body.publishedAt ?? body.rxInfo?.[0]?.time);
      // v4 uses "object", v3 used "objectJSON" (already parsed by some proxies).
      result.decoded = scalarsOnly(body.object ?? body.objectJSON ?? body.data_decoded);

      if (typeof body.data === "string") {
        const raw = decodeBase64(body.data);
        if (raw) { result.raw = raw; result.rawEncoding = "base64"; }
      }

      const rx: any[] = Array.isArray(body.rxInfo) ? body.rxInfo : [];
      const best = rx.reduce((acc: any, cur: any) => {
        if (!acc) return cur;
        return (num(cur?.rssi) ?? -999) > (num(acc?.rssi) ?? -999) ? cur : acc;
      }, null);
      result.metadata = {
        rssi: num(best?.rssi),
        snr: num(best?.loRaSNR ?? best?.snr),
        spreadingFactor: num(body.txInfo?.modulation?.lora?.spreadingFactor ?? body.txInfo?.loRaModulationInfo?.spreadingFactor),
        frameCounter: num(body.fCnt),
        port: num(body.fPort),
        gatewayCount: rx.length || undefined,
        gatewayId: str(best?.gatewayId ?? best?.gatewayID),
      };
      break;
    }

    case "helium": {
      pushId(body.dev_eui);
      pushId(body.device_id);
      pushId(body.name);
      result.deviceName = str(body.name);
      result.timestamp = parseUplinkTime(body.reported_at ?? body.received_at ?? body.timestamp);
      result.decoded = scalarsOnly(body.decoded?.payload ?? body.decoded ?? body.object);

      if (typeof body.payload === "string") {
        const raw = decodeBase64(body.payload);
        if (raw) { result.raw = raw; result.rawEncoding = "base64"; }
      }

      const hotspots: any[] = Array.isArray(body.hotspots) ? body.hotspots : [];
      const best = hotspots.reduce((acc: any, cur: any) => {
        if (!acc) return cur;
        return (num(cur?.rssi) ?? -999) > (num(acc?.rssi) ?? -999) ? cur : acc;
      }, null);
      result.metadata = {
        rssi: num(best?.rssi),
        snr: num(best?.snr),
        // Helium reports the data rate as e.g. "SF10BW125"; take only the SF.
        spreadingFactor: num(String(best?.spreading ?? best?.datarate ?? "").match(/SF(\d+)/i)?.[1]),
        frameCounter: num(body.fcnt),
        port: num(body.port),
        gatewayCount: hotspots.length || undefined,
        gatewayId: str(best?.name ?? best?.id),
      };
      break;
    }

    case "flat": {
      pushId(body.device ?? body.deviceId ?? body.dev_eui ?? body.id);
      result.timestamp = parseUplinkTime(body.timestamp ?? body.time ?? body.ts);
      const scalars = scalarsOnly(body);
      for (const key of ["device", "deviceId", "dev_eui", "id", "timestamp", "time", "ts"]) {
        delete scalars[key];
      }
      result.decoded = scalars;
      break;
    }

    default:
      break;
  }

  // Drop undefined metadata entries so the stored record stays tidy.
  for (const key of Object.keys(result.metadata) as Array<keyof UplinkMetadata>) {
    if (result.metadata[key] === undefined) delete result.metadata[key];
  }

  return result;
}

/** Human-readable provider name, used in logs and the setup UI. */
export function describeUplinkFormat(format: UplinkFormat): string {
  switch (format) {
    case "stratus": return "Stratus native JSON";
    case "sigfox": return "Sigfox backend callback";
    case "ttn": return "The Things Stack v3 webhook";
    case "chirpstack": return "ChirpStack HTTP integration";
    case "helium": return "Helium / generic console webhook";
    case "flat": return "Flat JSON readings";
    default: return "Unrecognized payload";
  }
}
