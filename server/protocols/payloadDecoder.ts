// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Declarative binary payload decoder for Sigfox and LoRaWAN uplinks.
 *
 * Sigfox caps a message at 12 bytes and LoRaWAN payloads are similarly tight,
 * so loggers pack readings as scaled integers rather than JSON. Rather than
 * requiring a code change (or running user-supplied JavaScript on the server,
 * which would be a remote code execution hole), each station stores a small
 * field map and this module applies it.
 *
 * Example spec for a 8 byte frame:
 *   {
 *     "fields": [
 *       { "name": "temperature",   "type": "int16",  "offset": 0, "scale": 0.01 },
 *       { "name": "humidity",      "type": "uint16", "offset": 2, "scale": 0.01 },
 *       { "name": "batteryVoltage","type": "uint16", "offset": 4, "scale": 0.001 },
 *       { "name": "rainfall",      "type": "uint16", "offset": 6, "scale": 0.1 }
 *     ]
 *   }
 */

export type PayloadFieldType =
  | "uint8" | "int8"
  | "uint16" | "int16"
  | "uint32" | "int32"
  | "float32"
  | "bool";

export interface PayloadField {
  /** Target field name, e.g. "temperature". Mapped onward by the weather mapper. */
  name: string;
  type: PayloadFieldType;
  /**
   * Byte offset into the frame. Required for fixed layouts. Ignored when the
   * spec declares a presence mask, because fields are then packed back to back
   * in declaration order and their position depends on which ones are present.
   */
  offset?: number;
  /**
   * Bit in the presence mask that marks this field as included. Required when
   * the spec declares a presence mask.
   */
  bitIndex?: number;
  /** Multiply the raw integer by this, e.g. 0.01 for centi-degrees. */
  scale?: number;
  /** Added after scaling, e.g. -40 for an offset-binary temperature. */
  add?: number;
  /** Byte order for multi-byte types. Defaults to big endian (network order). */
  endian?: "big" | "little";
  /** For type "bool": which bit of the byte to read (0..7). Defaults to 0. */
  bit?: number;
  /** Round the result to this many decimals. Defaults to 3. */
  decimals?: number;
}

/**
 * Presence mask header for variable-length frames.
 *
 * A logger that only sometimes has a soil probe or a pyranometer fitted cannot
 * use a fixed layout, and on Sigfox a full nine-sensor frame will not fit in
 * the 12 byte limit anyway. With a mask, the device sends a small bitfield
 * saying which sensors are in this message, then only those values, packed back
 * to back in the order the fields are declared.
 */
export interface PresenceMaskSpec {
  /** Byte offset of the mask. Normally 0. */
  offset: number;
  /** uint8 for up to 8 fields, uint16 for up to 16. */
  type: "uint8" | "uint16";
  endian?: "big" | "little";
}

export interface PayloadDecoderSpec {
  fields: PayloadField[];
  /** Set for variable-length frames. Omit for a fixed layout. */
  presence?: PresenceMaskSpec;
  /** Optional note shown in the setup UI. */
  description?: string;
}

const FIELD_WIDTH: Record<PayloadFieldType, number> = {
  uint8: 1, int8: 1,
  uint16: 2, int16: 2,
  uint32: 4, int32: 4,
  float32: 4,
  bool: 1,
};

const VALID_TYPES = new Set(Object.keys(FIELD_WIDTH));

export interface DecoderValidation {
  valid: boolean;
  errors: string[];
  /** Minimum frame length the spec needs, in bytes. */
  requiredBytes: number;
}

/**
 * Validate a spec supplied from the GUI. Returns every problem at once so the
 * user can fix the whole thing in one pass.
 */
