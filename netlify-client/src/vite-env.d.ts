/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STRATUS_SERVER_URL: string;
  readonly VITE_STRATUS_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
