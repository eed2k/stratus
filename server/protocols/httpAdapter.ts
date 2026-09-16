// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * HTTP Protocol Adapter
 * Fetches weather data from REST APIs, cloud services, and direct IP endpoints
 * Supports: CampbellCloud, WeatherLink Cloud, RikaCloud, Arduino IoT, Blynk, direct HTTP
 */

import { BaseProtocolAdapter, ProtocolConfig, NormalizedWeatherData } from "./adapter";
import axios, { AxiosInstance } from "axios";

// RikaCloud v2 API path prefix. RikaCloud migrated their public API from
// "/rika/api/v2" to "/api/v2" (the old path now hits the static SPA host and
// returns 405/HTML). Kept as a constant so a future move is a one-line change.
const RIKA_API_PREFIX = "/api/v2";

export class HTTPAdapter extends BaseProtocolAdapter {
  private httpClient: AxiosInstance;
  private serviceType: string = "generic";
  private rikaSession: string | null = null;
  private rikaFarmPk: number | null = null;
  // Timestamp (epoch seconds) of the most recent Rika reading we ingested, used
  // to avoid re-inserting identical stale readings on every poll.
  private rikaLastReadingTs: number | null = null;
  // Reading timestamp captured during the most recent parse (epoch seconds).
  private rikaCurrentReadingTs: number | null = null;
  private arduinoAccessToken: string | null = null;
  private arduinoTokenExpiry: number = 0;

  constructor(config: ProtocolConfig) {
    super(config);
    
    this.serviceType = this.detectServiceType();
    this.httpClient = axios.create({
      timeout: config.timeout || 30000,
      headers: this.buildHeaders(),
    });
  }

  private detectServiceType(): string {
    const endpoint = this.config.apiEndpoint?.toLowerCase() || "";
    const host = this.config.host?.toLowerCase() || "";

    // Explicit service type from the station's connection config is the most
    // reliable signal - it is set during setup and works even when the user
    // leaves the (optional) endpoint URL blank to use the service default.
    const explicitType = ((this.config as any).type || (this.config as any).serviceType || "")
      .toString()
      .toLowerCase();
    if (explicitType === "rikacloud") return "rikacloud";
    if (explicitType === "arduino_iot") return "arduino_iot";
    if (explicitType === "campbellcloud") return "campbellcloud";

    if (endpoint.includes("campbellcloud") || endpoint.includes("konect")) return "campbellcloud";
    if (endpoint.includes("weatherlink") || host.includes("weatherlink")) return "weatherlink";
    if (endpoint.includes("rika") || host.includes("rika")) return "rikacloud";
    if (endpoint.includes("arduino") || endpoint.includes("api2.arduino.cc")) return "arduino_iot";
    if (endpoint.includes("blynk")) return "blynk";
    if (endpoint.includes("thingspeak")) return "thingspeak";
    if (endpoint.includes("openweather")) return "openweathermap";
    
    return "generic";
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      switch (this.serviceType) {
        case "campbellcloud":
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
          break;
        case "weatherlink":
          headers["X-Api-Secret"] = this.config.apiKey;
          break;
        case "arduino_iot":
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
          break;
        case "blynk":
          // Blynk takes the token in the query string; see buildEndpointUrl.
          break;
        case "openweathermap":
          // Same: the key goes in the appid query parameter. Sending it as a
          // bearer token as well would leak it to a service that has no use for
          // it, and OpenWeatherMap rejects the request either way.
          break;
        default:
          headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      }
    }

