// Stratus Weather System
// Created by Lukas Esterhuizen

export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}
