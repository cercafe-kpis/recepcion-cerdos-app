import { db } from './db'
import {
  actualizarTiquete,
  crearNovedadCorralEnSharePoint,
  crearRecepcionEnSharePoint,
  crearUbicacionEnSharePoint,
  existeConsecutivo,
  existeRecepcionEnSharePoint,
  generarTiquetesFaltantes,
  generarTiquetesNovedadCorral,
  listarAsociados,
  listarGranjas,
  listarGruposAsociados,
  listarIdsDeRecepciones,
  listarRecepcionesEnProceso,
  listarTiquetesDeRecepcion,
  listarUsuarios,
  listarVehiculos,
  obtenerNovedadCorralDeRecepcion,
  registrarLog,
} from '../graph/lists'
import type { ConsolidadoTiquete, NovedadCorral, Recepcion } from '../types/models'

/**
 * Refresca la copia local de los maestros desde SharePoint. Se llama al
 * iniciar sesión con conexión y cuando el usuario lo pide a mano — nunca
 * automáticamente en segundo plano, para no gastar datos sin que el usuario
 * lo note. Los combos de captura (Asociado/Granja/Placa) siempre leen de
 * Dexie, así que después de esto siguen funcionando aunque se pierda la
 * conexión un minuto más tarde.
 */
export async function descargarMaestros(): Promise<void> {
  const [asociados, gruposAsociados, granjas, vehiculos, usuarios] = await Promise.all([
    listarAsociados(),
    listarGruposAsociados(),
    listarGranjas(),
    listarVehiculos(),
    listarUsuarios(),
  ])
  await db.transaction(
    'rw',
    [db.asociados, db.gruposAsociados, db.granjas, db.vehiculos, db.usuarios, db.meta],
    async () => {
      await db.asociados.clear()
      await db.asociados.bulkPut(asociados)
      await db.gruposAsociados.clear()
      await db.gruposAsociados.bulkPut(gruposAsociados)
      await db.granjas.clear()
      await db.granjas.bulkPut(granjas)
      await db.vehiculos.clear()
      await db.vehiculos.bulkPut(vehiculos)
      await db.usuarios.clear()
      await db.usuarios.bulkPut(usuarios)
      await db.meta.put({ clave: 'maestrosActualizadosEn', valor: new Date().toISOString() })
    },
  )
}

/**
 * Trae las Recepciones "En proceso" que ya existen en SharePoint pero que
 * este dispositivo no capturó — sin esto, Ubicación/NovedadesCorral/
 * Consolidado solo podían trabajar sobre lo que se había capturado EN ESE
 * MISMO dispositivo, porque la sincronización solo subía, nunca bajaba
 * (a diferencia de descargarMaestros(), que sí trae Asociados/Granjas/etc. a
 * todos los dispositivos). Se llama sola dentro de sincronizar() —no hace
 * falta un botón aparte— y también una vez al abrir la app (ver App.tsx).
 *
 * Se salta cualquier Recepción cuyo `spId` ya esté en Dexie (la haya
 * capturado este dispositivo o ya se hubiera descargado antes), para no
 * duplicarla ni pisar una edición que no debería existir — las Recepciones
 * no se editan una vez capturadas.
 */
