// Stratus Weather System
// Created by Lukas Esterhuizen

/**
 * Standard meteorological and physical constants used across the application.
 * Centralised here to avoid magic numbers in calculations.
 */

/** Standard sea-level atmospheric pressure in hPa (ISA). Used as fallback when no sensor reading available. */
export const STANDARD_SEA_LEVEL_PRESSURE_HPA = 1013.25;

/** Standard air density at sea level in kg/m³ (ISA, 15 °C, 1013.25 hPa). */
export const STANDARD_AIR_DENSITY_KGM3 = 1.225;

/** Default temperature fallback in °C when sensor reading is unavailable. */
export const DEFAULT_TEMPERATURE_C = 20;

/** Default relative humidity fallback in % when sensor reading is unavailable. */
export const DEFAULT_HUMIDITY_PERCENT = 50;

/** Assumed average daylight hours for solar energy estimates when latitude-based calculation is not available. */
export const ASSUMED_DAYLIGHT_HOURS = 12;
