import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileText, Download, Calendar, Plus, Trash2 } from "lucide-react";

interface Report {
  id: string;
  name: string;
  type: string;
  station: string;
  createdAt: string;
  status: "ready" | "generating" | "failed";
}

const mockReports: Report[] = [
  {
    id: "1",
    name: "Monthly Summary - November 2024",
    type: "Monthly Summary",
    station: "Kommetjie Weather",
    createdAt: "2024-12-01",
    status: "ready",
  },
  {
    id: "2",
    name: "Weekly Report - Week 49",
    type: "Weekly Report",
    station: "Kommetjie Weather",
    createdAt: "2024-12-08",
    status: "ready",
  },
  {
    id: "3",
    name: "Custom Report - Wind Analysis",
    type: "Custom",
    station: "Table Mountain",
    createdAt: "2024-12-10",
    status: "generating",
  },
];

export default function Reports() {
  const [reportType, setReportType] = useState("");
  const [station, setStation] = useState("");
  const [reports] = useState<Report[]>(mockReports);

  const handleGenerateReport = () => {
    console.log("Generating report:", { reportType, station });
  };

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Generate and download weather reports
        </p>
      </div>

      <Card data-testid="card-generate-report">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5" />
            Generate New Report
          </CardTitle>
          <CardDescription>Create a custom weather report for your station</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger data-testid="select-report-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily Summary</SelectItem>
                  <SelectItem value="weekly">Weekly Report</SelectItem>
                  <SelectItem value="monthly">Monthly Summary</SelectItem>
                  <SelectItem value="custom">Custom Date Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Station</Label>
              <Select value={station} onValueChange={setStation}>
                <SelectTrigger data-testid="select-report-station">
                  <SelectValue placeholder="Select station" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Kommetjie Weather</SelectItem>
                  <SelectItem value="2">Table Mountain</SelectItem>
                  <SelectItem value="3">Stellenbosch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {reportType === "custom" && (
              <>
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input type="date" className="pl-10" data-testid="input-report-start" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input type="date" className="pl-10" data-testid="input-report-end" />
                  </div>
                </div>
              </>
            )}
            <div className={`flex items-end ${reportType !== "custom" ? "lg:col-span-2" : ""}`}>
              <Button
                className="w-full"
                onClick={handleGenerateReport}
                disabled={!reportType || !station}
                data-testid="button-generate-report"
              >
                <FileText className="mr-2 h-4 w-4" />
                Generate Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-reports-list">
        <CardHeader>
          <CardTitle className="text-lg">Your Reports</CardTitle>
          <CardDescription>View and download previously generated reports</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {reports.map((report) => (
              <div
                key={report.id}
                className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
                data-testid={`report-item-${report.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{report.name}</p>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>{report.station}</span>
                      <span>-</span>
                      <span>{report.type}</span>
                      <span>-</span>
                      <span>{report.createdAt}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={report.status === "ready" ? "default" : report.status === "generating" ? "secondary" : "destructive"}
                    className={report.status === "ready" ? "bg-green-600 text-white" : ""}
                  >
                    {report.status === "ready" ? "Ready" : report.status === "generating" ? "Generating..." : "Failed"}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={report.status !== "ready"}
                    data-testid={`button-download-${report.id}`}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    data-testid={`button-delete-${report.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