export async function descargarRecepcionesEnProceso(): Promise<void> {
  const remotas = await listarRecepcionesEnProceso()
  for (const rec of remotas) {
    const local = await db.recepciones.where('spId').equals(rec.spId as string).first()
    if (!local) {
      await db.recepciones.put(rec)
      continue
    }
    // Autocorrección puntual: un dispositivo que ya haya descargado esta Recepción ANTES de que
    // graph/lists.ts corrigiera cómo interpreta lo que Graph devuelve se queda con el valor viejo
    // guardado en Dexie para siempre — el `if (!local)` de arriba lo salta en cada sincronización
    // futura. Estos 2 parches solo tocan el campo puntual que corrigen, nunca el resto del
    // registro, y dejan de tener efecto (la comparación ya no encuentra diferencia) en cuanto el
    // valor local se pone al día.
    const cambios: Partial<Recepcion> = {}
    // (2026-09-24) FechaRecepcion pasó de fecha-hora completa ("2026-09-24T05:00:00Z") a solo
    // fecha ("2026-09-24") — ver el comentario de esa normalización en mapFieldsARecepcion() — lo
    // que escondía la Recepción del desplegable de "hoy" en Consolidado/Ubicación/NovedadesCorral.
    if (local.FechaRecepcion !== rec.FechaRecepcion) cambios.FechaRecepcion = rec.FechaRecepcion
    // (2026-09-28) Las 4 horas (HoraProgramada y compañía) pasaron a corregirse por el desfase con
    // el que Graph las devuelve — ver horaDeGraphAHoraLocal() en graph/lists.ts, a raíz de que a
    // Nathalia el reporte de una Recepción le mostraba la hora de la tarde en vez de la de la
    // mañana. Se compara cada una por separado porque HoraInicioDesembarque/HoraFinalDesembarque
    // pueden quedar sin valor (`undefined`) si el lote llegó después de la jornada.
    if (local.HoraProgramada !== rec.HoraProgramada) cambios.HoraProgramada = rec.HoraProgramada
    if (local.HoraLlegadaVehiculo !== rec.HoraLlegadaVehiculo) cambios.HoraLlegadaVehiculo = rec.HoraLlegadaVehiculo
    if (local.HoraInicioDesembarque !== rec.HoraInicioDesembarque) cambios.HoraInicioDesembarque = rec.HoraInicioDesembarque
    if (local.HoraFinalDesembarque !== rec.HoraFinalDesembarque) cambios.HoraFinalDesembarque = rec.HoraFinalDesembarque
    if (Object.keys(cambios).length > 0) {
      await db.recepciones.update(local.id, cambios)
    }
  }
}

/**
 * Quita de este dispositivo las Recepciones que ya fueron BORRADAS en SharePoint (reportado por
 * Nathalia el 2026-10-09: borró un lote de prueba de la lista y la app lo seguía mostrando, con todos
 * sus datos, en los buscadores de Consolidado/Ubicación/Novedades en Corral). Ninguna otra
 * sincronización lo detectaba: solo se agregaba y actualizaba, nunca se quitaba una Recepción local.
 *
 * Solo revisa las que YA se subieron (tienen `spId` y están "Sincronizada") — una captura pendiente de
 * subir no existe todavía en SharePoint y nunca se toca. Para no borrar por error: primero se compara
 * contra la lista de ids de SharePoint, y cada ausente se confirma individualmente (un 404 de verdad)
 * antes de borrarlo, así una lista truncada o una falla pasajera nunca elimina nada local.
 *
 * Al quitar una Recepción también se quitan sus Ubicaciones, Novedades en Corral y tiquetes locales:
 * sin su padre ya no sirven para nada (y las pendientes de subir nunca podrían subirse).
 *
 * Devuelve cuántas Recepciones quitó. No lanza: es mantenimiento y no debe frenar la sincronización.
 */
export async function limpiarRecepcionesBorradas(): Promise<number> {
  try {
    const candidatas = (await db.recepciones.toArray()).filter((r) => r.spId && r.EstadoSync === 'Sincronizada')
    if (candidatas.length === 0) return 0

    const idsEnSharePoint = await listarIdsDeRecepciones()
    let quitadas = 0
    for (const rec of candidatas) {
      const spId = rec.spId as string
      if (idsEnSharePoint.has(spId)) continue
      if (await existeRecepcionEnSharePoint(spId)) continue // solo faltaba en la lista (truncada)

      await db.transaction('rw', db.recepciones, db.ubicaciones, db.novedadesCorral, db.consolidadoTiquetes, async () => {
        await db.ubicaciones.where('RecepcionId').equals(rec.id).delete()
        await db.novedadesCorral.where('RecepcionId').equals(rec.id).delete()
        await db.consolidadoTiquetes.where('RecepcionId').equals(spId).delete()
        await db.recepciones.delete(rec.id)
      })
      quitadas++
    }
    return quitadas
  } catch {
    return 0 // sin conexión o sin sesión: se reintenta en la próxima sincronización
  }
}

