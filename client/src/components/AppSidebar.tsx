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
import { LogOut, Shield, User } from "lucide-react";

interface AppSidebarProps {
  user?: {
    name: string;
    email: string;
    avatar?: string;
    role?: 'admin' | 'user';
  };
  onLogout?: () => void;
}

// Admin navigation items - full access
const adminNavItems = [
  { title: "Dashboard", url: "/" },
  { title: "Stations", url: "/stations" },
  { title: "User Management", url: "/users" },
  { title: "Organizations", url: "/organizations" },
  { title: "History", url: "/history" },
  { title: "Alarms", url: "/alarms" },
  { title: "Reports", url: "/reports" },
  { title: "Settings", url: "/settings" },
  { title: "Documentation", url: "/docs" },
];

// User navigation items - limited access
const userNavItems = [
  { title: "Dashboard", url: "/" },
  { title: "Account Settings", url: "/account" },
  { title: "Documentation", url: "/docs" },
];

export function AppSidebar({ user, onLogout }: AppSidebarProps) {
  const [location] = useLocation();
  const isAdmin = user?.role === 'admin';
  const navItems = isAdmin ? adminNavItems : userNavItems;

  return (
    <Sidebar className="bg-sidebar-background border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border p-4">
        <div className="flex items-center gap-3">
          {/* Dark Blue Circle with White Dot Logo */}
          <div className="w-9 h-9 rounded-full bg-[#1e3a5f] flex items-center justify-center shadow-md border border-white/10">
            <div className="w-3 h-3 rounded-full bg-white"></div>
          </div>
          <div>
            <h2 className="font-semibold text-sidebar-foreground">STRATUS</h2>
            <p className="text-xs text-muted-foreground">Weather Monitoring</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="bg-sidebar-background">
        <SidebarGroup>
          <SidebarGroupLabel className="text-muted-foreground">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Link href={item.url}>
                      <span>{item.title}</span>
                    </Link>
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
                <Badge variant="default" className="bg-blue-600 text-xs">
                  <Shield className="h-3 w-3 mr-1" />
                  Admin
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  <User className="h-3 w-3 mr-1" />
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
          <p>Credit: Lukas Esterhuizen 2025</p>
          <a 
            href="mailto:esterhuizen2k@proton.me" 
            className="hover:underline"
          >
            esterhuizen2k@proton.me
          </a>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
