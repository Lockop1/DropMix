/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Room server base URL (rooms spike). Defaults to the same-origin `/rooms-api` path that the
   * Vite dev server proxies to `wrangler dev`. Example: `VITE_ROOMS_URL=http://localhost:8787`.
   */
  readonly VITE_ROOMS_URL?: string;
  /**
   * "1" builds the LGPL (SoundTouch) and GPL (Rubber Band) stretcher backends into the app.
   * Unset by default: the shipped bundle stays permissive-licensed. Personal use only.
   */
  readonly VITE_ENABLE_NONPERMISSIVE_STRETCHERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