export interface ResultadoSync {
  recepcionesSubidas: number
  ubicacionesSubidas: number
  novedadesSubidas: number
  tiquetesSubidos: number
  conflictosConsecutivo: number
  errores: string[]
}

/**
 * Sube toda la cola local pendiente. Orden fijo y no negociable: Recepciones
 * primero (todo lo demás depende de conocer su spId real), luego Ubicacion y
 * NovedadesCorral (en cualquier orden entre ellas), y al final las ediciones
 * de ConsolidadoTiquetes. Un registro cuyo padre todavía no tiene spId se
 * deja como está — se reintenta en la próxima llamada a sincronizar(), no
 * dentro de esta misma corrida, para no reordenar por encima del límite de
 * reintentos de Graph.
 *
 * No lanza si algo falla: acumula el error en `errores` y sigue con el
 * resto de la cola, para que un registro problemático no bloquee a los
 * demás. Pensado para llamarse periódicamente cuando `navigator.onLine` es
 * true (ver src/offline/useSyncOnReconnect.ts, pendiente de construir).
 */
/**
 * Punto de entrada ÚNICO de la sincronización: garantiza que nunca corran dos sincronizaciones a la
 * vez en este dispositivo (2026-10-08, a raíz de un caso real: dos copias idénticas de la misma
 * Novedad en Corral del lote 87 en SharePoint — mismo `CapturadaEn`, `RecibidaEn` y `Created` hasta
 * el segundo, y 5 tiquetes de más que alguien tuvo que borrar con "Eliminar").
 *
 * Causa: sincronizar() la dispara MUCHO más de un sitio — el propio "Guardar" de cada formulario,
 * el temporizador y el regreso a la pestaña (App.tsx), el botón de la barra superior, Consolidado —
 * y antes nada impedía que dos corridas coincidieran. Ambas leían la misma captura como
 * "Pendiente" (la primera todavía no alcanzaba a marcarla "Sincronizada"), ambas la subían, y
 * además ambas generaban sus tiquetes al mismo tiempo, cada una sin ver los de la otra.
 *
 * Cómo se evita:
 *  1. Cola dentro de la pestaña: cada corrida espera a que termine la anterior, y recién ahí lee
 *     lo pendiente — así ya ve las capturas marcadas "Sincronizada" por la corrida anterior.
 *  2. Si ya hay una corrida ESPERANDO su turno (no ha empezado), las demás llamadas reutilizan esa
 *     misma — leerá todo lo pendiente cuando le toque, así que no hace falta apilar más.
 *  3. Candado entre pestañas (Web Locks): si la app está abierta en dos pestañas del mismo
 *     navegador (comparten la misma base local Dexie), también se turnan. Si el navegador no
 *     soporta Web Locks, queda solo la cola del punto 1.
 */
let colaDeSincronizacion: Promise<unknown> = Promise.resolve()
let corridaEnEspera: Promise<ResultadoSync> | undefined

function conCandadoEntrePestanas<T>(tarea: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: { request: (nombre: string, cb: () => Promise<T>) => Promise<T> } }).locks
  if (!locks) return tarea()
  return locks.request('recepcion-cerdos-sincronizar', tarea)
}

export function sincronizar(usuarioActual: string): Promise<ResultadoSync> {
  if (corridaEnEspera) return corridaEnEspera
  const turno = colaDeSincronizacion.then(() => {
    corridaEnEspera = undefined // ya le tocó: una llamada nueva debe encolar otra corrida detrás
    return conCandadoEntrePestanas(() => sincronizarUnaVez(usuarioActual))
  })
  corridaEnEspera = turno
  colaDeSincronizacion = turno.catch(() => undefined)
  return turno
}

