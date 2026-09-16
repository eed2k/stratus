// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * RikaCloud connection diagnostics.
 *
 * Runs the same login / farm-discovery / device-read sequence that
 * HTTPAdapter uses, but as a one-shot probe that reports the outcome of every
 * step. It deliberately does not touch the running adapter, so it can be used
 * to troubleshoot a station whose poller is already wedged, and it works even
 * when the stored session has expired.
 *
 * The point of this module is that a lost or changed RikaCloud login can be
 * diagnosed and repaired from the Settings page instead of requiring a code
 * change and redeploy.
 *
 * Nothing here ever returns the account password.
 */

import axios from "axios";

/** Mirrors RIKA_API_PREFIX in httpAdapter.ts - keep the two in step. */
const RIKA_API_PREFIX = "/api/v2";
const DEFAULT_BASE_URL = "https://cloud.rikacloud.com";

/**
 * RikaCloud device type codes to normalised weather fields.
 * Mirrors the typeMap in HTTPAdapter.parseRikaCloudResponse.
 */
const TYPE_MAP: Record<number, string> = {
  2001: "temperature",
  2002: "humidity",
  2006: "windSpeed",
  2007: "windDirection",
  2008: "rainfall",
  2014: "solarRadiation",
  3003: "pressure",
  2081: "pm10",
};

export type RikaStepStatus = "ok" | "warn" | "fail" | "skipped";

export interface RikaDiagStep {
  id: string;
  label: string;
  status: RikaStepStatus;
  message: string;
  /** Extra technical detail (HTTP status, content type, body snippet). */
  detail?: string;
}

export interface RikaFarmOption {
  pk: number | null;
  name: string;
}

export interface RikaDeviceOption {
  pk: number | null;
  name: string;
  agriId: string | null;
  typeCode: number | null;
  field: string | null;
  unit: string | null;
  online: boolean;
  value: number | null;
  readingAt: string | null;
}

export interface RikaPhysicalStation {
  agriId: string;
  sensorCount: number;
  latestReadingAt: string | null;
}

export interface RikaDiagnosticsResult {
  ok: boolean;
  summary: string;
  checkedAt: string;
  apiBase: string;
  account: string | null;
  steps: RikaDiagStep[];
  farms: RikaFarmOption[];
  selectedFarmPk: number | null;
  devices: RikaDeviceOption[];
  physicalStations: RikaPhysicalStation[];
  mappedFields: string[];
  latestReadingAt: string | null;
  readingAgeMinutes: number | null;
}

export interface RikaProbeConfig {
  account?: string | null;
  password?: string | null;
  apiEndpoint?: string | null;
  farmId?: string | number | null;
  deviceId?: string | number | null;
  /** Station poll interval in seconds, used to judge reading freshness. */
  pollIntervalSeconds?: number | null;
}

/** Resolve the API base URL from an optional user-supplied endpoint. */
export function resolveRikaApiBase(apiEndpoint?: string | null): string {
  const match = String(apiEndpoint || "").match(/^(https?:\/\/[^/]+)/);
  const base = match ? match[1] : DEFAULT_BASE_URL;
  return `${base}${RIKA_API_PREFIX}`;
}

function snippet(value: unknown, max = 240): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    if (!s) return "";
    return s.length > max ? `${s.slice(0, max)}...` : s;
  } catch {
    return "";
  }
}

function describeHttp(res: any): string {
  const status = res?.status;
  const contentType = res?.headers?.["content-type"] || "";
  const body = snippet(res?.data);
  return [
    status != null ? `HTTP ${status}` : null,
    contentType ? `content-type "${contentType}"` : null,
    body ? `body ${body}` : null,
  ].filter(Boolean).join(", ");
}

