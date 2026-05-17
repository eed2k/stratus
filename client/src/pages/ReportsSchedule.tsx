// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Report Scheduling page — admin-only, accessible from the sidebar nav
 * at `/reports/schedule`.
 *
 * Lets administrators create / edit / delete recurring email reports
 * (daily / weekly / monthly) that are sent via MailerSend from
 * noreply@stratusweather.co.za. Each scheduled report now also attaches a
 * PDF generated server-side.
 *
 * This page reuses the existing `/api/reports/*` endpoints. The backing
 * middleware (`requireReportsAuth`) was updated to accept authenticated
 * admin sessions in addition to the legacy REPORTS_PASSWORD cookie.
 */

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { authFetch } from "@/lib/queryClient";

type Frequency = "daily" | "weekly" | "monthly";

interface FieldDef { key: string; label: string; unit: string; }
interface Station { id: number; name: string; location: string | null; }

interface Schedule {
  id: number;
  name: string;
  stationIds: number[];
  fields: string[];
  recipients: string[];
  frequency: Frequency;
  hour: number;
  weekday: number | null;
  dayOfMonth: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: string | null;
}

interface FormState {
  name: string;
  stationIds: number[];
  fields: string[];
  recipientsText: string;
  frequency: Frequency;
  hour: number;
  weekday: number;
  dayOfMonth: number;
  enabled: boolean;
}

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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const emptyForm = (): FormState => ({
  name: "",
  stationIds: [],
  fields: [],
  recipientsText: "",
  frequency: "weekly",
  hour: 8,
  weekday: 1,
  dayOfMonth: 1,
  enabled: true,
});