async function sincronizarUnaVez(usuarioActual: string): Promise<ResultadoSync> {
  const resultado: ResultadoSync = {
    recepcionesSubidas: 0,
    ubicacionesSubidas: 0,
    novedadesSubidas: 0,
    tiquetesSubidos: 0,
    conflictosConsecutivo: 0,
    errores: [],
  }

  await sincronizarRecepciones(usuarioActual, resultado)
  await sincronizarUbicaciones(resultado)
  await sincronizarNovedadesCorral(resultado)
  await sincronizarTiquetesPendientes(resultado)

  try {
    await descargarRecepcionesEnProceso()
  } catch (err) {
    resultado.errores.push(`No se pudieron traer las Recepciones en proceso de otros dispositivos: ${(err as Error).message}`)
  }

  await limpiarRecepcionesBorradas()

  // Antes, un error de sincronización (por ejemplo, que Graph rechace crear
  // un ConsolidadoTiquetes por faltarle una columna obligatoria) solo quedaba
  // en `resultado.errores` — nadie lo mostraba en pantalla, así que una
  // Recepción podía quedar marcada "Sincronizada" con parte de su
  // información realmente perdida, sin que nadie se enterara. Se guarda en
  // Dexie (no solo en el valor de retorno) para que CUALQUIER pantalla que
  // dispare sincronizar() —no solo el botón de la barra superior— pueda
  // mostrar el aviso; ver el banner en Navbar.tsx. No se borra solo: se
  // queda hasta que alguien lo descarta a propósito, para no perderlo si la
  // siguiente sincronización automática no tiene nada más que subir.
  if (resultado.errores.length > 0) {
    await db.meta.put({
      clave: 'ultimoErrorSync',
      valor: JSON.stringify({ mensajes: resultado.errores, en: new Date().toISOString() }),
    })
  }

  return resultado
}

/**
 * Segunda red de seguridad contra subir dos veces la misma captura (la primera es la cola de
 * sincronizar(), arriba): justo antes de mandarla a SharePoint se vuelve a leer su estado actual en
 * Dexie — la lista `pendientes` se leyó al empezar la corrida y pudo haber cambiado mientras tanto.
 * Si ya no está "Pendiente" (otra corrida o pestaña ya la subió), se salta.
 */
async function sigueSiendoPendiente(
  tabla: { get: (id: string) => PromiseLike<{ EstadoSync: string } | undefined> },
  id: string,
): Promise<boolean> {
  const actual = await tabla.get(id)
  return actual?.EstadoSync === 'Pendiente'
}

async function sincronizarRecepciones(usuarioActual: string, resultado: ResultadoSync): Promise<void> {
  const pendientes = await db.recepciones.where('EstadoSync').equals('Pendiente').toArray()

  for (const rec of pendientes) {
    try {
      if (!(await sigueSiendoPendiente(db.recepciones, rec.id))) continue
      if (await existeConsecutivo(rec.Consecutivo)) {
        await db.recepciones.update(rec.id, { EstadoSync: 'ConflictoConsecutivo' })
        resultado.conflictosConsecutivo++
        continue
      }

      const { id: _id, spId: _spId, RecibidaEn: _RecibidaEn, ...campos } = rec
      const { spId, RecibidaEn } = await crearRecepcionEnSharePoint(campos)
      await db.recepciones.update(rec.id, { spId, RecibidaEn, EstadoSync: 'Sincronizada' })

      const recepcionSincronizada: Recepcion = { ...rec, spId, RecibidaEn, EstadoSync: 'Sincronizada' }
      await generarTiquetesFaltantes(recepcionSincronizada)
      await cachearTiquetesDeRecepcion(spId)

      await registrarLog({
        RecepcionId: spId,
        Usuario: usuarioActual,
        Accion: 'Recepción sincronizada',
        DetalleJson: JSON.stringify({ Consecutivo: rec.Consecutivo }),
        CreadoEn: RecibidaEn,
      }).catch(() => undefined) // la bitácora nunca debe tumbar la sincronización

      resultado.recepcionesSubidas++
    } catch (err) {
      resultado.errores.push(`Recepción ${rec.Consecutivo}: ${(err as Error).message}`)
    }
  }
}

