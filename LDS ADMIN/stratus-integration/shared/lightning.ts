// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * AS3935 Franklin lightning sensor interpretation helpers.
 *
 * Two things about this sensor are easy to get wrong, and both matter for how
 * the data is presented:
 *
 * 1. The "energy" figure is not energy. It is a 20 bit number the chip
 *    calculates internally while estimating distance, assembled from register
 *    0x04 (LSB), 0x05 (MSB) and the low nibble of 0x06 (MMSB). The datasheet is
 *    explicit that it carries no physical meaning and has no unit, so showing a
 *    bare number like "218" to a user tells them nothing. What it is genuinely
 *    useful for is comparison: between strikes in the same storm, and against
 *    the distance reported at the same moment. This module therefore converts
 *    it to a logarithmic 0 to 100 relative scale with named bands, and offers a
 *    distance-adjusted comparison figure, both clearly labelled as relative.
 *
 * 2. The distance figure is the estimated distance to the leading edge of the
 *    storm, not to the individual strike, and it is quantised into fifteen
 *    fixed bins between 5 km and 40 km (plus "overhead" and "out of range").
 *    Presenting it with decimals implies precision the sensor does not have.
 *
 * Reference: ams/ScioSense AS3935 datasheet. The "no physical meaning" wording
 * for the energy register is also carried in the ESPHome AS3935 component docs
 * (https://esphome.io/components/sensor/as3935/). Content was rephrased for
 * compliance with licensing restrictions.
 */

/** Widest value the 20 bit energy register can hold. */
export const AS3935_MAX_ENERGY = 0xfffff; // 1048575

/** Register value the sensor uses to mean "storm is out of range". */
export const AS3935_DISTANCE_OUT_OF_RANGE = 63;

/** Register value the sensor uses to mean "storm is overhead". */
export const AS3935_DISTANCE_OVERHEAD = 1;

/**
 * The distance estimates the AS3935 can actually report, in km. Anything the
 * logger sends is one of these, so it is worth snapping to the nearest bin
 * rather than implying a continuous measurement.
 */
export const AS3935_DISTANCE_BINS = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40] as const;

export type LightningIntensityBand = "none" | "veryWeak" | "weak" | "moderate" | "strong" | "veryStrong";

export interface LightningIntensity {
  /** The raw register value as received. */
  raw: number | null;
  /** True when the value is a usable reading. */
  valid: boolean;
  /** Logarithmic 0 to 100 scale across the register's full range. */
  relative: number;
  band: LightningIntensityBand;
  /** Short label for a card or chart legend. */
  label: string;
  /** Tailwind text colour class. */
  colorClass: string;
  /** Hex colour for charts. */
  color: string;
  /** One line explanation suitable for a tooltip. */
  description: string;
}

/**
 * Intensity band palette.
 *
 * House style excludes violet/purple and pale washed-out blues, so the weakest
 * bands use saturated dark cyan and a mid blue rather than sky tints. The ramp
 * runs dark cyan → blue → yellow → orange → red and must stay readable when a
 * report is printed, so every step is dark enough to hold on white paper.
 * Thresholds, labels and descriptions are unchanged.
 */
const BANDS: Array<{
  band: LightningIntensityBand;
  min: number;
  label: string;
  colorClass: string;
  color: string;
  description: string;
}> = [
  {
    band: "veryWeak", min: 0, label: "Very weak",
    colorClass: "text-cyan-700", color: "#0891b2",
    description: "Faint signal, typically a distant discharge or a marginal detection.",
  },
  {
    band: "weak", min: 1_000, label: "Weak",
    colorClass: "text-blue-600", color: "#2563eb",
    description: "Low relative strength for this sensor, usually a far storm.",
  },
  {
    band: "moderate", min: 10_000, label: "Moderate",
    colorClass: "text-yellow-600", color: "#eab308",
    description: "Mid-range discharge, the most common reading during an active storm.",
  },
  {
    band: "strong", min: 100_000, label: "Strong",
    colorClass: "text-orange-500", color: "#f97316",
    description: "High relative strength, either a powerful strike or a close one.",
  },
  {
    band: "veryStrong", min: 400_000, label: "Very strong",
    colorClass: "text-red-600", color: "#dc2626",
    description: "Near the top of the sensor's range. Expect a close, powerful discharge.",
  },
];

const NO_READING: LightningIntensity = {
  raw: null,
  valid: false,
  relative: 0,
  band: "none",
  label: "No reading",
  colorClass: "text-black",
  color: "#94a3b8",
  description: "No lightning intensity has been reported.",
};