export function validateDecoderSpec(spec: unknown): DecoderValidation {
  const errors: string[] = [];
  let requiredBytes = 0;

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return { valid: false, errors: ["Decoder must be a JSON object with a 'fields' array."], requiredBytes: 0 };
  }
  const fields = (spec as PayloadDecoderSpec).fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    return { valid: false, errors: ["Decoder needs at least one entry in 'fields'."], requiredBytes: 0 };
  }
  if (fields.length > 64) {
    errors.push("Decoder is limited to 64 fields.");
  }

  // Presence mask header, if this is a variable-length frame.
  const presence = (spec as PayloadDecoderSpec).presence;
  let maskBits = 0;
  if (presence !== undefined) {
    if (!presence || typeof presence !== "object") {
      errors.push("presence must be an object with 'offset' and 'type'.");
    } else {
      if (presence.type !== "uint8" && presence.type !== "uint16") {
        errors.push('presence.type must be "uint8" or "uint16".');
      } else {
        maskBits = presence.type === "uint8" ? 8 : 16;
      }
      const maskOffset = Number(presence.offset);
      if (!Number.isInteger(maskOffset) || maskOffset < 0 || maskOffset > 512) {
        errors.push("presence.offset must be an integer between 0 and 512.");
      } else if (maskBits > 0) {
        requiredBytes = Math.max(requiredBytes, maskOffset + maskBits / 8);
      }
      if (presence.endian !== undefined && presence.endian !== "big" && presence.endian !== "little") {
        errors.push('presence.endian must be "big" or "little".');
      }
    }
  }

  const seen = new Set<string>();
  const seenBits = new Set<number>();
  fields.forEach((field, index) => {
    const label = `fields[${index}]`;
    if (!field || typeof field !== "object") {
      errors.push(`${label} must be an object.`);
      return;
    }
    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) errors.push(`${label}.name is required.`);
    else if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
      errors.push(`${label}.name "${name}" must start with a letter and contain only letters, digits or underscores.`);
    } else if (seen.has(name)) {
      errors.push(`${label}.name "${name}" is duplicated.`);
    } else {
      seen.add(name);
    }

    if (!VALID_TYPES.has(String(field.type))) {
      errors.push(`${label}.type "${field.type}" is not supported. Use one of: ${[...VALID_TYPES].join(", ")}.`);
      return;
    }

    if (presence !== undefined) {
      // Masked frames are positional, so a bit index replaces the byte offset.
      const bitIndex = Number(field.bitIndex);
      if (!Number.isInteger(bitIndex) || bitIndex < 0 || (maskBits > 0 && bitIndex >= maskBits)) {
        errors.push(`${label}.bitIndex must be an integer between 0 and ${Math.max(0, maskBits - 1)} when a presence mask is used.`);
      } else if (seenBits.has(bitIndex)) {
        errors.push(`${label}.bitIndex ${bitIndex} is used by more than one field.`);
      } else {
        seenBits.add(bitIndex);
      }
      // Worst case: every field present.
      requiredBytes += FIELD_WIDTH[field.type as PayloadFieldType];
    } else {
      const offset = Number(field.offset);
      if (!Number.isInteger(offset) || offset < 0 || offset > 512) {
        errors.push(`${label}.offset must be an integer between 0 and 512.`);
        return;
      }
      requiredBytes = Math.max(requiredBytes, offset + FIELD_WIDTH[field.type as PayloadFieldType]);
    }

    if (field.scale !== undefined && !Number.isFinite(Number(field.scale))) {
      errors.push(`${label}.scale must be a number.`);
    }
    if (field.add !== undefined && !Number.isFinite(Number(field.add))) {
      errors.push(`${label}.add must be a number.`);
    }
    if (field.endian !== undefined && field.endian !== "big" && field.endian !== "little") {
      errors.push(`${label}.endian must be "big" or "little".`);
    }
    if (field.type === "bool" && field.bit !== undefined) {
      const bit = Number(field.bit);
      if (!Number.isInteger(bit) || bit < 0 || bit > 7) errors.push(`${label}.bit must be 0 to 7.`);
    }
  });

  return { valid: errors.length === 0, errors, requiredBytes };
}

function readField(buf: Buffer, field: PayloadField, offsetOverride?: number): number | null {
  const width = FIELD_WIDTH[field.type];
  const offset = offsetOverride !== undefined ? offsetOverride : Number(field.offset);
  if (!Number.isInteger(offset) || offset < 0 || offset + width > buf.length) return null;
  const little = field.endian === "little";

  switch (field.type) {
    case "uint8":   return buf.readUInt8(offset);
    case "int8":    return buf.readInt8(offset);
    case "uint16":  return little ? buf.readUInt16LE(offset) : buf.readUInt16BE(offset);
    case "int16":   return little ? buf.readInt16LE(offset) : buf.readInt16BE(offset);
    case "uint32":  return little ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
    case "int32":   return little ? buf.readInt32LE(offset) : buf.readInt32BE(offset);
    case "float32": return little ? buf.readFloatLE(offset) : buf.readFloatBE(offset);
    case "bool": {
      const bit = Number.isInteger(Number(field.bit)) ? Number(field.bit) : 0;
      return (buf.readUInt8(offset) >> bit) & 1;
    }
    default: return null;
  }
}

