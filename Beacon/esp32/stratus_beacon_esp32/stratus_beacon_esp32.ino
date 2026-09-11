// =========================================================================
//
//  Stratus Lightning Beacon (ESP32)
//  Polls the Quaggasklip LDS admin panel
//
//  Property of METRON (PTY) LTD | Inteltronics
//  Developer: L.J. Esterhuizen
//
// =========================================================================
//
// WHAT IT DOES
//   Polls  GET https://adminpanel.stratusweather.co.za/quaggasklip/api/v1/beacon/state
//   over outbound HTTPS (TLS, pinned to ISRG Root X1) and drives four outputs:
//
//     CH1  GREEN   12 V   detector reporting in (unit_online == true)
//     CH2  RED     12 V   detector NOT reporting in, OR the panel is
//                         unreachable
//     CH3  YELLOW  12 V   1 s flicker for 15 s when a strike lands inside
//                         10 km, then a 30 minute cooldown before it can fire
//                         again
//     CH4  WIFI    12 V   blinks (500ms on/off) for at least 4s after boot
//                         or a reconnect attempt, and continues blinking
//                         until connected; solid once WiFi is connected
//
// Only makes outbound HTTPS requests, so
// Behind NAT with no port forwarding.
//
// BOARD:  any ESP32 dev module (ESP32-WROOM-32 DevKitC recommended).
// SECRETS: WiFi password and panel token live in arduino_secrets.h
// =========================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <esp_task_wdt.h>

#include "ca_cert.h"          // ISRG_ROOT_X1_PEM
#include "arduino_secrets.h"  // WIFI_SSID, WIFI_PASSWORD, PANEL_AUTH_TOKEN

// ---------------------------------------------------------------------------
// Configuration (non-secret). Secrets are in arduino_secrets.h.
// ---------------------------------------------------------------------------

// Panel + tenant. This beacon is bound to the Quaggasklip client panel, so it
// polls the /quaggasklip/ path and presents the Quaggasklip token. Point it at
// a different tenant by changing the path, the station and the token together.
static const char* PANEL_HOST   = "adminpanel.stratusweather.co.za";
static const int   PANEL_PORT   = 443;
static const char* PANEL_PATH   = "/quaggasklip/api/v1/beacon/state";
static const char* STATION_ID   = "QUAGGASKLIP";

// Timing.
static const uint32_t POLL_INTERVAL_MS  = 10000;   // poll the panel every 10 s
static const uint32_t HTTP_TIMEOUT_MS   = 12000;   // per-request TLS+HTTP budget
static const uint32_t WDT_TIMEOUT_S     = 30;      // hardware watchdog

// Yellow strike lamp.
static const float    LIGHTNING_KM      = 10.0f;   // only strikes within this fire it
static const uint32_t FLICKER_TOTAL_MS  = 15000;   // flicker for 15 s
static const uint32_t FLICKER_HALF_MS   = 500;     // 500 on / 500 off = 1 s cadence
static const uint32_t STRIKE_COOLDOWN_MS = 30UL * 60UL * 1000UL;  // 30 min
// A strike is only treated as "new" while its reported age is within this
// window. Must be a little larger than the poll interval so a fresh strike is
// never missed, but small enough that an old strike (e.g. seen right after a
// reboot) does not trigger a burst. The 30 min cooldown then suppresses repeats.
static const uint32_t STRIKE_FRESH_S    = 30;

// WiFi status lamp blink cadence while connecting/offline.
static const uint32_t WIFI_BLINK_MS     = 500;     // 500 on / 500 off = 1 s cadence
static const uint32_t WIFI_MIN_BLINK_MS = 4000;    // blink at least this long after boot,
                                                    // even if WiFi connects sooner
static const uint32_t WIFI_RETRY_MS     = 15000;   // re-kick a stalled connect

