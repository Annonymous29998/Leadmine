/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Railway API origin for Vercel deploy (no trailing slash). Empty locally. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
