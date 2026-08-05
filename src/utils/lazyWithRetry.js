import { lazy } from 'react';

export const CHUNK_RELOAD_FLAG = 'chunkErrorReloaded';

// One recovery reload per cooldown window. The flag used to be a boolean that
// was CLEARED whenever any import succeeded — so a session where most chunks
// loaded and one persistently failed reloaded the page forever (a ~12s
// full-boot loop: auth, counts, SSE connect, reload, repeat). A timestamp
// with a cooldown keeps the one-shot recovery for genuine new-deploy chunk
// misses while guaranteeing a persistent failure surfaces to the
// ErrorBoundary instead of looping.
export const RELOAD_COOLDOWN_MS = 60_000;

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  const msg = String(error.message || error);
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

export function canAttemptChunkReload() {
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG) || 0);
  return !last || Date.now() - last > RELOAD_COOLDOWN_MS;
}

export function markChunkReloadAttempt() {
  sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
}

export async function loadWithReload(importFn) {
  try {
    return await importFn();
  } catch (error) {
    if (isChunkLoadError(error) && canAttemptChunkReload()) {
      markChunkReloadAttempt();
      window.location.reload();
      return new Promise(() => {});
    }
    throw error;
  }
}

export function lazyWithRetry(importFn) {
  return lazy(() => loadWithReload(importFn));
}
