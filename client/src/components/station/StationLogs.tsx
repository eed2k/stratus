import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient, authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Plus, AlertCircle, CheckCircle, Info, AlertTriangle, Wrench, RefreshCw, Settings, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { StationLog } from "@shared/schema";

interface StationLogsProps {
  stationId: number;
}

const logTypeIcons: Record<string, typeof FileText> = {
  update: RefreshCw,
  upgrade: Settings,
  error: AlertCircle,
  calibration: Wrench,
  maintenance: Wrench,
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
};

const severityColors: Record<string, string> = {
  info: "bg-blue-500/20 text-blue-400",
  warning: "bg-yellow-500/20 text-yellow-400",
  error: "bg-red-500/20 text-red-400",
  success: "bg-green-500/20 text-green-400",
};

export function StationLogs({ stationId }: StationLogsProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    logType: "info",
    severity: "info",
    title: "",
    message: "",
  });
  const { toast } = useToast();

  const { data: logs = [], isLoading } = useQuery<StationLog[]>({
    queryKey: ["/api/stations", stationId, "logs"],
    queryFn: async () => {
      const res = await authFetch(`/api/stations/${stationId}/logs`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", `/api/stations/${stationId}/logs`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/stations", stationId, "logs"] });
      setDialogOpen(false);
      setFormData({ logType: "info", severity: "info", title: "", message: "" });
      toast({ title: "Log entry created", description: "The log entry has been recorded." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create log entry.", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      toast({ title: "Validation Error", description: "Title is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-ZA", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getLogIcon = (logType: string) => {
    const IconComponent = logTypeIcons[logType] || FileText;
    return <IconComponent className="h-4 w-4" />;
  };

  return (
    <Card data-testid="card-station-logs">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg font-medium">Station Logs</CardTitle>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="button-add-log">
              <Plus className="mr-1 h-4 w-4" />
              Add Log
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Log Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="logType">Log Type</Label>
                  <Select
                    value={formData.logType}
                    onValueChange={(v) => setFormData((prev) => ({ ...prev, logType: v }))}
                  >
                    <SelectTrigger data-testid="select-log-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="update">Update</SelectItem>
                      <SelectItem value="upgrade">Upgrade</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="calibration">Calibration</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="severity">Severity</Label>
                  <Select
                    value={formData.severity}
                    onValueChange={(v) => setFormData((prev) => ({ ...prev, severity: v }))}
                  >
                    <SelectTrigger data-testid="select-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warning">Warning</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={formData.title}
                  onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Brief description of the event"
                  data-testid="input-log-title"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="message">Details (optional)</Label>
                <Textarea
                  id="message"
                  value={formData.message}
                  onChange={(e) => setFormData((prev) => ({ ...prev, message: e.target.value }))}
                  placeholder="Additional details about this log entry..."
                  className="min-h-[100px]"
                  data-testid="input-log-message"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-log">
                  {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Entry
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No log entries yet</p>
            <p className="text-xs">Add logs to track updates, maintenance, and calibrations</p>
          </div>
        ) : (
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
                  data-testid={`log-entry-${log.id}`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    <div className={`p-2 rounded-full ${severityColors[log.severity || "info"]}`}>
                      {getLogIcon(log.logType)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-foreground">{log.title}</span>
                      <Badge variant="secondary" className="text-xs">
                        {log.logType}
                      </Badge>
                    </div>
                    {log.message && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{log.message}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDate(log.createdAt?.toString() || new Date().toISOString())}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
