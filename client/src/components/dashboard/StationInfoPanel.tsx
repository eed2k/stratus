import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { safeFixed } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Info,
  Settings,
  FileText,
  Download,
  Plus,
  Save,
  Wrench,
  Calendar,
  MapPin,
  Cpu,
  Edit,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface StationInfo {
  id: number;
  name: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  pakbusAddress?: number;
  securityCode?: number;
  dataloggerModel?: string;
  dataloggerSerialNumber?: string;
  programName?: string;
  modemModel?: string;
  modemSerialNumber?: string;
  notes?: string;
  siteDescription?: string;
  lastCalibrationDate?: string;
  nextCalibrationDate?: string;
}

interface CalibrationLog {
  id: number;
  date: string;
  technician: string;
  sensor: string;
  action: string;
  preValue?: string;
  postValue?: string;
  notes?: string;
  [key: string]: string | number | undefined;
}

interface MaintenanceLog {
  id: number;
  date: string;
  type: string;
  description: string;
  performedBy: string;
  nextScheduled?: string;
  [key: string]: string | number | undefined;
}

interface StationInfoPanelProps {
  station: StationInfo;
  isAdmin?: boolean;
  onSave?: (data: Partial<StationInfo>) => void;
  onDelete?: () => Promise<void>;
}

