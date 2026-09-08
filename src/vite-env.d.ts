/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

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

/** Fecha/hora (ISO) en que se generó este build — inyectada en vite.config.ts (define), se
 * muestra en el pie de página (App.tsx) para poder comprobar a simple vista si un despliegue
 * ya llegó al dispositivo. */
declare const __FECHA_BUILD__: string
