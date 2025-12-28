import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { DemoInitializer } from "@/components/DemoInitializer";
import { useAuth } from "@/hooks/useAuth";
import { useElectronMenu } from "@/hooks/useElectronMenu";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import CampbellDashboard from "@/pages/CampbellDashboard";
import Stations from "@/pages/Stations";
import History from "@/pages/History";
import Settings from "@/pages/Settings";
import Organizations from "@/pages/Organizations";
import Alarms from "@/pages/Alarms";
import Reports from "@/pages/Reports";
import SerialMonitor from "@/pages/SerialMonitor";
import SharedDashboard from "@/pages/SharedDashboard";
import { LoginPage } from "@/pages/LoginPage";
import { Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  const { isLoading, user, logout, needsSetup, login } = useAuth();
  const [location] = useLocation();

  // Shared dashboard routes don't need authentication
  if (location.startsWith('/shared/')) {
    return <SharedDashboard />;
  }

  if (isLoading) {
    return <LoadingScreen />;
  }

  // Show login/setup screen on first launch
  if (needsSetup || !user) {
    return <LoginPage onLogin={login} />;
  }

  // Desktop app - authenticated
  return (
    <DemoInitializer>
      <AuthenticatedApp user={user!} logout={logout} />
    </DemoInitializer>
  );
}

function AuthenticatedApp({ user, logout }: { 
  user: { firstName?: string | null; lastName?: string | null; email?: string | null; profileImageUrl?: string | null };
  logout: () => void;
}) {
  // Initialize Electron menu listeners
  useElectronMenu();
  
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const displayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.email || "User";

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full bg-white">
        <AppSidebar
          user={{
            name: displayName,
            email: user.email || "",
            avatar: user.profileImageUrl || undefined,
          }}
          onLogout={logout}
        />
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <header className="flex h-14 items-center gap-4 border-b border-border px-4 bg-card">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto bg-background">
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/campbell" component={CampbellDashboard} />
              <Route path="/stations" component={Stations} />
              <Route path="/organizations" component={Organizations} />
              <Route path="/history" component={History} />
              <Route path="/alarms" component={Alarms} />
              <Route path="/reports" component={Reports} />
              <Route path="/serial-monitor" component={SerialMonitor} />
              <Route path="/settings" component={Settings} />
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
