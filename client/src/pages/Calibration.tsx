// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Calibration page - admin-only, intentionally NOT in the sidebar nav.
 * Reachable only by URL: stratusweather.co.za/calibration
 *
 * Lets the admin tune how raw rainfall data coming from each station is
 * interpreted and corrected before it is shown on the dashboard / used
 * in summaries. Different Campbell Scientific dataloggers report rainfall
 * very differently (incremental tips, lifetime cumulative totals, yearly
 * cumulative totals, or just a tip counter), so this page lets us pick
 * the right interpretation per station and then apply an offset / scale.
 *
 * Per-station controls:
 *   1. Rainfall calculation mode  (auto / incremental / cumulative_yearly /
 *                                  cumulative_lifetime / tip_count)
 *   2. Rainfall offset (mm)       - subtracted from cumulative readings so
 *                                   today's running total starts at 0 mm
 *   3. Tip factor (mm per tip)    - only used when mode = tip_count
 *   4. Daily reset hour (0-23 SAST) - when the "today" bucket resets
 *   5. Scaling multiplier         - applied to every reading (default 1.0)
 */

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, CheckCircle2, AlertCircle } from "lucide-react";
import { authFetch } from "@/lib/queryClient";

type RainfallType = "auto" | "incremental" | "cumulative_yearly" | "cumulative_lifetime" | "tip_count";

interface Station {
  id: number;
  name: string;
  location: string | null;
}

interface Calibration {
  stationId: number;
  rainfallType: RainfallType;
  rainfallOffset: number;
  tipFactor: number;
  dailyResetHour: number;
  scalingMultiplier: number;
  sourceField: string | null;
  sourceTable: string | null;
  timezoneOffsetHours: number;
  updatedAt: string | null;
}

const DEFAULT_CAL = (stationId: number): Calibration => ({
  stationId,
  rainfallType: "auto",
  rainfallOffset: 0,
  // 0.1 mm/tip is the most common resolution for the tipping buckets we deploy
  tipFactor: 0.1,
  dailyResetHour: 0,
  scalingMultiplier: 1,
  sourceField: null,
  sourceTable: null,
  timezoneOffsetHours: 2,
  updatedAt: null,
});

// Quick presets for common rain-sensor hardware.  Selecting a preset only
// adjusts the rainfall mode + tip factor client-side; the operator can still
// fine-tune the individual fields before saving.
type SensorPreset = {
  id: string;
  label: string;
  rainfallType: RainfallType;
  tipFactor: number;
  hint: string;
};

const SENSOR_PRESETS: SensorPreset[] = [
  {
    id: "tb-0.1",
    label: "Tipping bucket - 0.1 mm/tip",
    rainfallType: "tip_count",
    tipFactor: 0.1,
    hint: "Most common - Texas / Davis / Hydrological Services style buckets.",
  },
  {
    id: "tb-0.2",
    label: "Tipping bucket - 0.2 mm/tip",
    rainfallType: "tip_count",
    tipFactor: 0.2,
    hint: "Some older Campbell / RIMCO buckets and a few SAWS sites.",
  },
  {
    id: "tb-0.5",
    label: "Tipping bucket - 0.5 mm/tip",
    rainfallType: "tip_count",
    tipFactor: 0.5,
    hint: "Coarser buckets used at remote / low-rainfall sites.",
  },
  {
    id: "optical",
    label: "Radar / optical rain gauge (mm direct)",
    rainfallType: "incremental",
    tipFactor: 0,
    hint: "Non-tipping sensors (e.g. OTT Parsivel, Lufft WS, Vaisala WXT) report mm directly per record.",
  },
  {
    id: "cum-year",
    label: "Cumulative total - resets yearly",
    rainfallType: "cumulative_yearly",
    tipFactor: 0,
    hint: "Datalogger reports an ever-growing total that wraps to 0 each new year.",
  },
  {
    id: "cum-life",
    label: "Cumulative total - never resets",
    rainfallType: "cumulative_lifetime",
    tipFactor: 0,
    hint: "Datalogger reports lifetime cumulative mm; use rainfall offset to zero today.",
  },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = (body && typeof body === "object" && "error" in body) ? (body as any).error : String(body);
    throw new Error(`${res.status}: ${msg}`);
  }
  return body as T;
}

