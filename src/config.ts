/**
 * Configuración de la integración con Azure AD / SharePoint.
 *
 * CLIENT_ID / TENANT_ID: App Registration compartido por las apps de Cercafe (no son secretos).
 * SP_SITE_URL: sitio donde viven TODAS las listas de esta app.
 * DIAS_CEBA: convierte la pérdida de GDP (gr/día) a kg del ciclo de ceba.
 */
export const CONFIG = {
  CLIENT_ID: '5d4e5dd1-82f1-48d0-a0b0-f104d938c770',
  TENANT_ID: 'f2ea1671-e87d-4f02-9941-b721acbdbc01',
  SP_SITE_URL: 'https://cercafe.sharepoint.com/sites/Inspeccion_pulmones',
  DIAS_CEBA: 90,
} as const

/**
 * Nombres EXACTOS de las listas de SharePoint (ver docs/sharepoint-listas-guia.html).
 * InspeccionPulmones: un registro por cerdo (la de siempre).
 * Granjas / Asociados / Usuarios: configuración que administra el Rol Administrador desde la app.
 */
export const LISTAS = {
  INSPECCIONES: 'InspeccionPulmones',
  GRANJAS: 'Granjas',
  ASOCIADOS: 'Asociados',
  USUARIOS: 'Usuarios',
} as const
export type NombreLista = (typeof LISTAS)[keyof typeof LISTAS]

/** Súbalo en cada cambio: se ve en el pie de la app para confirmar que el celular ya tiene la versión nueva. */
export const APP_VERSION = '2026-11-06-b'

/** Scopes que ya usaba la app (no cambiar: así MSAL reutiliza el token guardado y nadie tiene que volver a iniciar sesión). */
export const SCOPES_LOGIN = ['User.Read', 'Sites.ReadWrite.All']
export const SCOPES_GRAPH = ['Sites.ReadWrite.All']
