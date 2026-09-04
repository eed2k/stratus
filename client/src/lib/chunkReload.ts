// Stratus Weather Server
// Created by Lukas Esterhuizen

/**
 * Recovery for stale lazy-chunk loads after a deploy.
 *
 * The app code-splits every page with dynamic import(). When a new build is
 * deployed while a tab is open, the in-memory index still points at the
 * previous chunk hashes (e.g. Dashboard-<oldhash>.js). Those files no longer
 * exist, so the next navigation's import() rejects and the page dies with
 * "error loading dynamically imported module".
 *
 * Reloading once pulls the fresh index.html (served with no-cache) and thus the
 * new chunk hashes. A short-lived sessionStorage guard prevents a reload loop
 * when the failure is a genuinely broken chunk rather than a stale deploy: if a
 * reload already happened moments ago, the error is allowed to surface instead.
 *
 * This lives in its own module (rather than in main.tsx) so both the entry
 * point and the ErrorBoundary can use it without a circular import.
 */

const RELOAD_GUARD_KEY = "stratus:chunk-reload-at";
const RELOAD_GUARD_MS = 15000;

/** Messages browsers use when a dynamic import / chunk fails to load. */
export const STALE_CHUNK_RE =
  /(dynamically imported module|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|ChunkLoadError|Loading chunk [0-9]+ failed)/i;

/**
 * Reload the page once to recover from a stale chunk. Returns true if a reload
 * was triggered, false if the guard suppressed it (so the caller can fall back
 * to showing an error).
 */
export function reloadOnceForStaleChunk(reason: string): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || "0");
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage can be unavailable (private mode); reload anyway.
  }
  console.warn(`Stratus: reloading to recover from a stale module load (${reason})`);
  window.location.reload();
  return true;
}

/**
 * Install global listeners for the two ways a failed lazy import surfaces:
 * Vite's own preload-error event, and an unhandled promise rejection. Call once
 * at startup.
 */
export function installChunkReloadHandlers(): void {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceForStaleChunk("vite:preloadError");
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = String(
      (event.reason && (event.reason.message ?? event.reason)) || "",
    );
    if (STALE_CHUNK_RE.test(message)) {
      reloadOnceForStaleChunk("unhandledrejection");
    }
  });
}