function StationCalibrationCard({
  station,
  initial,
  onSaved,
}: {
  station: Station;
  initial: Calibration;
  onSaved: (c: Calibration) => void;
}) {
  const [cal, setCal] = useState<Calibration>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function set<K extends keyof Calibration>(k: K, v: Calibration[K]) {
    setCal((c) => ({ ...c, [k]: v }));
    setMsg(null);
  }

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const saved = await api<Calibration>(`/api/calibration/${station.id}`, {
        method: "PUT",
        body: JSON.stringify({
          rainfallType: cal.rainfallType,
          rainfallOffset: Number(cal.rainfallOffset) || 0,
          tipFactor: Number(cal.tipFactor) || 0.1,
          dailyResetHour: Math.max(0, Math.min(23, Number(cal.dailyResetHour) || 0)),
          scalingMultiplier: Number(cal.scalingMultiplier) || 1,
          sourceField: cal.sourceField || null,
          sourceTable: cal.sourceTable || null,
          timezoneOffsetHours: Number(cal.timezoneOffsetHours) || 2,
        }),
      });
      onSaved(saved);
      setCal(saved);
      setMsg({ type: "ok", text: "Saved" });
    } catch (e: any) {
      setMsg({ type: "err", text: e.message || "save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base">{station.name}</CardTitle>
            <CardDescription>
              Station #{station.id}{station.location ? ` - ${station.location}` : ""}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{cal.rainfallType}</Badge>
            {cal.updatedAt && (
              <span className="text-xs text-muted-foreground">
                updated {new Date(cal.updatedAt).toLocaleString("en-ZA")}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <Label className="text-sm font-medium">Rain sensor preset</Label>
          <Select
            value={""}
            onValueChange={(id) => {
              const p = SENSOR_PRESETS.find((x) => x.id === id);
              if (!p) return;
              setCal((c) => ({
                ...c,
                rainfallType: p.rainfallType,
                tipFactor: p.rainfallType === "tip_count" ? p.tipFactor : c.tipFactor,
              }));
              setMsg(null);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Pick a hardware preset to auto-fill mode + tip factor" />
            </SelectTrigger>
            <SelectContent>
              {SENSOR_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Most of our tipping buckets are 0.1 mm/tip (Texas, Davis, Hydrological Services style); a few legacy units are 0.2 mm/tip.
            For radar/optical gauges (OTT Parsivel, Lufft WS, Vaisala WXT, etc.) that report mm directly per record, pick the "mm direct" preset - they don't tip.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Rainfall calculation mode</Label>
            <Select
              value={cal.rainfallType}
              onValueChange={(v) => set("rainfallType", v as RainfallType)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect (recommended)</SelectItem>
                <SelectItem value="incremental">Incremental (mm per record - radar / optical)</SelectItem>
                <SelectItem value="cumulative_yearly">Cumulative - yearly reset</SelectItem>
                <SelectItem value="cumulative_lifetime">Cumulative - lifetime total</SelectItem>
                <SelectItem value="tip_count">Tip count (tipping bucket - multiply by tip factor)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              How the raw rainfall column should be interpreted.
            </p>
          </div>

          <div>
            <Label htmlFor={`offset-${station.id}`}>Rainfall offset (mm)</Label>
            <Input
              id={`offset-${station.id}`}
              type="number"
              step="0.1"
              value={cal.rainfallOffset}
              onChange={(e) => set("rainfallOffset", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Subtracted from cumulative readings so today's running total starts at 0.
            </p>
          </div>

          <div>
            <Label htmlFor={`tipfactor-${station.id}`}>Tip factor (mm per tip)</Label>
            <Input
              id={`tipfactor-${station.id}`}
              type="number"
              step="0.01"
              value={cal.tipFactor}
              onChange={(e) => set("tipFactor", Number(e.target.value))}
              disabled={cal.rainfallType !== "tip_count"}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Common resolutions: <strong>0.1 mm/tip</strong> (Texas, Davis, Hydrological Services tipping buckets - most of our fleet), 
              <strong>0.2 mm/tip</strong> (some legacy Campbell/RIMCO units and SAWS sites), 
              <strong>0.5 mm/tip</strong> (coarser units at remote/low-rainfall sites).
              Only used when mode = Tip count.
            </p>
          </div>

          <div>
            <Label htmlFor={`reset-${station.id}`}>Daily reset hour (SAST, 0-23)</Label>
            <Input
              id={`reset-${station.id}`}
              type="number"
              min={0}
              max={23}
              value={cal.dailyResetHour}
              onChange={(e) => set("dailyResetHour", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              When the "rain today" bucket should reset. 0 = midnight.
            </p>
          </div>

          <div>
            <Label htmlFor={`scale-${station.id}`}>Scaling multiplier</Label>
            <Input
              id={`scale-${station.id}`}
              type="number"
              step="0.01"
              value={cal.scalingMultiplier}
              onChange={(e) => set("scalingMultiplier", Number(e.target.value))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Multiplied with every reading (default 1.0). Use to correct under/over-reads.
            </p>
          </div>

          <div>
            <Label htmlFor={`source-${station.id}`}>Source field (optional)</Label>
            <Input
              id={`source-${station.id}`}
              type="text"
              placeholder="e.g. Rain_mm_Tot, Rain_in_Tot"
              value={cal.sourceField ?? ""}
              onChange={(e) => set("sourceField", e.target.value || null)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Override which column to read from the datalogger DAT file.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {msg && (
            <span className={`text-xs flex items-center gap-1 ${msg.type === "ok" ? "text-green-700" : "text-red-600"}`}>
              {msg.type === "ok" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {msg.text}
            </span>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {busy ? "Saving..." : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Calibration() {
  const [stations, setStations] = useState<Station[]>([]);
  const [calMap, setCalMap] = useState<Record<number, Calibration>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true); setErr(null);
    try {
      const [st, cl] = await Promise.all([
        api<Station[]>("/api/stations"),
        api<Calibration[]>("/api/calibration"),
      ]);
      setStations(st);
      const m: Record<number, Calibration> = {};
      for (const c of cl) m[c.stationId] = c;
      setCalMap(m);
    } catch (e: any) {
      setErr(e.message || "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen w-full bg-slate-50">
      <div className="mx-auto max-w-5xl p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1e3a5f', fontFamily: 'Arial, Helvetica, sans-serif' }}>
            Calibration
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tune how raw rainfall data from each weather station is interpreted and corrected.
          </p>
        </div>

        {err && (
          <Card className="border-red-300 bg-red-50">
            <CardContent className="py-4 text-sm text-red-700">{err}</CardContent>
          </Card>
        )}

        {loading ? (
          <Card>
            <CardContent className="py-10 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : stations.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No stations available.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {stations.map((s) => (
              <StationCalibrationCard
                key={s.id}
                station={s}
                initial={calMap[s.id] ?? DEFAULT_CAL(s.id)}
                onSaved={(c) => setCalMap((m) => ({ ...m, [s.id]: c }))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
