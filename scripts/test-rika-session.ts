// Stratus Weather Server
// Standalone self-test for the RikaCloud session-recovery + device-targeting fix.
//
// This test does NOT require a test framework or network access. It monkey-patches
// axios to simulate RikaCloud responses and asserts that the HTTPAdapter:
//   1. Renews an expired session on HTTP 401 and retries (the outage fix).
//   2. Renews on a 200 response whose JSON body signals an auth/login error.
//   3. Reads data normally when the session is valid (no needless re-login).
//   4. Isolates a single physical station via rikaDeviceId (no cross-station merge).
//   5. Skips a poll when the device reports the same reading timestamp (no dup).
//
// Run from the project root:
//   npx tsx scripts/test-rika-session.ts
//
// Exit code 0 = all checks passed, 1 = one or more failed.

import axios from "axios";
import { HTTPAdapter } from "../server/protocols/httpAdapter";

// ---- tiny assertion helpers -------------------------------------------------
let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---- fixtures ---------------------------------------------------------------
// Two physical stations share one farm (agri_id STA-A and STA-B). STA-A reports
// 21.5 °C; STA-B reports a decoy 99 °C so we can prove device isolation works.
function deviceArray(t = 1_719_400_000) {
  return [
    { pk: 1, name: "AirTemp", agri_id: "STA-A", the_type: 2001, unit: "C", is_online: true, data: { value: 21.5, t } },
    { pk: 2, name: "RH", agri_id: "STA-A", the_type: 2002, unit: "%", is_online: true, data: { value: 60, t } },
    { pk: 9, name: "OtherTemp", agri_id: "STA-B", the_type: 2001, unit: "C", is_online: true, data: { value: 99, t } },
  ];
}

// Base config for a RikaCloud station. `type` drives serviceType detection.
function makeConfig(extra: Record<string, any> = {}) {
  return {
    stationId: 250125,
    protocol: "http",
    connectionType: "http",
    timeout: 30000,
    type: "rikacloud",
    rikaEmail: "test@example.com",
    rikaPassword: "secret",
    apiEndpoint: "",
    ...extra,
  } as any;
}

// Install axios stubs. `getSequence` is an array of response objects returned by
// the data endpoint (httpClient.get) in order; the last entry repeats. Login
// (axios.post) and farm discovery (axios.get) are always satisfied.
function installStubs(adapter: HTTPAdapter, getSequence: any[]) {
  const state = { loginCount: 0, dataGetCount: 0 };

  // Login endpoint
  (axios as any).post = async (_url: string) => {
    state.loginCount++;
    return { status: 200, data: { session: `SESSION-${state.loginCount}` } };
  };
  // Farm discovery (default axios.get) + any other default gets
  (axios as any).get = async (url: string) => {
    if (String(url).includes("/farm/")) {
      return { status: 200, data: [{ farm: { pk: 42, name: "Test Farm" } }] };
    }
    return { status: 200, data: [] };
  };
  // Data endpoint (the adapter's private httpClient instance)
  (adapter as any).httpClient.get = async (_url: string) => {
    const idx = Math.min(state.dataGetCount, getSequence.length - 1);
    state.dataGetCount++;
    return getSequence[idx];
  };

  return state;
}

const JSON_HDR = { "content-type": "application/json" };

async function run() {
  // -- Test 1: expired session returns HTTP 401 -> renew + retry --------------
  console.log("\nTest 1: recover from expired session (HTTP 401)");
  {
    const adapter = new HTTPAdapter(makeConfig({ rikaDeviceId: "STA-A" }));
    adapter.on("error", () => {}); // avoid unhandled 'error' event
    const state = installStubs(adapter, [
      { status: 401, headers: JSON_HDR, data: { message: "session expired" } },
      { status: 200, headers: JSON_HDR, data: deviceArray() },
    ]);

    const result = await adapter.readData();
    check("re-logged in after 401", state.loginCount === 2, `loginCount=${state.loginCount}`);
    check("returned data after recovery", result !== null);
    check("temperature parsed correctly", result?.temperature === 21.5, `got ${result?.temperature}`);
  }

  // -- Test 2: 200 response with a JSON auth-error body -----------------------
  console.log("\nTest 2: recover from 200 + JSON auth-error body");
  {
    const adapter = new HTTPAdapter(makeConfig({ rikaDeviceId: "STA-A" }));
    adapter.on("error", () => {});
    const state = installStubs(adapter, [
      { status: 200, headers: JSON_HDR, data: { code: 401, message: "please login again" } },
      { status: 200, headers: JSON_HDR, data: deviceArray() },
    ]);

    const result = await adapter.readData();
    check("re-logged in after JSON auth error", state.loginCount === 2, `loginCount=${state.loginCount}`);
    check("returned data after recovery", result !== null && result.temperature === 21.5);
  }

  // -- Test 3: valid session, no needless re-login ----------------------------
  console.log("\nTest 3: valid session reads without re-login");
  {
    const adapter = new HTTPAdapter(makeConfig({ rikaDeviceId: "STA-A" }));
    adapter.on("error", () => {});
    const state = installStubs(adapter, [
      { status: 200, headers: JSON_HDR, data: deviceArray() },
    ]);

    const result = await adapter.readData();
    check("logged in exactly once", state.loginCount === 1, `loginCount=${state.loginCount}`);
    check("returned data", result !== null && result.temperature === 21.5);
  }

  // -- Test 4: device isolation via rikaDeviceId ------------------------------
  console.log("\nTest 4: rikaDeviceId isolates a single physical station");
  {
    // Without a filter, STA-B's 99 C could win (last-writer). With STA-A it must be 21.5.
    const adapter = new HTTPAdapter(makeConfig({ rikaDeviceId: "STA-A" }));
    adapter.on("error", () => {});
    installStubs(adapter, [{ status: 200, headers: JSON_HDR, data: deviceArray() }]);

    const result = await adapter.readData();
    check("used STA-A temperature (21.5), not STA-B decoy (99)", result?.temperature === 21.5, `got ${result?.temperature}`);
    check("humidity from STA-A present", result?.humidity === 60, `got ${result?.humidity}`);
  }

  // -- Test 5: skip duplicate stale reading (same timestamp) ------------------
  console.log("\nTest 5: skip when reading timestamp is unchanged");
  {
    const adapter = new HTTPAdapter(makeConfig({ rikaDeviceId: "STA-A" }));
    adapter.on("error", () => {});
    // Both polls return the SAME reading timestamp -> second poll is a no-op.
    installStubs(adapter, [
      { status: 200, headers: JSON_HDR, data: deviceArray(1_719_400_000) },
      { status: 200, headers: JSON_HDR, data: deviceArray(1_719_400_000) },
    ]);

    const first = await adapter.readData();
    const second = await adapter.readData();
    check("first poll returns data", first !== null);
    check("second poll (same timestamp) is skipped", second === null);
    check("reading timestamp reflects device time", first?.timestamp?.getTime() === 1_719_400_000 * 1000);
  }

  // ---- summary --------------------------------------------------------------
  console.log(`\n${"=".repeat(48)}`);
  console.log(`Rika session self-test: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(48));
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Test harness crashed:", err);
  process.exit(1);
});
