import { RefreshIndicator } from "../dashboard/RefreshIndicator";
import { ThemeProvider } from "../ThemeProvider";

export default function RefreshIndicatorExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <RefreshIndicator
          lastUpdate={new Date(Date.now() - 120000)}
          autoRefresh={true}
          interval={60}
          onRefresh={() => console.log("Refresh triggered")}
          onIntervalChange={(i) => console.log("Interval:", i)}
          onAutoRefreshChange={(e) => console.log("Auto refresh:", e)}
        />
      </div>
    </ThemeProvider>
  );
}
