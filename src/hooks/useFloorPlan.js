import { useState, useEffect } from 'react';
import APP_CONFIG from '../config/config';
import { logger } from '../utils/logger';

/**
 * useFloorPlan — read-only loader for an event's floor plan image.
 *
 * A floor plan is stored as a GridFS attachment flagged `isFloorPlan: true`,
 * NOT as a top-level event field. This hook performs the two-hop authenticated
 * fetch (list attachments -> find the isFloorPlan image -> download the blob),
 * exposes a blob object URL for an <img>, and revokes it on cleanup so the
 * mobile detail component can stay render-only. The desktop form
 * (RoomReservationFormBase) inlines the same read path.
 *
 * Image-only by design: legacy data can flag a non-image (e.g. a PDF) as the
 * floor plan, which cannot render in an <img>, so those are skipped.
 *
 * @param {string} eventId  business eventId (matches the attachments endpoint)
 * @param {{ apiToken?: string, enabled?: boolean }} options
 * @returns {{ floorPlanUrl: string|null, fileName: string }}
 */
export default function useFloorPlan(eventId, { apiToken, enabled = true } = {}) {
  const [floorPlanUrl, setFloorPlanUrl] = useState(null);
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    // Nothing to load (sheet closed, unsaved event, or no token): clear any
    // prior plan so a recycled component never shows a stale image.
    if (!enabled || !eventId || !apiToken) {
      setFloorPlanUrl(null);
      setFileName('');
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;

    (async () => {
      try {
        const listRes = await fetch(
          `${APP_CONFIG.API_BASE_URL}/events/${eventId}/attachments`,
          { headers: { Authorization: `Bearer ${apiToken}` } }
        );
        if (!listRes.ok || cancelled) return;

        const data = await listRes.json();
        const fp = (data.attachments || []).find((a) => a.isFloorPlan);
        if (!fp || cancelled) return;

        // Skip a non-image floor plan — it can't render in <img> and would
        // otherwise download bytes only to show a broken image.
        if (fp.mimeType && !fp.mimeType.startsWith('image/')) return;

        const fileRes = await fetch(`${APP_CONFIG.API_BASE_URL}${fp.downloadUrl}`, {
          headers: { Authorization: `Bearer ${apiToken}` },
        });
        if (!fileRes.ok || cancelled) return;

        objectUrl = URL.createObjectURL(await fileRes.blob());
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setFloorPlanUrl(objectUrl);
        setFileName(fp.fileName || '');
      } catch (err) {
        logger.error('Failed to load floor plan:', err);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [eventId, apiToken, enabled]);

  return { floorPlanUrl, fileName };
}
