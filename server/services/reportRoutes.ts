// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Routes for the password-protected /reports portal.
 *
 * Auth model: a single shared password (env REPORTS_PASSWORD). On successful
 * POST /api/reports/auth we set an HTTP-only cookie `stratus_reports` whose
 * value is an HMAC of the password+expiry. requireReportsAuth verifies this
 * cookie. No interaction with the main user/admin auth.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import * as crypto from 'crypto';
import * as pg from '../db-postgres';
import {
  REPORT_FIELDS,
  getAllSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  runScheduleNow,
  buildReportBody,
  buildDemoLightningReport,
  type CreateScheduleInput,
  type ReportSchedule,
} from './reportSchedulerService';
import { sendEmail } from './emailService';
import { buildSchedulePdfBuffer } from './pdfReportService';

const router = Router();

const COOKIE_NAME  = 'stratus_reports';
const COOKIE_MAX_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days

function getReportsPassword(): string | null {
  const p = process.env.REPORTS_PASSWORD;
  return p && p.length > 0 ? p : null;
}

function getSecret(): string {
  // Reuse SESSION_SECRET if set, else derive from password — guarantees
  // tokens are invalidated whenever the password changes.
  return process.env.REPORTS_COOKIE_SECRET
      || process.env.SESSION_SECRET
      || `stratus-reports::${getReportsPassword() || 'unset'}`;
}

function signToken(expiryMs: number): string {
  const h = crypto.createHmac('sha256', getSecret()).update(String(expiryMs)).digest('hex');
  return `${expiryMs}.${h}`;
}

