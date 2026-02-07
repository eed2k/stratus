import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Cable,
  PlugZap,
  Unplug,
  Send,
  Trash2,
  Download,
  RefreshCw,
  Loader2,
  Terminal,
  Settings,
} from "lucide-react";

// ============================================================
// Type declarations for the desktop API
// ============================================================
interface SerialPortInfo {
  path: string;
  manufacturer: string;
  vendorId: string;
  productId: string;
  serialNumber: string;
  pnpId: string;
}

interface SerialDataEvent {
  timestamp: string;
  data: string;
  port: string;
}

interface DesktopAPI {
  isDesktop: boolean;
  serial: {
    listPorts: () => Promise<SerialPortInfo[]>;
    connect: (portPath: string, options: Record<string, unknown>) => Promise<{ success: boolean; port: string }>;
    disconnect: () => Promise<boolean>;
    send: (data: string) => Promise<boolean>;
    isConnected: () => Promise<boolean>;
    onData: (callback: (data: SerialDataEvent) => void) => () => void;
    onError: (callback: (error: { message: string; port: string }) => void) => () => void;
    onDisconnected: (callback: (info: { port: string }) => void) => () => void;
    onPortsUpdated: (callback: (ports: SerialPortInfo[]) => void) => () => void;
  };
}

// Check if running in desktop mode
const isDesktop = !!(window as any).stratusDesktop?.isDesktop;
const desktopApi: DesktopAPI | null = isDesktop ? (window as any).stratusDesktop : null;

// ============================================================
// Baud rate options for RS232/Serial
// ============================================================
const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const DATA_BITS = [5, 6, 7, 8];
const STOP_BITS = [1, 1.5, 2];
const PARITY_OPTIONS = ["none", "even", "odd", "mark", "space"];

// ============================================================
// Common Campbell Scientific commands
// ============================================================
const QUICK_COMMANDS = [
  { label: "Status", cmd: "*0S", desc: "Request station status" },
  { label: "Data", cmd: "*0D", desc: "Request current data" },
  { label: "ID", cmd: "*0I", desc: "Request logger ID" },
  { label: "Clock", cmd: "*0C", desc: "Request logger clock" },
  { label: "Hello", cmd: "\r", desc: "Send carriage return" },
  { label: "Storage", cmd: "*0W", desc: "Request storage info" },
];