// ---- Output pins (ESP32 BCM/GPIO numbers) ----
// All four are safe general-purpose outputs on a WROOM-32: not strapping pins,
// not input-only, no boot-time output. Change here if your wiring differs.
static const int PIN_GREEN  = 26;   // CH1
static const int PIN_RED    = 25;   // CH2
static const int PIN_YELLOW = 33;   // CH3
static const int PIN_WIFI   = 32;   // CH4

// Most opto-isolated relay/SSR input stages switch the load when the control
// input is pulled LOW. If every lamp shows the opposite of what it should,
// flip this one flag. Verify on the bench: with the detector active, GREEN must
// be lit and RED dark.
static const bool ACTIVE_LOW = true;

// What to show when the panel cannot be reached: RED (recommended) or dark.
static const bool FAIL_TO_RED = true;

// ---------------------------------------------------------------------------
// Types (declared before any function so the Arduino auto-prototype step,
// which runs before the definitions below, always sees the full type).
// ---------------------------------------------------------------------------

// online: 1 = up, 0 = down, -1 = unknown (treated as down for the lamps).
struct PanelState {
  int   online;
  bool  haveStrike;
  float strikeAgeS;
  float strikeKm;
};

// ---------------------------------------------------------------------------
// Lamp helpers
// ---------------------------------------------------------------------------

static void lampWrite(int pin, bool on) {
  // Translate logical on/off to the electrical level the board expects.
  digitalWrite(pin, (on == !ACTIVE_LOW) ? HIGH : LOW);
}

// Start all four "true" so the very first setX(false) call in setup() sees a
// real state change and actually issues the digitalWrite -- otherwise the
// initial off-command is skipped (cached state already matches) and each pin
// is left at its power-on-reset level, which is ON for an active-low relay.
static bool  g_green = true, g_red = true, g_yellow = true, g_wifi = true;

static void setGreen(bool on)  { if (on != g_green)  { g_green = on;  lampWrite(PIN_GREEN, on);  } }
static void setRed(bool on)    { if (on != g_red)    { g_red = on;    lampWrite(PIN_RED, on);    } }
static void setYellow(bool on) { if (on != g_yellow) { g_yellow = on; lampWrite(PIN_YELLOW, on); } }
static void setWifi(bool on)   { if (on != g_wifi)   { g_wifi = on;   lampWrite(PIN_WIFI, on);   } }

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

static uint32_t g_lastPoll      = 0;
static uint32_t g_flickerUntil  = 0;   // millis() deadline for the yellow burst
static uint32_t g_flickerStart  = 0;
static uint32_t g_cooldownUntil = 0;   // no new burst before this
static uint32_t g_wifiRetryAt   = 0;
static uint32_t g_wifiMinBlinkUntil = 0;   // don't show solid-on before this, even if connected
static uint32_t g_failCount     = 0;

// ---------------------------------------------------------------------------
// Minimal JSON field reader
// ---------------------------------------------------------------------------
// The beacon/state response is a small, flat JSON object, so a dependency-free
// reader is safer than pulling in a JSON library (and one less version to break
// on a field upgrade). Returns the raw token after "key": (e.g. "true",
// "false", "null", "42", "8.0", or a quoted string with quotes stripped).

static bool jsonValue(const String& body, const char* key, String& out) {
  String needle = String("\"") + key + "\"";
  int k = body.indexOf(needle);
  if (k < 0) return false;
  int c = body.indexOf(':', k + needle.length());
  if (c < 0) return false;
  int i = c + 1;
  while (i < (int)body.length() && (body[i] == ' ' || body[i] == '\t')) i++;
  int start = i;
  bool inStr = false;
  for (; i < (int)body.length(); i++) {
    char ch = body[i];
    if (ch == '"') inStr = !inStr;
    else if (!inStr && (ch == ',' || ch == '}')) break;
  }
  String tok = body.substring(start, i);
  tok.trim();
  if (tok.startsWith("\"") && tok.endsWith("\"") && tok.length() >= 2)
    tok = tok.substring(1, tok.length() - 1);
  out = tok;
  return true;
}

