import { useQuery } from "@tanstack/react-query";
import { StationDashboard } from "@/components/campbell/StationDashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Radio } from "lucide-react";
import type { WeatherStation } from "@shared/schema";

export default function CampbellDashboard() {
  const { data: stations = [], isLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (stations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6">
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12 px-8">
            <Radio className="h-12 w-12 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">No Weather Stations</h2>
            <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
              Initialize the demo station to see Campbell Scientific data.
            </p>
            <p className="text-xs text-muted-foreground text-center max-w-md">
              Run: <code className="bg-secondary px-2 py-1 rounded">node scripts/init-demo.js</code>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Use first station (demo station)
  const station = stations[0];

  return (
    <div className="h-full overflow-auto">
      <StationDashboard stationId={station.id} />
    </div>
  );
}