// ============================================================
// Serial Monitor Component
// ============================================================
export default function SerialMonitor() {
  const { toast } = useToast();

  // Port state
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Connection settings
  const [baudRate, setBaudRate] = useState("9600");
  const [dataBits, setDataBits] = useState("8");
  const [stopBits, setStopBits] = useState("1");
  const [parity, setParity] = useState("none");
  const [showSettings, setShowSettings] = useState(false);

  // Serial data
  const [serialLog, setSerialLog] = useState<Array<{ time: string; data: string; type: "rx" | "tx" }>>([]);
  const [sendInput, setSendInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [addCRLF, setAddCRLF] = useState(true);
  const [timestampEnabled, setTimestampEnabled] = useState(true);

  const logEndRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // Auto-scroll
  // ============================================================
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [serialLog, autoScroll]);

  // ============================================================
  // List serial ports
  // ============================================================
  const refreshPorts = useCallback(async () => {
    if (!desktopApi) return;
    try {
      const portList = await desktopApi.serial.listPorts();
      setPorts(portList);
      if (portList.length > 0 && !selectedPort) {
        setSelectedPort(portList[0].path);
      }
    } catch (err) {
      toast({
        title: "Port Scan Failed",
        description: "Could not enumerate serial ports",
        variant: "destructive",
      });
    }
  }, [selectedPort, toast]);

  // Initial port scan
  useEffect(() => {
    refreshPorts();
  }, []);

  // ============================================================
  // Subscribe to serial events
  // ============================================================
  useEffect(() => {
    if (!desktopApi) return;

    const unsubData = desktopApi.serial.onData((event) => {
      const time = timestampEnabled
        ? new Date(event.timestamp).toLocaleTimeString("en-ZA", { hour12: false } as Intl.DateTimeFormatOptions)
        : "";
      setSerialLog((prev) => [...prev, { time, data: event.data, type: "rx" }]);
    });

    const unsubError = desktopApi.serial.onError((error) => {
      toast({
        title: "Serial Error",
        description: error.message,
        variant: "destructive",
      });
    });

    const unsubDisconnected = desktopApi.serial.onDisconnected((info) => {
      setIsConnected(false);
      toast({
        title: "Disconnected",
        description: `Serial port ${info.port} disconnected`,
      });
    });

    const unsubPorts = desktopApi.serial.onPortsUpdated((updatedPorts) => {
      setPorts(updatedPorts);
    });

    return () => {
      unsubData();
      unsubError();
      unsubDisconnected();
      unsubPorts();
    };
  }, [timestampEnabled, toast]);

  // ============================================================
  // Connect / Disconnect
  // ============================================================
  const handleConnect = async () => {
    if (!desktopApi || !selectedPort) return;
    setIsConnecting(true);
    try {
      await desktopApi.serial.connect(selectedPort, {
        baudRate: parseInt(baudRate),
        dataBits: parseInt(dataBits),
        stopBits: parseFloat(stopBits),
        parity,
      });
      setIsConnected(true);
      setSerialLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString("en-ZA", { hour12: false }),
          data: `Connected to ${selectedPort} at ${baudRate} baud`,
          type: "tx",
        },
      ]);
      toast({
        title: "Connected",
        description: `Serial port ${selectedPort} opened at ${baudRate} baud`,
      });
    } catch (err: any) {
      toast({
        title: "Connection Failed",
        description: err.message || "Failed to open serial port",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!desktopApi) return;
    try {
      await desktopApi.serial.disconnect();
      setIsConnected(false);
      setSerialLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString("en-ZA", { hour12: false }),
          data: `Disconnected from ${selectedPort}`,
          type: "tx",
        },
      ]);
    } catch (err: any) {
      toast({
        title: "Disconnect Error",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // ============================================================
  // Send data
  // ============================================================
  const handleSend = async (data?: string) => {
    if (!desktopApi || !isConnected) return;
    const toSend = data || sendInput;
    if (!toSend) return;
    
    try {
      const payload = addCRLF ? toSend : toSend;
      await desktopApi.serial.send(payload);
      setSerialLog((prev) => [
        ...prev,
        {
          time: new Date().toLocaleTimeString("en-ZA", { hour12: false }),
          data: toSend,
          type: "tx",
        },
      ]);
      if (!data) setSendInput("");
    } catch (err: any) {
      toast({
        title: "Send Failed",
        description: err.message,
        variant: "destructive",
      });
    }
  };

  // ============================================================
  // Export log
  // ============================================================
  const handleExportLog = () => {
    const content = serialLog
      .map((entry) => `${entry.time ? `[${entry.time}] ` : ""}${entry.type === "tx" ? "TX" : "RX"}: ${entry.data}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stratus-serial-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============================================================
  // Not available in browser
  // ============================================================
  if (!isDesktop) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Cable className="h-16 w-16 text-muted-foreground mb-6" />
          <h1 className="text-2xl font-bold mb-2">Serial Monitor</h1>
          <p className="text-muted-foreground max-w-md mb-6">
            The Serial Monitor is only available in the Stratus Desktop application. 
            It provides direct RS232/USB connections to Campbell Scientific data loggers 
            and other serial devices.
          </p>
          <div className="bg-muted rounded-lg p-4 text-sm text-left max-w-md space-y-2">
            <p className="font-medium">Desktop Edition Features:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>RS232 &amp; USB serial port connections</li>
              <li>Real-time data logger monitoring</li>
              <li>Campbell Scientific PakBus commands</li>
              <li>Data logging to file</li>
              <li>Multiple baud rate support</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // Desktop Serial Monitor UI
  // ============================================================
  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Terminal className="h-6 w-6" /> Serial Monitor
          </h1>
          <p className="text-muted-foreground text-sm">
            RS232/USB serial port connection for data loggers
          </p>
        </div>
        <Badge
          variant={isConnected ? "default" : "secondary"}
          className={isConnected ? "bg-green-600" : ""}
        >
          {isConnected ? (
            <>
              <PlugZap className="h-3 w-3 mr-1" /> Connected
            </>
          ) : (
            <>
              <Unplug className="h-3 w-3 mr-1" /> Disconnected
            </>
          )}
        </Badge>
      </div>

      {/* Connection Panel */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Cable className="h-4 w-4" /> Connection
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)}>
              <Settings className="h-4 w-4 mr-1" /> {showSettings ? "Hide" : "Advanced"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Port selector */}
            <div className="flex-1">
              <Label className="text-xs mb-1.5 block">Port</Label>
              <div className="flex gap-2">
                <Select value={selectedPort} onValueChange={setSelectedPort} disabled={isConnected}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select port..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ports.length === 0 ? (
                      <SelectItem value="_none" disabled>No ports detected</SelectItem>
                    ) : (
                      ports.map((port) => (
                        <SelectItem key={port.path} value={port.path}>
                          {port.path} — {port.manufacturer}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={refreshPorts} disabled={isConnected}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Baud rate */}
            <div className="w-32">
              <Label className="text-xs mb-1.5 block">Baud Rate</Label>
              <Select value={baudRate} onValueChange={setBaudRate} disabled={isConnected}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BAUD_RATES.map((rate) => (
                    <SelectItem key={rate} value={String(rate)}>{rate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Connect/Disconnect */}
            <div className="flex items-end">
              {isConnected ? (
                <Button variant="destructive" onClick={handleDisconnect}>
                  <Unplug className="h-4 w-4 mr-2" /> Disconnect
                </Button>
              ) : (
                <Button onClick={handleConnect} disabled={!selectedPort || isConnecting}>
                  {isConnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <PlugZap className="h-4 w-4 mr-2" />
                  )}
                  Connect
                </Button>
              )}
            </div>
          </div>

          {/* Advanced Settings */}
          {showSettings && (
            <div className="flex flex-wrap gap-4 pt-2 border-t">
              <div className="w-24">
                <Label className="text-xs mb-1.5 block">Data Bits</Label>
                <Select value={dataBits} onValueChange={setDataBits} disabled={isConnected}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DATA_BITS.map((bits) => (
                      <SelectItem key={bits} value={String(bits)}>{bits}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-24">
                <Label className="text-xs mb-1.5 block">Stop Bits</Label>
                <Select value={stopBits} onValueChange={setStopBits} disabled={isConnected}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STOP_BITS.map((bits) => (
                      <SelectItem key={bits} value={String(bits)}>{bits}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <Label className="text-xs mb-1.5 block">Parity</Label>
                <Select value={parity} onValueChange={setParity} disabled={isConnected}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PARITY_OPTIONS.map((p) => (
                      <SelectItem key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Commands */}
      {isConnected && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Quick Commands</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {QUICK_COMMANDS.map((cmd) => (
                <Button
                  key={cmd.label}
                  variant="outline"
                  size="sm"
                  onClick={() => handleSend(cmd.cmd)}
                  title={cmd.desc}
                >
                  {cmd.label}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Serial Output */}
      <Card className="flex flex-col" style={{ height: "calc(100vh - 450px)", minHeight: "300px" }}>
        <CardHeader className="pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Terminal className="h-4 w-4" /> Output
              <Badge variant="secondary" className="text-xs">{serialLog.length} lines</Badge>
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Switch checked={autoScroll} onCheckedChange={setAutoScroll} id="autoscroll" />
                <Label htmlFor="autoscroll" className="text-xs">Auto-scroll</Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={timestampEnabled} onCheckedChange={setTimestampEnabled} id="timestamps" />
                <Label htmlFor="timestamps" className="text-xs">Timestamps</Label>
              </div>
              <Button variant="ghost" size="sm" onClick={handleExportLog} disabled={serialLog.length === 0}>
                <Download className="h-4 w-4 mr-1" /> Export
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSerialLog([])}>
                <Trash2 className="h-4 w-4 mr-1" /> Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden pb-2">
          <div
            className="h-full overflow-y-auto bg-slate-950 rounded-md p-3 font-mono text-xs leading-relaxed"
            style={{ scrollBehavior: autoScroll ? "smooth" : "auto" }}
          >
            {serialLog.length === 0 ? (
              <div className="text-slate-500 text-center py-8">
                {isConnected
                  ? "Waiting for data..."
                  : "Connect to a serial port to begin monitoring"}
              </div>
            ) : (
              serialLog.map((entry, idx) => (
                <div
                  key={idx}
                  className={`py-0.5 ${entry.type === "tx" ? "text-green-400" : "text-slate-300"}`}
                >
                  {entry.time && <span className="text-slate-600 mr-2">[{entry.time}]</span>}
                  <span className={`mr-2 ${entry.type === "tx" ? "text-green-600" : "text-blue-500"}`}>
                    {entry.type === "tx" ? "TX ›" : "RX ‹"}
                  </span>
                  {entry.data}
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </CardContent>
      </Card>

      {/* Send Input */}
      <div className="flex gap-2">
        <Input
          value={sendInput}
          onChange={(e) => setSendInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={isConnected ? "Type command and press Enter..." : "Connect to a port first"}
          disabled={!isConnected}
          className="font-mono"
        />
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Switch checked={addCRLF} onCheckedChange={setAddCRLF} id="crlf" />
          <Label htmlFor="crlf" className="text-xs whitespace-nowrap">CR/LF</Label>
        </div>
        <Button onClick={() => handleSend()} disabled={!isConnected || !sendInput}>
          <Send className="h-4 w-4 mr-2" /> Send
        </Button>
      </div>
    </div>
  );
}
