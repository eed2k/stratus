/**
 * Verify the report site line (latitude, longitude, altitude).
 *
 * Imports only reportSchedulerService and pdfReportService. Neither registers a
 * cron task nor reaches sendEmail at module scope, and server/index.ts is never
 * imported, so running this cannot send a report.
 *
 *   npx tsx demo/verify_report_site_line.ts
 */
import { formatSiteLine } from "../server/services/reportSchedulerService";

let failures = 0;

function check(label: string, actual: string | null, expected: string | null) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  console.log(`      got      ${actual === null ? "<null>" : `"${actual}"`}`);
  if (!ok) console.log(`      expected ${expected === null ? "<null>" : `"${expected}"`}`);
}

console.log("formatSiteLine");
console.log("=".repeat(70));

// Potchefstroom, the demo site: southern and eastern hemisphere.
check("Potchefstroom demo site",
  formatSiteLine({ latitude: -26.7145, longitude: 27.0977, altitude: 1350 }),
  "Lat 26.71450 S  |  Lon 27.09770 E  |  Altitude 1350 m AMSL");

// Northern and western hemisphere, to prove the hemisphere letters switch.
check("northern / western hemisphere",
  formatSiteLine({ latitude: 51.4778, longitude: -0.0015, altitude: 47 }),
  "Lat 51.47780 N  |  Lon 0.00150 W  |  Altitude 47 m AMSL");

// Altitude zero is a real value (a coastal station) and must not be dropped.
check("sea-level altitude is kept, not treated as missing",
  formatSiteLine({ latitude: -33.9249, longitude: 18.4241, altitude: 0 }),
  "Lat 33.92490 S  |  Lon 18.42410 E  |  Altitude 0 m AMSL");

// Coordinates present, altitude not recorded.
check("altitude missing",
  formatSiteLine({ latitude: -26.7145, longitude: 27.0977, altitude: null }),
  "Lat 26.71450 S  |  Lon 27.09770 E");

// Altitude present, coordinates not recorded.
check("coordinates missing",
  formatSiteLine({ latitude: null, longitude: null, altitude: 1350 }),
  "Altitude 1350 m AMSL");

// A half-set coordinate pair is unusable and must not print half a position.
check("latitude without longitude is not printed",
  formatSiteLine({ latitude: -26.7145, longitude: null, altitude: null }),
  null);

// Nothing recorded: caller omits the line entirely.
check("nothing recorded returns null so the line is omitted",
  formatSiteLine({ latitude: null, longitude: null, altitude: null }),
  null);

// Non-finite values must be rejected rather than printed as NaN.
check("NaN coordinates rejected",
  formatSiteLine({ latitude: NaN, longitude: NaN, altitude: null }),
  null);

// ASCII only: PDFKit's built-in Helvetica is WinAnsi-encoded.
const sample = formatSiteLine({ latitude: -26.7145, longitude: 27.0977, altitude: 1350 })!;
const nonAscii = [...sample].filter((ch) => ch.charCodeAt(0) > 127);
if (nonAscii.length) {
  console.log(`FAIL  site line contains non-ASCII: ${nonAscii.join(" ")}`);
  failures++;
} else {
  console.log("PASS  site line is pure ASCII (safe for PDFKit Helvetica)");
}

async function main() {
  // ── never-throw contract on the PDF builder ──────────────────────────────
  // No database is configured here, so every query fails. buildSchedulePdfBuffer
  // must still return a valid PDF rather than throwing, which also exercises the
  // branch where the station has no coordinates and the site line is omitted.
  console.log();
  console.log("buildSchedulePdfBuffer with no database reachable");
  console.log("=".repeat(70));
  try {
    const { buildSchedulePdfBuffer } = await import("../server/services/pdfReportService");
    const buf = await buildSchedulePdfBuffer({
      stationIds: [8],
      startMs: Date.now() - 7 * 86_400_000,
      endMs: Date.now(),
      title: "Site line verification",
      periodLabel: "Last 7 days",
    });
    const header = buf.subarray(0, 5).toString("latin1");
    console.log(`bytes            ${buf.length}`);
    console.log(`header           ${JSON.stringify(header)}`);
    if (header !== "%PDF-") { console.log("FAIL  not a PDF"); failures++; }
    else console.log("PASS  returned a valid PDF instead of throwing");
  } catch (err: any) {
    console.log(`FAIL  threw instead of returning a fallback PDF: ${err?.message || err}`);
    failures++;
  }

  console.log();
  console.log("=".repeat(70));
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
