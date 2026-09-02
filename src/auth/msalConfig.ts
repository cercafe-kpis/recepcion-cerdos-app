import type { Configuration } from '@azure/msal-browser'

// Reutiliza a propósito el mismo registro de aplicación en Entra ID que las
// demás apps de Cercafe (ver .env.example y README sección 2) — por eso estos
// valores vienen de variables de entorno en vez de estar fijos en el código.
const clientId = import.meta.env.VITE_AAD_CLIENT_ID as string
const tenantId = import.meta.env.VITE_AAD_TENANT_ID as string
const redirectUri = import.meta.env.VITE_AAD_REDIRECT_URI as string

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: redirectUri,
  },
  cache: {
    // localStorage (no sessionStorage) para que la sesión sobreviva si el
    // usuario cierra la pestaña sin señal y vuelve más tarde a sincronizar.
    cacheLocation: 'localStorage',
  },
}

// El único permiso que necesita esta app contra Graph — el mismo que ya
// tiene consentido el registro compartido (Sites.ReadWrite.All, ver README).
// Como URI de recurso completa (no solo el nombre del scope) para que
// coincida exactamente con el formato que usa HGP7 contra el mismo
// registro de Entra ID — evita que MSAL trate una petición como "distinta"
// de la que ya se autenticó y tenga que ir a confirmar con Microsoft en
// vez de usar el token que ya tiene en caché.
export const graphScopes = [
  'https://graph.microsoft.com/Sites.ReadWrite.All',
  'https://graph.microsoft.com/User.Read',
]
