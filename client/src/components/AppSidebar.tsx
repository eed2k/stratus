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
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, LogOut } from "lucide-react";

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
   * The AS3935 Admin Panel is a separate FastAPI application served from its
   * own subdomain, so it cannot be reached through the SPA router. It also
   * sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`, which rules
   * out embedding it in an iframe - a new tab is the only option that works.
   */
  external?: boolean;
}

// Lightning Detection System admin panel (separate Python/FastAPI service).
const LIGHTNING_PANEL_URL = "https://adminpanel.stratusweather.co.za";

// Admin navigation items - full access
const adminNavItems: NavItem[] = [
  // Pinned to the top: the AS3935 panel is the entry point operators reach for
  // most often, and it is the one item that leaves the SPA entirely.
  { title: "AS3935 Admin Panel", url: LIGHTNING_PANEL_URL, external: true },
  { title: "Active Stations", url: "/" },
  { title: "Station Setup", url: "/stations" },
  { title: "User Management", url: "/users" },
  { title: "Historical Data Export", url: "/history" },
  { title: "Alerts", url: "/alarms" },
  { title: "Report Generation", url: "/reports" },
  { title: "Report Scheduling", url: "/reports/schedule" },
  { title: "Settings", url: "/settings" },
  { title: "About Stratus", url: "/docs" },
];

// User navigation items - limited access (no docs, no config)
const userNavItems: NavItem[] = [
  { title: "Active Stations", url: "/" },
  { title: "Historical Data Export", url: "/history" },
  { title: "Account Settings", url: "/account" },
];

export function AppSidebar({ user, onLogout, onBackToStations: _onBackToStations }: AppSidebarProps) {
  const [location] = useLocation();
  const isAdmin = user?.role === 'admin';
  const navItems = isAdmin ? adminNavItems : userNavItems;

  return (
    <Sidebar className="bg-sidebar-background border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          {/* Dark Blue Circle with White Dot Logo */}
          <div className="w-8 h-8 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-md border border-white/10 flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
          </div>
          <div className="inline-flex flex-col items-center pt-[5px]">
            <h2 className="text-[18px] font-extrabold tracking-wide leading-none" style={{ fontFamily: 'Arial, sans-serif', color: '#1e3a5f' }}>STRATUS</h2>
            <span className="text-[9px] font-bold tracking-wider mt-0.5" style={{ fontFamily: 'Arial, sans-serif', color: '#1e3a5f' }}>METRON (PTY) LTD</span>
          </div>
          {/* Metron company logo */}
          <img src="/metron-logo.png" alt="Metron" className="w-8 h-8 object-contain flex-shrink-0 ml-1" />
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar-background">
        <SidebarGroup>
          <SidebarGroupLabel className="text-base font-semibold" style={{ color: '#1e3a5f' }}>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.external
                        ? false
                        : item.url === '/'
                          ? (location === '/' || location.startsWith('/dashboard'))
                          : location === item.url
                    }
                    data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {item.external ? (
                      // rel="noopener noreferrer" keeps the new tab from getting a
                      // handle on this window and withholds the referrer from the
                      // other origin.
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2"
                      >
                        <span>{item.title}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={item.url}>
                        <span>{item.title}</span>
                      </Link>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4 space-y-3">
        {user && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {isAdmin ? (
                <Badge variant="default" className="text-xs" style={{ backgroundColor: '#1e3a5f' }}>
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
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
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
        <div className="text-center text-xs text-muted-foreground pt-2 border-t border-sidebar-border">
          <p>Stratus Weather Station Server V2.1.0 [2026]</p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