/**
 * Turn the raw AS3935 energy register into something a person can act on.
 *
 * The scale is logarithmic because the register spans six orders of magnitude
 * and a linear scale would leave almost every real reading pinned near zero.
 */
export function interpretLightningIntensity(raw: number | null | undefined): LightningIntensity {
  if (raw === null || raw === undefined || !Number.isFinite(Number(raw))) return NO_READING;
  const value = Number(raw);
  if (value <= 0) {
    return { ...NO_READING, raw: value, description: "Sensor reported zero intensity, so there was no valid discharge." };
  }

  const clamped = Math.min(value, AS3935_MAX_ENERGY);
  const relative = Math.round((Math.log10(1 + clamped) / Math.log10(1 + AS3935_MAX_ENERGY)) * 1000) / 10;

  let match = BANDS[0];
  for (const band of BANDS) {
    if (clamped >= band.min) match = band;
  }

  return {
    raw: value,
    valid: true,
    relative,
    band: match.band,
    label: match.label,
    colorClass: match.colorClass,
    color: match.color,
    description: match.description,
  };
}

/** All bands, for building a chart legend or a distribution histogram. */
export function lightningIntensityBands() {
  return BANDS.map((b) => ({ band: b.band, label: b.label, min: b.min, color: b.color }));
}

export interface StrikeStrength {
  /** Relative 0 to 100 figure after adjusting for reported distance. */
  adjusted: number | null;
  /** Multiplier applied because of distance. 1 at the 10 km reference. */
  distanceFactor: number | null;
  note: string;
}

/**
 * Compare discharges recorded at different distances.
 *
 * The signal a magnetic loop antenna sees falls off with range, so a weak
 * reading from 35 km away can represent a far bigger discharge than a strong
 * reading from 5 km. Scaling the raw figure by the square of the distance
 * (relative to a 10 km reference) makes strikes in a storm roughly comparable.
 *
 * This is a comparison aid only: the underlying register has no unit, so the
 * result must never be presented as an absolute measurement.
 */
export function estimateRelativeStrikeStrength(
  raw: number | null | undefined,
  distanceKm: number | null | undefined,
): StrikeStrength {
  const intensity = interpretLightningIntensity(raw);
  if (!intensity.valid) {
    return { adjusted: null, distanceFactor: null, note: "Needs a valid intensity reading." };
  }
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(Number(distanceKm)) || Number(distanceKm) <= 0) {
    return {
      adjusted: intensity.relative,
      distanceFactor: null,
      note: "No distance reported, so the figure is not distance-adjusted.",
    };
  }
  const km = Math.min(Number(distanceKm), 40);
  const factor = Math.pow(km / 10, 2);
  const adjustedRaw = Math.min((intensity.raw as number) * factor, AS3935_MAX_ENERGY);
  const adjusted = Math.round((Math.log10(1 + adjustedRaw) / Math.log10(1 + AS3935_MAX_ENERGY)) * 1000) / 10;
  return {
    adjusted,
    distanceFactor: Math.round(factor * 100) / 100,
    note: "Relative comparison only, scaled to a 10 km reference distance.",
  };
}

export interface StormProximity {
  /** Distance snapped to the nearest value the sensor can report. */
  km: number | null;
  outOfRange: boolean;
  overhead: boolean;
  label: string;
  colorClass: string;
  color: string;
  /** Plain guidance for an operator or a site safety officer. */
  advice: string;
}

/**
 * Describe how close the storm front is.
 *
 * The bands follow the widely used lightning safety convention: activity within
 * roughly 10 km is close enough that the next strike could reach you, so
 * outdoor work should stop.
 */
