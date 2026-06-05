// src/__tests__/unit/hooks/useFloorPlan.test.js
//
// Locks the read-only floor-plan loader used by the mobile detail sheet.
// A floor plan is NOT a top-level event field — it is a GridFS attachment
// flagged `isFloorPlan: true`. This hook performs the two-hop authenticated
// fetch (list attachments -> find the isFloorPlan image -> download the blob),
// turns the blob into an object URL for <img src>, and revokes that URL on
// cleanup. The desktop form (RoomReservationFormBase) inlines the same read
// path; this hook isolates it so the mobile component stays render-only.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('../../../config/config', () => ({
  default: { API_BASE_URL: 'http://localhost:3001/api' },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import useFloorPlan from '../../../hooks/useFloorPlan';
import { logger } from '../../../utils/logger';

describe('useFloorPlan', () => {
  beforeEach(() => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the floor plan image when an isFloorPlan image attachment exists', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (typeof url === 'string' && url.endsWith('/events/evt-1/attachments')) {
        return {
          ok: true,
          json: async () => ({
            attachments: [
              {
                id: 'att-1',
                fileName: 'social-hall.png',
                isFloorPlan: true,
                mimeType: 'image/png',
                downloadUrl: '/files/gridfs-1',
              },
            ],
          }),
        };
      }
      // The /files/:id blob fetch
      return { ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) };
    });

    const { result } = renderHook(() =>
      useFloorPlan('evt-1', { apiToken: 'tok', enabled: true })
    );

    await waitFor(() => expect(result.current.floorPlanUrl).toBe('blob:mock-url'));
    expect(result.current.fileName).toBe('social-hall.png');
  });

  it('does not fetch when disabled', () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ attachments: [] }) }));

    const { result } = renderHook(() =>
      useFloorPlan('evt-1', { apiToken: 'tok', enabled: false })
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.current.floorPlanUrl).toBeNull();
  });

  it('skips a non-image floor plan attachment (no blob download, stays null)', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (typeof url === 'string' && url.endsWith('/events/evt-1/attachments')) {
        return {
          ok: true,
          json: async () => ({
            attachments: [
              {
                id: 'att-2',
                fileName: 'plan.pdf',
                isFloorPlan: true,
                mimeType: 'application/pdf',
                downloadUrl: '/files/gridfs-2',
              },
            ],
          }),
        };
      }
      return { ok: true, blob: async () => new Blob(['x'], { type: 'application/pdf' }) };
    });

    const { result } = renderHook(() =>
      useFloorPlan('evt-1', { apiToken: 'tok', enabled: true })
    );

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    // Give a buggy (guard-less) implementation ample time to download + set state.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const blobCall = globalThis.fetch.mock.calls.find(
      ([u]) => typeof u === 'string' && u.includes('/files/')
    );
    expect(blobCall).toBeUndefined();
    expect(result.current.floorPlanUrl).toBeNull();
  });

  it('logs and stays null when the attachments fetch fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    });

    const { result } = renderHook(() =>
      useFloorPlan('evt-1', { apiToken: 'tok', enabled: true })
    );

    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(result.current.floorPlanUrl).toBeNull();
  });

  it('revokes the object URL on unmount', async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (typeof url === 'string' && url.endsWith('/attachments')) {
        return {
          ok: true,
          json: async () => ({
            attachments: [
              {
                id: 'att-1',
                fileName: 'hall.png',
                isFloorPlan: true,
                mimeType: 'image/png',
                downloadUrl: '/files/gridfs-1',
              },
            ],
          }),
        };
      }
      return { ok: true, blob: async () => new Blob(['x'], { type: 'image/png' }) };
    });

    const { result, unmount } = renderHook(() =>
      useFloorPlan('evt-1', { apiToken: 'tok', enabled: true })
    );

    await waitFor(() => expect(result.current.floorPlanUrl).toBe('blob:mock-url'));
    unmount();

    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
