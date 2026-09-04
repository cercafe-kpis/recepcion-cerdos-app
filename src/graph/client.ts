import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { msalInstance } from '../auth/msalInstance'
import { graphScopes } from '../auth/msalConfig'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'

const SP_HOSTNAME = import.meta.env.VITE_SP_HOSTNAME as string
const SP_SITE_PATH = import.meta.env.VITE_SP_SITE_PATH as string

const TOKEN_TIMEOUT_MS = 15000

/**
 * Envuelve una promesa con un límite de tiempo propio. No cancela la promesa
 * original — MSAL no expone una forma de abortar acquireTokenSilent — pero
 * evita que la app se quede esperando para siempre una respuesta que nunca
 * llega: con señal débil, la técnica interna de MSAL para renovar el token
 * (un iframe oculto contra Microsoft) puede quedarse colgada en vez de
 * fallar rápido. Mismo patrón que ya usa la app HGP7 para este mismo
 * problema.
 */
function conLimiteDeTiempo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(mensaje)), ms)
    promesa.then(
      (valor) => {
        clearTimeout(temporizador)
        resolve(valor)
      },
      (error) => {
        clearTimeout(temporizador)
        reject(error)
      },
    )
  })
}

/**
 * Pide un token de acceso para Graph usando SOLO renovación silenciosa —
 * NUNCA abre una ventana emergente ni redirige la página por su cuenta. Esa
 * es la diferencia clave con una versión anterior de esta función: cada vez
 * que la renovación silenciosa fallaba (por ejemplo porque el navegador
 * bloquea las cookies de terceros que esa técnica usa como respaldo, algo
 * cada vez más común incluso fuera de InPrivate), esta función abría
 * automáticamente `acquireTokenPopup`/`loginPopup` — eso era la ventanita
 * en blanco que se veía y se cerraba sola en cada carga de la app.
 *
 * El patrón correcto (el mismo que ya usa HGP7, ver su useAuthToken.ts) es
 * que una renovación automática de token en segundo plano NUNCA debe
 * interrumpir a quien usa la app: si falla, se lanza un error controlado y
 * quien llama decide qué hacer — en esta app, useCurrentUser.ts ya cae a la
 * copia local en Dexie cuando esto pasa. Un login interactivo de verdad
 * solo debe pasar cuando la persona lo pide explícitamente: tocando
 * "Iniciar sesión" en PantallaLogin, o "Salir" y volviendo a entrar.
 */
async function getAccessToken(): Promise<string> {
  // getActiveAccount() y getAllAccounts() son cosas distintas para MSAL: la primera es solo un
  // "puntero" a cuál cuenta usar, que en el celular a veces se pierde (el navegador limpia justo
  // ese dato) aunque la cuenta siga guardada — ahí la barra superior seguía mostrando el usuario
  // (useCurrentUser.ts lee accounts[0] de useMsal(), no getActiveAccount()) pero cualquier pedido
  // a Graph fallaba con "No hay una sesión activa". Si pasa, se recupera solo usando la primera
  // cuenta guardada y se vuelve a marcar como activa, en vez de obligar a cerrar e iniciar sesión
  // de nuevo por algo que la app puede resolver sola.
  let account = msalInstance.getActiveAccount()
  if (!account) {
    const [primera] = msalInstance.getAllAccounts()
    if (!primera) {
      throw new Error('No hay una sesión activa de Microsoft. Inicia sesión de nuevo.')
    }
    msalInstance.setActiveAccount(primera)
    account = primera
  }
  try {
    const result = await conLimiteDeTiempo(
      msalInstance.acquireTokenSilent({ scopes: graphScopes, account }),
      TOKEN_TIMEOUT_MS,
      'Se agotó el tiempo de espera confirmando la sesión con Microsoft.',
    )
    return result.accessToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      throw new Error('Tu sesión de Microsoft venció. Cierra sesión (botón "Salir") y vuelve a iniciar sesión.')
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
      // Las columnas que esta app usa en $filter (Correo, Consecutivo,
      // RecepcionId) no están indexadas en SharePoint por defecto. Sin este
      // header, Graph responde 400 Bad Request apenas la lista supera un
      // umbral de elementos (o incluso antes, según la lista) — con él,
      // permite la consulta aunque no sea la más eficiente posible.
      Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly',
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
  | 'GruposAsociados'
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

/**
 * Borra DEFINITIVAMENTE un elemento de una lista de SharePoint — a diferencia
 * de "Desactivar" (que solo apaga el campo Activo/Activa), esto no se puede
 * deshacer desde la app. Se usa desde el botón "Eliminar" de las pantallas de
 * administración de maestros (Asociados/GruposAsociados/Granjas/Vehiculos/
 * Usuarios), protegido en la interfaz para que solo un Administrador lo vea
 * (ver ProtegidoPorRol.tsx y el chequeo `usuario.Rol` en cada pantalla).
 * Nunca se usa con las 4 listas transaccionales: ahí un registro se
 * actualiza (EstadoSync, Tiquete/Destino, etc.), nunca se borra. Cada
 * pantalla avisa antes de llamar a esto porque borrar un registro que otro
 * todavía referencia como Lookup (una Granja que pertenece a este Asociado,
 * una Recepción que usa esta Placa, etc.) deja esa referencia apuntando a un
 * elemento que ya no existe.
 */
export async function deleteItem(list: ListName, itemId: string): Promise<void> {
  const siteId = await getSiteId()
  const listId = await getListId(list)
  await graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}`, { method: 'DELETE' })
}

export { graphFetch }