function ScheduleForm({
  initial,
  fields,
  stations,
  onCancel,
  onSaved,
  saveLabel,
  onSave,
}: {
  initial: FormState;
  fields: FieldDef[];
  stations: Station[];
  onCancel: () => void;
  onSaved: (s: Schedule) => void;
  saveLabel: string;
  onSave: (payload: any) => Promise<Schedule>;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; text: string } | null>(null);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleField(key: string) {
    set("fields", form.fields.includes(key)
      ? form.fields.filter((k) => k !== key)
      : [...form.fields, key]);
  }

  function toggleStation(id: number) {
    set("stationIds", form.stationIds.includes(id)
      ? form.stationIds.filter((s) => s !== id)
      : [...form.stationIds, id]);
  }

  function buildPayload() {
    return {
      name: form.name.trim(),
      stationIds: form.stationIds,
      fields: form.fields,
      recipients: form.recipientsText
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      frequency: form.frequency,
      hour: form.hour,
      weekday: form.frequency === "weekly" ? form.weekday : null,
      dayOfMonth: form.frequency === "monthly" ? form.dayOfMonth : null,
      enabled: form.enabled,
    };
  }

  async function save() {
    setErr(null); setBusy(true);
    try {
      const s = await onSave(buildPayload());
      onSaved(s);
    } catch (e: any) {
      setErr(e.message || "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function doPreview() {
    setErr(null); setPreviewBusy(true);
    try {
      const p = await api<{ subject: string; text: string }>(
        "/api/reports/preview",
        { method: "POST", body: JSON.stringify(buildPayload()) },
      );
      setPreview(p);
    } catch (e: any) {
      setErr(e.message || "preview failed");
    } finally {
      setPreviewBusy(false);
    }
  }

  const groups = useMemo(() => {
    const general = fields.filter((f) => !f.key.startsWith("lightning"));
    const lightning = fields.filter((f) => f.key.startsWith("lightning"));
    return { general, lightning };
  }, [fields]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{saveLabel === "Create" ? "New schedule" : "Edit schedule"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Weekly farm summary" />
          </div>
          <div className="flex items-end gap-2">
            <Checkbox
              id="enabled"
              checked={form.enabled}
              onCheckedChange={(v) => set("enabled", v === true)}
            />
            <Label htmlFor="enabled" className="cursor-pointer">Enabled (run on schedule)</Label>
          </div>
        </div>

        <Separator />

        <div>
          <Label className="text-sm font-semibold">Stations ({form.stationIds.length} selected)</Label>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-auto p-2 border rounded">
            {stations.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={form.stationIds.includes(s.id)}
                  onCheckedChange={() => toggleStation(s.id)}
                />
                <span>{s.name}</span>
                <span className="text-xs text-muted-foreground">#{s.id}</span>
              </label>
            ))}
            {stations.length === 0 && <p className="text-sm text-muted-foreground">No stations available.</p>}
          </div>
        </div>

        <div>
          <Label className="text-sm font-semibold">Data fields ({form.fields.length} selected)</Label>
          <div className="mt-2 space-y-3">
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-1">General</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                {groups.general.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.fields.includes(f.key)} onCheckedChange={() => toggleField(f.key)} />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-1">Lightning</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                {groups.lightning.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={form.fields.includes(f.key)} onCheckedChange={() => toggleField(f.key)} />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <Label htmlFor="recipients">Recipients (comma or space separated)</Label>
          <Input
            id="recipients"
            value={form.recipientsText}
            onChange={(e) => set("recipientsText", e.target.value)}
            placeholder="alice@example.com, bob@example.com"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label>Frequency</Label>
            <Select value={form.frequency} onValueChange={(v) => set("frequency", v as Frequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Hour (SAST)</Label>
            <Select value={String(form.hour)} onValueChange={(v) => set("hour", Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>{String(h).padStart(2, "0")}:00</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {form.frequency === "weekly" && (
            <div>
              <Label>Weekday</Label>
              <Select value={String(form.weekday)} onValueChange={(v) => set("weekday", Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEEKDAYS.map((d, i) => (
                    <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {form.frequency === "monthly" && (
            <div>
              <Label>Day of month (1-28)</Label>
              <Input
                type="number"
                min={1}
                max={28}
                value={form.dayOfMonth}
                onChange={(e) => set("dayOfMonth", Math.max(1, Math.min(28, Number(e.target.value) || 1)))}
              />
            </div>
          )}
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        {preview && (
          <Card className="bg-slate-50">
            <CardHeader>
              <CardTitle className="text-sm">Preview: {preview.subject}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs whitespace-pre-wrap font-mono">{preview.text}</pre>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={doPreview} disabled={previewBusy || busy}>
            {previewBusy ? "Loading..." : "Preview"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving..." : saveLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleRow({
  s,
  stations,
  onEdit,
  onChanged,
}: {
  s: Schedule;
  stations: Station[];
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const stationNames = s.stationIds
    .map((id) => stations.find((x) => x.id === id)?.name || `#${id}`)
    .join(", ");

  function freqLabel() {
    if (s.frequency === "daily") return `Daily at ${String(s.hour).padStart(2, "0")}:00`;
    if (s.frequency === "weekly") return `${WEEKDAYS[s.weekday ?? 1]} at ${String(s.hour).padStart(2, "0")}:00`;
    return `Day ${s.dayOfMonth ?? 1} of month at ${String(s.hour).padStart(2, "0")}:00`;
  }

  async function sendNow() {
    setBusy("send"); setMsg(null);
    try {
      const r = await api<{ ok: boolean; message: string }>(
        `/api/reports/schedules/${s.id}/send-now`,
        { method: "POST" },
      );
      setMsg({ type: r.ok ? "ok" : "err", text: r.message });
      onChanged();
    } catch (e: any) {
      setMsg({ type: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete schedule "${s.name}"? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await api(`/api/reports/schedules/${s.id}`, { method: "DELETE" });
      onChanged();
    } catch (e: any) {
      setMsg({ type: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  async function toggleEnabled() {
    setBusy("toggle");
    try {
      await api(`/api/reports/schedules/${s.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: s.name,
          stationIds: s.stationIds,
          fields: s.fields,
          recipients: s.recipients,
          frequency: s.frequency,
          hour: s.hour,
          weekday: s.weekday,
          dayOfMonth: s.dayOfMonth,
          enabled: !s.enabled,
        }),
      });
      onChanged();
    } catch (e: any) {
      setMsg({ type: "err", text: e.message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{s.name}</h3>
              {s.enabled
                ? <Badge variant="default">Enabled</Badge>
                : <Badge variant="secondary">Disabled</Badge>}
              <Badge variant="outline">{freqLabel()}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Stations: <span className="text-slate-700">{stationNames || "(none)"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Recipients: <span className="text-slate-700">{s.recipients.join(", ") || "(none)"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Fields: <span className="text-slate-700">{s.fields.length} selected</span>
            </p>
            {s.lastRunAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Last run: {new Date(s.lastRunAt).toLocaleString("en-ZA")} - {s.lastStatus}
              </p>
            )}
            {msg && (
              <p className={`text-xs mt-2 ${msg.type === "ok" ? "text-green-700" : "text-red-600"}`}>
                {msg.text}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={sendNow} disabled={!!busy}>
              {busy === "send" ? "Sending..." : "Send now"}
            </Button>
            <Button size="sm" variant="outline" onClick={toggleEnabled} disabled={!!busy}>
              {s.enabled ? "Disable" : "Enable"}
            </Button>
            <Button size="sm" variant="outline" onClick={onEdit} disabled={!!busy}>
              Edit
            </Button>
            <Button size="sm" variant="destructive" onClick={remove} disabled={!!busy}>
              Delete
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReportsSchedule() {
  const [stations, setStations] = useState<Station[]>([]);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  type EditMode = { type: "none" } | { type: "new" } | { type: "edit"; id: number };
  const [edit, setEdit] = useState<EditMode>({ type: "none" });

  async function reload() {
    setLoading(true); setErr(null);
    try {
      const [st, fl, sc] = await Promise.all([
        api<Station[]>("/api/reports/stations"),
        api<FieldDef[]>("/api/reports/fields"),
        api<Schedule[]>("/api/reports/schedules"),
      ]);
      setStations(st);
      setFields(fl);
      setSchedules(sc);
    } catch (e: any) {
      setErr(e.message || "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  const editing = edit.type === "edit"
    ? schedules.find((s) => s.id === edit.id) ?? null
    : null;

  const initialFor = (s: Schedule | null): FormState => s ? ({
    name: s.name,
    stationIds: s.stationIds,
    fields: s.fields,
    recipientsText: s.recipients.join(", "),
    frequency: s.frequency,
    hour: s.hour,
    weekday: s.weekday ?? 1,
    dayOfMonth: s.dayOfMonth ?? 1,
    enabled: s.enabled,
  }) : emptyForm();

  return (
    <div className="min-h-screen w-full bg-slate-50">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: '#1e3a5f', fontFamily: 'Arial, Helvetica, sans-serif' }}>
              Report Scheduling
            </h1>
            <p className="text-sm text-muted-foreground">
              Automated email reports (with PDF attachment) sent from <code>noreply@stratusweather.co.za</code>
            </p>
          </div>
        </div>

        {err && <p className="mb-4 text-sm text-red-600">{err}</p>}

        {edit.type === "new" && (
          <div className="mb-6">
            <ScheduleForm
              initial={emptyForm()}
              fields={fields}
              stations={stations}
              saveLabel="Create"
              onSave={(payload) => api<Schedule>("/api/reports/schedules", {
                method: "POST", body: JSON.stringify(payload),
              })}
              onCancel={() => setEdit({ type: "none" })}
              onSaved={() => { setEdit({ type: "none" }); reload(); }}
            />
          </div>
        )}

        {edit.type === "edit" && editing && (
          <div className="mb-6">
            <ScheduleForm
              initial={initialFor(editing)}
              fields={fields}
              stations={stations}
              saveLabel="Save changes"
              onSave={(payload) => api<Schedule>(`/api/reports/schedules/${editing.id}`, {
                method: "PUT", body: JSON.stringify(payload),
              })}
              onCancel={() => setEdit({ type: "none" })}
              onSaved={() => { setEdit({ type: "none" }); reload(); }}
            />
          </div>
        )}

        {edit.type === "none" && (
          <div className="mb-4 flex justify-end">
            <Button onClick={() => setEdit({ type: "new" })}>
              New schedule
            </Button>
          </div>
        )}

        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

        {!loading && schedules.length === 0 && edit.type === "none" && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No schedules yet. Click <strong>New schedule</strong> to create your first one.
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {schedules.map((s) => (
            <ScheduleRow
              key={s.id}
              s={s}
              stations={stations}
              onEdit={() => setEdit({ type: "edit", id: s.id })}
              onChanged={reload}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