// ---------------------------------------------------------------------------
// WiFi
// ---------------------------------------------------------------------------

static void wifiBegin() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // steadier latency; this is mains/solar powered
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  g_wifiRetryAt = millis() + WIFI_RETRY_MS;
  g_wifiMinBlinkUntil = millis() + WIFI_MIN_BLINK_MS;
  Serial.printf("[wifi] connecting to \"%s\"\n", WIFI_SSID);
}

// Drive CH4 from the live WiFi state, and re-kick a stalled association.
// Always blinks for at least WIFI_MIN_BLINK_MS after boot (or after a
// re-kick), even if the connection completes sooner -- then goes solid once
// actually connected. Keeps blinking past that window for as long as WiFi
// stays down.
static void serviceWifi() {
  bool up = (WiFi.status() == WL_CONNECTED);
  bool pastMinBlink = (int32_t)(millis() - g_wifiMinBlinkUntil) >= 0;
  if (up && pastMinBlink) {
    setWifi(true);                // solid on once connected and past the min blink window
    return;
  }
  // Blink while connecting/offline, or still inside the guaranteed blink window.
  bool phase = ((millis() / WIFI_BLINK_MS) % 2) == 0;
  setWifi(phase);
  if ((int32_t)(millis() - g_wifiRetryAt) >= 0) {
    Serial.println("[wifi] still down, re-kicking association");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    g_wifiRetryAt = millis() + WIFI_RETRY_MS;
  }
}

// ---------------------------------------------------------------------------
// Panel poll
// ---------------------------------------------------------------------------

static bool fetchState(PanelState& st) {
  st.online = -1; st.haveStrike = false; st.strikeAgeS = 0; st.strikeKm = 0;

  WiFiClientSecure client;
  client.setCACert(ISRG_ROOT_X1_PEM);           // pinned root; real validation
  client.setTimeout(HTTP_TIMEOUT_MS / 1000);

  HTTPClient https;
  https.setConnectTimeout(HTTP_TIMEOUT_MS);
  https.setTimeout(HTTP_TIMEOUT_MS);

  String url = String("https://") + PANEL_HOST + PANEL_PATH +
               "?station_id=" + STATION_ID;
  if (!https.begin(client, url)) {
    Serial.println("[poll] begin() failed");
    return false;
  }
  https.addHeader("X-Auth-Token", PANEL_AUTH_TOKEN);
  https.addHeader("Accept", "application/json");
  https.setUserAgent("stratus-beacon-esp32/1.0");

  int code = https.GET();
  if (code != 200) {
    if (code == 401)
      Serial.println("[poll] HTTP 401: token rejected (check PANEL_AUTH_TOKEN "
                     "matches the quaggasklip tenant token on the panel)");
    else
      Serial.printf("[poll] HTTP %d\n", code);
    https.end();
    return false;
  }

  String body = https.getString();
  https.end();

  String v;
  if (jsonValue(body, "unit_online", v)) {
    if (v == "true")       st.online = 1;
    else if (v == "false") st.online = 0;
    else                   st.online = -1;   // null -> unknown
  }
  if (jsonValue(body, "last_strike_age_s", v) && v != "null" && v.length()) {
    st.haveStrike = true;
    st.strikeAgeS = v.toFloat();
  }
  if (jsonValue(body, "last_strike_km", v) && v != "null" && v.length()) {
    st.strikeKm = v.toFloat();
  } else {
    st.strikeKm = -1;  // out-of-range / unranged; do not treat as in-range
  }
  return true;
}

// ---------------------------------------------------------------------------
// Yellow burst
// ---------------------------------------------------------------------------