export function StationInfoPanel({ station, isAdmin = true, onSave, onDelete }: StationInfoPanelProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editedData, setEditedData] = useState<Partial<StationInfo>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [calibrationLogs, setCalibrationLogs] = useState<CalibrationLog[]>([]);
  const [maintenanceLogs, setMaintenanceLogs] = useState<MaintenanceLog[]>([]);
  const [showAddCalibration, setShowAddCalibration] = useState(false);
  const [showAddMaintenance, setShowAddMaintenance] = useState(false);
  const [newCalibration, setNewCalibration] = useState<Partial<CalibrationLog>>({});
  const [newMaintenance, setNewMaintenance] = useState<Partial<MaintenanceLog>>({});

  // Reset editedData when station changes or when starting to edit
  const startEditing = () => {
    setEditedData({
      name: station.name,
      location: station.location,
      latitude: station.latitude,
      longitude: station.longitude,
      altitude: station.altitude,
      pakbusAddress: station.pakbusAddress,
      securityCode: station.securityCode,
      dataloggerModel: station.dataloggerModel,
      dataloggerSerialNumber: station.dataloggerSerialNumber,
      programName: station.programName,
      modemModel: station.modemModel,
      modemSerialNumber: station.modemSerialNumber,
      siteDescription: station.siteDescription,
      notes: station.notes,
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave?.(editedData);
      setIsEditing(false);
    } catch (error) {
      // Error handled by parent
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
      setShowDeleteDialog(false);
      toast({
        title: "Station Deleted",
        description: `${station.name} has been permanently deleted.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete station. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddCalibration = () => {
    const newLog: CalibrationLog = {
      id: calibrationLogs.length + 1,
      date: newCalibration.date || new Date().toISOString().split('T')[0],
      technician: newCalibration.technician || "Unknown",
      sensor: newCalibration.sensor || "Unknown",
      action: newCalibration.action || "Calibration",
      preValue: newCalibration.preValue,
      postValue: newCalibration.postValue,
      notes: newCalibration.notes,
    };
    setCalibrationLogs([newLog, ...calibrationLogs]);
    setShowAddCalibration(false);
    setNewCalibration({});
    toast({ title: "Calibration Log Added" });
  };

  const handleAddMaintenance = () => {
    const newLog: MaintenanceLog = {
      id: maintenanceLogs.length + 1,
      date: newMaintenance.date || new Date().toISOString().split('T')[0],
      type: newMaintenance.type || "Routine",
      description: newMaintenance.description || "",
      performedBy: newMaintenance.performedBy || "Unknown",
      nextScheduled: newMaintenance.nextScheduled,
    };
    setMaintenanceLogs([newLog, ...maintenanceLogs]);
    setShowAddMaintenance(false);
    setNewMaintenance({});
    toast({ title: "Maintenance Log Added" });
  };

  const exportToCSV = (data: Record<string, unknown>[], filename: string) => {
    if (data.length === 0) {
      toast({ title: "Export Failed", description: "No data to export.", variant: "destructive" });
      return;
    }
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).map(v => `"${v || ''}"`).join(',')).join('\n');
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Export Complete", description: `${filename}.csv downloaded` });
  };

  const exportToPDF = (title: string, data: Record<string, unknown>[]) => {
    if (data.length === 0) {
      toast({ title: "Export Failed", description: "No data to export.", variant: "destructive" });
      return;
    }
    // Simple PDF export using browser print
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const headers = Object.keys(data[0]);
    const tableHtml = `
      <html>
        <head>
          <title>${title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            h1 { color: #333; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f4f4f4; }
            .station-info { margin-bottom: 20px; }
            .station-info p { margin: 5px 0; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="station-info">
            <p><strong>Station:</strong> ${station.name}</p>
            <p><strong>Location:</strong> ${station.location || 'N/A'}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <table>
            <thead>
              <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${data.map(row => `<tr>${headers.map(h => `<td>${row[h] || ''}</td>`).join('')}</tr>`).join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;
    printWindow.document.write(tableHtml);
    printWindow.document.close();
    printWindow.print();
    toast({ title: "PDF Export", description: "Print dialog opened" });
  };

  if (!isAdmin) {
    return null; // Only show to admins
  }

  return (
    <section className="space-y-4 mt-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          Station Administration
          <Badge variant="secondary" className="ml-2">Admin Only</Badge>
        </h2>
        <div className="flex gap-2">
          {!isEditing ? (
            <>
              <Button variant="outline" size="sm" onClick={startEditing}>
                <Edit className="h-4 w-4 mr-2" />
                Edit Info
              </Button>
              {onDelete && (
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Station
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isSaving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </span>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Delete Station Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Delete Station
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{station.name}</strong>?
              This will permanently remove the station and all its weather data.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Station"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="info" className="w-full">
        <TabsList className="w-full flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
          <TabsTrigger value="info" className="flex-1 min-w-[100px]">
            <Info className="h-4 w-4 mr-2" />
            Station Info
          </TabsTrigger>
          <TabsTrigger value="hardware" className="flex-1 min-w-[100px]">
            <Cpu className="h-4 w-4 mr-2" />
            Hardware
          </TabsTrigger>
          <TabsTrigger value="calibration" className="flex-1 min-w-[100px]">
            <Settings className="h-4 w-4 mr-2" />
            Calibration
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="flex-1 min-w-[100px]">
            <Wrench className="h-4 w-4 mr-2" />
            Maintenance
          </TabsTrigger>
        </TabsList>

        {/* Station Info Tab */}
        <TabsContent value="info" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Location & Site Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Station Name</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.name}
                      onChange={(e) => setEditedData({ ...editedData, name: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.name}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.location}
                      onChange={(e) => setEditedData({ ...editedData, location: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.location || "Not specified"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Altitude</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      defaultValue={station.altitude}
                      onChange={(e) => setEditedData({ ...editedData, altitude: parseFloat(e.target.value) })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.altitude ? `${station.altitude} m` : "Not specified"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Latitude</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.000001"
                      defaultValue={station.latitude}
                      onChange={(e) => setEditedData({ ...editedData, latitude: parseFloat(e.target.value) })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{safeFixed(station.latitude, 6, "Not specified")}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Longitude</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.000001"
                      defaultValue={station.longitude}
                      onChange={(e) => setEditedData({ ...editedData, longitude: parseFloat(e.target.value) })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{safeFixed(station.longitude, 6, "Not specified")}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>Site Description</Label>
                {isEditing ? (
                  <Textarea
                    defaultValue={station.siteDescription}
                    rows={3}
                    onChange={(e) => setEditedData({ ...editedData, siteDescription: e.target.value })}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{station.siteDescription || "No description provided"}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                {isEditing ? (
                  <Textarea
                    defaultValue={station.notes}
                    rows={3}
                    onChange={(e) => setEditedData({ ...editedData, notes: e.target.value })}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{station.notes || "No notes"}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Hardware Tab */}
        <TabsContent value="hardware" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Datalogger & Communication
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Datalogger Model</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.dataloggerModel}
                      onChange={(e) => setEditedData({ ...editedData, dataloggerModel: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.dataloggerModel || "Not specified"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Serial Number</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.dataloggerSerialNumber}
                      onChange={(e) => setEditedData({ ...editedData, dataloggerSerialNumber: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium font-mono">{station.dataloggerSerialNumber || "Not specified"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Program Name</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.programName}
                      onChange={(e) => setEditedData({ ...editedData, programName: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium font-mono">{station.programName || "Not specified"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>PakBus Address</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      defaultValue={station.pakbusAddress}
                      onChange={(e) => setEditedData({ ...editedData, pakbusAddress: parseInt(e.target.value) })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.pakbusAddress || "1"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Security Code</Label>
                  {isEditing ? (
                    <Input
                      type="number"
                      defaultValue={station.securityCode}
                      onChange={(e) => setEditedData({ ...editedData, securityCode: parseInt(e.target.value) })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.securityCode || "0"}</p>
                  )}
                </div>
              </div>
              <Separator />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Modem Model</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.modemModel}
                      onChange={(e) => setEditedData({ ...editedData, modemModel: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium">{station.modemModel || "Not specified"}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>Modem Serial Number</Label>
                  {isEditing ? (
                    <Input
                      defaultValue={station.modemSerialNumber}
                      onChange={(e) => setEditedData({ ...editedData, modemSerialNumber: e.target.value })}
                    />
                  ) : (
                    <p className="text-sm font-medium font-mono">{station.modemSerialNumber || "Not specified"}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Calibration Tab */}
        <TabsContent value="calibration" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Calibration Schedule & Logs
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Last calibration: {station.lastCalibrationDate || "Never"} • Next due: {station.nextCalibrationDate || "Not scheduled"}
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportToCSV(calibrationLogs, `${station.name}_calibration_logs`)}>
                    <Download className="h-4 w-4 mr-2" />
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportToPDF("Calibration Logs", calibrationLogs)}>
                    <FileText className="h-4 w-4 mr-2" />
                    PDF
                  </Button>
                  <Dialog open={showAddCalibration} onOpenChange={setShowAddCalibration}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Entry
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Calibration Log</DialogTitle>
                        <DialogDescription>Record a new calibration entry</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Date</Label>
                            <Input
                              type="date"
                              defaultValue={new Date().toISOString().split('T')[0]}
                              onChange={(e) => setNewCalibration({ ...newCalibration, date: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Technician</Label>
                            <Input
                              placeholder="Name"
                              onChange={(e) => setNewCalibration({ ...newCalibration, technician: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Sensor</Label>
                          <Input
                            placeholder="e.g., Temperature (HMP60)"
                            onChange={(e) => setNewCalibration({ ...newCalibration, sensor: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Action Performed</Label>
                          <Input
                            placeholder="e.g., Two-point calibration"
                            onChange={(e) => setNewCalibration({ ...newCalibration, action: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Pre-Calibration Value</Label>
                            <Input
                              placeholder="e.g., 0.2°C offset"
                              onChange={(e) => setNewCalibration({ ...newCalibration, preValue: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Post-Calibration Value</Label>
                            <Input
                              placeholder="e.g., 0.0°C offset"
                              onChange={(e) => setNewCalibration({ ...newCalibration, postValue: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Notes</Label>
                          <Textarea
                            placeholder="Additional notes..."
                            onChange={(e) => setNewCalibration({ ...newCalibration, notes: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddCalibration(false)}>Cancel</Button>
                        <Button onClick={handleAddCalibration}>Add Entry</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Sensor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Pre-Value</TableHead>
                      <TableHead>Post-Value</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calibrationLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{log.date}</TableCell>
                        <TableCell>{log.technician}</TableCell>
                        <TableCell>{log.sensor}</TableCell>
                        <TableCell>{log.action}</TableCell>
                        <TableCell className="text-muted-foreground">{log.preValue || "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{log.postValue || "-"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{log.notes || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Maintenance Tab */}
        <TabsContent value="maintenance" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wrench className="h-4 w-4" />
                  Maintenance History
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => exportToCSV(maintenanceLogs, `${station.name}_maintenance_logs`)}>
                    <Download className="h-4 w-4 mr-2" />
                    CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportToPDF("Maintenance Logs", maintenanceLogs)}>
                    <FileText className="h-4 w-4 mr-2" />
                    PDF
                  </Button>
                  <Dialog open={showAddMaintenance} onOpenChange={setShowAddMaintenance}>
                    <DialogTrigger asChild>
                      <Button size="sm">
                        <Plus className="h-4 w-4 mr-2" />
                        Add Entry
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Maintenance Log</DialogTitle>
                        <DialogDescription>Record a new maintenance entry</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Date</Label>
                            <Input
                              type="date"
                              defaultValue={new Date().toISOString().split('T')[0]}
                              onChange={(e) => setNewMaintenance({ ...newMaintenance, date: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Type</Label>
                            <Select onValueChange={(v) => setNewMaintenance({ ...newMaintenance, type: v })}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Routine">Routine</SelectItem>
                                <SelectItem value="Battery">Battery</SelectItem>
                                <SelectItem value="Software">Software</SelectItem>
                                <SelectItem value="Hardware">Hardware</SelectItem>
                                <SelectItem value="Emergency">Emergency</SelectItem>
                                <SelectItem value="Other">Other</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label>Description</Label>
                          <Textarea
                            placeholder="Describe the maintenance performed..."
                            onChange={(e) => setNewMaintenance({ ...newMaintenance, description: e.target.value })}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label>Performed By</Label>
                            <Input
                              placeholder="Name or team"
                              onChange={(e) => setNewMaintenance({ ...newMaintenance, performedBy: e.target.value })}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Next Scheduled (optional)</Label>
                            <Input
                              type="date"
                              onChange={(e) => setNewMaintenance({ ...newMaintenance, nextScheduled: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShowAddMaintenance(false)}>Cancel</Button>
                        <Button onClick={handleAddMaintenance}>Add Entry</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Performed By</TableHead>
                      <TableHead>Next Scheduled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {maintenanceLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{log.date}</TableCell>
                        <TableCell>
                          <Badge variant={log.type === "Emergency" ? "destructive" : "secondary"}>
                            {log.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px]">{log.description}</TableCell>
                        <TableCell>{log.performedBy}</TableCell>
                        <TableCell className="text-muted-foreground">{log.nextScheduled || "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </section>
  );
}
