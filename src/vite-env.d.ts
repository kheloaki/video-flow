/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Production / custom: full origin of Express API (e.g. https://api.example.com) */
  readonly VITE_API_BASE_URL?: string;
  /** Dev only: Express URL when UI runs on another port (default http://127.0.0.1:3000) */
  readonly VITE_DEV_API_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
