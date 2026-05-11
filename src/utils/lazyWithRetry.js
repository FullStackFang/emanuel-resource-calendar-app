import { lazy } from 'react';

export const CHUNK_RELOAD_FLAG = 'chunkErrorReloaded';

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

export async function loadWithReload(importFn) {
  const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1';
  try {
    const mod = await importFn();
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
    return mod;
  } catch (error) {
    if (isChunkLoadError(error) && !alreadyReloaded) {
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
      window.location.reload();
      return new Promise(() => {});
    }
    throw error;
  }
}

export function lazyWithRetry(importFn) {
  return lazy(() => loadWithReload(importFn));
}
