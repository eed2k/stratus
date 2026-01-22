/**
 * Password Utility Functions
 * 
 * Uses the Web Crypto API for secure password hashing with PBKDF2.
 * Falls back to simple hashing when crypto.subtle is unavailable (HTTP).
 * 
 * Security: PBKDF2 with SHA-256, 100,000 iterations, 128-bit salt
 */

const ITERATIONS = 100000;
const KEY_LENGTH = 256;
const SALT_LENGTH = 16;

// Check if Web Crypto API is available (requires HTTPS or localhost)
const isSecureContext = typeof crypto !== 'undefined' && crypto.subtle !== undefined;

/**
 * Convert ArrayBuffer to hex string
 */
function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBuffer(hex: string): Uint8Array {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
}

/**
 * Generate a cryptographically secure random salt
 */
function generateSalt(): Uint8Array {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  }
  // Fallback for non-secure context
  const salt = new Uint8Array(SALT_LENGTH);
  for (let i = 0; i < SALT_LENGTH; i++) {
    salt[i] = Math.floor(Math.random() * 256);
  }
  return salt;
}

/**
 * Simple hash function for HTTP fallback (not cryptographically secure)
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Hash a password using PBKDF2
 * Returns format: salt:hash (both hex encoded)
 * Falls back to simple hashing over HTTP
 */
export async function hashPassword(password: string): Promise<string> {
  // Fallback for non-secure context (HTTP)
  if (!isSecureContext) {
    const salt = bufferToHex(generateSalt().buffer as ArrayBuffer);
    const hash = simpleHash(salt + password + salt);
    return `fallback:${salt}:${hash}`;
  }
  
  const encoder = new TextEncoder();
  const salt = generateSalt();
  
  // Import password as a key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  // Derive key using PBKDF2
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH
  );
  
  // Return salt:hash format
  return `${bufferToHex(salt.buffer as ArrayBuffer)}:${bufferToHex(derivedBits)}`;
}

/**
 * Verify a password against a stored hash
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Handle legacy Base64 hashes during migration
  if (!storedHash.includes(':')) {
    // Legacy format - try Base64 comparison (for backward compatibility)
    try {
      return btoa(password) === storedHash;
    } catch {
      return false;
    }
  }
  
  // Handle fallback hash format (HTTP non-secure context)
  if (storedHash.startsWith('fallback:')) {
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;
    const [, saltHex, expectedHash] = parts;
    const computedHash = simpleHash(saltHex + password + saltHex);
    return computedHash === expectedHash;
  }
  
  // Fallback for non-secure context verifying a secure hash
  if (!isSecureContext) {
    console.warn('Cannot verify PBKDF2 hash in non-secure context (HTTP)');
    // Try simple comparison as last resort
    return false;
  }
  
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;
  
  const encoder = new TextEncoder();
  const salt = hexToBuffer(saltHex);
  
  // Import password as a key
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  // Derive key using same parameters
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    KEY_LENGTH
  );
  
  // Compare hashes (timing-safe comparison)
  const derivedHex = bufferToHex(derivedBits);
  
  // Simple constant-time comparison
  if (derivedHex.length !== hashHex.length) return false;
  let result = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    result |= derivedHex.charCodeAt(i) ^ hashHex.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Check if a hash is in the legacy (insecure) Base64 format
 */
export function isLegacyHash(hash: string): boolean {
  return !hash.includes(':');
}

/**
 * Migrate a password from legacy Base64 to secure PBKDF2
 * Call this after successful login with legacy hash
 */
export async function migratePasswordHash(password: string): Promise<string> {
  return hashPassword(password);
}
