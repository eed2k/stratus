import { MetricCard } from "../dashboard/MetricCard";
import { ThemeProvider } from "../ThemeProvider";

export default function MetricCardExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <MetricCard
          title="Temperature"
          value={23.5}
          unit="°C"
          trend={{ value: 1.2, label: "from yesterday" }}
          subMetrics={[
            { label: "Min", value: "18.2°C" },
            { label: "Max", value: "28.1°C" },
          ]}
          sparklineData={[20, 21, 22, 23, 24, 23.5, 22, 21, 23, 25, 24, 23.5]}
        />
      </div>
    </ThemeProvider>
  );
}
