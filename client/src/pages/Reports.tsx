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
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-page-title">Reports</h1>
        <p className="text-muted-foreground">Generate and export weather data reports</p>
      </div>

      <ReportGenerator stations={stations} />
    </div>
  );
}
