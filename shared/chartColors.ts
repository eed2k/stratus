// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Canonical chart colors for Stratus.
 *
 * Before this existed the same quantity was drawn in different colors on
 * different screens: ETo appeared as cyan, light blue and green depending on
 * the page, and wind speed alternated between green and blue. One map fixes
 * that, and it is the single place to change a color.
 *
 * House rules baked in here:
 *   - ETo is always green, and battery voltage is always green.
 *   - No purple or violet, and no pale washed-out blues. Every color is
 *     saturated enough to read as a thin line on a white chart and to survive
 *     being printed in a PDF report.
 *   - Where two related series share a chart (two battery banks, two charge
 *     regulators) they use two shades of the same hue so the pairing is
 *     obvious without adding a new hue to the palette.
 */

export const CHART_COLORS = {
  // Air
  temperature: "#ef4444",
  temperature8m: "#b91c1c",
  deltaTemperature: "#f97316",
  humidity: "#2563eb",
  dewPoint: "#0e7490",
  pressure: "#0f766e",        // teal, replaces the old purple
  pressureSeaLevel: "#115e59",
  heatIndex: "#dc2626",
  windChill: "#0369a1",
  airDensity: "#2563eb",

  // Wind
  windSpeed: "#0891b2",
  windGust: "#f59e0b",
  windDirection: "#64748b",
  windPower: "#16a34a",

  // Water
  rainfall: "#1d4ed8",
  waterLevel: "#1d4ed8",
  soilTemperature: "#b45309",
  soilMoisture: "#047857",
  eto: "#16a34a",             // always green
  irrigation: "#0891b2",

  // Solar and power
  solarRadiation: "#f59e0b",
  solarPower: "#f59e0b",
  batteryVoltage: "#16a34a",  // always green
  batteryVoltage2: "#15803d", // second bank, darker green
  panelTemperature: "#b45309",
  moduleTemperature: "#b45309",

  // Charge regulator
  mpptSolarVoltage: "#ef4444",
  mpptSolarCurrent: "#ef4444",
  mpptSolarPower: "#ef4444",
  mpptLoadVoltage: "#0891b2",
  mpptLoadCurrent: "#0891b2",
  mpptBatteryVoltage: "#16a34a",
  mpptChargerState: "#64748b",
  mpptBoardTemp: "#b45309",
  mppt2SolarVoltage: "#b91c1c",
  mppt2SolarCurrent: "#b91c1c",
  mppt2SolarPower: "#b91c1c",
  mppt2LoadVoltage: "#0e7490",
  mppt2LoadCurrent: "#0e7490",
  mppt2BatteryVoltage: "#15803d",
  mppt2BoardTemp: "#92400e",
  chargerEnergy1: "#f59e0b",
  chargerEnergy2: "#b45309",
  chargerEnergyTotal: "#1e3a5f",

  // Air quality
  pm10: "#ef4444",
  pm25: "#b91c1c",

  // Lightning
  lightning: "#f59e0b",
  lightningDistance: "#0891b2",
  lightningIntensity: "#f97316",

  // Astronomy
  sunElevation: "#f59e0b",
  sunAzimuth: "#b45309",

  // Neutral / brand
  brand: "#1e3a5f",
  neutral: "#64748b",
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;

/** Look up a color, falling back to the brand navy for anything unmapped. */
export function chartColor(key: string): string {
  return (CHART_COLORS as Record<string, string>)[key] ?? CHART_COLORS.brand;
}
