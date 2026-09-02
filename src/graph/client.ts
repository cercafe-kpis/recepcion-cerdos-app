import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance } from '../auth/msalInstance'
import { graphScopes } from '../auth/msalConfig'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'

const SP_HOSTNAME = import.meta.env.VITE_SP_HOSTNAME as string
const SP_SITE_PATH = import.meta.env.VITE_SP_SITE_PATH as string

/**
 * Pide un token de acceso para Graph. Si la sesión silenciosa falla (token
 * vencido, primera vez), cae a un login interactivo — esto solo puede pasar
 * con conexión, así que la capa offline (src/offline) nunca debe depender de
 * esta función para leer datos ya cacheados.
 */
async function getAccessToken(): Promise<string> {
  const account = msalInstance.getActiveAccount()
  if (!account) {
    const result = await msalInstance.loginPopup({ scopes: graphScopes })
    msalInstance.setActiveAccount(result.account)
    return result.accessToken
  }
  try {
    const result = await msalInstance.acquireTokenSilent({ scopes: graphScopes, account })
    return result.accessToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      const result = await msalInstance.acquireTokenPopup({ scopes: graphScopes })
      return result.accessToken
    }
    throw err
  }
}

async function graphFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(`${GRAPH_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Graph ${init?.method ?? 'GET'} ${path} → ${res.status}: ${body}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// --- Resolución y caché de siteId / listIds ---------------------------------
// Graph exige el GUID del sitio y de cada lista, no sus nombres. Resolverlos
// implica una llamada de red, así que se cachean en localStorage: siguen
// siendo válidos aunque el sitio esté offline en la siguiente sesión (el GUID
// no cambia), y evita pedirlos de nuevo en cada arranque de la app.

const CACHE_KEY = 'graph-ids-cache-v1'

interface IdsCache {
  siteId?: string
  listIds: Record<string, string>
}

function readCache(): IdsCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as IdsCache) : { listIds: {} }
  } catch {
    return { listIds: {} }
  }
}

function writeCache(cache: IdsCache) {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

export async function getSiteId(): Promise<string> {
  const cache = readCache()
  if (cache.siteId) return cache.siteId

  const site = await graphFetch<{ id: string }>(`/sites/${SP_HOSTNAME}:${SP_SITE_PATH}`)
  cache.siteId = site.id
  writeCache(cache)
  return site.id
}

/** Nombres EXACTOS de las listas tal como se crean en SharePoint — ver Arquitectura-App-Recepcion-Cerdos.md sección 4. */
export type ListName =
  | 'Usuarios'
  | 'Asociados'
  | 'Granjas'
  | 'Vehiculos'
  | 'Recepciones'
  | 'Ubicaciones'
  | 'NovedadesCorral'
  | 'ConsolidadoTiquetes'
  | 'RecepcionLog'

export async function getListId(name: ListName): Promise<string> {
  const cache = readCache()
  if (cache.listIds[name]) return cache.listIds[name]

  const siteId = await getSiteId()
  const list = await graphFetch<{ id: string }>(
    `/sites/${siteId}/lists/${encodeURIComponent(name)}`,
  )
  cache.listIds[name] = list.id
  writeCache(cache)
  return list.id
}

/** Refresca la caché de siteId/listIds — llamarlo si se renombra una lista o el sitio. */
export function clearIdsCache() {
  localStorage.removeItem(CACHE_KEY)
}

// --- Operaciones genéricas sobre elementos de lista -------------------------
// Todo lo específico de cada lista (qué campos tiene, cómo mapear tipos) vive
// en src/graph/lists.ts; este archivo solo sabe hablar con Graph en general.

export interface GraphListItem<TFields> {
  id: string
  fields: TFields
}

export async function listItems<TFields>(
  list: ListName,
  query = '$expand=fields&$top=200',
): Promise<GraphListItem<TFields>[]> {
  const siteId = await getSiteId()
  const listId = await getListId(list)
  const res = await graphFetch<{ value: GraphListItem<TFields>[] }>(
    `/sites/${siteId}/lists/${listId}/items?${query}`,
  )
  return res.value
}

export async function createItem<TFields extends object>(
  list: ListName,
  fields: TFields,
): Promise<GraphListItem<TFields>> {
  const siteId = await getSiteId()
  const listId = await getListId(list)
  return graphFetch<GraphListItem<TFields>>(`/sites/${siteId}/lists/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify({ fields }),
  })
}

export async function updateItem<TFields extends object>(
  list: ListName,
  itemId: string,
  fields: Partial<TFields>,
): Promise<void> {
  const siteId = await getSiteId()
  const listId = await getListId(list)
  await graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export { graphFetch }
