/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * "1" builds the LGPL (SoundTouch) and GPL (Rubber Band) stretcher backends into the app.
   * Unset by default: the shipped bundle stays permissive-licensed. Personal use only.
   */
  readonly VITE_ENABLE_NONPERMISSIVE_STRETCHERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
