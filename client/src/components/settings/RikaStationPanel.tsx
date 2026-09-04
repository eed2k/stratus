// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * RikaCloud station panel for the Settings page.
 *
 * Gives an administrator everything needed to diagnose and repair a RikaCloud
 * connection from the browser: live adapter status, a step by step probe of the
 * login / farm / device / mapping / freshness chain, and an editor for the
 * account, password, farm and device pinning that verifies the credentials
 * before saving and then reconnects the station.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { authFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface ProtocolStatus {
  connected: boolean;
  lastConnected?: string;
  lastError?: string;
  isSimulation?: boolean;
}

type StepStatus = "ok" | "warn" | "fail" | "skipped";

interface RikaDiagStep {
  id: string;
  label: string;
  status: StepStatus;
  message: string;
  detail?: string;
}

interface RikaFarmOption { pk: number | null; name: string }

interface RikaPhysicalStation {
  agriId: string;
  sensorCount: number;
  latestReadingAt: string | null;
}

interface RikaDeviceOption {
  pk: number | null;
  name: string;
  agriId: string | null;
  typeCode: number | null;
  field: string | null;
  unit: string | null;
  online: boolean;
  value: number | null;
  readingAt: string | null;
}

interface RikaDiagnostics {
  ok: boolean;
  summary: string;
  checkedAt: string;
  apiBase: string;
  account: string | null;
  steps: RikaDiagStep[];
  farms: RikaFarmOption[];
  selectedFarmPk: number | null;
  devices: RikaDeviceOption[];
  physicalStations: RikaPhysicalStation[];
  mappedFields: string[];
  latestReadingAt: string | null;
  readingAgeMinutes: number | null;
}

interface DiagnoseResponse {
  stationId: number;
  stationName: string;
  adapterStatus: ProtocolStatus | null;
  diagnostics: RikaDiagnostics;
  message?: string;
}

interface RikaStationPanelProps {
  station: { id: number; name: string; connectionConfig?: any; apiEndpoint?: string | null };
  status?: ProtocolStatus;
  onStatusChanged: () => void;
}

type BusyAction = "test" | "reconnect" | "diagnose" | "save" | null;

function parseConfig(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function formatWhen(value?: string | null): string {
  if (!value) return "never";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-ZA");
}

/**
 * Step outcome shown as a short text tag rather than an icon, per the
 * no-icon policy. The color carries the same signal an icon would.
 */
const STEP_TAG: Record<StepStatus, { label: string; className: string }> = {
  ok: { label: "PASS", className: "text-green-700" },
  warn: { label: "WARN", className: "text-amber-600" },
  fail: { label: "FAIL", className: "text-red-600" },
  skipped: { label: "SKIP", className: "text-muted-foreground" },
};

function StepTag({ status }: { status: StepStatus }) {
  const tag = STEP_TAG[status];
  return (
    <span className={`text-[10px] font-semibold tracking-wide w-9 flex-shrink-0 ${tag.className}`}>
      {tag.label}
    </span>
  );
}

export function RikaStationPanel({ station, status, onStatusChanged }: RikaStationPanelProps) {
  const { toast } = useToast();
  const config = parseConfig(station.connectionConfig);

  const [busy, setBusy] = useState<BusyAction>(null);
  const [diag, setDiag] = useState<RikaDiagnostics | null>(null);
  const [editing, setEditing] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [form, setForm] = useState({
    account: String(config.rikaEmail || config.rikaAccount || ""),
    password: "",
    farmId: String(config.rikaFarmId ?? ""),
    deviceId: String(config.rikaDeviceId ?? ""),
    apiEndpoint: String(config.apiEndpoint || station.apiEndpoint || ""),
    pollInterval: String(config.pollInterval ?? ""),
  });

  const setField = <K extends keyof typeof form>(key: K, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const connected = status?.connected === true;
  const statusColor = connected ? "bg-green-500" : status?.lastError ? "bg-red-500" : "bg-gray-400";

  async function runTest() {
    setBusy("test");
    try {
      const res = await authFetch(`/api/protocols/test/${station.id}`, { method: "POST" });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        toast({ title: `${station.name}: connection OK`, description: result.message || "Connected and received data." });
      } else {
        toast({
          title: `${station.name}: connection failed`,
          description: result.message || "Could not connect.",
          variant: "destructive",
        });
      }
      onStatusChanged();
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message || "Request error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function runReconnect() {
    setBusy("reconnect");
    try {
      const res = await authFetch(`/api/protocols/reconnect/${station.id}`, { method: "POST" });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success !== false) {
        toast({
          title: `${station.name}: reconnecting`,
          description: "The session was reset and the station re-registered. Status updates shortly.",
        });
      } else {
        toast({
          title: `${station.name}: reconnect failed`,
          description: result.message || "Could not reconnect.",
          variant: "destructive",
        });
      }
      setTimeout(onStatusChanged, 3000);
    } catch (err: any) {
      toast({ title: "Reconnect failed", description: err.message || "Request error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  /** Probe the account without touching the running poller. */
  async function runDiagnostics(useFormValues = false) {
    setBusy("diagnose");
    try {
      const body: Record<string, string> = {};
      if (useFormValues) {
        if (form.account.trim()) body.rikaEmail = form.account.trim();
        if (form.password) body.rikaPassword = form.password;
        if (form.farmId.trim()) body.rikaFarmId = form.farmId.trim();
        if (form.deviceId.trim()) body.rikaDeviceId = form.deviceId.trim();
        if (form.apiEndpoint.trim()) body.apiEndpoint = form.apiEndpoint.trim();
      }
      const res = await authFetch(`/api/protocols/rika/${station.id}/diagnose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: DiagnoseResponse = await res.json();
      if (!res.ok) throw new Error((result as any)?.message || `HTTP ${res.status}`);
      setDiag(result.diagnostics);
      toast({
        title: result.diagnostics.ok ? `${station.name}: diagnostics passed` : `${station.name}: attention needed`,
        description: result.diagnostics.summary,
        variant: result.diagnostics.ok ? undefined : "destructive",
      });
    } catch (err: any) {
      toast({ title: "Diagnostics failed", description: err.message || "Request error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function saveCredentials() {
    setBusy("save");
    try {
      const res = await authFetch(`/api/protocols/rika/${station.id}/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rikaEmail: form.account.trim(),
          rikaPassword: form.password,
          rikaFarmId: form.farmId.trim(),
          rikaDeviceId: form.deviceId.trim(),
          apiEndpoint: form.apiEndpoint.trim(),
          pollInterval: form.pollInterval.trim(),
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || result.success === false) {
        if (result.diagnostics) setDiag(result.diagnostics);
        throw new Error(result.message || `HTTP ${res.status}`);
      }
      if (result.diagnostics) setDiag(result.diagnostics);
      setForm((f) => ({ ...f, password: "" }));
      setEditing(false);
      toast({ title: `${station.name}: saved`, description: result.message || "Credentials saved and reconnected." });
      setTimeout(onStatusChanged, 3000);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message || "Request error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy !== null;

  return (
    <div className="border rounded-lg p-4 space-y-3">
      {/* Identity + live status */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusColor}`} />
          <span className="font-medium">{station.name}</span>
          <Badge variant="outline" className="text-xs">RikaCloud v2</Badge>
          <Badge variant={connected ? "default" : "secondary"} className="text-xs">
            {connected ? "Connected" : status?.lastError ? "Error" : "Not connected"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={runTest} disabled={anyBusy}>
            {busy === "test" ? "Testing..." : "Test"}
          </Button>
          <Button size="sm" variant="outline" onClick={runReconnect} disabled={anyBusy}>
            {busy === "reconnect" ? "Reconnecting..." : "Reconnect"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => runDiagnostics(false)} disabled={anyBusy}>
            {busy === "diagnose" ? "Diagnosing..." : "Diagnose"}
          </Button>
          <Button size="sm" variant={editing ? "secondary" : "outline"} onClick={() => setEditing((v) => !v)} disabled={anyBusy}>
            {editing ? "Close editor" : "Credentials"}
          </Button>
        </div>
      </div>

      {/* Stored configuration */}
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>
          <span className="font-medium">Account:</span>{" "}
          {config.rikaEmail || config.rikaAccount || "not set"}
        </div>
        <div>
          <span className="font-medium">Password:</span>{" "}
          {config.rikaPassword ? "stored" : "not set"}
        </div>
        <div>
          <span className="font-medium">Poll interval:</span>{" "}
          {config.pollInterval ? `${config.pollInterval}s` : "1800s (RikaCloud default)"}
        </div>
        <div>
          <span className="font-medium">Farm:</span>{" "}
          {config.rikaFarmId ? `pk ${config.rikaFarmId}` : "auto-selected"}
        </div>
        <div>
          <span className="font-medium">Station ID:</span>{" "}
          {config.rikaDeviceId || "not pinned"}
        </div>
        <div>
          <span className="font-medium">Last connected:</span> {formatWhen(status?.lastConnected)}
        </div>
        <div className="col-span-2">
          <span className="font-medium">API endpoint:</span>{" "}
          {config.apiEndpoint || station.apiEndpoint || "https://cloud.rikacloud.com (default)"}
        </div>
        {status?.lastError && (
          <div className="col-span-2 text-red-600">
            <span className="font-medium">Last error:</span> {status.lastError}
          </div>
        )}
      </div>

      {/* Diagnostics results */}
      {diag && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <StepTag status={diag.ok ? "ok" : "fail"} />
              <span className="text-sm font-medium">{diag.summary}</span>
            </div>
            <span className="text-[11px] text-muted-foreground">Checked {formatWhen(diag.checkedAt)}</span>
          </div>

          <div className="space-y-1.5">
            {diag.steps.map((step) => (
              <div key={step.id} className="flex items-start gap-2">
                <StepTag status={step.status} />
                <div className="min-w-0">
                  <p className="text-xs">
                    <span className="font-medium">{step.label}:</span> {step.message}
                  </p>
                  {step.detail && <p className="text-[11px] text-muted-foreground break-words">{step.detail}</p>}
                </div>
              </div>
            ))}
          </div>

          {diag.mappedFields.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Mapped fields: {diag.mappedFields.join(", ")}
              {diag.readingAgeMinutes != null && ` | newest reading ${diag.readingAgeMinutes} min old`}
            </p>
          )}

          {/* Quick pickers so the user never has to guess an ID */}
          {diag.farms.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium">Farms on this account</p>
              <div className="flex flex-wrap gap-1.5">
                {diag.farms.map((farm) => (
                  <Button
                    key={String(farm.pk)}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => { setField("farmId", String(farm.pk ?? "")); setEditing(true); }}
                  >
                    {farm.name} (pk {farm.pk})
                  </Button>
                ))}
              </div>
            </div>
          )}

          {diag.physicalStations.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium">Physical stations on the selected farm</p>
              <div className="flex flex-wrap gap-1.5">
                {diag.physicalStations.map((ps) => (
                  <Button
                    key={ps.agriId}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => { setField("deviceId", ps.agriId); setEditing(true); }}
                  >
                    {ps.agriId} ({ps.sensorCount} sensors)
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Credential + pinning editor */}
      {editing && (
        <div className="rounded-md border p-3 space-y-3">
          <Separator />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`rika-account-${station.id}`} className="text-xs">RikaCloud account</Label>
              <Input
                id={`rika-account-${station.id}`}
                value={form.account}
                onChange={(e) => setField("account", e.target.value)}
                placeholder="R25021205 or the account email"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rika-password-${station.id}`} className="text-xs">Password</Label>
              <div className="relative">
                <Input
                  id={`rika-password-${station.id}`}
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setField("password", e.target.value)}
                  placeholder={config.rikaPassword ? "leave blank to keep the stored password" : "RikaCloud password"}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rika-farm-${station.id}`} className="text-xs">Farm pk (blank = first farm)</Label>
              <Input
                id={`rika-farm-${station.id}`}
                value={form.farmId}
                onChange={(e) => setField("farmId", e.target.value)}
                placeholder="e.g. 412"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rika-device-${station.id}`} className="text-xs">Station ID (agri_id, pk or name)</Label>
              <Input
                id={`rika-device-${station.id}`}
                value={form.deviceId}
                onChange={(e) => setField("deviceId", e.target.value)}
                placeholder="required when the farm has more than one station"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rika-endpoint-${station.id}`} className="text-xs">API endpoint (blank = default host)</Label>
              <Input
                id={`rika-endpoint-${station.id}`}
                value={form.apiEndpoint}
                onChange={(e) => setField("apiEndpoint", e.target.value)}
                placeholder="https://cloud.rikacloud.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`rika-poll-${station.id}`} className="text-xs">Poll interval (seconds)</Label>
              <Input
                id={`rika-poll-${station.id}`}
                value={form.pollInterval}
                onChange={(e) => setField("pollInterval", e.target.value)}
                placeholder="1800"
                inputMode="numeric"
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Saving verifies the login against RikaCloud first, so a typo cannot take a working feed offline.
            The station is reconnected immediately afterwards.
          </p>

          <div className="flex flex-wrap gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => runDiagnostics(true)} disabled={anyBusy}>
              {busy === "diagnose" ? "Testing..." : "Test these details"}
            </Button>
            <Button size="sm" onClick={saveCredentials} disabled={anyBusy || !form.account.trim()}>
              {busy === "save" ? "Saving..." : "Save and reconnect"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
