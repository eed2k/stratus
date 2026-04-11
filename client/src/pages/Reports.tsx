// Stratus Weather Server
// Created by Lukas Esterhuizen

import { useQuery } from "@tanstack/react-query";
import { ReportGenerator } from "@/components/reports/ReportGenerator";
import type { WeatherStation } from "@shared/schema";

export default function Reports() {
  const { data: stations = [], isLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">Loading stations...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Report Generation</h1>
        <p className="text-sm text-muted-foreground">Generate and export weather data reports</p>
      </div>

      <ReportGenerator stations={stations} />
    </div>
  );
}