    return headers;
  }

  async connect(): Promise<boolean> {
    try {
      // Arduino IoT Cloud requires OAuth2 client_credentials token
      if (this.serviceType === "arduino_iot") {
        const token = await this.arduinoGetAccessToken();
        if (!token) {
          this.setError(new Error("Arduino IoT Cloud auth failed - check client ID/secret"));
          return false;
        }
        this.setConnected(true);
        return true;
      }

      // RikaCloud requires session-based login first
      if (this.serviceType === "rikacloud") {
        const loggedIn = await this.rikaCloudLogin();
        if (!loggedIn) {
          this.setError(new Error("RikaCloud login failed - check account/password"));
          return false;
        }
        // Verify we can reach the data endpoint
        const url = this.buildEndpointUrl();
        const response = await this.httpClient.get(url, {
          timeout: 10000,
          headers: { session: this.rikaSession! },
        });
        if (response.status >= 200 && response.status < 300) {
          this.setConnected(true);
          return true;
        }
        this.setError(new Error(`HTTP ${response.status}: ${response.statusText}`));
        return false;
      }

      const url = this.buildEndpointUrl();
      const response = await this.httpClient.get(url, { timeout: 10000 });
      
      if (response.status >= 200 && response.status < 300) {
        this.setConnected(true);
        return true;
      }
      
      this.setError(new Error(`HTTP ${response.status}: ${response.statusText}`));
      return false;
    } catch (error: any) {
      this.setError(new Error(error.message || "Connection failed"));
      return false;
    }
  }

  async disconnect(): Promise<void> {
    this.cancelReconnect();
    this.setConnected(false);
  }

  async readData(): Promise<NormalizedWeatherData | null> {
    try {
      let result: NormalizedWeatherData | null;

      // Arduino IoT Cloud: use OAuth2 token to read thing properties
      if (this.serviceType === "arduino_iot") {
        result = await this.readArduinoIoTData();
      } else if (this.serviceType === "rikacloud") {
        // RikaCloud v2: use session header and handle re-login
        result = await this.readRikaCloudData();
      } else {
        const url = this.buildEndpointUrl();
        const response = await this.httpClient.get(url);

        if (response.status !== 200) {
          throw new Error(`HTTP ${response.status}`);
        }

        const rawData = this.extractDataFromResponse(response.data);
        const normalized = this.normalizeData(rawData);

        this.emit("data", normalized);
        result = normalized;
      }

      /**
       * A read that completed without throwing means the link is healthy, so
       * clear any stale lastError.
       *
       * Without this, a single transient timeout stayed on the System Settings
       * panel forever: lastError is only ever cleared by setConnected(true),
       * which runs in connect(), and a registered station is not reconnected on
       * every poll. A Rika station polls every 30 minutes, so one blip left a
       * red "Last error: timeout of 30000ms exceeded" line on screen through
       * every later successful poll until the process restarted.
       *
       * A null result is NOT a failure here: readRikaCloudData returns null
       * when the device has no reading newer than the one already ingested.
       */
      this.setConnected(true);
      return result;
    } catch (error: any) {
      this.setError(error);
      return null;
    }
  }

  /**
   * Decide whether a RikaCloud response indicates an expired/invalid session.
   *
   * RikaCloud's v2 API has been observed to signal an expired session in
   * several ways depending on gateway/version: 401/403, session-timeout codes
   * (419/440), an HTML login page (content-type text/html), or even a 200 with
   * a JSON error body mentioning login/session/auth. The previous code only
   * handled 403/HTML, so a session that expired with a 401 (or JSON error) was
   * never renewed and the feed went silent until the process restarted - the
   * likely cause of a long-running station suddenly going stale.
   */
  private rikaSessionExpired(response: any): boolean {
    const status = response?.status;
    if (status === 401 || status === 403 || status === 419 || status === 440) return true;

    const contentType = String(response?.headers?.["content-type"] || "").toLowerCase();
    if (contentType.includes("text/html")) return true;

    // JSON error body that hints at an auth/session problem
    const body = response?.data;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const msg = String(body.message || body.msg || body.error || body.detail || "").toLowerCase();
      if (msg.includes("login") || msg.includes("session") || msg.includes("auth") || msg.includes("token")) {
        return true;
      }
    }
    return false;
  }

  /**
   * Network-level faults that are worth a second attempt. These are conditions
   * where the request never got a considered answer from the application, so
   * repeating it can genuinely succeed. Anything else (bad credentials, a
   * malformed request) fails identically on a retry and is surfaced at once.
   */
  private static readonly TRANSIENT_NET_CODES = new Set([
    "ECONNABORTED",  // what axios raises for its own client-side timeout
    "ETIMEDOUT",
    "ECONNRESET",
    "ECONNREFUSED",
    "EAI_AGAIN",     // transient DNS resolution failure
    "ENETUNREACH",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "EPIPE",
  ]);

  /**
   * Gateway statuses that mean "busy, try again" rather than "your request was
   * wrong". 429 is rate limiting; 502/503/504 are a front-end proxy that could
   * not reach or wait for the RikaCloud application server.
   */
  private static readonly TRANSIENT_HTTP_STATUS = new Set([429, 502, 503, 504]);

  private isTransientNetworkError(error: any): boolean {
    if (!error) return false;
    if (error.code && HTTPAdapter.TRANSIENT_NET_CODES.has(String(error.code))) return true;
    // Older axios builds set only the message for a timeout, not a code.
    if (/timeout/i.test(String(error.message || ""))) return true;
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * GET a RikaCloud URL, retrying transient faults with exponential backoff.
   *
   * Why this exists: the RikaCloud device endpoint is intermittently slow, and
   * a single slow response used to fail the whole poll with
   * "timeout of 30000ms exceeded". Because a Rika station only polls every 30
   * minutes, one blip cost a full half-hour of data.
   *
   * The timeout is set explicitly per attempt rather than inheriting the 30s
   * axios instance default, so the budget is visible here: three attempts of
   * 20s with 2s and 5s backoff is at most ~67s, comfortably inside the
   * 30-minute poll interval and so it can never overlap the next poll.
   */
  private async rikaGet(url: string): Promise<any> {
    const MAX_ATTEMPTS = 3;
    const PER_ATTEMPT_TIMEOUT_MS = 20000;
    const BACKOFF_MS = [2000, 5000];

    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.httpClient.get(url, {
          headers: { session: this.rikaSession! },
          validateStatus: () => true,
          timeout: PER_ATTEMPT_TIMEOUT_MS,
        });

        // Busy gateway: same treatment as a network fault, but only if we still
        // have an attempt left, otherwise return it so the caller can report
        // the real status rather than a generic retry error.
        if (
          HTTPAdapter.TRANSIENT_HTTP_STATUS.has(response.status) &&
          attempt < MAX_ATTEMPTS
        ) {
          const wait = BACKOFF_MS[attempt - 1] ?? 5000;
          console.warn(
            `[HTTPAdapter] RikaCloud HTTP ${response.status} on attempt ${attempt}/${MAX_ATTEMPTS} - retrying in ${wait}ms`
          );
          await this.sleep(wait);
          continue;
        }

        if (attempt > 1) {
          console.log(`[HTTPAdapter] RikaCloud read recovered on attempt ${attempt}/${MAX_ATTEMPTS}`);
        }
        return response;
      } catch (error: any) {
        lastError = error;

        if (!this.isTransientNetworkError(error) || attempt === MAX_ATTEMPTS) {
          throw error;
        }

        const wait = BACKOFF_MS[attempt - 1] ?? 5000;
        console.warn(
          `[HTTPAdapter] RikaCloud read attempt ${attempt}/${MAX_ATTEMPTS} failed (${error.code || "no code"}: ${error.message}) - retrying in ${wait}ms`
        );
        await this.sleep(wait);
      }
    }

    throw lastError ?? new Error("RikaCloud read failed after retries");
  }

  private rikaBodySnippet(response: any): string {
    try {
      const body = response?.data;
      const s = typeof body === "string" ? body : JSON.stringify(body);
      return s ? s.slice(0, 200) : "";
    } catch {
      return "";
    }
  }

  /**
   * Read data from RikaCloud v2 API.
   * Uses session token in header; renews the session on expiry and retries.
   */
  private async readRikaCloudData(): Promise<NormalizedWeatherData | null> {
    if (!this.rikaSession) {
      const loggedIn = await this.rikaCloudLogin();
      if (!loggedIn) throw new Error("RikaCloud login failed");
    }

    const url = this.buildEndpointUrl();
    let response = await this.rikaGet(url);

    // Session expired / invalid? Renew and retry once. Clearing farm_pk forces
    // re-discovery in case the account's farm changed while we were running.
    if (this.rikaSessionExpired(response)) {
      const ct = response.headers?.["content-type"] || "";
      console.log(
        `[HTTPAdapter] RikaCloud session appears invalid (status ${response.status}, content-type "${ct}") - re-logging in...`
      );
      this.rikaSession = null;
      this.rikaFarmPk = null;
      const loggedIn = await this.rikaCloudLogin();
      if (!loggedIn) throw new Error("RikaCloud re-login failed - check account/password");
      response = await this.rikaGet(url);
    }

    if (response.status !== 200) {
      throw new Error(
        `RikaCloud HTTP ${response.status} (content-type "${response.headers?.["content-type"] || ""}") body: ${this.rikaBodySnippet(response)}`
      );
    }

    // Guard against a 200 that isn't the expected device array (e.g. an error
    // envelope or HTML served with a 200) so we don't silently store nulls.
    if (!Array.isArray(response.data)) {
      throw new Error(
        `RikaCloud returned unexpected non-array payload: ${this.rikaBodySnippet(response)}`
      );
    }

    const rawData = this.extractDataFromResponse(response.data);

    // If the selected Rika device reports the same reading timestamp as the
    // last one we ingested, there is genuinely no new data - skip it instead of
    // re-inserting a duplicate that would masquerade as a fresh reading.
    if (
      this.rikaCurrentReadingTs !== null &&
      this.rikaLastReadingTs !== null &&
      this.rikaCurrentReadingTs <= this.rikaLastReadingTs
    ) {
      console.log(
        `[HTTPAdapter] RikaCloud: no new reading since ${new Date(this.rikaLastReadingTs * 1000).toISOString()} - skipping`
      );
      return null;
    }

    const normalized = this.normalizeData(rawData);

    // Use the device's own reading time when available so the dashboard shows
    // the true observation time (and staleness monitoring works correctly).
    if (this.rikaCurrentReadingTs !== null) {
      normalized.timestamp = new Date(this.rikaCurrentReadingTs * 1000);
      this.rikaLastReadingTs = this.rikaCurrentReadingTs;
    }

    this.emit("data", normalized);
    return normalized;
  }

  /**
   * Login to RikaCloud v2 API.
   * POST {account, password} to /rika/api/v2/login/account/
   * Returns a session token used in the 'session' header for all subsequent requests.
   * Also discovers the farm_pk needed for data queries.
   */
  private async rikaCloudLogin(): Promise<boolean> {
    const config = this.config as any;
    const account = config.rikaEmail || config.rikaAccount;
    const password = config.rikaPassword;

    if (!account || !password) {
      console.error("[HTTPAdapter] RikaCloud login requires account and password");
      return false;
    }

    try {
      // Determine base URL from endpoint or default
      const endpoint = this.config.apiEndpoint || "";
      const urlMatch = endpoint.match(/^(https?:\/\/[^/]+)/);
      const baseUrl = urlMatch ? urlMatch[1] : "https://cloud.rikacloud.com";
      const apiBase = `${baseUrl}${RIKA_API_PREFIX}`;
      const loginUrl = `${apiBase}/login/account/`;

      console.log(`[HTTPAdapter] Logging in to RikaCloud v2 at ${loginUrl} as ${account}...`);

      const response = await axios.post(loginUrl, { account, password }, {
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      });

      if (response.status === 200 && response.data?.session) {
        this.rikaSession = response.data.session;
        console.log(`[HTTPAdapter] RikaCloud login successful for ${account} (session: ${this.rikaSession!.substring(0, 8)}...)`);

        // Discover farm_pk if not yet known
        if (!this.rikaFarmPk) {
          try {
            const farmRes = await axios.get(`${apiBase}/farm/`, {
              headers: { session: this.rikaSession! },
              timeout: 10000,
            });
            if (Array.isArray(farmRes.data) && farmRes.data.length > 0) {
              const farmFilter = String((this.config as any).rikaFarmId ?? "").trim();

              // When an account has multiple farms, log them all so the user can
              // discover the farm_pk to pin to a station.
              if (farmRes.data.length > 1) {
                const farmList = farmRes.data
                  .map((f: any) => `${f.farm?.name ?? "?"} (pk=${f.farm?.pk})`)
                  .join(", ");
                console.log(`[HTTPAdapter] RikaCloud account has ${farmRes.data.length} farms: ${farmList}`);
              }

              let chosen = farmRes.data[0];
              if (farmFilter) {
                const match = farmRes.data.find((f: any) => String(f.farm?.pk) === farmFilter);
                if (match) {
                  chosen = match;
                } else {
                  console.warn(`[HTTPAdapter] RikaCloud farm_pk ${farmFilter} not found; falling back to first farm`);
                }
              }

              this.rikaFarmPk = chosen.farm.pk;
              console.log(`[HTTPAdapter] RikaCloud farm_pk: ${this.rikaFarmPk}${farmFilter ? " (pinned)" : ""}`);
            } else {
              console.warn("[HTTPAdapter] No farms found on RikaCloud account");
            }
          } catch (err: any) {
            console.warn(`[HTTPAdapter] Could not fetch farms: ${err.message}`);
          }
        }
        return true;
      }

      console.error(`[HTTPAdapter] RikaCloud login failed - status ${response.status}`);
      return false;
    } catch (error: any) {
      console.error(`[HTTPAdapter] RikaCloud login error: ${error.message}`);
      return false;
    }
  }

  /**
   * Arduino IoT Cloud: OAuth2 client_credentials token exchange.
   * POST to https://api2.arduino.cc/iot/v1/clients/token
   */
  private async arduinoGetAccessToken(): Promise<string | null> {
    // Return cached token if still valid (with 60s buffer)
    if (this.arduinoAccessToken && Date.now() < this.arduinoTokenExpiry - 60000) {
      return this.arduinoAccessToken;
    }

    const config = this.config as any;
    const clientId = config.arduinoClientId || config.apiKey;
    const clientSecret = config.arduinoClientSecret;

    if (!clientId || !clientSecret) {
      console.error("[HTTPAdapter] Arduino IoT Cloud requires clientId and clientSecret");
      return null;
    }

    try {
      console.log(`[HTTPAdapter] Requesting Arduino IoT Cloud access token...`);
      const response = await axios.post(
        "https://api2.arduino.cc/iot/v1/clients/token",
        new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          audience: "https://api2.arduino.cc/iot",
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 15000,
        }
      );

      if (response.status === 200 && response.data?.access_token) {
        this.arduinoAccessToken = response.data.access_token;
        // Token typically expires in 300s, cache it
        const expiresIn = response.data.expires_in || 300;
        this.arduinoTokenExpiry = Date.now() + expiresIn * 1000;
        console.log(`[HTTPAdapter] Arduino IoT Cloud token acquired (expires in ${expiresIn}s)`);
        return this.arduinoAccessToken;
      }

      console.error(`[HTTPAdapter] Arduino IoT Cloud token request failed - status ${response.status}`);
      return null;
    } catch (error: any) {
      console.error(`[HTTPAdapter] Arduino IoT Cloud token error: ${error.message}`);
      return null;
    }
  }

  /**
   * Read data from Arduino IoT Cloud.
   * GET /iot/v2/things/{thingId}/properties to fetch all property values.
   */
  private async readArduinoIoTData(): Promise<NormalizedWeatherData | null> {
    const token = await this.arduinoGetAccessToken();
    if (!token) throw new Error("Arduino IoT Cloud auth failed");

    const config = this.config as any;
    const thingId = config.arduinoThingId;

    if (!thingId) {
      throw new Error("Arduino IoT Cloud requires a Thing ID");
    }

    const url = `https://api2.arduino.cc/iot/v2/things/${thingId}/properties`;
    console.log(`[HTTPAdapter] Fetching Arduino IoT Cloud properties from ${url}`);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeout: 15000,
    });

    if (response.status !== 200) {
      throw new Error(`Arduino IoT Cloud HTTP ${response.status}`);
    }

    const rawData = this.parseArduinoIoTResponse(response.data);
    const normalized = this.normalizeData(rawData);
    this.emit("data", normalized);
    return normalized;
  }

  private buildEndpointUrl(): string {
    // RikaCloud v2: use /farm/{farm_pk}/device/ endpoint (returns all sensors with live data)
    if (this.serviceType === "rikacloud") {
      const endpoint = this.config.apiEndpoint || "";
      const urlMatch = endpoint.match(/^(https?:\/\/[^/]+)/);
      const baseUrl = urlMatch ? urlMatch[1] : "https://cloud.rikacloud.com";
      if (this.rikaFarmPk) {
        return `${baseUrl}${RIKA_API_PREFIX}/farm/${this.rikaFarmPk}/device/`;
      }
      // Fallback: if user provided a full URL, use it as-is
      if (endpoint) return endpoint;
      return `${baseUrl}${RIKA_API_PREFIX}/farm/`;
    }

    if (this.config.apiEndpoint) {
      let url = this.config.apiEndpoint;
      
      if (this.serviceType === "blynk" && this.config.apiKey) {
        const baseUrl = url.includes("blynk.cloud") ? url : "https://blynk.cloud/external/api";
        return `${baseUrl}/get?token=${this.config.apiKey}&pin=V0,V1,V2,V3,V4,V5`;
      }
      
      if (this.serviceType === "weatherlink" && this.config.apiKey) {
        const apiKeyId = this.config.apiKey.split(":")[0];
        url += url.includes("?") ? "&" : "?";
        url += `api-key=${apiKeyId}&t=${Date.now()}`;
      }

      /**
       * OpenWeatherMap authenticates with an `appid` query parameter, not a
       * header, and it reports Kelvin unless `units` is given. Both are added
       * here when absent, so a station configured with nothing but an endpoint
       * and an API key works: without the key the service answers 401, and
       * without `units=metric` the temperature arrives in Kelvin and would be
       * stored as if it were Celsius.
       *
       * Anything the operator already put in the URL is left alone.
       */
      if (this.serviceType === "openweathermap") {
        const parsed = new URL(url, "https://api.openweathermap.org");
        if (this.config.apiKey && !parsed.searchParams.has("appid")) {
          parsed.searchParams.set("appid", this.config.apiKey);
        }
        if (!parsed.searchParams.has("units")) {
          parsed.searchParams.set("units", "metric");
        }
        url = parsed.toString();
      }

      return url;
    }

    if (this.config.host) {
      const port = this.config.port || 80;
      const protocol = port === 443 ? "https" : "http";
      return `${protocol}://${this.config.host}:${port}/api/data`;
    }

    throw new Error("No endpoint configured");
  }

  private extractDataFromResponse(response: any): Record<string, number | null> {
    switch (this.serviceType) {
      case "campbellcloud":
        return this.parseCampbellCloudResponse(response);
      case "weatherlink":
        return this.parseWeatherLinkResponse(response);
      case "rikacloud":
        return this.parseRikaCloudResponse(response);
      case "arduino_iot":
        return this.parseArduinoIoTResponse(response);
      case "blynk":
        return this.parseBlynkResponse(response);
      case "thingspeak":
        return this.parseThingSpeakResponse(response);
      case "openweathermap":
        return this.parseOpenWeatherMapResponse(response);
      default:
        return this.parseGenericResponse(response);
    }
  }

  private parseCampbellCloudResponse(data: any): Record<string, number | null> {
    const record = data?.data?.[0] || data;
    return {
      temperature: record.AirTemp_C ?? record.temperature ?? null,
      humidity: record.RH ?? record.humidity ?? null,
      pressure: record.BP_mbar ?? record.pressure ?? null,
      windSpeed: record.WS_ms ?? record.windSpeed ?? null,
      windDirection: record.WD ?? record.windDirection ?? null,
      windGust: record.WS_max ?? record.windGust ?? null,
      rainfall: record.Rain_mm ?? record.rainfall ?? null,
      solarRadiation: record.Solar_Wm2 ?? record.solarRadiation ?? null,
      batteryVoltage: record.BattV ?? record.batteryVoltage ?? null,
    };
  }

  private parseWeatherLinkResponse(data: any): Record<string, number | null> {
    const sensors = data?.sensors || [];
    const result: Record<string, number | null> = {};

    for (const sensor of sensors) {
      const sensorData = sensor.data?.[0] || {};
      
      if (sensorData.temp !== undefined) result.temperature = this.fahrenheitToCelsius(sensorData.temp);
      if (sensorData.hum !== undefined) result.humidity = sensorData.hum;
      if (sensorData.bar !== undefined) result.pressure = sensorData.bar * 33.8639;
      if (sensorData.wind_speed_last !== undefined) result.windSpeed = sensorData.wind_speed_last * 0.44704;
      if (sensorData.wind_dir_last !== undefined) result.windDirection = sensorData.wind_dir_last;
      if (sensorData.wind_speed_hi_last_10_min !== undefined) result.windGust = sensorData.wind_speed_hi_last_10_min * 0.44704;
      if (sensorData.rain_day_mm !== undefined) result.rainfall = sensorData.rain_day_mm;
      if (sensorData.solar_rad !== undefined) result.solarRadiation = sensorData.solar_rad;
    }

    return result;
  }

  private parseRikaCloudResponse(data: any): Record<string, number | null> {
    // RikaCloud v2 /farm/{farm_pk}/device/ returns an array of device objects:
    // [{ pk, name, agri_id, the_type, unit, data: { last_value, t, value, t_display }, is_online }, ...]
    // Map device the_type codes to normalised weather fields:
    //   2001 = temperature (°C), 2002 = humidity (%RH), 2006 = wind speed (m/s),
    //   2007 = wind direction (°), 2008 = rainfall (mm), 2014 = solar radiation (W/m²),
    //   3003 = barometric pressure (hPa), 2081 = PM10 (μg/m³)
    //   3331 = longitude, 3332 = latitude (GPS - skip)

    const typeMap: Record<number, string> = {
      2001: "temperature",
      2002: "humidity",
      2006: "windSpeed",
      2007: "windDirection",
      2008: "rainfall",
      2014: "solarRadiation",
      3003: "pressure",
      2081: "pm10",
    };

    const result: Record<string, number | null> = {
      temperature: null,
      humidity: null,
      pressure: null,
      windSpeed: null,
      windDirection: null,
      rainfall: null,
      solarRadiation: null,
    };

    // Handle device array response
    const allDevices: any[] = Array.isArray(data) ? data : [];
    this.rikaCurrentReadingTs = null;

    if (allDevices.length === 0) {
      console.log("[HTTPAdapter] RikaCloud: no devices returned");
      return result;
    }

    // A single farm can host multiple physical stations, each grouped by
    // agri_id. Without a filter, readings from every station collapse into one
    // record (last-writer-wins per sensor type), which is why a second station
    // never shows its own data. Pin this Stratus station to a single Rika
    // device/station via rikaDeviceId (matched against agri_id, pk, or name).
    const deviceFilter = String((this.config as any).rikaDeviceId ?? "").trim();

    // Log the distinct physical stations (agri_ids) present so the user can
    // discover the correct rikaDeviceId to configure for each station.
    const agriIds = Array.from(
      new Set(allDevices.map((d) => d.agri_id).filter((v) => v !== undefined && v !== null))
    );
    if (agriIds.length > 1 && !deviceFilter) {
      console.warn(
        `[HTTPAdapter] RikaCloud farm has ${agriIds.length} physical stations (agri_id: ${agriIds.join(", ")}) ` +
          `but no rikaDeviceId is set - readings from all stations are being merged. ` +
          `Set rikaDeviceId on each Stratus station to isolate its data.`
      );
    }

    let devices = allDevices;
    if (deviceFilter) {
      devices = allDevices.filter(
        (d) =>
          String(d.agri_id) === deviceFilter ||
          String(d.pk) === deviceFilter ||
          (d.name && String(d.name) === deviceFilter)
      );
      if (devices.length === 0) {
        console.warn(
          `[HTTPAdapter] RikaCloud: rikaDeviceId "${deviceFilter}" matched no devices ` +
            `(available agri_ids: ${agriIds.join(", ") || "none"})`
        );
        return result;
      }
    }

    for (const device of devices) {
      const typeCode = device.the_type;
      const fieldName = typeMap[typeCode];
      if (!fieldName) continue; // Skip GPS and unknown types

      const rawVal = device.data?.value ?? device.data?.last_value;
      if (rawVal === undefined || rawVal === null) continue;

      const value = typeof rawVal === "number" ? rawVal : parseFloat(rawVal);
      if (isNaN(value)) continue;

      result[fieldName] = value;

      // Track the most recent reading timestamp across the selected sensors.
      const ts = this.parseRikaTimestamp(device.data?.t ?? device.data?.t_display);
      if (ts !== null && (this.rikaCurrentReadingTs === null || ts > this.rikaCurrentReadingTs)) {
        this.rikaCurrentReadingTs = ts;
      }

      const displayName = device.name || `type_${typeCode}`;
      const online = device.is_online === false ? " (OFFLINE)" : "";
      console.log(`[HTTPAdapter] RikaCloud device "${displayName}"${online}: ${value} ${device.unit || ""}`);
    }

    const populated = Object.entries(result).filter(([, v]) => v !== null).length;
    console.log(
      `[HTTPAdapter] RikaCloud: populated ${populated}/${Object.keys(result).length} weather fields ` +
        `from ${devices.length}/${allDevices.length} devices` +
        (deviceFilter ? ` (device "${deviceFilter}")` : "")
    );

    return result;
  }

  /**
   * Parse a RikaCloud reading timestamp into epoch seconds.
   * Accepts epoch seconds/millis (number or numeric string) or an ISO date string.
   */
  private parseRikaTimestamp(t: any): number | null {
    if (t === undefined || t === null) return null;
    if (typeof t === "number") {
      // Heuristic: values above ~10^12 are millis, otherwise seconds
      return t > 1e12 ? Math.floor(t / 1000) : t;
    }
    const asNum = Number(t);
    if (!isNaN(asNum) && String(t).trim() !== "") {
      return asNum > 1e12 ? Math.floor(asNum / 1000) : asNum;
    }
    const parsed = Date.parse(String(t));
    return isNaN(parsed) ? null : Math.floor(parsed / 1000);
  }

  private parseArduinoIoTResponse(data: any): Record<string, number | null> {
    // Arduino IoT Cloud /iot/v2/things/{id}/properties returns an array of property objects:
    // [{ id, name, last_value, type, variable_name, update_at, ... }]
    const properties = Array.isArray(data) ? data : (data?.properties || []);
    const result: Record<string, number | null> = {};

    for (const prop of properties) {
      const name = (prop.variable_name || prop.name || "").toLowerCase();
      const value = prop.last_value;
      if (value === null || value === undefined) continue;
      const num = typeof value === "number" ? value : parseFloat(value);
      if (isNaN(num)) continue;

      // Map Arduino property names to normalised weather fields
      if (name.includes("temp") && !name.includes("board") && !name.includes("soil")) result.temperature = num;
      if (name.includes("humid") || name === "rh") result.humidity = num;
      if (name.includes("press") || name.includes("baro")) result.pressure = num;
      if (name.includes("wind") && (name.includes("speed") || name.includes("spd"))) result.windSpeed = num;
      if (name.includes("wind") && (name.includes("dir") || name.includes("bearing"))) result.windDirection = num;
      if (name.includes("gust")) result.windGust = num;
      if (name.includes("rain") || name.includes("precip")) result.rainfall = num;
      if (name.includes("solar") || name.includes("radiation") || name === "sr") result.solarRadiation = num;
      if (name.includes("uv")) result.uvIndex = num;
      if (name.includes("dew")) result.dewPoint = num;
      if (name.includes("batt")) result.batteryVoltage = num;
      if (name.includes("soil") && name.includes("temp")) result.soilTemperature = num;
      if (name.includes("soil") && name.includes("moist")) result.soilMoisture = num;
      if (name.includes("pm25") || name.includes("pm2_5")) result.pm25 = num;
      if (name.includes("pm10")) result.pm10 = num;
      if (name.includes("co2")) result.co2 = num;

      console.log(`[HTTPAdapter] Arduino IoT property "${name}": ${num}`);
    }

    const populated = Object.keys(result).length;
    console.log(`[HTTPAdapter] Arduino IoT: mapped ${populated} weather fields from ${properties.length} properties`);

    return result;
  }

  private parseBlynkResponse(data: any): Record<string, number | null> {
    if (Array.isArray(data)) {
      return {
        temperature: data[0] ?? null,
        humidity: data[1] ?? null,
        pressure: data[2] ?? null,
        windSpeed: data[3] ?? null,
        windDirection: data[4] ?? null,
        rainfall: data[5] ?? null,
      };
    }
    return this.parseGenericResponse(data);
  }

  private parseThingSpeakResponse(data: any): Record<string, number | null> {
    const feed = data?.feeds?.[0] || {};
    return {
      temperature: feed.field1 ? parseFloat(feed.field1) : null,
      humidity: feed.field2 ? parseFloat(feed.field2) : null,
      pressure: feed.field3 ? parseFloat(feed.field3) : null,
      windSpeed: feed.field4 ? parseFloat(feed.field4) : null,
      windDirection: feed.field5 ? parseFloat(feed.field5) : null,
      rainfall: feed.field6 ? parseFloat(feed.field6) : null,
      solarRadiation: feed.field7 ? parseFloat(feed.field7) : null,
      batteryVoltage: feed.field8 ? parseFloat(feed.field8) : null,
    };
  }

  /**
   * OpenWeatherMap current-weather response.
   *
   * Shape: { main: { temp, humidity, pressure, grnd_level }, wind: { speed, deg,
   * gust }, rain: { "1h" }, clouds: { all }, visibility }.
   *
   * This previously fell through to the generic parser, which got the
   * temperature and humidity by accident and was wrong in two ways that mattered:
   * `wind.deg` matched none of the generic direction aliases, so wind direction
   * was silently dropped, and a response in Kelvin was stored as if it were
   * Celsius, putting every reading near 295 degrees.
   *
   * Pressure prefers `grnd_level`, the pressure at the station, over `pressure`,
   * which OpenWeatherMap reduces to sea level. Stratus treats pressure as a
   * station reading everywhere else, and mixing the two makes a barometric trend
   * meaningless.
   */
  private parseOpenWeatherMapResponse(data: any): Record<string, number | null> {
    const main = data?.main ?? {};
    const wind = data?.wind ?? {};
    const rain = data?.rain ?? {};
    const snow = data?.snow ?? {};

    const n = (v: any): number | null => {
      if (v === null || v === undefined) return null;
      const num = typeof v === "number" ? v : parseFloat(v);
      return Number.isFinite(num) ? num : null;
    };

    /**
     * Normalize temperature regardless of the `units` the endpoint was called
     * with. buildEndpointUrl adds units=metric when the operator did not, but an
     * endpoint that already carries units=standard or units=imperial is left as
     * the operator wrote it, and a station must not silently record the wrong
     * scale because of it. The ranges do not overlap for any temperature this
     * planet produces: Kelvin is above 150, Fahrenheit above 60 is beyond the
     * highest air temperature ever recorded in Celsius.
     */
    const toCelsius = (v: number | null): number | null => {
      if (v === null) return null;
      if (v > 150) return v - 273.15;
      if (v > 60) return this.fahrenheitToCelsius(v);
      return v;
    };

    const result: Record<string, number | null> = {
      temperature: toCelsius(n(main.temp)),
      humidity: n(main.humidity),
      // grnd_level first: see the note above on station versus sea-level pressure.
      pressure: n(main.grnd_level) ?? n(main.pressure),
      windSpeed: n(wind.speed),
      windDirection: n(wind.deg),
      windGust: n(wind.gust),
      // Rain is reported for the last hour, in mm. Snow is added because a
      // station that reports only snow would otherwise show no precipitation.
      rainfall: n(rain["1h"]) ?? n(rain["3h"]) ?? n(snow["1h"]) ?? n(snow["3h"]),
      dewPoint: toCelsius(n(main.dew_point ?? data?.dew_point)),
      cloudCover: n(data?.clouds?.all),
      // Reported in meters; Stratus carries visibility in kilometres.
      visibility: n(data?.visibility) === null ? null : (n(data.visibility) as number) / 1000,
    };

    // Drop the keys the service did not report, so a missing field stays missing
    // rather than being written as a null that overwrites a good earlier value.
    for (const key of Object.keys(result)) {
      if (result[key] === null) delete result[key];
    }
    return result;
  }

  private parseGenericResponse(data: any): Record<string, number | null> {
    const flatten = (obj: any, prefix = ""): Record<string, any> => {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj || {})) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          Object.assign(result, flatten(value, newKey));
        } else {
          result[newKey] = value;
        }
      }
      return result;
    };

    const flat = flatten(data);
    
    const mappings: Record<string, string[]> = {
      temperature: ["temperature", "temp", "air_temp", "t", "temp_c", "temperature_c"],
      humidity: ["humidity", "rh", "relative_humidity", "hum"],
      pressure: ["pressure", "baro", "barometer", "slp", "qnh", "bp"],
      windSpeed: ["wind_speed", "windspeed", "ws", "wind", "wspd"],
      windDirection: ["wind_direction", "winddir", "wd", "wdir"],
      windGust: ["wind_gust", "gust", "wgust"],
      rainfall: ["rainfall", "rain", "precip", "precipitation"],
      solarRadiation: ["solar_radiation", "solar", "radiation", "sr"],
      dewPoint: ["dew_point", "dewpoint", "dp"],
      batteryVoltage: ["battery", "batt", "battery_voltage", "vbatt"],
    };

    const result: Record<string, number | null> = {};

    for (const [normalized, aliases] of Object.entries(mappings)) {
      for (const alias of aliases) {
        for (const [key, value] of Object.entries(flat)) {
          if (key.toLowerCase().includes(alias)) {
            const num = typeof value === "number" ? value : parseFloat(value);
            if (!isNaN(num)) {
              result[normalized] = num;
              break;
            }
          }
        }
        if (result[normalized] !== undefined) break;
      }
    }

    return result;
  }

  private fahrenheitToCelsius(f: number): number {
    return (f - 32) * 5 / 9;
  }
}