static void serviceFlicker() {
  uint32_t now = millis();
  if ((int32_t)(now - g_flickerUntil) < 0) {
    // Square wave phased from the START of the burst, so it always begins lit.
    uint32_t elapsed = now - g_flickerStart;
    bool on = ((elapsed / FLICKER_HALF_MS) % 2) == 0;
    setYellow(on);
  } else {
    setYellow(false);
  }
}

static void maybeArmFlicker(const PanelState& st) {
  if (!st.haveStrike) return;
  if (st.strikeKm < 0 || st.strikeKm > LIGHTNING_KM) return;   // not in range
  if (st.strikeAgeS > (float)STRIKE_FRESH_S) return;           // old news
  uint32_t now = millis();
  if ((int32_t)(now - g_cooldownUntil) < 0) return;            // still cooling down
  if ((int32_t)(now - g_flickerUntil) < 0) return;             // already flickering
  g_flickerStart = now;
  g_flickerUntil = now + FLICKER_TOTAL_MS;
  g_cooldownUntil = now + STRIKE_COOLDOWN_MS;
  Serial.printf("[strike] in range at %.0f km (age %.0fs) -> yellow %us, "
                "cooldown %lu min\n",
                st.strikeKm, st.strikeAgeS, FLICKER_TOTAL_MS / 1000,
                (unsigned long)(STRIKE_COOLDOWN_MS / 60000));
}

// ---------------------------------------------------------------------------
// Online lamps
// ---------------------------------------------------------------------------

static void applyOnline(int online) {
  if (online == 1) {              // known up
    setGreen(true);  setRed(false);
  } else if (online == 0) {       // known down
    setGreen(false); setRed(true);
  } else {                        // unknown -> never green
    setGreen(false); setRed(FAIL_TO_RED);
  }
}

// ---------------------------------------------------------------------------
// Arduino entry points
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=== Stratus Lightning Beacon (ESP32) ===");
  Serial.printf("panel https://%s%s station=%s\n", PANEL_HOST, PANEL_PATH, STATION_ID);

  pinMode(PIN_GREEN, OUTPUT);
  pinMode(PIN_RED, OUTPUT);
  pinMode(PIN_YELLOW, OUTPUT);
  pinMode(PIN_WIFI, OUTPUT);
  // Start with every lamp off, then assert the fail state so a booting beacon
  // is never mistaken for a dead one.
  setGreen(false); setRed(false); setYellow(false); setWifi(false);
  applyOnline(-1);

  // Hardware watchdog. Compatible with both ESP32 Arduino core 2.x and 3.x.
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
  esp_task_wdt_config_t wdt_cfg = {
    .timeout_ms = WDT_TIMEOUT_S * 1000,
    .idle_core_mask = 0,
    .trigger_panic = true,
  };
  esp_task_wdt_init(&wdt_cfg);
#else
  esp_task_wdt_init(WDT_TIMEOUT_S, true);
#endif
  esp_task_wdt_add(NULL);

  wifiBegin();
}

void loop() {
  esp_task_wdt_reset();
  serviceWifi();
  serviceFlicker();

  uint32_t now = millis();
  if ((int32_t)(now - g_lastPoll) >= 0) {
    g_lastPoll = now + POLL_INTERVAL_MS;
    if (WiFi.status() == WL_CONNECTED) {
      PanelState st;
      if (fetchState(st)) {
        if (g_failCount) {
          Serial.printf("[poll] panel reachable again after %lu failure(s)\n",
                        (unsigned long)g_failCount);
          g_failCount = 0;
        }
        applyOnline(st.online);
        maybeArmFlicker(st);
      } else {
        g_failCount++;
        if (g_failCount == 1 || (g_failCount % 30) == 0)
          Serial.printf("[poll] panel unreachable (%lu consecutive)\n",
                        (unsigned long)g_failCount);
        applyOnline(-1);          // fail to red; leave any active burst running
      }
    } else {
      applyOnline(-1);            // no WiFi -> unknown -> red
    }
  }

  delay(20);                      // keep the loop responsive without busy-spinning
}
