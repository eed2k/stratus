/**
 * Stratus Web App Brochure PDF Generator
 * Plain black text, research-grade format
 */
const { jsPDF } = require('jspdf');
const autoTable = require('jspdf-autotable').default || require('jspdf-autotable');

const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
const pageW = 210;
const pageH = 297;
const margin = 22;
const contentW = pageW - margin * 2;
let y = 0;
const BLACK = [0, 0, 0];

function setBlack() { doc.setTextColor(0, 0, 0); }

function checkPage(needed) {
  if (y + needed > pageH - 20) {
    doc.addPage();
    y = 25;
    return true;
  }
  return false;
}

function sectionTitle(text) {
  checkPage(30);
  y += 6;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  setBlack();
  doc.text(text.toUpperCase(), margin, y);
  y += 1;
  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);
  doc.line(margin, y, margin + contentW, y);
  y += 5;
}

function subHeading(text) {
  checkPage(25);
  y += 2;
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  setBlack();
  doc.text(text, margin, y);
  y += 4.5;
}

function bodyText(text, indent) {
  const x = margin + (indent || 0);
  const w = contentW - (indent || 0);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  setBlack();
  const lines = doc.splitTextToSize(text, w);
  lines.forEach(line => {
    checkPage(4.5);
    doc.text(line, x, y);
    y += 4;
  });
}

function bulletList(items, indent) {
  const x = margin + (indent || 4);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  setBlack();
  items.forEach(item => {
    checkPage(5);
    doc.text('-', x - 4, y);
    const lines = doc.splitTextToSize(item, contentW - (indent || 4) - 2);
    lines.forEach(line => {
      doc.text(line, x, y);
      y += 3.8;
    });
  });
}

