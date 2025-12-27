import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Terminal, 
  Plug, 
  Unplug, 
  Send, 
  Trash2, 
  RefreshCw,
  ArrowDown,
  ArrowUp,
  Info,
  AlertCircle,
  Settings2
} from "lucide-react";

interface SerialPort {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

interface SerialMessage {
  timestamp: string;
  direction: 'tx' | 'rx' | 'info' | 'error';
  data: string;
  hex?: string;
}

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const DATA_BITS = [5, 6, 7, 8];
const PARITY_OPTIONS = ['none', 'even', 'odd', 'mark', 'space'];
const STOP_BITS = [1, 1.5, 2];

export default function SerialMonitor() {
  const [ports, setPorts] = useState<SerialPort[]>([]);
  const [selectedPort, setSelectedPort] = useState<string>("");
  const [baudRate, setBaudRate] = useState<number>(115200);
  const [dataBits, setDataBits] = useState<number>(8);
  const [parity, setParity] = useState<string>("none");
  const [stopBits, setStopBits] = useState<number>(1);
  const [flowControl, setFlowControl] = useState<boolean>(false);
  
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<SerialMessage[]>([]);
  const [inputData, setInputData] = useState("");
  const [inputFormat, setInputFormat] = useState<'ascii' | 'hex'>('ascii');
  const [showHex, setShowHex] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch available ports
  const fetchPorts = useCallback(async () => {
    try {
      const response = await fetch("/api/serial-monitor/ports");
      const data = await response.json();
      setPorts(data);
    } catch (error) {
      console.error("Failed to fetch ports:", error);
    }
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/serial-monitor`);
    
    ws.onopen = () => {
      console.log("Serial monitor WebSocket connected");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'init':
          setConnected(data.connected);
          if (data.history) {
            setMessages(data.history);
          }
          break;
        case 'status':
          setConnected(data.connected);
          break;
        case 'message':
          setMessages(prev => [...prev, {
            timestamp: data.timestamp,
            direction: data.direction,
            data: data.data,
            hex: data.hex
          }]);
          break;
        case 'clear':
          setMessages([]);
          break;
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    ws.onclose = () => {
      console.log("WebSocket closed");
    };

    wsRef.current = ws;

    return () => {
      ws.close();
    };
  }, []);

  // Auto scroll
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  // Initial port fetch
  useEffect(() => {
    fetchPorts();
  }, [fetchPorts]);

  const handleConnect = async () => {
    if (!selectedPort) return;
    
    setLoading(true);
    try {
      const response = await fetch("/api/serial-monitor/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          port: selectedPort,
          baudRate,
          dataBits,
          parity,
          stopBits,
          flowControl
        })
      });
      
      const result = await response.json();
      if (!result.success) {
        console.error("Failed to connect:", result.message);
      }
    } catch (error) {
      console.error("Connect error:", error);
    }
    setLoading(false);
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await fetch("/api/serial-monitor/disconnect", { method: "POST" });
    } catch (error) {
      console.error("Disconnect error:", error);
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if (!inputData.trim() || !connected) return;
    
    try {
      await fetch("/api/serial-monitor/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: inputData,
          format: inputFormat
        })
      });
      setInputData("");
    } catch (error) {
      console.error("Send error:", error);
    }
  };

  const handleClear = async () => {
    try {
      await fetch("/api/serial-monitor/clear", { method: "POST" });
    } catch (error) {
      console.error("Clear error:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${timeStr}.${ms}`;
  };

  const getMessageIcon = (direction: string) => {
    switch (direction) {
      case 'tx': return <ArrowUp className="h-3 w-3 text-green-500" />;
      case 'rx': return <ArrowDown className="h-3 w-3 text-blue-500" />;
      case 'info': return <Info className="h-3 w-3 text-muted-foreground" />;
      case 'error': return <AlertCircle className="h-3 w-3 text-red-500" />;
      default: return null;
    }
  };

  const getMessageClass = (direction: string) => {
    switch (direction) {
      case 'tx': return 'text-green-400';
      case 'rx': return 'text-blue-400';
      case 'info': return 'text-muted-foreground italic';
      case 'error': return 'text-red-400';
      default: return '';
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Terminal className="h-8 w-8" />
            Serial Monitor
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time serial port monitor for Campbell Scientific datalogger communication
          </p>
        </div>
        <Badge variant={connected ? "default" : "secondary"} className="text-sm">
          {connected ? "Connected" : "Disconnected"}
        </Badge>
      </div>

      {/* Connection Settings */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Connection</CardTitle>
              <CardDescription>Configure serial port settings</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings2 className="h-4 w-4 mr-2" />
              {showSettings ? 'Hide' : 'Show'} Advanced
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <Label>Serial Port</Label>
              <div className="flex gap-2">
                <Select value={selectedPort} onValueChange={setSelectedPort} disabled={connected}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select port..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ports.map((port) => (
                      <SelectItem key={port.path} value={port.path}>
                        {port.path} {port.manufacturer && `(${port.manufacturer})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={fetchPorts} disabled={connected}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="w-[150px]">
              <Label>Baud Rate</Label>
              <Select value={baudRate.toString()} onValueChange={(v) => setBaudRate(parseInt(v))} disabled={connected}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BAUD_RATES.map((rate) => (
                    <SelectItem key={rate} value={rate.toString()}>{rate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end gap-2">
              {connected ? (
                <Button onClick={handleDisconnect} variant="destructive" disabled={loading}>
                  <Unplug className="h-4 w-4 mr-2" />
                  Disconnect
                </Button>
              ) : (
                <Button onClick={handleConnect} disabled={!selectedPort || loading}>
                  <Plug className="h-4 w-4 mr-2" />
                  Connect
                </Button>
              )}
            </div>
          </div>

          {showSettings && (
            <>
              <Separator />
              <div className="flex flex-wrap gap-4">
                <div className="w-[120px]">
                  <Label>Data Bits</Label>
                  <Select value={dataBits.toString()} onValueChange={(v) => setDataBits(parseInt(v))} disabled={connected}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_BITS.map((bits) => (
                        <SelectItem key={bits} value={bits.toString()}>{bits}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-[120px]">
                  <Label>Parity</Label>
                  <Select value={parity} onValueChange={setParity} disabled={connected}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PARITY_OPTIONS.map((p) => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-[120px]">
                  <Label>Stop Bits</Label>
                  <Select value={stopBits.toString()} onValueChange={(v) => setStopBits(parseFloat(v))} disabled={connected}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STOP_BITS.map((bits) => (
                        <SelectItem key={bits} value={bits.toString()}>{bits}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <Label>Flow Control (RTS/CTS)</Label>
                  <Switch checked={flowControl} onCheckedChange={setFlowControl} disabled={connected} />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Terminal Output */}
      <Card className="flex-1">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Terminal</CardTitle>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Show Hex</Label>
                <Switch checked={showHex} onCheckedChange={setShowHex} />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm">Auto-scroll</Label>
                <Switch checked={autoScroll} onCheckedChange={setAutoScroll} />
              </div>
              <Button variant="outline" size="sm" onClick={handleClear}>
                <Trash2 className="h-4 w-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea 
            className="h-[400px] rounded-md border bg-slate-950 p-4 font-mono text-sm"
            ref={scrollRef}
          >
            {messages.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">
                No data yet. Connect to a serial port to begin monitoring.
              </div>
            ) : (
              <div className="space-y-1">
                {messages.map((msg, index) => (
                  <div key={index} className="flex items-start gap-2 hover:bg-slate-900/50 px-1 rounded">
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                    <span className="w-4 flex-shrink-0">
                      {getMessageIcon(msg.direction)}
                    </span>
                    <span className={`break-all ${getMessageClass(msg.direction)}`}>
                      {showHex && msg.hex ? msg.hex : msg.data}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Input */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder={inputFormat === 'hex' ? "Enter hex data (e.g., BD 00 01 00 00)..." : "Enter data to send..."}
                value={inputData}
                onChange={(e) => setInputData(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={!connected}
                className="font-mono"
              />
            </div>
            <Select value={inputFormat} onValueChange={(v: 'ascii' | 'hex') => setInputFormat(v)}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ascii">ASCII</SelectItem>
                <SelectItem value="hex">HEX</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSend} disabled={!connected || !inputData.trim()}>
              <Send className="h-4 w-4 mr-2" />
              Send
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
