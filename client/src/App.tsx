import { useState, useMemo, lazy, Suspense } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth, type AuthUser } from "@/hooks/useAuth";
import { authFetch } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

// Lazy-loaded pages — code-split for faster initial load
const NotFound = lazy(() => import("@/pages/not-found"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const StationSelector = lazy(() => import("@/pages/StationSelector"));
const CampbellDashboard = lazy(() => import("@/pages/CampbellDashboard"));
const Stations = lazy(() => import("@/pages/Stations"));
const History = lazy(() => import("@/pages/History"));
const Settings = lazy(() => import("@/pages/Settings"));
const Organizations = lazy(() => import("@/pages/Organizations"));
const Alarms = lazy(() => import("@/pages/Alarms"));
const Reports = lazy(() => import("@/pages/Reports"));
const SharedDashboard = lazy(() => import("@/pages/SharedDashboard"));
const UserManagement = lazy(() => import("@/pages/UserManagement"));
const AccountSettings = lazy(() => import("@/pages/AccountSettings"));
const Documentation = lazy(() => import("@/pages/Documentation"));
const SerialMonitor = lazy(() => import("@/pages/SerialMonitor"));
const LoginPage = lazy(() => import("@/pages/LoginPage").then(m => ({ default: m.LoginPage })));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage").then(m => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage").then(m => ({ default: m.ResetPasswordPage })));
const SetupPasswordPage = lazy(() => import("@/pages/SetupPasswordPage").then(m => ({ default: m.SetupPasswordPage })));

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
    return <Suspense fallback={<LoadingScreen />}><SharedDashboard /></Suspense>;
  }
  
  if (isForgotPasswordRoute) {
    return <Suspense fallback={<LoadingScreen />}><ForgotPasswordPage /></Suspense>;
  }
  
  if (isResetPasswordRoute) {
    return <Suspense fallback={<LoadingScreen />}><ResetPasswordPage /></Suspense>;
  }
  
  if (isSetupPasswordRoute) {
    return <Suspense fallback={<LoadingScreen />}><SetupPasswordPage /></Suspense>;
  }
  
  if (isLoading) {
    return <LoadingScreen />;
  }

  if (needsSetup || !user) {
    return <Suspense fallback={<LoadingScreen />}><LoginPage onLogin={login} /></Suspense>;
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
  
  // Fetch stations for position-based dashboard numbering
  const { data: stationList = [] } = useQuery<{ id: number }[]>({
    queryKey: ["/api/stations/ids"],
    queryFn: async () => {
      const res = await authFetch("/api/stations");
      if (!res.ok) return [];
      const stations = await res.json();
      return stations.map((s: any) => ({ id: s.id })).sort((a: any, b: any) => a.id - b.id);
    },
    staleTime: 5 * 60 * 1000,
  });

  // Build position ↔ ID mappings (1-indexed)
  const { positionToId, idToPosition } = useMemo(() => {
    const p2id: Record<number, number> = {};
    const id2p: Record<number, number> = {};
    stationList.forEach((s, i) => {
      p2id[i + 1] = s.id;
      id2p[s.id] = i + 1;
    });
    return { positionToId: p2id, idToPosition: id2p };
  }, [stationList]);

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  const displayName = user.firstName && user.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user.firstName || user.email || "User";

  const handleSelectStation = (stationId: number) => {
    setSelectedStationId(stationId);
    const position = idToPosition[stationId] || stationId;
    setLocation(`/dashboard/${position}`);
  };

  const handleBackToStations = () => {
    setSelectedStationId(null);
    setLocation("/");
  };

  // Resolve a dashboard route param to actual station ID
  const resolveStationId = (param: string): number => {
    const num = parseInt(param);
    // If we have position mapping and this looks like a position, resolve it
    if (positionToId[num] !== undefined) {
      return positionToId[num];
    }
    // Fallback: treat as direct station ID for backward compatibility
    return num;
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
            <Suspense fallback={<LoadingScreen />}>
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
              
              {/* Dashboard with station position number */}
              <Route path="/dashboard/:stationId">
                {(params) => (
                  <Dashboard 
                    isAdmin={isAdmin} 
                    canAccessStation={canAccessStation} 
                    stationId={resolveStationId(params.stationId)}
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
                <History canAccessStation={canAccessStation} assignedStations={user.assignedStations} isAdmin={isAdmin} />
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
              
              {/* Documentation - admin only */}
              <Route path="/docs">
                <AdminRoute isAdmin={isAdmin}><Documentation /></AdminRoute>
              </Route>
              
              <Route component={NotFound} />
            </Switch>
            </Suspense>
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
