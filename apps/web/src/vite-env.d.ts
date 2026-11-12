/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Room server base URL (rooms spike). Defaults to the same-origin `/rooms-api` path that the
   * Vite dev server proxies to `wrangler dev`. Example: `VITE_ROOMS_URL=http://localhost:8787`.
   */
  readonly VITE_ROOMS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
