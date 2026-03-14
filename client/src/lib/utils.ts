// Stratus Weather System
// Created by Lukas Esterhuizen

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely format a number with toFixed, handling null, undefined, strings, and NaN.
 * Returns '--' for invalid values.
 */
export function safeFixed(
  value: number | string | null | undefined,
  decimals: number = 1,
  fallback: string = '--'
): string {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (num === null || num === undefined || isNaN(num)) return fallback;
  return num.toFixed(decimals);
}

/**
 * Safely convert a value to a number, handling strings.
 * Returns the fallback for invalid values.
 */
export function safeNumber(
  value: number | string | null | undefined,
  fallback: number = 0
): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return fallback;
  return num;
}
