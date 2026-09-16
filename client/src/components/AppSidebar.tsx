// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useLocation, Link } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut } from "lucide-react";

interface AppSidebarProps {
  user?: {
    name: string;
    email: string;
    avatar?: string;
    role?: 'admin' | 'user';
  };
  onLogout?: () => void;
  onBackToStations?: () => void;
}

interface NavItem {
  title: string;
  url: string;
  /**
   * Renders a plain anchor instead of a client-side route.
   *
   * The four sibling services each run as a separate application on their own
   * subdomain, so none of them can be reached through the SPA router. The
   * AS3935 panel additionally sends `X-Frame-Options: DENY` and
   * `frame-ancestors 'none'`, which rules out embedding it in an iframe, so a
   * new tab is the only option that works.
   */
  external?: boolean;
}

/**
 * A labelled group of nav items, rendered as a dropdown.
 *
 * Grouping exists because a flat list of thirteen entries gave no clue which
 * pages belonged together, and buried the four cross-service links among the
 * in-app pages. Sections are deliberately shallow: one level of nesting, so no
 * page is ever more than two clicks away.
 */
interface NavSection {
  label: string;
  items: NavItem[];
}

// Stratus brand navy. Used for the wordmark and the admin badge in this file.
const STRATUS_NAVY = "#1e3a5f";

// The four sibling services, each a separate deployment on its own subdomain.
const LIGHTNING_PANEL_URL = "https://adminpanel.stratusweather.co.za";
const FORECAST_URL = "https://forecast.stratusweather.co.za";
const INFO_CENTRE_URL = "https://info.stratusweather.co.za";
const LIGHTNING_DEMO_URL = "https://lightningdemo.stratusweather.co.za";

/**
 * Station id of Quaggasklip INSIDE THE FORECAST APP.
 *
 * The forecast service keeps its own SQLite database with its own numbering, so
 * this is not the Stratus station id and the two must not be assumed equal. Its
 * pages are all station-scoped (`/station/{id}/...`), which is why the deep
 * links below need it. If that station is ever removed from the forecast app
 * these three entries become 404s, so they are listed here rather than derived,
 * to keep the coupling visible.
 */
const FORECAST_STATION_ID = 2;

/**
 * Admin navigation - full access, grouped by what the operator is doing.
 *
 * Section order is deliberate and is the order the operator asked for:
 * the live monitoring services first (AS3935, then Forecast), then the things
 * you produce from the data (Data and Reports), then configuration (Settings).
 * Active Stations leads the whole menu and About closes it; both sit outside
 * this array because they are single pages rather than categories.
 *
 * Reordering this array is all it takes to reorder the menu: the renderer walks
 * it in sequence.
 */
const adminNavSections: NavSection[] = [
  {
    // The lightning detection family: the operator panel for the live AS3935
    // units, the public demo of the same detection, and the reference material
    // that explains it.
    label: "AS3935",
    items: [
      { title: "AS3935 Admin Panel", url: LIGHTNING_PANEL_URL, external: true },
      { title: "Lightning Demo", url: LIGHTNING_DEMO_URL, external: true },
      { title: "Information Centre", url: INFO_CENTRE_URL, external: true },
    ],
  },
  {
    label: "Forecast",
    items: [
      { title: "Forecast Overview", url: FORECAST_URL, external: true },
      {
        title: "Forecast Dashboard",
        url: `${FORECAST_URL}/station/${FORECAST_STATION_ID}/dashboard`,
        external: true,
      },
      {
        title: "Forecast Accuracy",
        url: `${FORECAST_URL}/station/${FORECAST_STATION_ID}/verify`,
        external: true,
      },
    ],
  },
  {
    label: "Data and Reports",
    items: [
      { title: "Historical Data Export", url: "/history" },
      { title: "Report Generation", url: "/reports" },
      { title: "Report Scheduling", url: "/reports/schedule" },
    ],
  },
  {
    label: "Settings",
    items: [
      { title: "Station Setup", url: "/stations" },
      { title: "User Management", url: "/users" },
      { title: "Alerts", url: "/alarms" },
      { title: "System Settings", url: "/settings" },
    ],
  },
];

// Sit outside the dropdowns: single pages, not categories. Active Stations leads
// because it is the landing page and the one every session starts from.
const adminStandaloneItems: NavItem[] = [
  { title: "Active Stations", url: "/" },
];

// Rendered after the grouped sections.
const adminFooterItems: NavItem[] = [
  { title: "About Stratus", url: "/docs" },
];