/**
 * Corrige el Consecutivo/Número de orden de una Recepción que quedó en `EstadoSync:
 * 'ConflictoConsecutivo'` (dos dispositivos capturaron el mismo Consecutivo estando ambos sin
 * conexión — ver el `continue` de arriba en `sincronizarRecepciones`) y la vuelve a poner en
 * `'Pendiente'` para que la próxima sincronización la reintente. No hace falta repetir aquí la
 * validación de `existeConsecutivo()`: `sincronizarRecepciones()` ya la vuelve a hacer en ese
 * reintento, y si el número nuevo también choca, la Recepción simplemente vuelve a quedar en
 * conflicto. Usada desde el panel "Consecutivos repetidos" en Consolidado.tsx (solo Administrador —
 * a pedido de Nathalia 2026-09-29, primer caso real de este conflicto en producción: antes la app
 * solo avisaba cuántos había, en el badge de Navbar.tsx, pero no existía ninguna forma de
 * resolverlos desde la interfaz).
 */
export async function corregirConsecutivoConflicto(
  id: string,
  cambios: { Consecutivo: string; NumeroOrden: string },
): Promise<void> {
  await db.recepciones.update(id, { ...cambios, EstadoSync: 'Pendiente' })
}

/**
 * Descarta por completo una Recepción atascada en `'ConflictoConsecutivo'` — para cuando la captura
 * duplicada no hace falta recuperar (a diferencia de `corregirConsecutivoConflicto()`, esto NO
 * intenta subirla a SharePoint: la borra de este dispositivo, sin poder deshacerse). También borra
 * cualquier Ubicación/Novedad en Corral que ya se hubiera capturado localmente para esta misma
 * Recepción — `sincronizarUbicaciones()`/`sincronizarNovedadesCorral()` esperan a que el padre tenga
 * `spId` antes de subir a sus hijos (`if (!padre?.spId) continue`), y una Recepción descartada nunca
 * va a tenerlo, así que sin este borrado esos registros se quedarían reintentando para siempre, sin
 * ningún aviso en pantalla ni forma de notar el problema.
 */
export async function descartarRecepcionConflicto(id: string): Promise<void> {
  await db.transaction('rw', db.recepciones, db.ubicaciones, db.novedadesCorral, async () => {
    await db.ubicaciones.where('RecepcionId').equals(id).delete()
    await db.novedadesCorral.where('RecepcionId').equals(id).delete()
    await db.recepciones.delete(id)
  })
}

async function sincronizarUbicaciones(resultado: ResultadoSync): Promise<void> {
  const pendientes = await db.ubicaciones.where('EstadoSync').equals('Pendiente').toArray()

  for (const ubic of pendientes) {
    try {
      const padre = await db.recepciones.get(ubic.RecepcionId)
      if (!padre?.spId) continue // se reintenta en la próxima corrida, cuando el padre ya tenga spId
      if (!(await sigueSiendoPendiente(db.ubicaciones, ubic.id))) continue

      const { id: _id, spId: _spId, RecibidaEn: _RecibidaEn, ...campos } = ubic
      const { spId, RecibidaEn } = await crearUbicacionEnSharePoint({ ...campos, RecepcionId: padre.spId })
      await db.ubicaciones.update(ubic.id, { spId, RecibidaEn, EstadoSync: 'Sincronizada' })
      resultado.ubicacionesSubidas++
    } catch (err) {
      resultado.errores.push(`Ubicación ${ubic.id}: ${(err as Error).message}`)
    }
  }
}

