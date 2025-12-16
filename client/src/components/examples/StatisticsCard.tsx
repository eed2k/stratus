import { StatisticsCard } from "../dashboard/StatisticsCard";
import { ThemeProvider } from "../ThemeProvider";

export default function StatisticsCardExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <StatisticsCard
          title="Temperature Statistics"
          periods={[
            {
              period: "24h",
              stats: [
                { label: "Minimum", value: 15.2, unit: "°C" },
                { label: "Maximum", value: 28.4, unit: "°C" },
                { label: "Average", value: 21.8, unit: "°C" },
                { label: "Range", value: 13.2, unit: "°C" },
              ],
            },
            {
              period: "7d",
              stats: [
                { label: "Minimum", value: 12.1, unit: "°C" },
                { label: "Maximum", value: 31.5, unit: "°C" },
                { label: "Average", value: 20.3, unit: "°C" },
                { label: "Range", value: 19.4, unit: "°C" },
              ],
            },
            {
              period: "30d",
              stats: [
                { label: "Minimum", value: 8.5, unit: "°C" },
                { label: "Maximum", value: 34.2, unit: "°C" },
                { label: "Average", value: 19.6, unit: "°C" },
                { label: "Range", value: 25.7, unit: "°C" },
              ],
            },
          ]}
        />
      </div>
    </ThemeProvider>
  );
}