export interface DecodeResult {
  values: Record<string, number>;
  /** Fields that fell outside the frame, so the user can spot a wrong offset. */
  skipped: string[];
  /** For masked frames: the presence bitfield that was read, for diagnostics. */
  presenceMask?: number;
  /** For masked frames: fields the device said it was not sending. */
  absent?: string[];
}

/**
 * Apply a validated spec to a frame. Fields that reach past the end of the
 * frame are skipped rather than throwing, because a device can legitimately
 * send a shorter frame (for example omitting an optional sensor block).
 */
export function decodePayload(raw: Buffer, spec: PayloadDecoderSpec): DecodeResult {
  const values: Record<string, number> = {};
  const skipped: string[] = [];
  const fields = spec.fields || [];

  // ── Variable-length frame: read the presence mask, then walk the included
  // fields in declaration order, consuming bytes as we go.
  if (spec.presence) {
    const absent: string[] = [];
    const maskWidth = spec.presence.type === "uint8" ? 1 : 2;
    const maskOffset = Number(spec.presence.offset) || 0;
    if (maskOffset + maskWidth > raw.length) {
      return { values, skipped: fields.map((f) => f.name), presenceMask: undefined, absent };
    }
    const little = spec.presence.endian === "little";
    const mask = maskWidth === 1
      ? raw.readUInt8(maskOffset)
      : (little ? raw.readUInt16LE(maskOffset) : raw.readUInt16BE(maskOffset));

    let cursor = maskOffset + maskWidth;
    for (const field of fields) {
      const bitIndex = Number(field.bitIndex);
      if (!Number.isInteger(bitIndex)) { skipped.push(field.name); continue; }
      if (((mask >> bitIndex) & 1) === 0) { absent.push(field.name); continue; }

      const rawValue = readField(raw, field, cursor);
      if (rawValue === null) {
        skipped.push(field.name);
        continue;
      }
      cursor += FIELD_WIDTH[field.type];
      values[field.name] = applyScaling(rawValue, field) ?? NaN;
      if (!Number.isFinite(values[field.name])) {
        delete values[field.name];
        skipped.push(field.name);
      }
    }
    return { values, skipped, presenceMask: mask, absent };
  }

  for (const field of fields) {
    const rawValue = readField(raw, field);
    if (rawValue === null) {
      skipped.push(field.name);
      continue;
    }
    const scaled = applyScaling(rawValue, field);
    if (scaled === null) {
      skipped.push(field.name);
      continue;
    }
    values[field.name] = scaled;
  }

  return { values, skipped };
}

/** Apply scale, offset and rounding to a raw register value. */
function applyScaling(rawValue: number, field: PayloadField): number | null {
  const scale = field.scale === undefined ? 1 : Number(field.scale);
  const add = field.add === undefined ? 0 : Number(field.add);
  const decimals = Number.isInteger(Number(field.decimals)) ? Number(field.decimals) : 3;
  const scaled = rawValue * scale + add;
  if (!Number.isFinite(scaled)) return null;
  const factor = Math.pow(10, Math.max(0, Math.min(8, decimals)));
  return Math.round(scaled * factor) / factor;
}

/**
 * A worked example used by the station setup UI so the operator has something
 * to edit rather than a blank box. Matches the 8 byte frame in the module
 * comment above.
 */
export const EXAMPLE_DECODER_SPEC: PayloadDecoderSpec = {
  description: "8 byte example frame: temperature, humidity, battery, rainfall",
  fields: [
    { name: "temperature", type: "int16", offset: 0, scale: 0.01 },
    { name: "humidity", type: "uint16", offset: 2, scale: 0.01 },
    { name: "batteryVoltage", type: "uint16", offset: 4, scale: 0.001 },
    { name: "rainfall", type: "uint16", offset: 6, scale: 0.1 },
  ],
};

/**
 * The nine sensor channels the Stratus Sigfox / LoRa logger reports. Field
 * names match the normalised weather fields, so no extra alias mapping is
 * needed once decoded.
 *
 * Ranges and resolutions:
 *   temperature      int16  x0.01   -327.68 to 327.67 degC
 *   humidity         uint16 x0.01   0 to 100 %
 *   pressure         uint16 x0.1    0 to 6553.5 hPa
 *   windSpeed        uint16 x0.01   0 to 655.35 m/s
 *   windDirection    uint16 x1      0 to 360 degrees
 *   rainfall         uint16 x0.1    0 to 6553.5 mm
 *   soilTemperature  int16  x0.01   -327.68 to 327.67 degC
 *   soilMoisture     uint16 x0.01   0 to 100 % VWC
 *   solarRadiation   uint16 x1      0 to 65535 W/m2
 */
