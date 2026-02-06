import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Shield,
  FileCheck,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  FileText,
  Download,
  Plus,
  RefreshCw,
  Calendar,
  Link2,
  Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ComplianceSummary {
  calibration: {
    total: number;
    valid: number;
    expired: number;
    dueSoon: number;
  };
  dataQuality: {
    totalFlags: number;
    pendingReview: number;
  };
  dataSubjectRequests: {
    total: number;
    pending: number;
    overdue: number;
  };
  certifications: {
    total: number;
    active: number;
    expiringSoon: number;
  };
  lastUpdated: string;
}

interface CalibrationRecord {
  calibration: {
    id: number;
    sensorId: number;
    calibrationDate: string;
    nextCalibrationDue: string;
    calibratingInstitution: string;
    certificateNumber: string;
    calibrationStatus: string;
    uncertaintyValue: number;
    uncertaintyUnit: string;
    laboratoryAccreditation: string;
    referenceStandardTraceability: string;
  };
  sensor: {
    id: number;
    sensorType: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
  };
  station: {
    id: number;
    name: string;
  };
}

interface QualityFlag {
  flag: {
    id: number;
    stationId: number;
    flagType: string;
    severity: string;
    startTime: string;
    endTime: string | null;
    reason: string;
    reviewStatus: string;
    qcLevel: number;
    affectedParameters: string[];
  };
  station: {
    id: number;
    name: string;
  };
  sensor: {
    id: number;
    sensorType: string;
  } | null;
}

interface DataSubjectRequest {
  id: number;
  requestType: string;
  requestReference: string;
  dataSubjectEmail: string;
  dataSubjectName: string;
  status: string;
  requestDate: string;
  dueDate: string;
  completedDate: string | null;
}

interface Certification {
  certification: {
    id: number;
    standardName: string;
    standardVersion: string;
    certificationNumber: string;
    certifyingBody: string;
    issueDate: string;
    expiryDate: string;
    status: string;
    scopeDescription: string;
  };
  station: {
    id: number;
    name: string;
  } | null;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; className: string }> = {
    valid: { variant: "default", className: "bg-green-600" },
    active: { variant: "default", className: "bg-green-600" },
    completed: { variant: "default", className: "bg-green-600" },
    approved: { variant: "default", className: "bg-green-600" },
    due_soon: { variant: "secondary", className: "bg-yellow-500 text-white" },
    pending: { variant: "secondary", className: "bg-yellow-500 text-white" },
    in_progress: { variant: "secondary", className: "bg-blue-500 text-white" },
    expired: { variant: "destructive", className: "" },
    overdue: { variant: "destructive", className: "" },
    rejected: { variant: "destructive", className: "" },
    suspended: { variant: "destructive", className: "" },
  };
  
  const config = variants[status] || { variant: "outline", className: "" };
  
  return (
    <Badge variant={config.variant} className={config.className}>
      {status.replace(/_/g, " ").toUpperCase()}
    </Badge>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: "bg-blue-100 text-blue-800",
    warning: "bg-yellow-100 text-yellow-800",
    error: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };
  
  return (
    <Badge variant="outline" className={colors[severity] || "bg-gray-100"}>
      {severity.toUpperCase()}
    </Badge>
  );
}

function QCLevelBadge({ level }: { level: number }) {
  const labels = ["Raw", "Auto QC", "Manual QC", "Validated"];
  const colors = [
    "bg-gray-100 text-gray-800",
    "bg-blue-100 text-blue-800",
    "bg-purple-100 text-purple-800",
    "bg-green-100 text-green-800",
  ];
  
  return (
    <Badge variant="outline" className={colors[level] || colors[0]}>
      QC{level}: {labels[level] || "Unknown"}
    </Badge>
  );
}

