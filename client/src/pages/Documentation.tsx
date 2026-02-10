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
                <span className="font-medium">1.1.0</span>
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
                <span className="font-medium">© 2025–2026 Lukas Esterhuizen</span>
              </div>
            </div>
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
                  <span className="text-foreground font-medium">Recharts</span>{" "}
                  — Xiao Lin (xiao-lin) and the Recharts contributors.
                  Composable React charting library used for all weather data
                  charts, temperature history, pressure trends, and fire-danger
                  graphs.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Wind Rose &amp; Wind Scatter
                  </span>{" "}
                  — Custom SVG implementation using
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
                  <span className="text-foreground font-medium">shadcn/ui</span>{" "}
                  — shadcn (Shadid Haque). Beautiful, accessible component
                  system built on Radix UI primitives.
                </li>
                <li>
                  <span className="text-foreground font-medium">Radix UI</span>{" "}
                  — Pedro Duarte, Jenna Smith, and the WorkOS team.
                  Unstyled, accessible headless UI primitives powering dialogs,
                  selects, tabs, tooltips, and more.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Tailwind CSS
                  </span>{" "}
                  — Adam Wathan and the Tailwind Labs team. Utility-first CSS
                  framework for rapid, consistent styling.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Lucide React
                  </span>{" "}
                  — The Lucide contributors (fork of Feather Icons by Cole Bemis).
                  Icon set used throughout the interface.
                </li>
              </ul>
            </div>

            {/* Maps */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                Mapping
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">Leaflet</span>{" "}
                  — Volodymyr Agafonkin. Lightweight interactive map library
                  used for station location display.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    React Leaflet
                  </span>{" "}
                  — Paul Le Cam. React components for Leaflet maps.
                </li>
                <li>
                  <span className="text-foreground font-medium">Windy API</span>{" "}
                  — Windyty SE. Weather forecast map overlays (wind, rain,
                  temperature, pressure, CAPE).
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
                  <span className="text-foreground font-medium">Express</span>{" "}
                  — TJ Holowaychuk and the Express contributors. HTTP server
                  framework.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Drizzle ORM
                  </span>{" "}
                  — Oleksii Khoroshulin (Alex Blokh) and the Drizzle Team.
                  Type-safe PostgreSQL ORM.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    TanStack Query
                  </span>{" "}
                  — Tanner Linsley. Powerful async data-fetching and caching
                  for React.
                </li>
                <li>
                  <span className="text-foreground font-medium">Zod</span>{" "}
                  — Colin McDonnell. Runtime schema validation for API
                  payloads, forms, and configuration.
                </li>
              </ul>
            </div>

            {/* Build & Desktop */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                Build &amp; Desktop
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">Vite</span>{" "}
                  — Evan You and the Vite team. Next-generation frontend build
                  tool.
                </li>
                <li>
                  <span className="text-foreground font-medium">Electron</span>{" "}
                  — GitHub / OpenJS Foundation. Cross-platform desktop
                  application shell.
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    electron-builder
                  </span>{" "}
                  — Vladimir Krivosheev (develar). Packaging and distribution
                  for Electron apps.
                </li>
              </ul>
            </div>

            {/* Weather / Scientific */}
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                Meteorological Calculations
              </h4>
              <ul className="space-y-1.5 text-muted-foreground ml-4 list-disc">
                <li>
                  <span className="text-foreground font-medium">
                    FAO Penman-Monteith
                  </span>{" "}
                  — Evapotranspiration (ETo) calculations follow the FAO-56
                  reference method (Allen, Pereira, Raes &amp; Smith, 1998).
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    McArthur Forest Fire Danger Index
                  </span>{" "}
                  — Fire danger rating adapted from A.G. McArthur's empirical
                  FFDI model (1967), as revised by Noble, Gill &amp; Bary
                  (1980).
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    WMO Beaufort Scale
                  </span>{" "}
                  — Wind speed classifications follow World Meteorological
                  Organization standards for surface wind observation.
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