const LOGGER_CHANNELS: Array<{ name: string; type: PayloadFieldType; scale: number; decimals: number }> = [
  { name: "temperature", type: "int16", scale: 0.01, decimals: 2 },
  { name: "humidity", type: "uint16", scale: 0.01, decimals: 2 },
  { name: "pressure", type: "uint16", scale: 0.1, decimals: 1 },
  { name: "windSpeed", type: "uint16", scale: 0.01, decimals: 2 },
  { name: "windDirection", type: "uint16", scale: 1, decimals: 0 },
  { name: "rainfall", type: "uint16", scale: 0.1, decimals: 1 },
  { name: "soilTemperature", type: "int16", scale: 0.01, decimals: 2 },
  { name: "soilMoisture", type: "uint16", scale: 0.01, decimals: 2 },
  { name: "solarRadiation", type: "uint16", scale: 1, decimals: 0 },
];

/**
 * Fixed 18 byte layout: every channel, always, in a known position.
 *
 * Use this on LoRaWAN, where an 18 byte frame is comfortable. A logger that
 * omits trailing sensors can send a shorter frame and the missing tail is
 * simply not decoded, but the order may not change.
 */
export const LOGGER_FIXED_DECODER_SPEC: PayloadDecoderSpec = {
  description: "Stratus Sigfox/LoRa logger, fixed 18 byte frame, all nine channels in order",
  fields: LOGGER_CHANNELS.map((channel, index) => ({
    name: channel.name,
    type: channel.type,
    offset: index * 2,
    scale: channel.scale,
    decimals: channel.decimals,
  })),
};

/**
 * Variable-length layout with a 2 byte presence mask, for a logger that sends
 * "some or all" of the channels.
 *
 * Frame: [mask hi][mask lo][value][value]... Each set bit means that channel is
 * present, and present channels follow in the order below. Bit 0 is
 * temperature, bit 1 humidity, and so on to bit 8 for solar radiation.
 *
 * This is the layout to use on Sigfox: the 12 byte message limit only allows
 * about five 16 bit channels per uplink, so the device can rotate which sensors
 * it reports and Stratus still stores each value against the right field.
 */
export const LOGGER_MASKED_DECODER_SPEC: PayloadDecoderSpec = {
  description: "Stratus Sigfox/LoRa logger, 2 byte presence mask then only the channels that are present",
  presence: { offset: 0, type: "uint16", endian: "big" },
  fields: LOGGER_CHANNELS.map((channel, index) => ({
    name: channel.name,
    type: channel.type,
    bitIndex: index,
    scale: channel.scale,
    decimals: channel.decimals,
  })),
};

/** Presets offered in the station setup screen. */
export const DECODER_PRESETS: Array<{ id: string; label: string; note: string; spec: PayloadDecoderSpec }> = [
  {
    id: "logger-masked",
    label: "Stratus logger, presence mask (recommended for Sigfox)",
    note: "2 byte mask then only the channels present. Send any subset of the nine channels in one uplink.",
    spec: LOGGER_MASKED_DECODER_SPEC,
  },
  {
    id: "logger-fixed",
    label: "Stratus logger, fixed 18 byte frame (LoRaWAN)",
    note: "All nine channels every time, in a fixed order. A short frame simply drops the trailing channels.",
    spec: LOGGER_FIXED_DECODER_SPEC,
  },
  {
    id: "example",
    label: "Minimal 8 byte example",
    note: "Temperature, humidity, battery and rainfall. A starting point to edit.",
    spec: EXAMPLE_DECODER_SPEC,
  },
];

/**
 * Build the presence mask a device should send for a given set of channels.
 * Exposed so the setup screen can show the operator the exact mask value for
 * their sensor fit.
 */
export function presenceMaskFor(fieldNames: string[]): number {
  let mask = 0;
  for (const field of LOGGER_MASKED_DECODER_SPEC.fields) {
    if (fieldNames.includes(field.name) && Number.isInteger(field.bitIndex)) {
      mask |= 1 << (field.bitIndex as number);
    }
  }
  return mask;
}
