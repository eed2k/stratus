import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function Documentation() {
  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Documentation
        </h1>
      </div>

      <div className="grid gap-6">
        {/* Version Info */}
        <Card>
          <CardHeader>
            <CardTitle>About Stratus Weather Server</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-medium">1.2.1 (Build 19.6)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Developer</span>
                <span className="font-medium">Lukas Esterhuizen</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Contact</span>
                <a href="mailto:esterhuizen2k@proton.me" className="font-medium text-primary hover:underline">
                  esterhuizen2k@proton.me
                </a>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Licence</span>
                <span className="font-medium">Proprietary (EULA)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Copyright</span>
                <span className="font-medium">&copy; 2025-2026 Lukas Esterhuizen</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Desktop Application */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Desktop Application
              <Badge variant="outline" className="text-xs">Windows</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              Stratus Desktop is a standalone Windows application for direct
              station management, data acquisition, and wind rose analysis.
              It requires no browser or internet connection for local operation.
            </p>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Platform</span>
                <span className="font-medium text-foreground">Windows 10/11 (x64)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Runtime</span>
                <span className="font-medium text-foreground">.NET 8 (self-contained)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Framework</span>
                <span className="font-medium text-foreground">WPF (Windows Presentation Foundation)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Distribution</span>
                <span className="font-medium text-foreground">Single-file EXE (~169 MB, no installer required)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Licence</span>
                <span className="font-medium text-foreground">Hardware-locked with lifetime key</span>
              </div>
            </div>
            <h4 className="font-medium text-foreground pt-2">Key Features</h4>
            <ul className="space-y-1.5 ml-4 list-disc">
              <li>Setup wizard for first-run database and server configuration</li>
              <li>Station management with real-time data collection</li>
              <li>Wind rose generator with 24-hour, daylight, nighttime, and seasonal analysis</li>
              <li>CSV import for external wind data (TOA5, standard CSV, auto-detect)</li>
              <li>High-resolution PNG export (192 DPI) for publication-quality figures</li>
              <li>Adjustable sector angle (5-60 degrees) for wind direction binning</li>
              <li>Fullscreen mode (F11) for field deployment</li>
            </ul>
          </CardContent>
        </Card>

        {/* Wind Rose Analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Wind Rose Analysis
              <Badge variant="outline" className="text-xs">Research</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              The wind rose module provides research-grade polar plots
              conforming to standard meteorological conventions. Wind speed
              categories follow the openair R package classification bins
              (0-2, 2-5, 5-8, 8-12, 12-20, 20-35 m/s) for compatibility
              with published literature.
            </p>
            <h4 className="font-medium text-foreground">Analysis Modes</h4>
            <ul className="space-y-1.5 ml-4 list-disc">
              <li>
                <span className="text-foreground font-medium">24-Hour</span>
                {" - "}Full-period wind rose from all available records.
              </li>
              <li>
                <span className="text-foreground font-medium">Daylight / Nighttime</span>
                {" - "}Solar declination-based sunrise/sunset classification for diurnal analysis.
              </li>
              <li>
                <span className="text-foreground font-medium">Seasonal</span>
                {" - "}Southern Hemisphere seasons: Summer (Dec-Feb), Autumn (Mar-May),
                Winter (Jun-Aug), Spring (Sep-Nov).
              </li>
            </ul>
            <h4 className="font-medium text-foreground pt-2">Technical Details</h4>
            <ul className="space-y-1.5 ml-4 list-disc">
              <li>Sector angles: 5, 6, 8, 9, 10, 12, 15, 18, 20, 24, 30, 36, 40, 45, or 60 degrees (must evenly divide 360)</li>
              <li>Calm threshold: wind speed &lt; 0.5 m/s</li>
              <li>Direction convention: meteorological (direction wind blows FROM, clockwise from north)</li>
              <li>Default latitude: -33.0 degrees (South Africa) for daylight calculation</li>
            </ul>
          </CardContent>
        </Card>

        {/* Licence Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Licence</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              Stratus Weather Station is proprietary software distributed under a
              commercial End User Licence Agreement (EULA). The software is
              licensed, not sold.
            </p>
          </CardContent>
        </Card>

        {/* Acknowledgements / Third-party credits */}
        <Card>
          <CardHeader>
            <CardTitle>Acknowledgements</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            <p className="text-muted-foreground">
              Stratus is built on the shoulders of outstanding open-source
              projects. The following libraries and their contributors made this
              software possible.
            </p>

            {/* Charts & Visualisation */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                Charts &amp; Visualisation
                <Badge variant="outline" className="text-xs">Core</Badge>
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">Recharts</span>
                  {" - "}Xiao Lin (xiao-lin) and the Recharts contributors.
                  Composable React charting library used for all weather data
                  charts, temperature history, pressure trends, and fire-danger
                  graphs.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Wind Rose &amp; Wind Scatter
                  </span>
                  {" - "}Custom SVG implementation using
                  WMO-standard Beaufort-scale speed classifications for polar
                  wind plots.
                </li>
              </ul>
            </div>

            {/* UI Framework */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                UI Framework
                <Badge variant="outline" className="text-xs">Core</Badge>
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">shadcn/ui</span>
                  {" - "}shadcn (Shadid Haque). Beautiful, accessible component
                  system built on Radix UI primitives.
                </li>
                <li>
                  <span className="text-foreground font-medium">Radix UI</span>
                  {" - "}Pedro Duarte, Jenna Smith, and the WorkOS team.
                  Unstyled, accessible headless UI primitives powering dialogs,
                  selects, tabs, tooltips, and more.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Tailwind CSS
                  </span>
                  {" - "}Adam Wathan and the Tailwind Labs team. Utility-first CSS
                  framework for rapid, consistent styling.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Lucide React
                  </span>
                  {" - "}The Lucide contributors (fork of Feather Icons by Cole Bemis).
                  Icon set used throughout the interface.
                </li>
              </ul>
            </div>

            {/* Maps */}
            <div>
              <h4 className="font-medium mb-2">
                Mapping
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">Leaflet</span>
                  {" - "}Volodymyr Agafonkin. Lightweight interactive map library
                  used for station location display.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    React Leaflet
                  </span>
                  {" - "}Paul Le Cam. React components for Leaflet maps.
                </li>
                <li>
                  <span className="text-foreground font-medium">OpenStreetMap</span>
                  {" - "}OpenStreetMap Foundation and contributors. Free, editable
                  map tile layer and Nominatim geocoding service.
                </li>
              </ul>
            </div>

            {/* Server & Data */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                Server &amp; Data
                <Badge variant="outline" className="text-xs">Core</Badge>
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">Express</span>
                  {" - "}TJ Holowaychuk and the Express contributors. HTTP server
                  framework.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Drizzle ORM
                  </span>
                  {" - "}Oleksii Khoroshulin (Alex Blokh) and the Drizzle Team.
                  Type-safe PostgreSQL ORM.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    TanStack Query
                  </span>
                  {" - "}Tanner Linsley. Powerful async data-fetching and caching
                  for React.
                </li>
                <li>
                  <span className="text-foreground font-medium">Zod</span>
                  {" - "}Colin McDonnell. Runtime schema validation for API
                  payloads, forms, and configuration.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Neon Serverless Postgres
                  </span>
                  {" - "}Neon, Inc. Serverless PostgreSQL database with HTTP and
                  WebSocket drivers for cloud-native storage.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Dropbox SDK
                  </span>
                  {" - "}Dropbox, Inc. OAuth 2.0 API for automated weather data
                  file synchronisation from remote loggers.
                </li>
                <li>
                  <span className="text-foreground font-medium">date-fns</span>
                  {" - "}Sasha Koss and the date-fns contributors. Modern
                  JavaScript date utility library.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    React Router
                  </span>
                  {" - "}Remix Software. Declarative client-side routing for
                  single-page navigation.
                </li>
              </ul>
            </div>

            {/* Desktop */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                Desktop Application
                <Badge variant="outline" className="text-xs">.NET 8</Badge>
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">WPF</span>
                  {" - "}Windows Presentation Foundation (.NET 8). Native desktop
                  UI framework with hardware-accelerated rendering.
                </li>
                <li>
                  <span className="text-foreground font-medium">Npgsql</span>
                  {" - "}Shay Rojansky and the Npgsql contributors. High-performance
                  .NET data provider for PostgreSQL.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    System.Management
                  </span>
                  {" - "}Microsoft. WMI-based hardware fingerprinting for
                  licence validation.
                </li>
              </ul>
            </div>

            {/* Build Tools */}
            <div>
              <h4 className="font-medium mb-2">
                Build Tools
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">Vite</span>
                  {" - "}Evan You and the Vite team. Next-generation frontend build
                  tool.
                </li>
              </ul>
            </div>

            {/* Weather / Scientific */}
            <div>
              <h4 className="font-medium mb-2">
                Meteorological Calculations
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">
                    FAO Penman-Monteith
                  </span>
                  {" - "}Evapotranspiration (ETo) calculations follow the FAO-56
                  reference method (Allen, Pereira, Raes &amp; Smith, 1998).
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    McArthur Forest Fire Danger Index
                  </span>
                  {" - "}Fire danger rating adapted from A.G. McArthur's empirical
                  FFDI model (1967), as revised by Noble, Gill &amp; Bary
                  (1980).
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    WMO Beaufort Scale
                  </span>
                  {" - "}Wind speed classifications follow World Meteorological
                  Organization standards for surface wind observation.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Solar Declination Model
                  </span>
                  {" - "}Simplified solar declination calculation for sunrise/sunset
                  estimation used in daylight/nighttime wind rose classification.
                </li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground pt-2 border-t">
              All listed libraries are used under their respective open-source
              licences (MIT, Apache 2.0, ISC, or BSD). Stratus does not modify
              any upstream library source code.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
