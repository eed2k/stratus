// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Calibration admin API. Mounted at `/api/calibration` and protected by
 * `isAuthenticated` + `isAdmin` from server/routes.ts.
 *
 * Used by the hidden admin page at /calibration (Calibration.tsx).
 */

import { Router, Request, Response } from "express";
import {
  ensureCalibrationCache,
  getAllCalibrationCached,
  getCalibrationCached,
  upsertCalibration,
  reloadCalibrationCache,
  type RainfallType,
} from "./calibrationCache";
import { DEFAULT_TIP_FACTOR } from "../config/stationRainfallConfig";

const router = Router();

const VALID_TYPES: RainfallType[] = [
  "auto",
  "incremental",
  "cumulative_yearly",
  "cumulative_lifetime",
  "tip_count",
];

function clampInt(n: any, min: number, max: number, fallback: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function num(n: any, fallback: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

/** GET /api/calibration → list all calibration rows. */
router.get("/", async (_req: Request, res: Response) => {
  try {
    await ensureCalibrationCache();
    res.json(getAllCalibrationCached());
  } catch (e: any) {
    res.status(500).json({ error: e.message || "load failed" });
  }
});

/** GET /api/calibration/:stationId → single row (or 404). */
router.get("/:stationId", async (req: Request, res: Response) => {
  const id = Number(req.params.stationId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid stationId" });
    return;
  }
  try {
    await ensureCalibrationCache();
    const row = getCalibrationCached(id);
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(row);
  } catch (e: any) {
    res.status(500).json({ error: e.message || "load failed" });
  }
});

/** PUT /api/calibration/:stationId → upsert. */
router.put("/:stationId", async (req: Request, res: Response) => {
  const id = Number(req.params.stationId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid stationId" });
    return;
  }
  const body = req.body ?? {};
  const rainfallType: RainfallType = VALID_TYPES.includes(body.rainfallType)
    ? body.rainfallType
    : "auto";
  try {
    const saved = await upsertCalibration(id, {
      rainfallType,
      rainfallOffset: num(body.rainfallOffset, 0),
      // 0.1 mm/tip matches DEFAULT_TIP_FACTOR, the `tip_factor` column default
      // and the client. This used to default to 0.2 while everything else used
      // 0.1, so saving the calibration form without touching this field
      // silently doubled tip_count stations.
      tipFactor: num(body.tipFactor, DEFAULT_TIP_FACTOR),
      dailyResetHour: clampInt(body.dailyResetHour, 0, 23, 0),
      scalingMultiplier: num(body.scalingMultiplier, 1),
      sourceField: body.sourceField === "" ? null : (body.sourceField ?? null),
      sourceTable: body.sourceTable === "" ? null : (body.sourceTable ?? null),
      timezoneOffsetHours: clampInt(body.timezoneOffsetHours, -12, 14, 2),
    });
    res.json(saved);
  } catch (e: any) {
    res.status(500).json({ error: e.message || "save failed" });
  }
});

/** POST /api/calibration/reload → admin-triggered cache refresh. */
router.post("/reload", async (_req: Request, res: Response) => {
  try {
    await reloadCalibrationCache();
    res.json({ ok: true, count: getAllCalibrationCached().length });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "reload failed" });
  }
});

export default router;