export default function Compliance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch compliance summary
  const { data: summary, isLoading: summaryLoading } = useQuery<ComplianceSummary>({
    queryKey: ["compliance-summary"],
    queryFn: async () => {
      const res = await authFetch("/api/compliance/summary");
      if (!res.ok) throw new Error("Failed to fetch compliance summary");
      return res.json();
    },
    refetchInterval: 60000, // Refresh every minute
  });

  // Fetch calibrations
  const { data: calibrations, isLoading: calibrationsLoading } = useQuery<CalibrationRecord[]>({
    queryKey: ["calibrations"],
    queryFn: async () => {
      const res = await authFetch("/api/compliance/calibrations");
      if (!res.ok) throw new Error("Failed to fetch calibrations");
      return res.json();
    },
  });

  // Fetch quality flags
  const { data: qualityFlags, isLoading: flagsLoading } = useQuery<QualityFlag[]>({
    queryKey: ["quality-flags"],
    queryFn: async () => {
      const res = await authFetch("/api/compliance/quality-flags");
      if (!res.ok) throw new Error("Failed to fetch quality flags");
      return res.json();
    },
  });

  // Fetch data subject requests
  const { data: dsrRequests, isLoading: dsrLoading } = useQuery<DataSubjectRequest[]>({
    queryKey: ["dsr-requests"],
    queryFn: async () => {
      const res = await authFetch("/api/compliance/dsr");
      if (!res.ok) throw new Error("Failed to fetch DSR requests");
      return res.json();
    },
  });

  // Fetch certifications
  const { data: certifications, isLoading: certsLoading } = useQuery<Certification[]>({
    queryKey: ["certifications"],
    queryFn: async () => {
      const res = await authFetch("/api/compliance/certifications");
      if (!res.ok) throw new Error("Failed to fetch certifications");
      return res.json();
    },
  });

  // Export audit log
  const handleExportAuditLog = async () => {
    try {
      const res = await authFetch("/api/compliance/audit-log/export?format=csv");
      if (!res.ok) throw new Error("Failed to export audit log");
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-log-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Export Complete",
        description: "Audit log exported successfully",
      });
    } catch (error) {
      toast({
        title: "Export Failed",
        description: "Failed to export audit log",
        variant: "destructive",
      });
    }
  };

  // Handlers for adding compliance records
  const handleAddCalibration = () => {
    toast({
      title: "Add Calibration",
      description: "Navigate to Station Setup → Sensors to add calibration records for individual sensors.",
    });
    // Navigate to station setup sensors tab
    window.location.href = "/station-setup?tab=sensors";
  };

  const handleAddQualityFlag = () => {
    toast({
      title: "Add Quality Flag",
      description: "Quality flags are automatically generated by the system. Manual flags can be added via API.",
    });
  };

  const handleAddCertification = () => {
    toast({
      title: "Add Certification",
      description: "Navigate to Station Setup → Station Info to add certifications.",
    });
    window.location.href = "/station-setup?tab=info";
  };

  const handleViewRecord = (type: string, id: number) => {
    toast({
      title: `Viewing ${type} #${id}`,
      description: `Opening details for ${type} record...`,
    });
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Regulatory Compliance</h1>
          <p className="text-muted-foreground">
            ISO 17025 · ISO 19115/19157 · GDPR · ISO 27001
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportAuditLog}>
            <Download className="h-4 w-4 mr-2" />
            Export Audit Log
          </Button>
          <Button variant="outline" onClick={() => queryClient.invalidateQueries({ queryKey: ["compliance-summary"] })}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Calibration Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-blue-500" />
              Calibration Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="animate-pulse h-16 bg-muted rounded" />
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-bold">{summary?.calibration.valid || 0}</span>
                  <Badge variant="default" className="bg-green-600">Valid</Badge>
                </div>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-yellow-500" />
                    {summary?.calibration.dueSoon || 0} due soon
                  </span>
                  <span className="flex items-center gap-1">
                    <XCircle className="h-3 w-3 text-red-500" />
                    {summary?.calibration.expired || 0} expired
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Data Quality */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-purple-500" />
              Data Quality Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="animate-pulse h-16 bg-muted rounded" />
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-bold">{summary?.dataQuality.totalFlags || 0}</span>
                  <Badge variant="outline">Total</Badge>
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {summary?.dataQuality.pendingReview || 0} pending review
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* GDPR Requests */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4 text-orange-500" />
              Data Subject Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="animate-pulse h-16 bg-muted rounded" />
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-bold">{summary?.dataSubjectRequests.pending || 0}</span>
                  <Badge variant="secondary" className="bg-yellow-500 text-white">Pending</Badge>
                </div>
                {(summary?.dataSubjectRequests.overdue || 0) > 0 && (
                  <div className="text-sm text-red-500 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {summary?.dataSubjectRequests.overdue} overdue!
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Certifications */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              Certifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <div className="animate-pulse h-16 bg-muted rounded" />
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-2xl font-bold">{summary?.certifications.active || 0}</span>
                  <Badge variant="default" className="bg-green-600">Active</Badge>
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {summary?.certifications.expiringSoon || 0} expiring soon
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs for detailed views */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="calibrations">Calibrations</TabsTrigger>
          <TabsTrigger value="quality">Data Quality</TabsTrigger>
          <TabsTrigger value="gdpr">GDPR / DSR</TabsTrigger>
          <TabsTrigger value="certifications">Certifications</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Supported Standards */}
            <Card>
              <CardHeader>
                <CardTitle>Supported Compliance Standards</CardTitle>
                <CardDescription>
                  Stratus implements comprehensive regulatory compliance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Badge className="bg-blue-600">ISO/IEC 17025</Badge>
                  <div>
                    <p className="font-medium">Calibration Laboratory Competence</p>
                    <p className="text-sm text-muted-foreground">
                      Full traceability chain to NIST, measurement uncertainty documentation, accredited laboratory tracking
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="bg-purple-600">ISO 19115/19157</Badge>
                  <div>
                    <p className="font-medium">Geographic Data Quality</p>
                    <p className="text-sm text-muted-foreground">
                      Metadata standards, data quality dimensions, completeness and accuracy tracking
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="bg-orange-600">GDPR</Badge>
                  <div>
                    <p className="font-medium">Data Protection Regulation</p>
                    <p className="text-sm text-muted-foreground">
                      Data subject rights (Art. 15-22), consent management, data retention policies, audit logging
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="bg-green-600">ISO 27001</Badge>
                  <div>
                    <p className="font-medium">Information Security Management</p>
                    <p className="text-sm text-muted-foreground">
                      Comprehensive audit logging, access control, data integrity verification
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Badge className="bg-cyan-600">WMO-No. 8</Badge>
                  <div>
                    <p className="font-medium">Meteorological Instruments Guide</p>
                    <p className="text-sm text-muted-foreground">
                      Standard observing practices, instrument siting, quality control levels (QC0-QC3)
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common compliance tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("calibrations")}>
                  <FileCheck className="h-4 w-4 mr-2" />
                  View Calibration Status
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("quality")}>
                  <Shield className="h-4 w-4 mr-2" />
                  Review Quality Flags
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("gdpr")}>
                  <FileText className="h-4 w-4 mr-2" />
                  Process Data Requests
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={handleExportAuditLog}>
                  <Download className="h-4 w-4 mr-2" />
                  Export Audit Log
                </Button>
                <Button variant="outline" className="w-full justify-start" onClick={() => setActiveTab("certifications")}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Manage Certifications
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Calibrations Tab */}
        <TabsContent value="calibrations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Calibration Records</CardTitle>
                  <CardDescription>ISO/IEC 17025 compliant calibration tracking with NIST traceability</CardDescription>
                </div>
                <Button onClick={handleAddCalibration}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Calibration
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {calibrationsLoading ? (
                <div className="animate-pulse space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sensor</TableHead>
                      <TableHead>Station</TableHead>
                      <TableHead>Calibration Date</TableHead>
                      <TableHead>Next Due</TableHead>
                      <TableHead>Certificate</TableHead>
                      <TableHead>Uncertainty</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calibrations?.map((record) => (
                      <TableRow key={record.calibration.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{record.sensor.sensorType}</p>
                            <p className="text-xs text-muted-foreground">
                              {record.sensor.manufacturer} {record.sensor.model}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>{record.station.name}</TableCell>
                        <TableCell>
                          {new Date(record.calibration.calibrationDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {record.calibration.nextCalibrationDue
                            ? new Date(record.calibration.nextCalibrationDue).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-xs">
                            {record.calibration.certificateNumber || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {record.calibration.uncertaintyValue
                            ? `±${record.calibration.uncertaintyValue} ${record.calibration.uncertaintyUnit || ""}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={record.calibration.calibrationStatus} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => handleViewRecord("calibration", record.calibration.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => window.open(`/api/compliance/calibrations/${record.calibration.id}/certificate`, "_blank")}>
                            <Link2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!calibrations || calibrations.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No calibration records found. Add your first calibration to start tracking.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Quality Tab */}
        <TabsContent value="quality">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Data Quality Flags</CardTitle>
                  <CardDescription>ISO 19157 data quality tracking and WMO QC levels</CardDescription>
                </div>
                <Button onClick={handleAddQualityFlag}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Flag
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {flagsLoading ? (
                <div className="animate-pulse space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Station</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>QC Level</TableHead>
                      <TableHead>Time Range</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Review Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {qualityFlags?.map((item) => (
                      <TableRow key={item.flag.id}>
                        <TableCell>{item.station.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{item.flag.flagType}</Badge>
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity={item.flag.severity} />
                        </TableCell>
                        <TableCell>
                          <QCLevelBadge level={item.flag.qcLevel} />
                        </TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <p>{new Date(item.flag.startTime).toLocaleString()}</p>
                            {item.flag.endTime && (
                              <p className="text-muted-foreground">
                                → {new Date(item.flag.endTime).toLocaleString()}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {item.flag.reason || "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={item.flag.reviewStatus} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => handleViewRecord("quality-flag", item.flag.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!qualityFlags || qualityFlags.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No data quality flags found. Flags are created automatically or manually.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* GDPR Tab */}
        <TabsContent value="gdpr">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Data Subject Requests</CardTitle>
                  <CardDescription>GDPR Art. 15-22 rights management</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {dsrLoading ? (
                <div className="animate-pulse space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Requester</TableHead>
                      <TableHead>Request Date</TableHead>
                      <TableHead>Due Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dsrRequests?.map((request) => {
                      const isOverdue = new Date(request.dueDate) < new Date() && request.status === "pending";
                      return (
                        <TableRow key={request.id} className={isOverdue ? "bg-red-50" : ""}>
                          <TableCell className="font-mono text-xs">
                            {request.requestReference}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{request.requestType}</Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p>{request.dataSubjectName || "—"}</p>
                              <p className="text-xs text-muted-foreground">{request.dataSubjectEmail}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            {new Date(request.requestDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className={isOverdue ? "text-red-600 font-medium" : ""}>
                            {new Date(request.dueDate).toLocaleDateString()}
                            {isOverdue && " (OVERDUE)"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={request.status} />
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="sm" onClick={() => handleViewRecord("dsr", request.id)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {(!dsrRequests || dsrRequests.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No data subject requests found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Certifications Tab */}
        <TabsContent value="certifications">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Compliance Certifications</CardTitle>
                  <CardDescription>Track regulatory certifications and accreditations</CardDescription>
                </div>
                <Button onClick={handleAddCertification}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Certification
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {certsLoading ? (
                <div className="animate-pulse space-y-2">
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted rounded" />)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Standard</TableHead>
                      <TableHead>Station/Scope</TableHead>
                      <TableHead>Certificate #</TableHead>
                      <TableHead>Certifying Body</TableHead>
                      <TableHead>Issue Date</TableHead>
                      <TableHead>Expiry Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {certifications?.map((cert) => (
                      <TableRow key={cert.certification.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{cert.certification.standardName}</p>
                            {cert.certification.standardVersion && (
                              <p className="text-xs text-muted-foreground">v{cert.certification.standardVersion}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {cert.station?.name || (
                            <span className="text-muted-foreground">Organisation-wide</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {cert.certification.certificationNumber || "—"}
                        </TableCell>
                        <TableCell>{cert.certification.certifyingBody || "—"}</TableCell>
                        <TableCell>
                          {new Date(cert.certification.issueDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          {cert.certification.expiryDate
                            ? new Date(cert.certification.expiryDate).toLocaleDateString()
                            : "No expiry"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={cert.certification.status} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => handleViewRecord("certification", cert.certification.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!certifications || certifications.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                          No certifications found. Add certifications to track compliance status.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
