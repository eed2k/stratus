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
 * Based on the Beaufort Scale with metric (km/h) values
 * Reference: WMO-No. 8, Guide to Meteorological Instruments and Methods of Observation
 * 
 * Colors follow a proper thermal gradient progression:
 * - Blues for light winds (cool/calm)
 * - Greens for moderate winds (comfortable)
 * - Yellows/Oranges for strong winds (caution)
 * - Reds for severe winds (danger)
 */
export const WMO_SPEED_CLASSES: WindSpeedClass[] = [
  { min: 0, max: 1, color: "#e0f2fe", label: "Calm", beaufort: "0", description: "Smoke rises vertically" },
  { min: 1, max: 6, color: "#bae6fd", label: "Light Air", beaufort: "1", description: "Direction shown by smoke drift" },
  { min: 6, max: 12, color: "#7dd3fc", label: "Light Breeze", beaufort: "2", description: "Wind felt on face, leaves rustle" },
  { min: 12, max: 20, color: "#38bdf8", label: "Gentle Breeze", beaufort: "3", description: "Leaves and small twigs in motion" },
  { min: 20, max: 29, color: "#0ea5e9", label: "Moderate Breeze", beaufort: "4", description: "Raises dust and loose paper" },
  { min: 29, max: 39, color: "#22c55e", label: "Fresh Breeze", beaufort: "5", description: "Small trees begin to sway" },
  { min: 39, max: 50, color: "#84cc16", label: "Strong Breeze", beaufort: "6", description: "Large branches in motion" },
  { min: 50, max: 62, color: "#eab308", label: "Near Gale", beaufort: "7", description: "Whole trees in motion" },
  { min: 62, max: 75, color: "#f97316", label: "Gale", beaufort: "8", description: "Twigs break off trees" },
  { min: 75, max: 89, color: "#ef4444", label: "Strong Gale", beaufort: "9", description: "Slight structural damage" },
  { min: 89, max: 103, color: "#dc2626", label: "Storm", beaufort: "10", description: "Trees uprooted" },
  { min: 103, max: 118, color: "#b91c1c", label: "Violent Storm", beaufort: "11", description: "Widespread damage" },
  { min: 118, max: Infinity, color: "#7f1d1d", label: "Hurricane", beaufort: "12", description: "Devastating damage" },
];

/**
 * Simplified WMO classes for wind rose display (6 categories)
 * Uses same thermal gradient color scheme
 */
export const WMO_SIMPLIFIED_CLASSES: WindSpeedClass[] = [
  { min: 0, max: 6, color: "#bae6fd", label: "Calm/Light (0-6 km/h)", beaufort: "0-1" },
  { min: 6, max: 20, color: "#38bdf8", label: "Light/Gentle (6-20 km/h)", beaufort: "2-3" },
  { min: 20, max: 39, color: "#22c55e", label: "Moderate/Fresh (20-39 km/h)", beaufort: "4-5" },
  { min: 39, max: 62, color: "#eab308", label: "Strong/Near Gale (39-62 km/h)", beaufort: "6-7" },
  { min: 62, max: 89, color: "#f97316", label: "Gale/Strong Gale (62-89 km/h)", beaufort: "8-9" },
  { min: 89, max: Infinity, color: "#dc2626", label: "Storm+ (>89 km/h)", beaufort: "10+" },
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
 * @param speed Wind speed in km/h
 * @returns Color hex code
 */
export function getSpeedColor(speed: number): string {
  const colorClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return colorClass?.color || "#dc2626";
}

/**
 * Get wind description based on WMO Beaufort scale
 * @param speed Wind speed in km/h
 * @returns Beaufort scale description (e.g., "Calm", "Light Air", etc.)
 */
export function getWindDescription(speed: number): string {
  const wmoClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return wmoClass?.label || "Unknown";
}

/**
 * Get Beaufort number for a given wind speed
 * @param speed Wind speed in km/h
 * @returns Beaufort number (0-12)
 */
export function getBeaufortNumber(speed: number): number {
  const wmoClass = WMO_SPEED_CLASSES.find(c => speed >= c.min && speed < c.max);
  return wmoClass ? parseInt(wmoClass.beaufort) : 12;
}