function addTable(headers, rows, colWidths) {
  checkPage(15);
  autoTable(doc, {
    startY: y,
    head: [headers],
    body: rows,
    margin: { left: margin, right: margin },
    styles: { fontSize: 7.5, cellPadding: 1.5, font: 'helvetica', textColor: BLACK, lineColor: [160, 160, 160], lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: [240, 240, 240], textColor: BLACK, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: colWidths ? Object.fromEntries(colWidths.map((w, i) => [i, { cellWidth: w }])) : {},
    theme: 'grid',
  });
  y = doc.lastAutoTable.finalY + 4;
}

// ====== COVER ======
y = 65;
doc.setFontSize(28);
doc.setFont('helvetica', 'bold');
setBlack();
doc.text('STRATUS', pageW / 2, y, { align: 'center' });
y += 10;
doc.setFontSize(14);
doc.setFont('helvetica', 'normal');
doc.text('Weather Station Server', pageW / 2, y, { align: 'center' });
y += 8;
doc.setFontSize(10);
doc.text('Product Brochure', pageW / 2, y, { align: 'center' });
y += 5;
doc.setLineWidth(0.5);
doc.line(pageW / 2 - 30, y, pageW / 2 + 30, y);
y += 15;

doc.setFontSize(9.5);
doc.setFont('helvetica', 'normal');
const overview = 'Stratus is a professional weather station monitoring platform delivered as a cloud-hosted web application. It provides real-time data visualisation across 17+ dashboard sections, threshold and rate-of-change alarms, WMO-compliant data quality assurance, ISO 17025 calibration management, agricultural analytics, fire danger monitoring, and comprehensive audit logging. Stratus connects to weather stations via multiple protocols and tracks 100+ weather parameters.';
doc.splitTextToSize(overview, contentW).forEach(l => { doc.text(l, margin, y); y += 4.5; });
y += 3;
const audience = 'Designed for meteorologists, farmers, researchers, environmental consultants, water resource managers, renewable energy operators, and compliance officers - Stratus brings enterprise-grade station management to organisations of every size.';
doc.splitTextToSize(audience, contentW).forEach(l => { doc.text(l, margin, y); y += 4.5; });

y += 10;
doc.setFont('helvetica', 'bold');
doc.setFontSize(10);
doc.text('Deployment Overview', margin, y); y += 5;
doc.setFont('helvetica', 'normal');
doc.setFontSize(9);
const deployLines = [
  'Cloud VPS: Vultr  |  Database: Neon Serverless PostgreSQL  |  SSL: Traefik + Let\'s Encrypt',
  'Container: Docker multi-stage build (Node.js 20 Alpine)  |  Reverse Proxy: Traefik v2.11',
  'Frontend: React 18 + TypeScript + Tailwind CSS  |  Backend: Node.js 20 + Express + Drizzle ORM',
];
deployLines.forEach(l => { doc.text(l, margin, y); y += 4; });

// ====== PAGE 2 - DASHBOARD SECTIONS ======
doc.addPage();
y = 25;

sectionTitle('Dashboard Sections & Visualisations');

addTable(
  ['Section', 'Description'],
  [
    ['Current Conditions', 'All readings, last update, trend indicators, sparklines'],
    ['Wind Compass', 'Real-time 16-point compass with cardinal directions'],
    ['Wind Rose Charts', 'Frequency distribution (1 min to 31 days), 16-sector, Beaufort speed bands, calm %'],
    ['Wind Rose Scatter', 'Individual observations on polar chart, colour-coded speed classes'],
    ['Wind Power Card', 'Power density (W/m2), gust power, air density, energy potential projections'],
    ['Weather Chart', 'Interactive line/area/bar charts, min/max shaded regions, average overlays, tooltips'],
    ['Data Block Chart', 'Flexible multi-series chart with configurable axes'],
    ['Fire Danger Card', 'SA FDI gauge, colour-coded rating, fuel moisture, spread potential, 24h trend'],
    ['Station Map', 'OpenStreetMap/Leaflet with location marker'],
    ['Solar Position Card', 'Elevation, azimuth, sunrise/sunset, dawn/dusk, 24h solar track'],
    ['Solar Radiation Card', 'Current and historical solar flux'],
    ['Solar Power Harvest', 'Harvestable energy estimates, peak sun hours, daily/weekly/monthly/yearly projections'],
    ['Air Density Card', 'Real-time calculation from temperature, pressure, humidity'],
    ['Barometric Pressure', 'Dual display: station-level + sea-level QNH (hPa)'],
    ['MPPT Charger Card', 'Victron charger state tracking, battery health, solar input/load, dual charger'],
    ['ETo / Evapotranspiration', 'Reference ET, cumulative (today, 7d, 30d)'],
    ['Statistics Card', 'Min/max/avg, 7-day rolling summaries'],
  ],
  [38, contentW - 38]
);

bodyText('Dashboard sections auto-hide when data is unavailable. Time range selection: 1h, 6h, 12h, 24h, 48h, 7d, 31d, and custom. Auto-refresh: 1s to 60s intervals. Per-station visibility toggling.');

// ====== WEATHER PARAMETERS ======
sectionTitle('Weather Parameters');

subHeading('Atmospheric');
bulletList([
  'Temperature (current, min, max) / Inside temperature',
  'Relative humidity / Inside humidity',
  'Barometric pressure (station + sea-level QNH)',
  'Dew point / Air density / Heat index / Wind chill',
  'Wet bulb temperature / Vapour pressure deficit (VPD)',
]);

subHeading('Wind');
bulletList([
  'Wind speed / direction / gust / 10-min gust',
  'Wind power density (W/m2) / Direction std deviation',
  'SDI-12 wind vector / Cumulative wind energy (kWh/m2)',
]);

subHeading('Precipitation');
bulletList(['Rainfall (10-min, daily, 7d, 30d, yearly) / Storm rain / Month rain / Year rain']);

subHeading('Solar & Radiation');
bulletList([
  'Solar radiation (current, max) / UV index',
  'Sun azimuth & elevation / Sunrise / sunset / twilight / Solar noon / Day length',
]);

subHeading('Soil & Environment');
bulletList(['Soil temperature & moisture / Leaf wetness / Water level / Lightning']);

subHeading('Air Quality');
bulletList(['PM1, PM2.5, PM10, particulate count / AQI, CO2, TVOC / Visibility / Cloud base & cover']);

subHeading('System & Power');
bulletList([
  'Battery voltage / Panel temperature / Console & transmitter battery / Charger voltage',
  'MPPT Charger 1 & 2: solar V/I/P, load V/I, battery V, charger state, board temp',
  'Pump select (well, borehole) / Port status (C1, C2)',
]);

// ====== CALCULATED METRICS ======
sectionTitle('Calculated & Derived Metrics');

addTable(
  ['Metric', 'Method', 'Detail'],
  [
    ['Dew Point', 'Magnus-Tetens formula', 'From temperature + humidity'],
    ['Sea-Level QNH', 'Hypsometric equation', 'Station pressure + altitude correction'],
    ['Air Density', 'Ideal gas law + humidity', 'Dry + vapour components'],
    ['Reference ETo', 'FAO-56 Penman-Monteith', 'Full solar geometry, net radiation, soil heat flux'],
    ['Wind Power', 'P = 0.5 x p x v^3', 'Output in W/m2'],
    ['Cumulative Wind Energy', 'Time-interval integration', 'Daily kWh/m2'],
    ['Heat Index', 'Rothfusz regression (NWS)', 'Adjustment factors for extreme T/RH'],
    ['Wind Chill', 'Environment Canada formula', 'Valid for T <= 10C, wind >= 4.8 km/h'],
    ['Solar Position', 'NOAA algorithm', 'Elevation, azimuth, sunrise/sunset, twilight'],
    ['Fire Danger (SA FDI)', 'SA additive table method', '5 levels: Safe (0-20) to Extreme (76-100)'],
    ['Grassland FDI', 'Grassland fire model', 'Curing factor, fuel moisture'],
    ['KBDI', 'Rainfall approximation', 'Drought severity tracking'],
    ['Fuel Moisture', 'Temperature + humidity', 'Fire risk input'],
    ['Spread Potential', 'Fire spread classification', 'From wind speed + FMC'],
    ['VPD', 'Saturation deficit', 'Key crop science parameter'],
    ['Wet Bulb Temp', 'Stull 2011 formula', 'Heat stress indicator'],
    ['Growing Degree Days', 'Configurable base (10C)', 'Crop development tracking'],
    ['Chill Hours', 'Utah model simplified', 'Fruit/nut vernalisation'],
  ],
  [34, 38, contentW - 72]
);

// ====== ALARMS ======
sectionTitle('Alarms & Notifications');

subHeading('Alarm Types');
bulletList([
  'Threshold alarms (above / below) on 25+ parameters',
  'Rate-of-change alarms / Data staleness detection (5 min to 7 days)',
  'Fire danger level alerts / Battery no-charge detection',
  'Exact-value match and not-equals conditions',
]);

subHeading('Severity & Delivery');
bulletList([
  'Levels: Info, Warning, Error, Critical with escalation & cooldown',
  'Email (MailerSend) / Browser push / Webhooks',
  'Acknowledgement workflow, trigger count tracking, events log',
]);

subHeading('Staleness Monitor');
bulletList([
  'Auto check every 15 min, 2-hour threshold, 6-hour cooldown',
  'Recovery notifications / Battery charging check every 5 min',
]);

// ====== CONNECTIVITY ======
sectionTitle('Connectivity & Protocols');

addTable(
  ['Protocol', 'Description'],
  [
    ['Dropbox Sync', 'Cloud sync for cellular modems - OAuth 2.0, auto token renewal, folder watching. Imports all historical records on first sync'],
    ['HTTP POST', 'Stations push data to /api/ingest/:stationId (rate-limited: 60 req/min)'],
    ['Arduino IoT Cloud', 'Arduino IoT Cloud API integration for Arduino-based sensor platforms'],
    ['RikaCloud', 'RIKA cloud IoT platform integration (v2 API)'],
  ],
  [30, contentW - 30]
);

// ====== IMPORT / EXPORT ======
sectionTitle('Data Import & Export');

subHeading('Import');
bulletList([
  'Campbell Scientific TOA5 CSV (4-header format) / TOB1 binary',
  'Manual file upload - bulk historical import via web interface',
  'Dropbox sync - automatic import, historical backfill',
  'HTTP POST ingest endpoint (rate-limited)',
]);

subHeading('Export');
bulletList([
  'CSV - configurable columns, ISO 8601 timestamps, custom date ranges',
  'Excel (.xlsx) - native Open XML generation',
  'PDF reports - multi-page with statistics tables',
  'Report generator - daily/weekly/monthly/custom, selectable parameters',
  'Audit log CSV / REST API for programmatic extraction',
]);

// ====== USER MANAGEMENT ======
sectionTitle('User Management & Security');

subHeading('Access Control');
bulletList([
  'Roles: Admin (full), User (station-specific), Viewer (read-only)',
  'Multi-organisation support / Email invitations with secure setup links',
  'Station assignment per user',
]);

subHeading('Security');
bulletList([
  'JWT authentication / bcrypt hashing (10 salt rounds)',
  'Login rate limiting (5 attempts / 15 min) / Password reset (3/hour)',
  'Helmet headers, CORS, HTTPS via Traefik + Let\'s Encrypt',
  'WebSocket 4 KB limit / Zod schema validation / Non-root Docker container',
]);

// ====== AUDIT ======
sectionTitle('Audit & Logging');
bulletList([
  'Full operation audit trail - login, config changes, exports, station modifications',
  'Event tracking: type, category, severity, actor, target, previous/new values',
  'Request tracking with legal basis, purpose, retention period',
  'Sensitive data redaction (passwords, tokens, keys)',
  'CSV-exportable audit logs',
]);

// ====== STATION METADATA ======
sectionTitle('Station Metadata');
bodyText('Each station stores: name, location, latitude, longitude, altitude, timezone, site description, notes, installation date/team, admin contact (name, email, phone), datalogger details (model, serial, firmware, program name/signature), modem details (model, serial, phone, SIM), antenna type, solar panel watts, battery Ah, enclosure type, station image, ingest ID, calibration dates, and maintenance history.');

// ====== UI ======
sectionTitle('User Interface');

addTable(
  ['Aspect', 'Detail'],
  [
    ['Framework', 'React 18 with TypeScript, Tailwind CSS'],
    ['Layout', 'Responsive card-based grid, mobile-friendly'],
    ['Charts', 'SVG gauges, Recharts line/bar charts'],
    ['Navigation', 'Sidebar menu, tabbed sections, URL routing'],
    ['Theming', 'Light/dark mode, Radix UI components'],
    ['Access', 'Any modern browser (Chrome, Firefox, Edge, Safari)'],
    ['Real-Time', 'WebSocket push, auto-refresh (1s-60s)'],
    ['Maps', 'Leaflet / OpenStreetMap interactive maps'],
  ],
  [28, contentW - 28]
);

// ====== DEPLOYMENT ======
sectionTitle('Deployment Architecture');

addTable(
  ['Component', 'Detail'],
  [
    ['Cloud VPS', 'Vultr cloud server (Ubuntu)'],
    ['Container', 'Docker multi-stage (node:20-alpine), non-root, health checks, auto-restart'],
    ['Orchestration', 'Docker Compose - app + PostgreSQL 15 + Traefik v2.11'],
    ['SSL/TLS', 'Let\'s Encrypt automatic HTTPS provisioning and renewal'],
    ['Database', 'Neon Serverless PostgreSQL (cloud) or PostgreSQL 15 (local)'],
    ['Backups', 'Scheduled (daily/weekly/pre-deploy), restore, monitoring'],
  ],
  [28, contentW - 28]
);

// ====== TECH STACK ======
sectionTitle('Technology Stack');

addTable(
  ['Layer', 'Technologies'],
  [
    ['Frontend', 'React 18, TypeScript, Tailwind CSS, Recharts, Radix UI, Socket.IO, Leaflet, jsPDF'],
    ['Backend', 'Node.js 20, Express, Drizzle ORM, PostgreSQL, Socket.IO, Zod, Helmet, bcrypt, JWT'],
    ['Deployment', 'Docker (multi-stage), Traefik v2.11, Let\'s Encrypt, PostgreSQL 15'],
  ],
  [24, contentW - 24]
);

// ====== APPLICATIONS ======
sectionTitle('Applications');

addTable(
  ['Sector', 'Use Cases'],
  [
    ['Agriculture', 'Irrigation scheduling, ETo, frost alerts, GDD, spray conditions, soil monitoring'],
    ['Fire Management', 'FDI, GFDI, KBDI, wildfire risk, fire weather alerting'],
    ['Research', 'Climate studies, environmental monitoring'],
    ['Water Resources', 'Rainfall, evapotranspiration, soil moisture, water level'],
    ['Renewable Energy', 'Solar irradiance, wind profiling, power density, MPPT monitoring'],
    ['Regulatory', 'WMO, ISO 17025, ISO 19157, GDPR, audit trails'],
  ],
  [28, contentW - 28]
);

// Page numbers
const totalPages = doc.internal.getNumberOfPages();
for (let i = 1; i <= totalPages; i++) {
  doc.setPage(i);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  setBlack();
  doc.text(`Page ${i} of ${totalPages}`, pageW - margin, pageH - 10, { align: 'right' });
}

const fs = require('fs');
const outPath = require('path').join(__dirname, '..', 'docs', 'Stratus-Web-App-Brochure.pdf');
fs.mkdirSync(require('path').dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.from(doc.output('arraybuffer')));
console.log('Saved:', outPath);