async function sincronizarNovedadesCorral(resultado: ResultadoSync): Promise<void> {
  const pendientes = await db.novedadesCorral.where('EstadoSync').equals('Pendiente').toArray()

  for (const nov of pendientes) {
    try {
      const padre = await db.recepciones.get(nov.RecepcionId)
      if (!padre?.spId) continue
      if (!(await sigueSiendoPendiente(db.novedadesCorral, nov.id))) continue

      const { id: _id, spId: _spId, RecibidaEn: _RecibidaEn, ...campos } = nov
      const { spId, RecibidaEn } = await crearNovedadCorralEnSharePoint({ ...campos, RecepcionId: padre.spId })
      const novedadSincronizada: NovedadCorral = { ...nov, spId, RecibidaEn, EstadoSync: 'Sincronizada' }
      await db.novedadesCorral.update(nov.id, { spId, RecibidaEn, EstadoSync: 'Sincronizada' })

      // Los tiquetes se generan a partir de la SUMA de TODOS los registros de Novedades en Corral
      // del lote, no solo del que se acaba de subir. generarTiquetesNovedadCorral() compara la
      // cantidad que recibe contra los tiquetes que el lote YA tiene: con solo este registro, un
      // segundo envío con "1 caído, beneficio de emergencia 1" para un lote que ya tenía 1 caído
      // comparaba 1 contra 1 y no creaba nada — el tiquete nuevo no aparecía en Consolidado hasta que
      // un Administrador usaba "Volver a generar tiquetes" (que sí suma los registros). Reportado por
      // Nathalia el 2026-10-09. Es la misma suma que usan los reportes.
      const combinada = await obtenerNovedadCorralDeRecepcion(padre.spId, novedadSincronizada)
      await generarTiquetesNovedadCorral(combinada ?? novedadSincronizada, {
        spId: padre.spId,
        Consecutivo: padre.Consecutivo,
      })
      await cachearTiquetesDeRecepcion(padre.spId)
      resultado.novedadesSubidas++
    } catch (err) {
      resultado.errores.push(`Novedad de corral ${nov.id}: ${(err as Error).message}`)
    }
  }
}

/**
 * A diferencia de las tres anteriores, ConsolidadoTiquetes no crea filas
 * nuevas desde el dispositivo (esas las genera el propio servidor de sync
 * vía generarTiquetesFaltantes/generarTiquetesNovedadCorral): lo que se
 * sincroniza aquí son las EDICIONES hechas en la pantalla Consolidado
 * (asignar Tiquete y Destino a un animal) mientras no había conexión.
 */
async function sincronizarTiquetesPendientes(resultado: ResultadoSync): Promise<void> {
  const pendientes = await db.consolidadoTiquetes.where('EstadoSync').equals('Pendiente').toArray()

  for (const t of pendientes) {
    try {
      if (!t.spId) continue // la fila la crea el servidor al sincronizar su Recepción/NovedadCorral padre
      await actualizarTiquete(t.spId, {
        Tiquete: t.Tiquete,
        Destino: t.Destino,
        Factura: t.Factura,
        FechaDespacho: t.FechaDespacho,
        FechaBeneficio: t.FechaBeneficio,
      })
      await db.consolidadoTiquetes.update(t.id, { EstadoSync: 'Sincronizada' })
      resultado.tiquetesSubidos++
    } catch (err) {
      resultado.errores.push(`Tiquete ${t.id}: ${(err as Error).message}`)
    }
  }
}

/**
 * Antes, esta función (`cerrarLotesCompletos`) marcaba sola una Recepción
 * como "Completo" apenas todos sus tiquetes tenían Tiquete+Destino — pero
 * eso pasa (ver actualizarTiquete() en graph/lists.ts) SIN esperar a que los
 * Fortuitos tengan Factura, así que un lote podía cerrarse solo, bloqueando
 * la edición para no-Administradores (ver el candado en Consolidado.tsx),
 * antes de que alguien alcanzara a ponerle la factura a un Fortuito. A
 * pedido explícito de Nathalia (2026-09-09), cerrar un lote ahora es una
 * acción manual — el botón "Terminar proceso" en Consolidado.tsx, que llama
 * directamente a marcarLoteCompleto() — precisamente porque el proceso se
 * hace en varias partes/sesiones y hace falta un punto final explícito, en
 * vez de que el sistema adivine solo cuándo ya "quedó totalmente
 * gestionada". Como consecuencia, un lote sin ese clic se sigue trayendo
 * como "En proceso" (ver listarRecepcionesEnProceso) indefinidamente — a
 * cambio de la garantía de que nunca se cierra antes de tiempo.
 */

