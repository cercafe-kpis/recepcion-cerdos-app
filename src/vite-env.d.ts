/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AAD_CLIENT_ID: string
  readonly VITE_AAD_TENANT_ID: string
  readonly VITE_AAD_REDIRECT_URI: string
  readonly VITE_SP_HOSTNAME: string
  readonly VITE_SP_SITE_PATH: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
