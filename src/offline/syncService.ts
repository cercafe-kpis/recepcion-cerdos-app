import { db } from './db'
import {
  actualizarTiquete,
  crearNovedadCorralEnSharePoint,
  crearRecepcionEnSharePoint,
  crearUbicacionEnSharePoint,
  existeConsecutivo,
  generarTiqueteMuertoReposo,
  generarTiquetesFaltantes,
  listarAsociados,
  listarGranjas,
  listarTiquetesDeRecepcion,
  listarUsuarios,
  listarVehiculos,
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
  const [asociados, granjas, vehiculos, usuarios] = await Promise.all([
    listarAsociados(),
    listarGranjas(),
    listarVehiculos(),
    listarUsuarios(),
  ])
  await db.transaction(
    'rw',
    [db.asociados, db.granjas, db.vehiculos, db.usuarios, db.meta],
    async () => {
      await db.asociados.clear()
      await db.asociados.bulkPut(asociados)
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
export async function sincronizar(usuarioActual: string): Promise<ResultadoSync> {
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

  return resultado
}

async function sincronizarRecepciones(usuarioActual: string, resultado: ResultadoSync): Promise<void> {
  const pendientes = await db.recepciones.where('EstadoSync').equals('Pendiente').toArray()

  for (const rec of pendientes) {
    try {
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

async function sincronizarUbicaciones(resultado: ResultadoSync): Promise<void> {
  const pendientes = await db.ubicaciones.where('EstadoSync').equals('Pendiente').toArray()

  for (const ubic of pendientes) {
    try {
      const padre = await db.recepciones.get(ubic.RecepcionId)
      if (!padre?.spId) continue // se reintenta en la próxima corrida, cuando el padre ya tenga spId

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

      const { id: _id, spId: _spId, RecibidaEn: _RecibidaEn, ...campos } = nov
      const { spId, RecibidaEn } = await crearNovedadCorralEnSharePoint({ ...campos, RecepcionId: padre.spId })
      const novedadSincronizada: NovedadCorral = { ...nov, spId, RecibidaEn, EstadoSync: 'Sincronizada' }
      await db.novedadesCorral.update(nov.id, { spId, RecibidaEn, EstadoSync: 'Sincronizada' })

      await generarTiqueteMuertoReposo(novedadSincronizada, { spId: padre.spId })
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
 * vía generarTiquetesFaltantes/generarTiqueteMuertoReposo): lo que se
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
 * Trae de Graph los tiquetes de una Recepción ya sincronizada y los guarda
 * en Dexie, para que la pantalla Consolidado los tenga disponibles aunque
 * se pierda la conexión justo después. Se llama automáticamente al generar
 * tiquetes nuevos durante sincronizar(), y también la usa Consolidado.tsx
 * como botón de "Actualizar" manual.
 */
export async function cachearTiquetesDeRecepcion(recepcionSpId: string): Promise<void> {
  const tiquetes = await listarTiquetesDeRecepcion(recepcionSpId)
  await db.consolidadoTiquetes.bulkPut(tiquetes)
}

/** Registra localmente (siempre, con o sin conexión) la edición de un tiquete hecha en pantalla. */
export async function guardarEdicionTiqueteLocal(
  id: string,
  cambios: Partial<Pick<ConsolidadoTiquete, 'Tiquete' | 'Destino' | 'Factura' | 'FechaDespacho' | 'FechaBeneficio'>>,
): Promise<void> {
  await db.consolidadoTiquetes.update(id, { ...cambios, EstadoSync: 'Pendiente' })
}
