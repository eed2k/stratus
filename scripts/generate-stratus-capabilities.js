/**
 * Stratus Capabilities PDF Generator
 * Generates a professional PDF report for METRON (PTY) LTD
 */

const { jsPDF } = require('jspdf');
const fs = require('fs');
const path = require('path');

// Initialize PDF
const doc = new jsPDF({
  orientation: 'portrait',
  unit: 'mm',
  format: 'a4'
});

const pageWidth = doc.internal.pageSize.getWidth();
const pageHeight = doc.internal.pageSize.getHeight();
const margin = 20;
const contentWidth = pageWidth - (margin * 2);
let yPos = margin;

// Colors
const primaryColor = [41, 98, 255];    // Blue
const darkColor = [30, 41, 59];        // Slate-800
const grayColor = [100, 116, 139];     // Slate-500
const lightBg = [248, 250, 252];       // Slate-50

// Helper functions
function addPage() {
  doc.addPage();
  yPos = margin;
}

function checkPageBreak(neededHeight = 30) {
  if (yPos + neededHeight > pageHeight - margin) {
    addPage();
    return true;
  }
  return false;
}

function setColor(color) {
  doc.setTextColor(color[0], color[1], color[2]);
}

function drawHorizontalLine() {
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, yPos, pageWidth - margin, yPos);
  yPos += 5;
}

