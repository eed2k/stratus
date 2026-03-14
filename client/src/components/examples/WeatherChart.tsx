// Stratus Weather System - Example/Template Component
// Source: Library (shadcn/ui example)

import { WeatherChart } from "../charts/WeatherChart";
import { ThemeProvider } from "../ThemeProvider";

const generateMockData = () => {
  const data = [];
  const now = new Date();
  for (let i = 24; i >= 0; i--) {
    const time = new Date(now.getTime() - i * 60 * 60 * 1000);
    data.push({
      timestamp: time.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
      temperature: 20 + Math.sin(i / 4) * 5 + Math.random() * 2,
      humidity: 60 + Math.cos(i / 6) * 15 + Math.random() * 5,
    });
  }
  return data;
};

export default function WeatherChartExample() {
  return (
    <ThemeProvider>
      <div className="p-4 bg-background">
        <WeatherChart
          title="Temperature & Humidity"
          data={generateMockData()}
          series={[
            { dataKey: "temperature", name: "Temperature (°C)", color: "#ef4444" },
            { dataKey: "humidity", name: "Humidity (%)", color: "#3b82f6" },
          ]}
          onRangeChange={(range) => console.log("Range changed:", range)}
        />
      </div>
    </ThemeProvider>
  );
}
