import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isChunkLoadError,
  loadWithReload,
  CHUNK_RELOAD_FLAG,
  RELOAD_COOLDOWN_MS,
} from '../../../utils/lazyWithRetry';

describe('lazyWithRetry', () => {
  let reloadSpy;
  let originalLocation;

  beforeEach(() => {
    sessionStorage.clear();
    originalLocation = window.location;
    delete window.location;
    reloadSpy = vi.fn();
    window.location = { ...originalLocation, reload: reloadSpy };
  });

  afterEach(() => {
    window.location = originalLocation;
  });

  describe('isChunkLoadError', () => {
    it('detects ChunkLoadError by name', () => {
      const err = new Error('whatever');
      err.name = 'ChunkLoadError';
      expect(isChunkLoadError(err)).toBe(true);
    });

    it('detects Vite "Failed to fetch dynamically imported module" message', () => {
      const err = new TypeError(
        'Failed to fetch dynamically imported module: https://example.com/assets/Calendar-Bo68taGM.js'
      );
      expect(isChunkLoadError(err)).toBe(true);
    });

    it('detects Safari "Importing a module script failed" message', () => {
      const err = new Error('Importing a module script failed.');
      expect(isChunkLoadError(err)).toBe(true);
    });

    it('detects Firefox "error loading dynamically imported module" message', () => {
      const err = new Error('error loading dynamically imported module');
      expect(isChunkLoadError(err)).toBe(true);
    });

    it('returns false for unrelated errors', () => {
      expect(isChunkLoadError(new TypeError('Cannot read properties of null'))).toBe(false);
      expect(isChunkLoadError(new Error('Network request failed'))).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isChunkLoadError(null)).toBe(false);
      expect(isChunkLoadError(undefined)).toBe(false);
    });
  });

  describe('loadWithReload', () => {
    // The guard is a timestamp with a cooldown, NOT a boolean cleared on
    // success. The cleared-on-success design looped forever when most chunks
    // loaded and one persistently failed (observed as a ~12s full-boot loop).

    it('returns the module when the import succeeds, leaving the guard alone', async () => {
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now())); // prior reload
      const mod = { default: 'Component' };
      const importFn = vi.fn().mockResolvedValue(mod);

      const result = await loadWithReload(importFn);

      expect(result).toBe(mod);
      expect(importFn).toHaveBeenCalledTimes(1);
      // The recorded attempt survives — a success must not re-arm the reload
      expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).not.toBeNull();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('reloads once on a chunk-load error and records the attempt timestamp', async () => {
      const err = new TypeError(
        'Failed to fetch dynamically imported module: /assets/Calendar.js'
      );
      const importFn = vi.fn().mockRejectedValue(err);

      // loadWithReload never resolves after triggering reload — race it
      // against a macrotask sentinel to flush microtasks AND verify it hangs.
      const pending = loadWithReload(importFn);
      const result = await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve('still-pending'), 30)),
      ]);

      expect(result).toBe('still-pending');
      expect(reloadSpy).toHaveBeenCalledTimes(1);
      expect(Number(sessionStorage.getItem(CHUNK_RELOAD_FLAG))).toBeGreaterThan(0);
    });

    it('LOOP GUARD: success between failures does not re-arm the reload; the next failure surfaces', async () => {
      // First failure consumes the one recovery reload
      const err = new TypeError(
        'Failed to fetch dynamically imported module: /assets/Calendar.js'
      );
      const pending = loadWithReload(vi.fn().mockRejectedValue(err));
      await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve('still-pending'), 30)),
      ]);
      expect(reloadSpy).toHaveBeenCalledTimes(1);

      // Another chunk succeeds — this used to clear the boolean flag
      await expect(loadWithReload(vi.fn().mockResolvedValue({ ok: true }))).resolves.toEqual({ ok: true });

      // The same failure again, inside the cooldown: MUST throw, not reload
      await expect(loadWithReload(vi.fn().mockRejectedValue(err))).rejects.toBe(err);
      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('allows a fresh recovery reload after the cooldown expires', async () => {
      sessionStorage.setItem(
        CHUNK_RELOAD_FLAG,
        String(Date.now() - RELOAD_COOLDOWN_MS - 1000)
      );
      const err = new TypeError(
        'Failed to fetch dynamically imported module: /assets/Calendar.js'
      );

      const pending = loadWithReload(vi.fn().mockRejectedValue(err));
      await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve('still-pending'), 30)),
      ]);

      expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('rethrows non-chunk errors without reloading', async () => {
      const err = new TypeError('Cannot read properties of null (reading "foo")');
      const importFn = vi.fn().mockRejectedValue(err);

      await expect(loadWithReload(importFn)).rejects.toBe(err);
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(CHUNK_RELOAD_FLAG)).toBeNull();
    });
  });
});
