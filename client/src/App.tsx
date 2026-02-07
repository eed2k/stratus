import { useState } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import StationSelector from "@/pages/StationSelector";
import CampbellDashboard from "@/pages/CampbellDashboard";
import Stations from "@/pages/Stations";
import History from "@/pages/History";
import Settings from "@/pages/Settings";
import Organizations from "@/pages/Organizations";
import Alarms from "@/pages/Alarms";
import Reports from "@/pages/Reports";
import SharedDashboard from "@/pages/SharedDashboard";
import UserManagement from "@/pages/UserManagement";
import AccountSettings from "@/pages/AccountSettings";
import Documentation from "@/pages/Documentation";
import Weather from "@/pages/Weather";
import SerialMonitor from "@/pages/SerialMonitor";
import { LoginPage } from "@/pages/LoginPage";
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SetupPasswordPage } from "@/pages/SetupPasswordPage";
import { Loader2 } from "lucide-react";

function LoadingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function Router() {
  const { isLoading, user, logout, needsSetup, login, isAdmin, canAccessStation } = useAuth();
  const [location] = useLocation();

  // Public routes that don't need authentication
  const isSharedRoute = location.startsWith('/shared/');
  const isForgotPasswordRoute = location === '/forgot-password';
  const isResetPasswordRoute = location.startsWith('/reset-password');
  const isSetupPasswordRoute = location.startsWith('/setup-password');
  
  // Handle public routes first (before auth check)
  if (isSharedRoute) {
    return <SharedDashboard />;
  }
  
  if (isForgotPasswordRoute) {
    return <ForgotPasswordPage />;
  }
  
  if (isResetPasswordRoute) {
    return <ResetPasswordPage />;
  }
  
  if (isSetupPasswordRoute) {
    return <SetupPasswordPage />;
  }
  
  if (isLoading) {
    return <LoadingScreen />;
  }

  if (needsSetup || !user) {
    return <LoginPage onLogin={login} />;
  }

  // Desktop app - authenticated
  return (
    <AuthenticatedApp user={user} logout={logout} isAdmin={isAdmin} canAccessStation={canAccessStation} />
  );
}

function AuthenticatedApp({ user, logout, isAdmin, canAccessStation }: { 
  user: AuthUser;
  logout: () => void;
  isAdmin: boolean;
  canAccessStation: (stationId: number) => boolean;
}) {
  const [, setLocation] = useLocation();
  const [_selectedStationId, setSelectedStationId] = useState<number | null>(null);
  
  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const displayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.email || "User";

  const handleSelectStation = (stationId: number) => {
    setSelectedStationId(stationId);
    setLocation(`/dashboard/${stationId}`);
  };

  const handleBackToStations = () => {
    setSelectedStationId(null);
    setLocation("/");
  };

  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full bg-white">
        <AppSidebar
          user={{
            name: displayName,
            email: user.email || "",
            avatar: user.profileImageUrl || undefined,
            role: user.role,
          }}
          onLogout={logout}
          onBackToStations={handleBackToStations}
        />
        <div className="flex flex-1 flex-col overflow-hidden bg-background">
          <header className="flex h-14 items-center gap-4 border-b border-border px-4 bg-card">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
          </header>
          <main className="flex-1 overflow-auto bg-background">
            <Switch>
              {/* Station Selector - landing page */}
              <Route path="/">
                <StationSelector 
                  isAdmin={isAdmin} 
                  canAccessStation={canAccessStation} 
                  assignedStations={user.assignedStations}
                  onSelectStation={handleSelectStation}
                />
              </Route>
              
              {/* Dashboard with station ID */}
              <Route path="/dashboard/:stationId">
                {(params) => (
                  <Dashboard 
                    isAdmin={isAdmin} 
                    canAccessStation={canAccessStation} 
                    stationId={parseInt(params.stationId)}
                    onBackToStations={handleBackToStations}
                  />
                )}
              </Route>
              
              {/* Legacy dashboard route - redirect to station selector */}
              <Route path="/dashboard">
                <StationSelector 
                  isAdmin={isAdmin} 
                  canAccessStation={canAccessStation} 
                  assignedStations={user.assignedStations}
                  onSelectStation={handleSelectStation}
                />
              </Route>
              
              {/* Weather - accessible to all users */}
              <Route path="/weather" component={Weather} />

              {/* Serial Monitor - desktop only (shows notice in browser) */}
              <Route path="/serial-monitor" component={SerialMonitor} />

              {/* Admin routes */}
              <Route path="/campbell">
                <AdminRoute isAdmin={isAdmin}><CampbellDashboard /></AdminRoute>
              </Route>
              <Route path="/stations">
                <AdminRoute isAdmin={isAdmin}><Stations /></AdminRoute>
              </Route>
              <Route path="/users">
                <AdminRoute isAdmin={isAdmin}><UserManagement /></AdminRoute>
              </Route>
              <Route path="/organizations">
                <AdminRoute isAdmin={isAdmin}><Organizations /></AdminRoute>
              </Route>
              <Route path="/history">
                <AdminRoute isAdmin={isAdmin}><History /></AdminRoute>
              </Route>
              <Route path="/alarms">
                <AdminRoute isAdmin={isAdmin}><Alarms /></AdminRoute>
              </Route>
              <Route path="/reports">
                <AdminRoute isAdmin={isAdmin}><Reports /></AdminRoute>
              </Route>
              <Route path="/settings">
                <AdminRoute isAdmin={isAdmin}><Settings /></AdminRoute>
              </Route>
              
              {/* User routes */}
              <Route path="/account" component={AccountSettings} />
              
              {/* Documentation - available to all users */}
              <Route path="/docs" component={Documentation} />
              
              <Route component={NotFound} />
            </Switch>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

// Wrapper component for admin-only routes
function AdminRoute({ isAdmin, children }: { isAdmin: boolean; children: React.ReactNode }) {
  if (!isAdmin) {
    return <NotFound />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
