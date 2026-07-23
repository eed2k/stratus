// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Report Generation page - admin-only, accessible from the sidebar nav at
 * `/reports`. Renders the existing `ReportGenerator` component which lets
 * an admin build an ad-hoc PDF report (with summary stats and wind rose
 * diagrams) for a single station over a chosen date range.
 *
 * The scheduling UI for recurring email reports has moved to
 * `/reports/schedule` (see ReportsSchedule.tsx).
 */

import { useQuery } from "@tanstack/react-query";
import type { WeatherStation } from "@shared/schema";
import { ReportGenerator } from "@/components/reports/ReportGenerator";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";

export default function Reports() {
  const { data: stations = [], isLoading } = useQuery<WeatherStation[]>({
    queryKey: ["/api/stations"],
  });

  return (
    <div className="min-h-screen w-full bg-background">
      <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: '#1e3a5f', fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Report Generation
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Build an on-demand PDF report for a single station with summary statistics and wind rose diagrams.
              For recurring email reports, see <Link href="/reports/schedule" className="underline">Report Scheduling</Link>.
            </p>
          </div>
          <Link href="/reports/schedule">
            <Button variant="outline">Report Scheduling →</Button>
          </Link>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-10 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : stations.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No stations available. Add a station from the Station Setup page to generate reports.
            </CardContent>
          </Card>
        ) : (
          <ReportGenerator stations={stations} />
        )}
      </div>
    </div>
  );
}
