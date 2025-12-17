import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import CampbellDashboard from "@/pages/CampbellDashboard";
import Landing from "@/pages/Landing";
import Stations from "@/pages/Stations";
import History from "@/pages/History";
import Settings from "@/pages/Settings";
import { Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/" component={Landing} />
        <Route component={Landing} />
      </Switch>
    );
  }

  return (
    <AuthenticatedApp user={user!} logout={logout} />
  );
}

function AuthenticatedApp({ user, logout }: { 
  user: { firstName?: string | null; lastName?: string | null; email?: string | null; profileImageUrl?: string | null };
  logout: () => void;
}) {
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const displayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.email || "User";

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="dark flex h-screen w-full bg-background">
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
              <Route path="/history" component={History} />
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
      <ThemeProvider>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