export function describeStormProximity(distanceKm: number | null | undefined): StormProximity {
  if (distanceKm === null || distanceKm === undefined || !Number.isFinite(Number(distanceKm)) || Number(distanceKm) <= 0) {
    return {
      km: null, outOfRange: false, overhead: false,
      label: "No activity", colorClass: "text-green-700", color: "#15803d",
      advice: "No lightning has been detected in range.",
    };
  }
  const value = Number(distanceKm);

  if (value >= AS3935_DISTANCE_OUT_OF_RANGE) {
    return {
      km: null, outOfRange: true, overhead: false,
      label: "Out of range", colorClass: "text-green-700", color: "#15803d",
      advice: "Activity detected but beyond the sensor's 40 km estimate.",
    };
  }

  const km = snapToDistanceBin(value);

  if (km <= AS3935_DISTANCE_OVERHEAD) {
    return {
      km, outOfRange: false, overhead: true,
      label: "Overhead", colorClass: "text-red-600", color: "#dc2626",
      advice: "Storm is overhead. Stay indoors and keep away from masts and exposed wiring.",
    };
  }
  if (km <= 10) {
    return {
      km, outOfRange: false, overhead: false,
      label: "Very close", colorClass: "text-red-600", color: "#dc2626",
      advice: "Within striking range. Suspend outdoor and mast work now.",
    };
  }
  if (km <= 20) {
    return {
      km, outOfRange: false, overhead: false,
      label: "Approaching", colorClass: "text-orange-500", color: "#f97316",
      advice: "Close enough to reach the site quickly. Prepare to stop outdoor work.",
    };
  }
  if (km <= 30) {
    return {
      km, outOfRange: false, overhead: false,
      label: "Nearby", colorClass: "text-yellow-600", color: "#eab308",
      advice: "Storm within monitoring range. Watch the distance trend.",
    };
  }
  return {
    km, outOfRange: false, overhead: false,
    label: "Distant", colorClass: "text-blue-500", color: "#3b82f6",
    advice: "Storm detected at the far edge of the sensor's range.",
  };
}

/** Snap a distance to the nearest value the AS3935 can actually report. */
export function snapToDistanceBin(km: number): number {
  let best = AS3935_DISTANCE_BINS[0] as number;
  let bestDelta = Math.abs(km - best);
  for (const bin of AS3935_DISTANCE_BINS) {
    const delta = Math.abs(km - bin);
    if (delta < bestDelta) { best = bin; bestDelta = delta; }
  }
  return best;
}

export type StormTrend = "approaching" | "receding" | "steady" | "unknown";

export interface StormTrendResult {
  trend: StormTrend;
  label: string;
  colorClass: string;
  /** Change in km across the window. Negative means closing in. */
  deltaKm: number | null;
  description: string;
}

/**
 * Work out whether the storm front is closing in or moving away.
 *
 * Readings are compared as the mean of the first and last thirds of the window,
 * which rides out the sensor's coarse distance bins better than comparing two
 * single readings.
 */
export function analyseStormTrend(
  readings: Array<{ timestamp: string | Date; distanceKm: number | null | undefined }>,
): StormTrendResult {
  const valid = readings
    .map((r) => ({
      ts: new Date(r.timestamp).getTime(),
      km: Number(r.distanceKm),
    }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.km) && r.km > 0 && r.km < AS3935_DISTANCE_OUT_OF_RANGE)
    .sort((a, b) => a.ts - b.ts);

  if (valid.length < 4) {
    return {
      trend: "unknown", label: "Not enough data", colorClass: "text-black", deltaKm: null,
      description: "At least four distance readings are needed to judge a trend.",
    };
  }

  const third = Math.max(1, Math.floor(valid.length / 3));
  const mean = (arr: typeof valid) => arr.reduce((sum, r) => sum + r.km, 0) / arr.length;
  const first = mean(valid.slice(0, third));
  const last = mean(valid.slice(-third));
  const deltaKm = Math.round((last - first) * 10) / 10;

  // One distance bin is the smallest change the sensor can express, so use a
  // 2 km dead band to avoid calling bin noise a trend.
  if (deltaKm <= -2) {
    return {
      trend: "approaching", label: "Approaching", colorClass: "text-red-600", deltaKm,
      description: `Storm front has closed by about ${Math.abs(deltaKm)} km over this window.`,
    };
  }
  if (deltaKm >= 2) {
    return {
      trend: "receding", label: "Moving away", colorClass: "text-green-700", deltaKm,
      description: `Storm front has moved about ${deltaKm} km further away over this window.`,
    };
  }
  return {
    trend: "steady", label: "Holding steady", colorClass: "text-yellow-600", deltaKm,
    description: "Storm front distance has not changed by more than one sensor bin.",
  };
}

/**
 * Count strikes from a cumulative counter series.
 *
 * The AS3935 itself does not keep a running total, so loggers usually publish
 * one. Counters reset on power cycle or roll over, so only positive steps are
 * counted and an implausible jump is ignored rather than trusted.
 */
export function countStrikesFromCounter(
  values: Array<number | null | undefined>,
  maxPlausibleStep = 1000,
): number {
  let total = 0;
  let previous: number | null = null;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) continue;
    const current = Number(value);
    if (previous !== null) {
      const step = current - previous;
      if (step > 0 && step < maxPlausibleStep) total += step;
    }
    previous = current;
  }
  return total;
}