// ============================================================================
// COVER PAGE
// ============================================================================
function addCoverPage() {
  // Header background
  doc.setFillColor(41, 98, 255);
  doc.rect(0, 0, pageWidth, 100, 'F');
  
  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(32);
  doc.setFont('helvetica', 'bold');
  doc.text('STRATUS', pageWidth / 2, 45, { align: 'center' });
  
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.text('Weather Station Management Platform', pageWidth / 2, 58, { align: 'center' });
  
  doc.setFontSize(12);
  doc.text('Technical Capabilities & Architecture Overview', pageWidth / 2, 72, { align: 'center' });
  
  // Document info box
  yPos = 120;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, yPos, contentWidth, 70, 3, 3, 'F');
  
  yPos += 15;
  setColor(darkColor);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('PREPARED FOR:', margin + 10, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text('Felie Le Roux', margin + 60, yPos);
  
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('ORGANIZATION:', margin + 10, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text('METRON (PTY) LTD', margin + 60, yPos);
  
  yPos += 15;
  doc.setFont('helvetica', 'bold');
  doc.text('PREPARED BY:', margin + 10, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text('Lukas Esterhuizen', margin + 60, yPos);
  
  yPos += 10;
  doc.setFont('helvetica', 'bold');
  doc.text('DATE:', margin + 10, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' }), margin + 60, yPos);
  
  // Version info
  yPos = 210;
  doc.setFillColor(240, 253, 244);
  doc.roundedRect(margin, yPos, contentWidth, 25, 3, 3, 'F');
  
  yPos += 10;
  doc.setFontSize(11);
  setColor([22, 163, 74]);
  doc.setFont('helvetica', 'bold');
  doc.text('Version 1.0.0', margin + 10, yPos);
  setColor(grayColor);
  doc.setFont('helvetica', 'normal');
  doc.text('|  Production Release  |  MIT License', margin + 50, yPos);
  
  // Footer
  yPos = pageHeight - 30;
  setColor(grayColor);
  doc.setFontSize(9);
  doc.text('CONFIDENTIAL - For METRON (PTY) LTD internal use only', pageWidth / 2, yPos, { align: 'center' });
  doc.text('Contact: esterhuizen2k@proton.me', pageWidth / 2, yPos + 6, { align: 'center' });
}

// ============================================================================
// TABLE OF CONTENTS
// ============================================================================
function addTableOfContents() {
  addPage();
  
  doc.setFontSize(20);
  setColor(primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text('Table of Contents', margin, yPos);
  yPos += 15;
  drawHorizontalLine();
  
  const tocItems = [
    { title: '1. Executive Summary', page: 3 },
    { title: '2. Technology Stack', page: 4 },
    { title: '3. Backend Architecture', page: 5 },
    { title: '4. Frontend Framework', page: 7 },
    { title: '5. Protocol Implementations', page: 8 },
    { title: '6. Data Management & Storage', page: 10 },
    { title: '7. Real-Time Features', page: 11 },
    { title: '8. Security & Compliance', page: 12 },
    { title: '9. Cloud Infrastructure', page: 13 },
    { title: '10. API & Integration Capabilities', page: 14 },
    { title: '11. Meteorological Calculations', page: 15 },
    { title: '12. Key Features Summary', page: 16 },
  ];
  
  yPos += 5;
  doc.setFontSize(11);
  
  tocItems.forEach(item => {
    setColor(darkColor);
    doc.setFont('helvetica', 'normal');
    doc.text(item.title, margin, yPos);
    
    // Dotted line
    const titleWidth = doc.getTextWidth(item.title);
    const pageNumWidth = doc.getTextWidth(item.page.toString());
    const dotsStart = margin + titleWidth + 3;
    const dotsEnd = pageWidth - margin - pageNumWidth - 3;
    
    setColor(grayColor);
    for (let x = dotsStart; x < dotsEnd; x += 2) {
      doc.text('.', x, yPos);
    }
    
    doc.text(item.page.toString(), pageWidth - margin, yPos, { align: 'right' });
    yPos += 8;
  });
}

// ============================================================================
// SECTION HEADER HELPER
// ============================================================================
function addSectionHeader(number, title) {
  checkPageBreak(25);
  yPos += 5;
  doc.setFontSize(16);
  setColor(primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text(`${number}. ${title}`, margin, yPos);
  yPos += 8;
  drawHorizontalLine();
}

function addSubHeader(title) {
  checkPageBreak(20);
  yPos += 3;
  doc.setFontSize(12);
  setColor(darkColor);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin, yPos);
  yPos += 7;
}

function addParagraph(text) {
  checkPageBreak(15);
  doc.setFontSize(10);
  setColor(darkColor);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(text, contentWidth);
  doc.text(lines, margin, yPos);
  yPos += lines.length * 5 + 3;
}

function addBulletPoint(text, indent = 0) {
  checkPageBreak(10);
  doc.setFontSize(10);
  setColor(darkColor);
  doc.setFont('helvetica', 'normal');
  const bulletX = margin + indent;
  doc.text('•', bulletX, yPos);
  const lines = doc.splitTextToSize(text, contentWidth - indent - 8);
  doc.text(lines, bulletX + 5, yPos);
  yPos += lines.length * 5 + 2;
}

function addCodeBlock(title, items) {
  checkPageBreak(items.length * 6 + 20);
  
  doc.setFillColor(248, 250, 252);
  const blockHeight = items.length * 5 + 15;
  doc.roundedRect(margin, yPos, contentWidth, blockHeight, 2, 2, 'F');
  
  yPos += 8;
  doc.setFontSize(9);
  setColor(primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin + 5, yPos);
  yPos += 6;
  
  doc.setFont('courier', 'normal');
  setColor(darkColor);
  items.forEach(item => {
    doc.text(item, margin + 8, yPos);
    yPos += 5;
  });
  
  yPos += 5;
}

// ============================================================================
// CONTENT SECTIONS
// ============================================================================

function addExecutiveSummary() {
  addPage();
  addSectionHeader('1', 'Executive Summary');
  
  addParagraph('Stratus is a professional-grade weather station management platform designed for Campbell Scientific dataloggers and compatible weather monitoring equipment. Built with modern web technologies, Stratus provides comprehensive data collection, real-time monitoring, and advanced meteorological analysis capabilities.');
  
  addParagraph('The platform supports multiple communication protocols including native PakBus implementation, HTTP/REST APIs, LoRaWAN IoT connectivity, and cloud synchronization via Dropbox. This multi-protocol approach ensures compatibility with diverse deployment scenarios from remote agricultural sites to urban monitoring networks.');
  
  addSubHeader('Core Value Propositions');
  addBulletPoint('Native PakBus Protocol: Direct communication with Campbell Scientific CR-series dataloggers without third-party dependencies');
  addBulletPoint('Multi-Protocol Support: TCP/IP, Cellular (4G/LTE), LoRaWAN, HTTP POST, and Dropbox cloud sync');
  addBulletPoint('Real-Time Dashboard: Live weather data visualization with auto-refresh and WebSocket updates');
  addBulletPoint('Professional Meteorology: FAO Penman-Monteith ETo, solar position tracking, air density calculations');
  addBulletPoint('Enterprise Security: Role-based access control, audit logging, secure authentication');
  addBulletPoint('Flexible Deployment: Desktop application (Windows), cloud VPS, or Docker containers');
  
  addSubHeader('Target Applications');
  addBulletPoint('Agricultural weather monitoring and irrigation scheduling');
  addBulletPoint('Environmental compliance monitoring');
  addBulletPoint('Research station data management');
  addBulletPoint('Renewable energy site assessment (wind power density)');
  addBulletPoint('Fire weather monitoring (McArthur FFDI)');
}

function addTechnologyStack() {
  addPage();
  addSectionHeader('2', 'Technology Stack');
  
  addParagraph('Stratus is built on a modern, production-ready technology stack optimized for performance, maintainability, and cross-platform deployment.');
  
  addCodeBlock('FRONTEND TECHNOLOGIES', [
    'React 18.3          - Modern UI library with hooks and concurrent features',
    'TypeScript 5.x      - Type-safe development with full IDE support',
    'Tailwind CSS        - Utility-first CSS framework',
    'Radix UI            - Accessible, unstyled component primitives',
    'Recharts            - Composable charting library for data visualization',
    'TanStack Query      - Server state management and caching',
    'Wouter              - Lightweight client-side routing',
    'Socket.io Client    - Real-time WebSocket communication',
  ]);
  
  addCodeBlock('BACKEND TECHNOLOGIES', [
    'Node.js 18+         - JavaScript runtime with native ES modules',
    'Express 4.x         - Minimalist web framework',
    'TypeScript          - Full type safety on server',
    'sql.js              - Pure JavaScript SQLite (portable, no compilation)',
    'PostgreSQL          - Production database for cloud deployments',
    'Drizzle ORM         - Type-safe database queries with zero overhead',
    'Socket.io           - Real-time bidirectional event communication',
    'Helmet.js           - Security headers and CSP management',
  ]);
  
  addCodeBlock('BUILD & TOOLING', [
    'Vite 5.x            - Next-generation frontend build tool',
    'TSX                 - TypeScript execution with watch mode',
    'ESLint              - Code quality and consistency',
    'Zod                 - Runtime schema validation',
    'jsPDF               - Client-side PDF generation',
    'Concurrently        - Parallel npm script execution',
  ]);
}

function addBackendArchitecture() {
  addPage();
  addSectionHeader('3', 'Backend Architecture');
  
  addParagraph('The Stratus backend follows a modular, event-driven architecture designed for extensibility and maintainability. Core components are organized by domain responsibility with clear separation of concerns.');
  
  addSubHeader('Directory Structure');
  addCodeBlock('SERVER MODULE ORGANIZATION', [
    'server/',
    '├── index.ts              # Application entry point',
    '├── routes.ts             # API route definitions',
    '├── db.ts                 # Database initialization & migrations',
    '├── localStorage.ts       # Data access layer',
    '├── campbell/             # Campbell Scientific integration',
    '│   ├── pakbus.ts         # PakBus protocol implementation',
    '│   ├── connectionManager.ts',
    '│   └── dataCollectionService.ts',
    '├── protocols/            # Multi-protocol adapters',
    '│   ├── adapter.ts        # Base adapter interface',
    '│   ├── httpAdapter.ts    # HTTP/REST adapter',
    '│   ├── loraAdapter.ts    # LoRaWAN adapter',
    '│   └── protocolManager.ts',
    '├── services/             # Business logic services',
    '│   ├── dropboxSyncService.ts',
    '│   ├── emailService.ts   # SendGrid integration',
    '│   └── auditLogService.ts',
    '└── parsers/              # Data file parsers',
    '    └── campbellScientific.ts  # TOA5/CSV parser',
  ]);
  
  addSubHeader('Event-Driven Design');
  addParagraph('Core services extend EventEmitter for loose coupling and reactive data flow. The ConnectionManager emits events for connection state changes, incoming data, and errors. The DataCollectionService subscribes to these events and manages buffered writes to the database.');
  
  addCodeBlock('EVENT ARCHITECTURE EXAMPLE', [
    'connectionManager.on("connected", ({ stationId }) => { ... });',
    'connectionManager.on("data", async ({ stationId, records }) => { ... });',
    'connectionManager.on("error", ({ stationId, error }) => { ... });',
    'connectionManager.on("reconnecting", ({ attempt }) => { ... });',
  ]);
  
  addSubHeader('API Layer');
  addParagraph('RESTful API endpoints are organized by resource type with consistent error handling and response formatting. All routes support JSON request/response bodies with Zod schema validation.');
  
  addBulletPoint('/api/stations - Station CRUD operations and configuration');
  addBulletPoint('/api/weather-data - Weather data retrieval with time range filtering');
  addBulletPoint('/api/alarms - Alarm configuration and event management');
  addBulletPoint('/api/users - User management and role assignment');
  addBulletPoint('/api/auth - Authentication and session management');
  addBulletPoint('/api/campbell - PakBus-specific operations (connect, collect, sync clock)');
  addBulletPoint('/api/dropbox - Dropbox sync configuration and manual triggers');
}

function addFrontendFramework() {
  addPage();
  addSectionHeader('4', 'Frontend Framework');
  
  addParagraph('The Stratus frontend is a single-page application (SPA) built with React and TypeScript. The component architecture emphasizes reusability, accessibility, and performance.');
  
  addSubHeader('Component Architecture');
  addCodeBlock('FRONTEND STRUCTURE', [
    'client/src/',
    '├── App.tsx               # Root component with routing',
    '├── main.tsx              # Application entry point',
    '├── components/',
    '│   ├── ui/               # Radix-based UI primitives',
    '│   ├── AppSidebar.tsx    # Navigation sidebar',
    '│   ├── ThemeProvider.tsx # Dark/light mode support',
    '│   └── ErrorBoundary.tsx # Error handling wrapper',
    '├── pages/',
    '│   ├── Dashboard.tsx     # Main weather dashboard',
    '│   ├── Stations.tsx      # Station management',
    '│   ├── History.tsx       # Historical data analysis',
    '│   ├── Reports.tsx       # PDF report generation',
    '│   ├── Alarms.tsx        # Alarm configuration',
    '│   └── Settings.tsx      # Application settings',
    '├── hooks/',
    '│   ├── useAuth.ts        # Authentication state',
    '│   ├── useWebSocket.ts   # Real-time updates',
    '│   └── useWeatherData.ts # Data fetching hooks',
    '└── lib/',
    '    └── queryClient.ts    # TanStack Query configuration',
  ]);
  
  addSubHeader('State Management');
  addParagraph('Stratus uses TanStack Query (React Query) for server state management, providing automatic caching, background refetching, and optimistic updates. Local UI state is managed with React hooks and context where appropriate.');
  
  addSubHeader('UI Component Library');
  addParagraph('The UI is built on Radix UI primitives combined with Tailwind CSS for styling. This approach provides fully accessible components (WCAG 2.1 compliant) with a consistent design system. Components include dialogs, dropdowns, tabs, toasts, tooltips, and form elements.');
  
  addSubHeader('Data Visualization');
  addBulletPoint('Recharts: Line charts, area charts, bar charts for time-series data');
  addBulletPoint('Custom Wind Rose: Polar charts for wind direction frequency analysis');
  addBulletPoint('Leaflet Maps: Interactive station location mapping with OpenStreetMap');
  addBulletPoint('Real-time Gauges: Battery voltage, temperature, humidity indicators');
}

function addProtocolImplementations() {
  addPage();
  addSectionHeader('5', 'Protocol Implementations');
  
  addParagraph('Stratus implements multiple communication protocols through a unified adapter interface. This architecture allows seamless integration of diverse station types while maintaining consistent data handling.');
  
  addSubHeader('PakBus Protocol (Campbell Scientific)');
  addParagraph('Native implementation of Campbell Scientific\'s PakBus protocol versions 3.x and 4.x. The protocol handler manages packet framing, CRC-16 CCITT checksums, transaction numbering, and response parsing.');
  
  addCodeBlock('PAKBUS CAPABILITIES', [
    '• TCP/IP socket communication on port 6785 (configurable)',
    '• Security code authentication',
    '• Data table enumeration and structure discovery',
    '• Record-by-record or bulk data collection',
    '• Datalogger clock synchronization',
    '• Program signature verification',
    '• Automatic reconnection with exponential backoff',
  ]);
  
  addSubHeader('Supported Dataloggers');
  addBulletPoint('CR1000X, CR1000 - High-performance measurement and control');
  addBulletPoint('CR6 - Compact, rugged with USB-C');
  addBulletPoint('CR3000 - High channel count applications');
  addBulletPoint('CR800, CR850 - Cost-effective mid-range');
  addBulletPoint('CR300 - Entry-level with Ethernet option');
  addBulletPoint('CR200X - Basic measurement applications');
  
  addSubHeader('HTTP/REST Protocol');
  addParagraph('HTTP adapter for stations that push data via REST API. Supports custom endpoint configuration, authentication headers, and payload mapping. Ideal for Arduino IoT Cloud, ESP32/ESP8266, and generic HTTP-capable devices.');
  
  addSubHeader('LoRaWAN Protocol');
  addParagraph('LoRaWAN adapter integrates with The Things Network (TTN) and other LoRaWAN network servers via MQTT. Supports EU868 and other regional frequency plans. Provides long-range, low-power connectivity for remote sites.');
  
  addCodeBlock('LORAWAN CONFIGURATION', [
    'Network Server: eu1.cloud.thethings.network (configurable)',
    'Protocol: MQTT over TLS',
    'Payload Decoding: Cayenne LPP or custom decoders',
    'Signal Monitoring: RSSI and SNR tracking',
  ]);
  
  addSubHeader('Dropbox Cloud Sync');
  addParagraph('Automated import of TOA5 CSV files from Dropbox App Folder. Supports OAuth 2.0 refresh tokens for 24/7 operation, configurable sync intervals, and file pattern matching. Ideal for cellular modem deployments that upload to cloud storage.');
}

function addDataManagement() {
  addPage();
  addSectionHeader('6', 'Data Management & Storage');
  
  addParagraph('Stratus implements a dual-database strategy supporting both embedded SQLite for desktop deployments and PostgreSQL for cloud/enterprise installations.');
  
  addSubHeader('Database Architecture');
  addCodeBlock('STORAGE BACKENDS', [
    'Desktop/Portable: sql.js (Pure JavaScript SQLite)',
    '  - No native compilation required',
    '  - Database file: %APPDATA%/Stratus Weather Server/stratus.db',
    '  - Automatic migrations on schema changes',
    '',
    'Cloud/Production: PostgreSQL',
    '  - Full ACID compliance',
    '  - Horizontal scaling capability',
    '  - Connection pooling via Drizzle ORM',
  ]);
  
  addSubHeader('Data Schema');
  addParagraph('The schema is defined using Drizzle ORM with automatic Zod validation schema generation. Core entities include:');
  
  addBulletPoint('Stations: Configuration, location, connection settings, metadata');
  addBulletPoint('Weather Data: Time-series measurements with quality flags');
  addBulletPoint('Users: Authentication, roles, station assignments');
  addBulletPoint('Organizations: Multi-tenant support with member management');
  addBulletPoint('Alarms: Threshold definitions, notification settings, event history');
  addBulletPoint('Calibration Records: ISO 17025 traceability chain');
  addBulletPoint('Audit Logs: Security compliance event tracking');
  
  addSubHeader('Data Quality Framework');
  addParagraph('Implements ISO 19157 data quality standards with quality flags (valid, suspect, missing, estimated, rejected) and WMO Quality Control levels (0-3). Supports measurement uncertainty tracking per GUM guidelines.');
  
  addSubHeader('Data Retention & Export');
  addBulletPoint('Configurable retention policies per station');
  addBulletPoint('CSV export with custom date ranges and field selection');
  addBulletPoint('PDF report generation with charts and statistics');
  addBulletPoint('Bulk data import from TOA5 files');
}

function addRealTimeFeatures() {
  addPage();
  addSectionHeader('7', 'Real-Time Features');
  
  addParagraph('Stratus provides real-time data updates through WebSocket connections, enabling live dashboard updates without page refreshes.');
  
  addSubHeader('WebSocket Implementation');
  addCodeBlock('SOCKET.IO EVENTS', [
    'Server -> Client:',
    '  weather-update    - New weather data available',
    '  station-connected - Station connection established',
    '  station-error     - Connection or data error',
    '  alarm-triggered   - Threshold exceeded',
    '',
    'Client -> Server:',
    '  subscribe-station - Register for station updates',
    '  request-collect   - Trigger manual data collection',
  ]);
  
  addSubHeader('Auto-Refresh Configuration');
  addParagraph('Configurable refresh intervals from 5 seconds to 60 minutes. Dashboard automatically detects data staleness and displays visual warnings when live data stops flowing.');
  
  addSubHeader('Connection Health Monitoring');
  addBulletPoint('Real-time connection status indicators (connected, disconnected, reconnecting)');
  addBulletPoint('Last successful data timestamp tracking');
  addBulletPoint('Automatic reconnection with configurable retry attempts');
  addBulletPoint('Signal strength monitoring for LoRa connections');
  
  addSubHeader('Live Dashboard Widgets');
  addBulletPoint('Current conditions card with all readings');
  addBulletPoint('Wind compass with animated direction indicator');
  addBulletPoint('Battery voltage gauge with charge status');
  addBulletPoint('Solar radiation and UV index displays');
  addBulletPoint('Rainfall totals (daily, monthly, yearly)');
}

function addSecurityCompliance() {
  addPage();
  addSectionHeader('8', 'Security & Compliance');
  
  addParagraph('Stratus implements enterprise-grade security controls aligned with ISO 27001 principles and GDPR requirements for data protection.');
  
  addSubHeader('Authentication & Authorization');
  addCodeBlock('SECURITY FEATURES', [
    '• PBKDF2 password hashing with automatic legacy migration',
    '• JWT-based session tokens with configurable expiration',
    '• Role-based access control (Admin, User, Viewer)',
    '• Station-level access assignment',
    '• Rate limiting on authentication endpoints',
    '• Secure cookie attributes (HttpOnly, SameSite)',
  ]);
  
  addSubHeader('Security Headers');
  addParagraph('Helmet.js middleware applies comprehensive security headers including Content Security Policy (CSP), X-Content-Type-Options, X-Frame-Options, and Strict-Transport-Security for HTTPS deployments.');
  
  addSubHeader('Audit Logging');
  addParagraph('Comprehensive audit trail for security compliance and accountability:');
  
  addBulletPoint('USER_LOGIN, USER_LOGOUT, LOGIN_FAILED - Authentication events');
  addBulletPoint('USER_CREATE, USER_UPDATE, USER_DELETE - User management');
  addBulletPoint('STATION_CREATE, STATION_UPDATE, STATION_DELETE - Station changes');
  addBulletPoint('DATA_EXPORT, DATA_DELETE - Data access events');
  addBulletPoint('ALARM_CREATE, ALARM_ACKNOWLEDGE - Alarm management');
  addBulletPoint('SETTINGS_UPDATE, CONFIG_CHANGE - System configuration');
  
  addSubHeader('Data Protection');
  addBulletPoint('Shared dashboard password protection option');
  addBulletPoint('Expiration dates for shared links');
  addBulletPoint('View-only access for shared dashboards');
  addBulletPoint('Input validation with Zod schemas');
}

function addCloudInfrastructure() {
  addPage();
  addSectionHeader('9', 'Cloud Infrastructure');
  
  addParagraph('Stratus is designed for cloud VPS deployment enabling 24/7 availability and remote station monitoring from anywhere.');
  
  addSubHeader('Deployment Options');
  addCodeBlock('SUPPORTED PLATFORMS', [
    'Cloud VPS Providers:',
    '  • Hetzner (CX22 recommended)',
    '  • Linode',
    '  • DigitalOcean',
    '  • Vultr',
    '  • Oracle Cloud (free tier eligible)',
    '',
    'Container Orchestration:',
    '  • Docker with docker-compose',
    '  • Docker Swarm',
    '  • Kubernetes (Helm chart available)',
  ]);
  
  addSubHeader('Resource Requirements');
  addBulletPoint('Minimum: 1 vCPU, 1GB RAM, 10GB storage');
  addBulletPoint('Recommended: 2 vCPU, 2-4GB RAM, 20GB SSD');
  addBulletPoint('Database: PostgreSQL 14+ for production');
  addBulletPoint('Runtime: Node.js 18+ LTS');
  
  addSubHeader('Process Management');
  addParagraph('PM2 process manager provides automatic restart on failure, cluster mode for multi-core utilization, log management, and zero-downtime deployments.');
  
  addSubHeader('Networking');
  addBulletPoint('Dynamic DNS support via dynv6 for residential IPs');
  addBulletPoint('Nginx reverse proxy configuration included');
  addBulletPoint('HTTPS termination with Let\'s Encrypt certificates');
  addBulletPoint('WebSocket proxy pass for real-time updates');
  
  addSubHeader('Docker Deployment');
  addCodeBlock('DOCKER COMPOSE SERVICES', [
    'services:',
    '  stratus:',
    '    build: .',
    '    ports: ["5000:5000"]',
    '    environment:',
    '      - DATABASE_URL=postgresql://...',
    '      - NODE_ENV=production',
    '    depends_on: [postgres]',
    '  postgres:',
    '    image: postgres:15-alpine',
    '    volumes: [postgres_data:/var/lib/postgresql/data]',
  ]);
}

function addAPIIntegration() {
  addPage();
  addSectionHeader('10', 'API & Integration Capabilities');
  
  addParagraph('Stratus exposes a comprehensive REST API for external integrations and automation.');
  
  addSubHeader('Core API Endpoints');
  addCodeBlock('REST API ROUTES', [
    'Authentication:',
    '  POST /api/auth/login        - User authentication',
    '  POST /api/auth/logout       - Session termination',
    '  GET  /api/auth/me           - Current user info',
    '',
    'Stations:',
    '  GET    /api/stations        - List all stations',
    '  POST   /api/stations        - Create station',
    '  GET    /api/stations/:id    - Get station details',
    '  PUT    /api/stations/:id    - Update station',
    '  DELETE /api/stations/:id    - Delete station',
    '',
    'Weather Data:',
    '  GET /api/weather-data/:stationId',
    '    ?start=ISO8601&end=ISO8601&limit=1000',
    '  GET /api/weather-data/:stationId/latest',
    '  GET /api/weather-data/:stationId/statistics',
  ]);
  
  addSubHeader('Campbell Scientific Integration');
  addCodeBlock('PAKBUS API ENDPOINTS', [
    'POST /api/campbell/connect/:stationId    - Establish connection',
    'POST /api/campbell/disconnect/:stationId - Close connection',
    'POST /api/campbell/collect/:stationId    - Trigger data collection',
    'POST /api/campbell/sync-clock/:stationId - Synchronize clock',
    'GET  /api/campbell/tables/:stationId     - List data tables',
    'GET  /api/campbell/status/:stationId     - Connection health',
  ]);
  
  addSubHeader('Email Notifications');
  addParagraph('SendGrid integration for transactional email delivery. Supports alarm notifications, daily reports, and system alerts.');
  
  addCodeBlock('EMAIL CAPABILITIES', [
    '• Alarm threshold notifications with severity levels',
    '• HTML-formatted emails with station branding',
    '• Multiple recipient support',
    '• Configurable notification preferences per user',
    '• Free tier: 100 emails/day',
  ]);
  
  addSubHeader('HTTP POST Ingest');
  addParagraph('Stations can push data directly to Stratus via HTTP POST. Supports custom payload mapping for various sensor configurations.');
}

function addMeteorologicalCalculations() {
  addPage();
  addSectionHeader('11', 'Meteorological Calculations');
  
  addParagraph('Stratus implements standard meteorological algorithms for derived parameter calculations, providing professional-grade analysis capabilities.');
  
  addSubHeader('Solar Position (NOAA Algorithm)');
  addCodeBlock('SOLAR CALCULATIONS', [
    '• Sun Elevation: Degrees above/below horizon (-90° to +90°)',
    '• Sun Azimuth: Degrees from north (0° to 360°)',
    '• Sunrise/Sunset: Actual times for station location',
    '• Nautical Dawn/Dusk: Sun at -12° below horizon',
    '• Civil Dawn/Dusk: Sun at -6° below horizon',
    '• Solar Noon: Time of maximum elevation',
    '• Day Length: Hours of daylight',
  ]);
  
  addSubHeader('Reference Evapotranspiration (FAO-56)');
  addParagraph('FAO Penman-Monteith method for agricultural water management:');
  
  addBulletPoint('Inputs: Temperature, humidity, wind speed (2m), solar radiation, altitude, latitude');
  addBulletPoint('Outputs: ETo rate (mm/hr), daily ETo (mm/day), cumulative totals');
  addBulletPoint('Essential for irrigation scheduling and crop water requirements');
  
  addSubHeader('Atmospheric Calculations');
  addCodeBlock('DERIVED PARAMETERS', [
    'Dew Point:        From temperature and relative humidity',
    'Sea Level (QNH):  Hypsometric equation with altitude correction',
    'Air Density:      Ideal gas law with humidity correction',
    'Heat Index:       Apparent temperature (high humidity)',
    'Wind Chill:       Apparent temperature (wind cooling)',
    'Vapor Pressure:   Saturation and actual vapor pressure',
  ]);
  
  addSubHeader('Wind Analysis');
  addBulletPoint('Wind Power Density: W/m² from air density and wind speed cubed');
  addBulletPoint('Wind Rose: Direction frequency distribution with speed classes');
  addBulletPoint('Beaufort Scale: WMO standard wind classification (0-12)');
  addBulletPoint('Gust Factor: Ratio of gust to mean wind speed');
  
  addSubHeader('Fire Weather Index');
  addParagraph('McArthur Forest Fire Danger Index (FFDI) calculation using temperature, humidity, wind speed, and drought factor. Danger categories: Low (0-12), Moderate (12-25), High (25-50), Very High (50-75), Extreme (>75).');
}

function addFeaturesSummary() {
  addPage();
  addSectionHeader('12', 'Key Features Summary');
  
  addSubHeader('Data Collection');
  addBulletPoint('Native PakBus protocol for Campbell Scientific dataloggers');
  addBulletPoint('Multi-protocol support: TCP/IP, HTTP, LoRaWAN, Dropbox sync');
  addBulletPoint('Scheduled and on-demand data collection');
  addBulletPoint('Automatic reconnection with exponential backoff');
  addBulletPoint('Data buffering and batch database writes');
  
  addSubHeader('Visualization');
  addBulletPoint('Real-time dashboard with auto-refresh');
  addBulletPoint('Interactive charts (line, area, bar, scatter)');
  addBulletPoint('Wind rose and polar scatter plots');
  addBulletPoint('Station map with OpenStreetMap integration');
  addBulletPoint('Dark and light theme support');
  
  addSubHeader('Analysis');
  addBulletPoint('FAO Penman-Monteith evapotranspiration');
  addBulletPoint('Solar position tracking (NOAA algorithm)');
  addBulletPoint('Air density and atmospheric calculations');
  addBulletPoint('Fire danger index (McArthur FFDI)');
  addBulletPoint('Wind power density for renewable assessment');
  
  addSubHeader('Enterprise');
  addBulletPoint('Multi-user with role-based access control');
  addBulletPoint('Organization/tenant support');
  addBulletPoint('Comprehensive audit logging');
  addBulletPoint('ISO 19157 data quality framework');
  addBulletPoint('ISO 17025 calibration record management');
  
  addSubHeader('Deployment');
  addBulletPoint('Windows desktop application (Electron)');
  addBulletPoint('Cloud VPS deployment (Hetzner, Linode, etc.)');
  addBulletPoint('Docker container support');
  addBulletPoint('PM2 process management');
  addBulletPoint('Nginx reverse proxy with HTTPS');
  
  // Final page with contact
  yPos += 15;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, yPos, contentWidth, 35, 3, 3, 'F');
  
  yPos += 12;
  doc.setFontSize(11);
  setColor(primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.text('For technical inquiries or implementation support:', margin + 10, yPos);
  
  yPos += 10;
  setColor(darkColor);
  doc.setFont('helvetica', 'normal');
  doc.text('Lukas Esterhuizen  |  esterhuizen2k@proton.me', margin + 10, yPos);
}

// ============================================================================
// GENERATE PDF
// ============================================================================

// Build document
addCoverPage();
addTableOfContents();
addExecutiveSummary();
addTechnologyStack();
addBackendArchitecture();
addFrontendFramework();
addProtocolImplementations();
addDataManagement();
addRealTimeFeatures();
addSecurityCompliance();
addCloudInfrastructure();
addAPIIntegration();
addMeteorologicalCalculations();
addFeaturesSummary();

// Add page numbers
const pageCount = doc.internal.getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
  doc.setPage(i);
  if (i > 1) { // Skip cover page
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    doc.text('Stratus Weather Station - Technical Capabilities', margin, pageHeight - 10);
    doc.text('CONFIDENTIAL', pageWidth - margin, pageHeight - 10, { align: 'right' });
  }
}

// Save to file
const outputPath = path.join(__dirname, '..', 'docs', 'Stratus-Capabilities-METRON.pdf');
const pdfBuffer = doc.output('arraybuffer');
fs.writeFileSync(outputPath, Buffer.from(pdfBuffer));

console.log(`PDF generated successfully: ${outputPath}`);
