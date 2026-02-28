/**
 * Wind Direction and Speed Constants
 * 
 * Shared constants for wind direction labels and WMO/Beaufort wind speed classifications.
 * This centralizes all wind-related constants to avoid duplication across components.
 */

/**
 * 16-point compass rose direction labels
 * Used for converting wind direction degrees to cardinal/intercardinal directions
 */
export const WIND_DIRECTIONS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

export type WindDirection = typeof WIND_DIRECTIONS[number];

/**
 * Wind speed class type definition
 */
export interface WindSpeedClass {
  min: number;
  max: number;
  color: string;
  label: string;
  beaufort: string;
  description?: string;
}

/**
 * WMO (World Meteorological Organization) Standard Wind Speed Classes
 * Based on the Beaufort Scale with metric (m/s) values
 * Reference: WMO-No. 8, Guide to Meteorological Instruments and Methods of Observation
 * 
 * Official Beaufort scale values in m/s:
 * 
 * Beaufort | m/s
 * ---------|----------
 *    0     | <0.3
 *    1     | 0.3-1.5
 *    2     | 1.6-3.3
 *    3     | 3.4-5.4
 *    4     | 5.5-7.9
 *    5     | 8.0-10.7
 *    6     | 10.8-13.8
 *    7     | 13.9-17.1
 *    8     | 17.2-20.7
 *    9     | 20.8-24.4
 *    10    | 24.5-28.4
 *    11    | 28.5-32.6
 *    12    | ≥32.7
 * 
 * Colors follow a proper thermal gradient progression:
 * - Blues for light winds (cool/calm)
 * - Greens for moderate winds (comfortable)
 * - Yellows/Oranges for strong winds (caution)
 * - Reds for severe winds (danger)
 */
export const WMO_SPEED_CLASSES: WindSpeedClass[] = [
  { min: 0, max: 0.3, color: "#e0f2fe", label: "Calm", beaufort: "0", description: "Smoke rises vertically" },
  { min: 0.3, max: 1.6, color: "#bae6fd", label: "Light Air", beaufort: "1", description: "Direction shown by smoke drift" },
  { min: 1.6, max: 3.4, color: "#7dd3fc", label: "Light Breeze", beaufort: "2", description: "Wind felt on face, leaves rustle" },
  { min: 3.4, max: 5.5, color: "#38bdf8", label: "Gentle Breeze", beaufort: "3", description: "Leaves and small twigs in motion" },
  { min: 5.5, max: 8.0, color: "#0ea5e9", label: "Moderate Breeze", beaufort: "4", description: "Raises dust and loose paper" },
  { min: 8.0, max: 10.8, color: "#22c55e", label: "Fresh Breeze", beaufort: "5", description: "Small trees begin to sway" },
  { min: 10.8, max: 13.9, color: "#84cc16", label: "Strong Breeze", beaufort: "6", description: "Large branches in motion" },
  { min: 13.9, max: 17.2, color: "#eab308", label: "Near Gale", beaufort: "7", description: "Whole trees in motion" },
  { min: 17.2, max: 20.8, color: "#f97316", label: "Gale", beaufort: "8", description: "Twigs break off trees" },
  { min: 20.8, max: 24.5, color: "#ef4444", label: "Strong Gale", beaufort: "9", description: "Slight structural damage" },
  { min: 24.5, max: 28.5, color: "#dc2626", label: "Storm", beaufort: "10", description: "Trees uprooted" },
  { min: 28.5, max: 32.7, color: "#b91c1c", label: "Violent Storm", beaufort: "11", description: "Widespread damage" },
  { min: 32.7, max: Infinity, color: "#7f1d1d", label: "Hurricane", beaufort: "12", description: "Devastating damage" },
];

/**
 * Simplified WMO classes for wind rose display (6 categories)
 * Uses same thermal gradient color scheme. Values in m/s.
 */
export const WMO_SIMPLIFIED_CLASSES: WindSpeedClass[] = [
  { min: 0, max: 1.6, color: "#bae6fd", label: "Calm/Light (0–1.5 m/s)", beaufort: "0-1" },
  { min: 1.6, max: 5.5, color: "#38bdf8", label: "Light/Gentle (1.6–5.4 m/s)", beaufort: "2-3" },
  { min: 5.5, max: 10.8, color: "#22c55e", label: "Moderate/Fresh (5.5–10.7 m/s)", beaufort: "4-5" },
  { min: 10.8, max: 17.2, color: "#eab308", label: "Strong/Near Gale (10.8–17.1 m/s)", beaufort: "6-7" },
  { min: 17.2, max: 24.5, color: "#f97316", label: "Gale/Strong Gale (17.2–24.4 m/s)", beaufort: "8-9" },
  { min: 24.5, max: Infinity, color: "#dc2626", label: "Storm+ (>24.5 m/s)", beaufort: "10+" },
];

/**
 * Convert wind direction in degrees to compass label
 * @param degrees Wind direction in degrees (0-360, where 0/360 = North)
 * @returns Compass direction label (e.g., "N", "NNE", "NE", etc.)
 */
export function getWindDirectionLabel(degrees: number): WindDirection {
  const index = Math.round(degrees / 22.5) % 16;
  return WIND_DIRECTIONS[index];
}

/**
 * Get color for a given wind speed based on WMO/Beaufort scale
 * @param speed Wind speed in m/s
 * @returns Color hex code
 */
export function getSpeedColor(speed: number): string {
  const colorClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return colorClass?.color || "#dc2626";
}

/**
 * Get wind description based on WMO Beaufort scale
 * @param speed Wind speed in m/s
 * @returns Beaufort scale description (e.g., "Calm", "Light Air", etc.)
 */
export function getWindDescription(speed: number): string {
  const wmoClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return wmoClass?.label || "Unknown";
}

/**
 * Get Beaufort number for a given wind speed
 * @param speed Wind speed in m/s
 * @returns Beaufort number (0-12)
 */
export function getBeaufortNumber(speed: number): number {
  const wmoClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return wmoClass ? parseInt(wmoClass.beaufort) : 12;
}
