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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

interface AppSidebarProps {
  user?: {
    name: string;
    email: string;
    avatar?: string;
  };
  onLogout?: () => void;
}

const navItems = [
  { title: "Dashboard", url: "/" },
  { title: "Stations", url: "/stations" },
  { title: "Serial Monitor", url: "/serial-monitor" },
  { title: "Organizations", url: "/organizations" },
  { title: "History", url: "/history" },
  { title: "Alarms", url: "/alarms" },
  { title: "Reports", url: "/reports" },
  { title: "Settings", url: "/settings" },
];

export function AppSidebar({ user, onLogout }: AppSidebarProps) {
  const [location] = useLocation();

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
                    data-testid={`nav-${item.title.toLowerCase()}`}
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
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user.avatar} />
              <AvatarFallback className="text-xs bg-secondary text-secondary-foreground">
                {user.name.split(" ").map(n => n[0]).join("").toUpperCase()}
              </AvatarFallback>
            </Avatar>
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