/** Parse a RikaCloud reading timestamp into epoch milliseconds. */
function parseReadingTs(t: any): number | null {
  if (t === undefined || t === null) return null;
  if (typeof t === "number") return t > 1e12 ? t : t * 1000;
  const numeric = Number(t);
  if (Number.isFinite(numeric) && String(t).trim() !== "") {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(String(t));
  return Number.isFinite(parsed) ? parsed : null;
}

function isoOrNull(ms: number | null): string | null {
  return ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Probe a RikaCloud account end to end and report every step.
 * Never throws: a failure is reported as a failed step.
 */
export async function runRikaDiagnostics(config: RikaProbeConfig): Promise<RikaDiagnosticsResult> {
  const steps: RikaDiagStep[] = [];
  const apiBase = resolveRikaApiBase(config.apiEndpoint);
  const account = (config.account || "").trim() || null;
  const password = config.password || "";
  const farmFilter = String(config.farmId ?? "").trim();
  const deviceFilter = String(config.deviceId ?? "").trim();

  const result: RikaDiagnosticsResult = {
    ok: false,
    summary: "",
    checkedAt: new Date().toISOString(),
    apiBase,
    account,
    steps,
    farms: [],
    selectedFarmPk: null,
    devices: [],
    physicalStations: [],
    mappedFields: [],
    latestReadingAt: null,
    readingAgeMinutes: null,
  };

  // ── 1. Configuration ──
  if (!account || !password) {
    steps.push({
      id: "config",
      label: "Credentials configured",
      status: "fail",
      message: !account && !password
        ? "No RikaCloud account or password stored for this station."
        : !account ? "No RikaCloud account stored for this station."
        : "No RikaCloud password stored for this station.",
      detail: "Enter the credentials in the RIKA panel and save to reconnect.",
    });
    result.summary = "RikaCloud credentials are missing.";
    return result;
  }
  steps.push({
    id: "config",
    label: "Credentials configured",
    status: "ok",
    message: `Account ${account} configured.`,
    detail: [
      `API base ${apiBase}`,
      farmFilter ? `farm pinned to ${farmFilter}` : "farm auto-selected",
      deviceFilter ? `device pinned to ${deviceFilter}` : "device not pinned",
    ].join(" | "),
  });

  // ── 2. Login ──
  let session: string | null = null;
  try {
    const loginUrl = `${apiBase}/login/account/`;
    const res = await axios.post(loginUrl, { account, password }, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status === 200 && res.data?.session) {
      session = String(res.data.session);
      steps.push({
        id: "login",
        label: "RikaCloud login",
        status: "ok",
        message: "Login succeeded and a session token was issued.",
        detail: `POST ${loginUrl} | session ${session.slice(0, 8)}...`,
      });
    } else if (res.status === 401 || res.status === 403) {
      steps.push({
        id: "login",
        label: "RikaCloud login",
        status: "fail",
        message: "RikaCloud rejected the account or password.",
        detail: describeHttp(res),
      });
      result.summary = "Login rejected. Re-enter the RikaCloud account and password.";
      return result;
    } else if (res.status === 200) {
      steps.push({
        id: "login",
        label: "RikaCloud login",
        status: "fail",
        message: "Login returned 200 but no session token, so the API path is probably wrong.",
        detail: describeHttp(res),
      });
      result.summary = "Login response contained no session token.";
      return result;
    } else {
      steps.push({
        id: "login",
        label: "RikaCloud login",
        status: "fail",
        message: `Login failed with HTTP ${res.status}.`,
        detail: describeHttp(res),
      });
      result.summary = `Login failed (HTTP ${res.status}).`;
      return result;
    }
  } catch (err: any) {
    steps.push({
      id: "login",
      label: "RikaCloud login",
      status: "fail",
      message: `Could not reach RikaCloud: ${err?.message || err}`,
      detail: `Target ${apiBase}/login/account/ | code ${err?.code || "unknown"}`,
    });
    result.summary = "RikaCloud is unreachable from the server.";
    return result;
  }

  // ── 3. Farms ──
  let farmPk: number | null = null;
  try {
    const res = await axios.get(`${apiBase}/farm/`, {
      headers: { session },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !Array.isArray(res.data)) {
      steps.push({
        id: "farms",
        label: "Farm discovery",
        status: "fail",
        message: "Could not list farms for this account.",
        detail: describeHttp(res),
      });
      result.summary = "Logged in, but the farm list could not be read.";
      return result;
    }
    result.farms = res.data.map((f: any) => ({
      pk: f?.farm?.pk != null ? Number(f.farm.pk) : null,
      name: String(f?.farm?.name ?? "unnamed"),
    }));

    if (result.farms.length === 0) {
      steps.push({
        id: "farms",
        label: "Farm discovery",
        status: "fail",
        message: "The account has no farms, so there is nothing to poll.",
        detail: "Check that the correct RikaCloud account is being used.",
      });
      result.summary = "No farms on this RikaCloud account.";
      return result;
    }

    let chosen = result.farms[0];
    let pinned = false;
    if (farmFilter) {
      const match = result.farms.find((f) => String(f.pk) === farmFilter);
      if (match) { chosen = match; pinned = true; }
    }
    farmPk = chosen.pk;
    result.selectedFarmPk = farmPk;

    const farmList = result.farms.map((f) => `${f.name} (pk=${f.pk})`).join(", ");
    if (farmFilter && !pinned) {
      steps.push({
        id: "farms",
        label: "Farm discovery",
        status: "warn",
        message: `Pinned farm ${farmFilter} was not found, so ${chosen.name} (pk=${chosen.pk}) is being used instead.`,
        detail: `Available: ${farmList}`,
      });
    } else if (result.farms.length > 1 && !pinned) {
      steps.push({
        id: "farms",
        label: "Farm discovery",
        status: "warn",
        message: `${result.farms.length} farms found and none is pinned, so the first one (${chosen.name}) is used.`,
        detail: `Available: ${farmList}. Pin a farm below to make this deterministic.`,
      });
    } else {
      steps.push({
        id: "farms",
        label: "Farm discovery",
        status: "ok",
        message: `Using farm ${chosen.name} (pk=${chosen.pk})${pinned ? ", pinned" : ""}.`,
        detail: `Available: ${farmList}`,
      });
    }
  } catch (err: any) {
    steps.push({
      id: "farms",
      label: "Farm discovery",
      status: "fail",
      message: `Farm lookup failed: ${err?.message || err}`,
    });
    result.summary = "Farm lookup failed.";
    return result;
  }

  // ── 4. Devices ──
  let devices: any[] = [];
  try {
    const url = `${apiBase}/farm/${farmPk}/device/`;
    const res = await axios.get(url, {
      headers: { session },
      timeout: 20000,
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      steps.push({
        id: "devices",
        label: "Device read",
        status: "fail",
        message: `Device list request failed with HTTP ${res.status}.`,
        detail: describeHttp(res),
      });
      result.summary = `Device read failed (HTTP ${res.status}).`;
      return result;
    }
    if (!Array.isArray(res.data)) {
      steps.push({
        id: "devices",
        label: "Device read",
        status: "fail",
        message: "Device endpoint returned an unexpected payload instead of a device array.",
        detail: describeHttp(res),
      });
      result.summary = "Device endpoint returned an unexpected payload.";
      return result;
    }
    devices = res.data;
    steps.push({
      id: "devices",
      label: "Device read",
      status: devices.length > 0 ? "ok" : "fail",
      message: devices.length > 0
        ? `${devices.length} sensor channel(s) returned by the farm.`
        : "The farm returned no sensor channels.",
      detail: `GET ${url}`,
    });
    if (devices.length === 0) {
      result.summary = "No sensor channels on the selected farm.";
      return result;
    }
  } catch (err: any) {
    steps.push({
      id: "devices",
      label: "Device read",
      status: "fail",
      message: `Device read failed: ${err?.message || err}`,
    });
    result.summary = "Device read failed.";
    return result;
  }

  // Flatten every channel for the GUI pickers.
  result.devices = devices.map((d: any) => {
    const rawVal = d?.data?.value ?? d?.data?.last_value;
    const value = rawVal == null ? null : Number(rawVal);
    const typeCode = d?.the_type != null ? Number(d.the_type) : null;
    return {
      pk: d?.pk != null ? Number(d.pk) : null,
      name: String(d?.name ?? "unnamed"),
      agriId: d?.agri_id != null ? String(d.agri_id) : null,
      typeCode,
      field: typeCode != null ? (TYPE_MAP[typeCode] ?? null) : null,
      unit: d?.unit != null ? String(d.unit) : null,
      online: d?.is_online !== false,
      value: value != null && Number.isFinite(value) ? value : null,
      readingAt: isoOrNull(parseReadingTs(d?.data?.t ?? d?.data?.t_display)),
    };
  });

  // Group by agri_id so the user can see each physical station on the farm.
  const groups = new Map<string, { sensorCount: number; latest: number | null }>();
  for (const d of result.devices) {
    const key = d.agriId ?? "(no agri_id)";
    const g = groups.get(key) || { sensorCount: 0, latest: null };
    g.sensorCount++;
    const ms = d.readingAt ? Date.parse(d.readingAt) : null;
    if (ms != null && Number.isFinite(ms) && (g.latest == null || ms > g.latest)) g.latest = ms;
    groups.set(key, g);
  }
  result.physicalStations = Array.from(groups.entries())
    .map(([agriId, g]) => ({ agriId, sensorCount: g.sensorCount, latestReadingAt: isoOrNull(g.latest) }))
    .sort((a, b) => a.agriId.localeCompare(b.agriId));

  // ── 5. Device selection / field mapping ──
  let selected = result.devices;
  if (deviceFilter) {
    selected = result.devices.filter((d) =>
      String(d.agriId) === deviceFilter ||
      String(d.pk) === deviceFilter ||
      d.name === deviceFilter,
    );
  }

  if (deviceFilter && selected.length === 0) {
    steps.push({
      id: "selection",
      label: "Station selection",
      status: "fail",
      message: `Pinned device "${deviceFilter}" matched no channel, so this station receives no data.`,
      detail: `Available station IDs: ${result.physicalStations.map((p) => p.agriId).join(", ")}`,
    });
    result.summary = `Pinned device "${deviceFilter}" does not exist on this farm.`;
    return result;
  }

  if (!deviceFilter && result.physicalStations.length > 1) {
    steps.push({
      id: "selection",
      label: "Station selection",
      status: "warn",
      message: `The farm hosts ${result.physicalStations.length} physical stations and no device is pinned, so their readings are merged into one record.`,
      detail: `Pin one of: ${result.physicalStations.map((p) => p.agriId).join(", ")}`,
    });
  } else {
    steps.push({
      id: "selection",
      label: "Station selection",
      status: "ok",
      message: deviceFilter
        ? `Pinned device "${deviceFilter}" matched ${selected.length} channel(s).`
        : "Single physical station on this farm, no pinning needed.",
    });
  }

  const mapped = new Map<string, RikaDeviceOption>();
  for (const d of selected) {
    if (!d.field || d.value == null) continue;
    mapped.set(d.field, d);
  }
  result.mappedFields = Array.from(mapped.keys()).sort();

  const unmapped = selected.filter((d) => !d.field).map((d) => `${d.name} (type ${d.typeCode})`);
  steps.push({
    id: "mapping",
    label: "Sensor mapping",
    status: result.mappedFields.length > 0 ? "ok" : "fail",
    message: result.mappedFields.length > 0
      ? `${result.mappedFields.length} weather field(s) mapped: ${result.mappedFields.join(", ")}.`
      : "No sensor channel mapped to a known weather field.",
    detail: unmapped.length ? `Unmapped channels: ${unmapped.join(", ")}` : undefined,
  });

  // ── 6. Reading freshness ──
  let latest: number | null = null;
  for (const d of selected) {
    const ms = d.readingAt ? Date.parse(d.readingAt) : null;
    if (ms != null && Number.isFinite(ms) && (latest == null || ms > latest)) latest = ms;
  }
  result.latestReadingAt = isoOrNull(latest);

  if (latest == null) {
    steps.push({
      id: "freshness",
      label: "Reading freshness",
      status: "warn",
      message: "RikaCloud did not include a reading timestamp, so freshness cannot be checked.",
    });
  } else {
    const ageMin = Math.round((Date.now() - latest) / 60000);
    result.readingAgeMinutes = ageMin;
    const pollMin = Math.max(1, Math.round((config.pollIntervalSeconds || 1800) / 60));
    const staleLimit = Math.max(pollMin * 3, 90);
    steps.push({
      id: "freshness",
      label: "Reading freshness",
      status: ageMin <= staleLimit ? "ok" : "warn",
      message: ageMin <= staleLimit
        ? `Newest reading is ${ageMin} minute(s) old.`
        : `Newest reading is ${ageMin} minute(s) old, which is beyond the ${staleLimit} minute freshness limit.`,
      detail: `Reading time ${new Date(latest).toISOString()} | poll interval ${pollMin} min`,
    });
  }

  const failed = steps.filter((s) => s.status === "fail").length;
  const warned = steps.filter((s) => s.status === "warn").length;
  result.ok = failed === 0 && result.mappedFields.length > 0;
  result.summary = failed > 0
    ? `${failed} check(s) failed.`
    : warned > 0
      ? `Connection works with ${warned} warning(s).`
      : "All checks passed.";

  return result;
}
