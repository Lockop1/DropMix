/**
 * Where the room server lives. By default it is reached through the web dev server's own origin
 * at `/rooms-api` (Vite proxies it to `wrangler dev` on :8787), so a phone needs a single tunnel
 * URL. `VITE_ROOMS_URL` overrides it, e.g. `VITE_ROOMS_URL=http://localhost:8787`.
 */

export const DEFAULT_ROOMS_PATH = '/rooms-api';

export interface RoomsEndpoint {
  /** Base for HTTP calls, without a trailing slash (`POST {http}/rooms`). */
  http: string;
  /** For partysocket: host[:port], URL path prefix, and ws/wss. */
  host: string;
  prefix: string;
  protocol: 'ws' | 'wss';
}

export function resolveRoomsEndpoint(
  override: string | undefined = import.meta.env.VITE_ROOMS_URL,
  pageHref: string = window.location.href,
): RoomsEndpoint {
  const url = new URL(override?.trim() || DEFAULT_ROOMS_PATH, pageHref);
  const path = url.pathname.replace(/\/+$/, '');
  const trimmed = path.replace(/^\/+/, '');
  return {
    http: `${url.origin}${path}`,
    host: url.host,
    prefix: trimmed ? `${trimmed}/parties` : 'parties',
    protocol: url.protocol === 'https:' ? 'wss' : 'ws',
  };
}

/** The phone-facing join link for a room (what the QR code encodes). */
export function joinUrl(code: string, origin: string = window.location.origin): string {
  return `${origin}/roomlab/join/${code}`;
}