/**
 * Trae de Graph los tiquetes de una Recepción ya sincronizada y los guarda
 * en Dexie, para que la pantalla Consolidado los tenga disponibles aunque
 * se pierda la conexión justo después. Se llama automáticamente al generar
 * tiquetes nuevos durante sincronizar(), y también la usa Consolidado.tsx
 * como botón de "Actualizar" manual.
 *
 * Además de agregar/actualizar (bulkPut), BORRA de Dexie cualquier tiquete de
 * esta Recepción que ya no venga en la respuesta de Graph (2026-09-24, bug
 * reportado por Nathalia: eliminó una novedad en Consolidado desde el celular
 * y en el computador seguía apareciendo). Antes esta función solo agregaba —
 * nunca sacaba nada — así que un tiquete borrado con eliminarTiquete() en
 * OTRO dispositivo se quedaba huérfano para siempre en cualquier dispositivo
 * que ya lo hubiera cacheado antes del borrado, sin importar cuántas veces
 * se le diera a "Actualizar desde SharePoint". Es seguro comparar por `id`
 * porque, a diferencia de Recepcion/Ubicacion/NovedadCorral, un
 * ConsolidadoTiquete SIEMPRE se crea directo contra Graph (nunca sin
 * conexión) — ver el comentario en listarTiquetesDeRecepcion() — así que no
 * existe un tiquete "pendiente de subir" con id solo local que este borrado
 * pudiera pisar por error.
 */
export async function cachearTiquetesDeRecepcion(recepcionSpId: string): Promise<void> {
  const tiquetes = await listarTiquetesDeRecepcion(recepcionSpId)
  const idsFrescos = new Set(tiquetes.map((t) => t.id))
  await db.transaction('rw', db.consolidadoTiquetes, async () => {
    // Una edición hecha aquí que todavía no subió a SharePoint (EstadoSync 'Pendiente') NO se
    // pisa con la versión de SharePoint, que todavía no la tiene. Importa desde que Consolidado se
    // refresca solo cada pocos segundos (ver el efecto de refresco automático en Consolidado.tsx):
    // sin esto, un Tiquete/Destino guardado sin conexión podía borrarse justo antes de sincronizar.
    const localesAntes = await db.consolidadoTiquetes.where('RecepcionId').equals(recepcionSpId).toArray()
    const pendientesLocales = new Set(localesAntes.filter((t) => t.EstadoSync === 'Pendiente').map((t) => t.id))
    await db.consolidadoTiquetes.bulkPut(tiquetes.filter((t) => !pendientesLocales.has(t.id)))
    const locales = await db.consolidadoTiquetes.where('RecepcionId').equals(recepcionSpId).toArray()
    const idsABorrar = locales.filter((t) => !idsFrescos.has(t.id)).map((t) => t.id)
    if (idsABorrar.length > 0) {
      await db.consolidadoTiquetes.bulkDelete(idsABorrar)
    }
  })
}

/** Registra localmente (siempre, con o sin conexión) la edición de un tiquete hecha en pantalla. */
export async function guardarEdicionTiqueteLocal(
  id: string,
  cambios: Partial<Pick<ConsolidadoTiquete, 'Tiquete' | 'Destino' | 'Factura' | 'FechaDespacho' | 'FechaBeneficio'>>,
): Promise<void> {
  await db.consolidadoTiquetes.update(id, { ...cambios, EstadoSync: 'Pendiente' })
}