// Non-admin navigation - limited access (no docs, no config). Three entries do
// not need grouping, so they render flat.
const userStandaloneItems: NavItem[] = [
  { title: "Active Stations", url: "/" },
  { title: "Historical Data Export", url: "/history" },
  { title: "Account Settings", url: "/account" },
];

/** Stable test id derived from the label, unchanged from the flat menu. */
function testId(title: string): string {
  return `nav-${title.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Whether an item points at the page currently on screen.
 *
 * Matching is exact. Prefix matching would be wrong here because
 * `/reports/schedule` sits under `/reports`, and a `startsWith` test would light
 * up both. The station selector is the one exception: it also owns every
 * `/dashboard/*` route, which it navigates to on selection.
 */
function isItemActive(item: NavItem, location: string): boolean {
  if (item.external) return false;
  if (item.url === '/') return location === '/' || location.startsWith('/dashboard');
  return location === item.url;
}

export function AppSidebar({ user, onLogout, onBackToStations: _onBackToStations }: AppSidebarProps) {
  const [location] = useLocation();
  const isAdmin = user?.role === 'admin';
  const sections = isAdmin ? adminNavSections : [];
  const leadItems = isAdmin ? adminStandaloneItems : userStandaloneItems;
  const footerItems = isAdmin ? adminFooterItems : [];

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.title}>
      <SidebarMenuButton
        asChild
        isActive={isItemActive(item, location)}
        data-testid={testId(item.title)}
      >
        <Link href={item.url}>
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <Sidebar className="bg-sidebar-background border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          {/* Dark Blue Circle with White Dot Logo */}
          <div className="w-8 h-8 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-md border border-white/10 flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
          </div>
          <div className="inline-flex flex-col items-center pt-[5px]">
            <h2 className="text-[18px] font-extrabold tracking-wide leading-none" style={{ color: STRATUS_NAVY }}>STRATUS</h2>
            <span className="text-[9px] font-bold tracking-wider mt-0.5" style={{ color: STRATUS_NAVY }}>METRON (PTY) LTD</span>
          </div>
          {/* Metron company logo */}
          <img src="/metron-logo.png" alt="Metron" className="w-8 h-8 object-contain flex-shrink-0 ml-1" />
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar-background">
        <SidebarGroup>
          {/* Brand navy and bold. Carried inline for the same reason the wordmark
              is: this is the Stratus brand colour, not a themeable token, so it
              must not shift if the sidebar theme changes. */}
          <SidebarGroupLabel className="text-base font-bold" style={{ color: STRATUS_NAVY }}>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {leadItems.map(renderItem)}

              {/*
                Sections are permanently expanded: no trigger, no disclosure
                arrow, nothing to collapse. Every destination stays visible and
                in the same place on every visit, so the menu can be navigated
                from memory rather than by opening things to look inside. The
                heading is a plain label, not a button, and the indentation from
                SidebarMenuSub is what conveys the grouping.
              */}
              {sections.map((section) => (
                <SidebarMenuItem key={section.label}>
                  <div
                    className="flex h-8 w-full items-center rounded-md p-2 text-left text-sm font-medium text-sidebar-foreground"
                    data-testid={`nav-section-${section.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <span>{section.label}</span>
                  </div>
                  <SidebarMenuSub>
                    {section.items.map((item) => (
                      <SidebarMenuSubItem key={item.title}>
                        <SidebarMenuSubButton
                          asChild
                          isActive={isItemActive(item, location)}
                          data-testid={testId(item.title)}
                        >
                          {item.external ? (
                            // rel="noopener noreferrer" keeps the new tab from
                            // getting a handle on this window and withholds the
                            // referrer from the other origin.
                            <a href={item.url} target="_blank" rel="noopener noreferrer">
                              <span>{item.title}</span>
                              <span className="sr-only">(opens in a new tab)</span>
                            </a>
                          ) : (
                            <Link href={item.url}>
                              <span>{item.title}</span>
                            </Link>
                          )}
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </SidebarMenuItem>
              ))}

              {footerItems.map(renderItem)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 space-y-3">
        {user && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Badge variant="default" className="text-xs" style={{ backgroundColor: STRATUS_NAVY }}>
                  Admin
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  User
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 overflow-hidden">
                <p className="truncate text-sm font-medium text-sidebar-foreground" data-testid="text-user-name">{user.name}</p>
                <p className="truncate text-xs text-sidebar-foreground">{user.email}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={onLogout}
                data-testid="button-logout"
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
        <div className="text-center text-xs text-sidebar-foreground pt-2 border-t border-sidebar-border">
          <p>Stratus Weather Station Server V2.2.1 [2026]</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
