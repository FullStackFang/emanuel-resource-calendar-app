import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Decodes a JWT payload without any library.
 * Splits on '.', base64url-decodes the middle segment, JSON.parses.
 */
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // base64url → base64 → decode
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * useSessionTimer - Returns time remaining on the current API token.
 *
 * @returns {{ minutesRemaining: number, status: 'active'|'warning'|'critical' } | null}
 *   null when there is no token (chip should be hidden).
 */
export function useSessionTimer() {
  const { apiToken } = useAuth();
  const [minutesRemaining, setMinutesRemaining] = useState(null);

  useEffect(() => {
    if (!apiToken) {
      setMinutesRemaining(null);
      return;
    }

    const payload = decodeJwtPayload(apiToken);
    if (!payload?.exp) {
      setMinutesRemaining(null);
      return;
    }

    const update = () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, Math.ceil((payload.exp - nowSec) / 60));
      setMinutesRemaining(remaining);
    };

    update(); // immediate
    const id = setInterval(update, 60_000); // every minute

    return () => clearInterval(id);
  }, [apiToken]);

  if (minutesRemaining == null) return null;

  let status;
  if (minutesRemaining > 10) status = 'active';
  else if (minutesRemaining >= 5) status = 'warning';
  else status = 'critical';

  return { minutesRemaining, status };
}