function verifyToken(token: string): boolean {
  if (!token || !token.includes('.')) return false;
  const [expStr, sig] = token.split('.', 2);
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = crypto.createHmac('sha256', getSecret()).update(String(exp)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setReportsCookie(res: Response, expiryMs: number): void {
  const token = signToken(expiryMs);
  // SameSite=Lax + HttpOnly; secure when not on plain HTTP (Traefik terminates TLS)
  const secure = (process.env.NODE_ENV || 'production') === 'production';
  const maxAgeSec = Math.floor((expiryMs - Date.now()) / 1000);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${maxAgeSec}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearReportsCookie(res: Response): void {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`);
}

export function requireReportsAuth(req: Request, res: Response, next: NextFunction): void {
  // Allow authenticated admin sessions to bypass the portal password.
  // Admin pages (Report Generation, Report Scheduling) under the main
  // sidebar nav rely on this so they can reuse the existing endpoints
  // without forcing admins to log in twice.
  const sessionUser = (req as any).user;
  if (sessionUser && sessionUser.isAuthenticated && sessionUser.role === 'admin') {
    next();
    return;
  }
  if (!getReportsPassword()) {
    res.status(503).json({ error: 'reports portal not configured (REPORTS_PASSWORD env var unset)' });
    return;
  }
  const cookies = parseCookies(req.headers.cookie);
  const tok = cookies[COOKIE_NAME];
  if (!tok || !verifyToken(tok)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

// ── Public: status + login + logout ──────────────────────────────────────────

/** Returns whether the portal is configured + whether the caller is authed. */
router.get('/auth', (req, res) => {
  const configured = !!getReportsPassword();
  // Admin sessions are always treated as authed.
  const sessionUser = (req as any).user;
  if (sessionUser && sessionUser.isAuthenticated && sessionUser.role === 'admin') {
    res.json({ configured, authed: true });
    return;
  }
  let authed = false;
  if (configured) {
    const cookies = parseCookies(req.headers.cookie);
    const tok = cookies[COOKIE_NAME];
    authed = !!tok && verifyToken(tok);
  }
  res.json({ configured, authed });
});

router.post('/auth', (req, res) => {
  const expected = getReportsPassword();
  if (!expected) {
    res.status(503).json({ error: 'reports portal not configured' });
    return;
  }
  const submitted = String((req.body && req.body.password) || '');
  // Constant-time compare
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    // Mild rate-limit via 401
    res.status(401).json({ error: 'invalid password' });
    return;
  }
  const exp = Date.now() + COOKIE_MAX_AGE_MS;
  setReportsCookie(res, exp);
  res.json({ ok: true, expiresAt: exp });
});

router.post('/logout', (_req, res) => {
  clearReportsCookie(res);
  res.json({ ok: true });
});

// ── Authed below ─────────────────────────────────────────────────────────────

router.use(requireReportsAuth);

router.get('/fields', (_req, res) => {
  res.json(REPORT_FIELDS);
});

router.get('/stations', async (_req, res) => {
  try {
    const r = await pg.query(`SELECT id, name, location FROM stations WHERE is_active = true ORDER BY id`);
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

function serialize(s: ReportSchedule) {
  return {
    id: s.id,
    name: s.name,
    stationIds: s.stationIds,
    fields: s.fields,
    recipients: s.recipients,
    frequency: s.frequency,
    hour: s.hour,
    weekday: s.weekday,
    dayOfMonth: s.dayOfMonth,
    enabled: s.enabled,
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastStatus: s.lastStatus,
  };
}

function validateInput(body: any): { ok: true; value: CreateScheduleInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid body' };
  const name = String(body.name || '').trim();
  if (!name) return { ok: false, error: 'name is required' };
  const stationIds = Array.isArray(body.stationIds)
    ? body.stationIds.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)
    : [];
  if (!stationIds.length) return { ok: false, error: 'at least one station is required' };
  const validKeys: Set<string> = new Set(REPORT_FIELDS.map(f => f.key));
  const fields = Array.isArray(body.fields)
    ? body.fields.filter((k: any) => typeof k === 'string' && validKeys.has(k))
    : [];
  if (!fields.length) return { ok: false, error: 'at least one field is required' };
  const recipients = Array.isArray(body.recipients)
    ? body.recipients.map((s: any) => String(s).trim()).filter((s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    : [];
  if (!recipients.length) return { ok: false, error: 'at least one valid recipient email is required' };
  const frequency = body.frequency;
  if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') {
    return { ok: false, error: 'frequency must be daily, weekly, or monthly' };
  }
  const hour = Number.isInteger(body.hour) ? body.hour : 8;
  if (hour < 0 || hour > 23) return { ok: false, error: 'hour must be 0..23' };
  const weekday = body.weekday == null ? null : Number(body.weekday);
  if (weekday != null && (weekday < 0 || weekday > 6)) return { ok: false, error: 'weekday must be 0..6' };
  const dayOfMonth = body.dayOfMonth == null ? null : Number(body.dayOfMonth);
  if (dayOfMonth != null && (dayOfMonth < 1 || dayOfMonth > 28)) return { ok: false, error: 'dayOfMonth must be 1..28' };
  return {
    ok: true,
    value: {
      name, stationIds, fields, recipients, frequency,
      hour, weekday, dayOfMonth,
      enabled: body.enabled !== false,
    },
  };
}

router.get('/schedules', async (_req, res) => {
  try {
    const all = await getAllSchedules();
    res.json(all.map(serialize));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schedules', async (req, res) => {
  const v = validateInput(req.body);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  try {
    const s = await createSchedule(v.value);
    res.status(201).json(serialize(s));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/schedules/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  const v = validateInput(req.body);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  try {
    const s = await updateSchedule(id, v.value);
    if (!s) { res.status(404).json({ error: 'not found' }); return; }
    res.json(serialize(s));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/schedules/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  try {
    await deleteSchedule(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/schedules/:id/send-now', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'invalid id' }); return; }
  try {
    const result = await runScheduleNow(id);
    if (!result.ok) { res.status(500).json(result); return; }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Render plain-text body without sending — for "Preview" button. */
router.post('/preview', async (req, res) => {
  const v = validateInput(req.body);
  if (!v.ok) { res.status(400).json({ error: v.error }); return; }
  try {
    const dummy: ReportSchedule = {
      id: 0,
      name: v.value.name,
      stationIds: v.value.stationIds,
      fields: v.value.fields,
      recipients: v.value.recipients,
      frequency: v.value.frequency,
      hour: v.value.hour,
      weekday: v.value.weekday ?? null,
      dayOfMonth: v.value.dayOfMonth ?? null,
      enabled: true,
      lastRunAt: null,
      lastStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { subject, text } = await buildReportBody(dummy);
    res.json({ subject, text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Send a synthetic lightning demo report to the supplied recipients.
 * No real station data is read. Useful for showing prospective users
 * what the email looks like, or for sender deliverability tests.
 */
router.post('/send-demo', async (req, res) => {
  const recipients = Array.isArray(req.body?.recipients)
    ? req.body.recipients.map((s: any) => String(s).trim())
        .filter((s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    : [];
  if (!recipients.length) {
    res.status(400).json({ error: 'at least one valid recipient email is required' });
    return;
  }
  try {
    const { subject, text, html } = buildDemoLightningReport();
    const ok = await sendEmail({ to: recipients, subject, text, html });
    if (!ok) { res.status(500).json({ ok: false, error: 'email send failed (see server logs)' }); return; }
    res.json({ ok: true, message: `demo report sent to ${recipients.length} recipient(s)`, subject });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * Render a PDF report on-demand. Protected by requireReportsAuth (admins
 * bypass automatically via the early-return in that middleware).
 *
 * Query params:
 *   stationId / stationIds — single id or comma list (required)
 *   from / to               — ISO timestamps (optional, default last 24h)
 *   fields                  — comma-separated REPORT_FIELDS keys (optional → all)
 *   title                   — optional cover-page title
 */
router.get('/pdf', async (req, res) => {
  try {
    const raw = String(req.query.stationIds || req.query.stationId || '').trim();
    const stationIds = raw.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (!stationIds.length) { res.status(400).json({ error: 'stationId(s) required' }); return; }

    const now = Date.now();
    const toMs = req.query.to ? Date.parse(String(req.query.to)) : now;
    const fromMs = req.query.from ? Date.parse(String(req.query.from)) : (toMs - 24 * 3600 * 1000);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) {
      res.status(400).json({ error: 'invalid from/to' }); return;
    }

    const validKeys = new Set<string>(REPORT_FIELDS.map((f) => f.key));
    const fields = String(req.query.fields || '').split(',')
      .map((s) => s.trim()).filter((k) => k && validKeys.has(k));

    const title = String(req.query.title || 'Stratus Weather Report');

    const buf = await buildSchedulePdfBuffer({
      stationIds, startMs: fromMs, endMs: toMs, fields, title,
    });
    const filename = `stratus-report-${new Date(toMs).toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  } catch (err: any) {
    console.error('[reports/pdf]', err);
    res.status(500).json({ error: err?.message || 'pdf render failed' });
  }
});

export default router;
