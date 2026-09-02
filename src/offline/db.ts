import Dexie, { type Table } from 'dexie'
import type {
  Asociado,
  ConsolidadoTiquete,
  Granja,
  NovedadCorral,
  Recepcion,
  Ubicacion,
  Usuario,
  Vehiculo,
} from '../types/models'

/**
 * Base local (IndexedDB, vía Dexie) que hace posible capturar sin conexión.
 * Dos familias de tablas, igual que en Arquitectura-App-Recepcion-Cerdos.md
 * sección 5:
 *
 *  - "Maestros" (asociados/granjas/vehiculos/usuarios): una copia de solo
 *    lectura de lo que hay en SharePoint, refrescada cuando hay conexión
 *    (ver descargarMaestros() en syncService.ts). Los combos de captura leen
 *    de aquí siempre, con o sin internet.
 *  - "Transaccionales" (recepciones/ubicaciones/novedadesCorral/
 *    consolidadoTiquetes): la cola de lo capturado en este dispositivo.
 *    Todo registro nuevo se guarda aquí primero, con EstadoSync='Pendiente'
 *    y un id local (UUID); sincronizar() (syncService.ts) los sube a Graph
 *    y actualiza el mismo registro con spId/RecibidaEn/EstadoSync.
 *
 * Nunca se borra un registro transaccional al sincronizar: se actualiza en
 * el sitio, así la app puede seguir mostrando el historial de este
 * dispositivo (sincronizado o no) sin volver a pedirlo a Graph.
 */
export class RecepcionCerdosDB extends Dexie {
  asociados!: Table<Asociado, string>
  granjas!: Table<Granja, string>
  vehiculos!: Table<Vehiculo, string>
  usuarios!: Table<Usuario, string>

  recepciones!: Table<Recepcion, string>
  ubicaciones!: Table<Ubicacion, string>
  novedadesCorral!: Table<NovedadCorral, string>
  consolidadoTiquetes!: Table<ConsolidadoTiquete, string>

  /** Metadatos internos — hoy solo la fecha del último descargarMaestros(). */
  meta!: Table<{ clave: string; valor: string }, string>

  constructor() {
    super('recepcion-cerdos-db')

    // Dexie solo necesita declarar las columnas que se van a indexar/buscar
    // (`id` como llave primaria, más lo que se filtra en consultas); el
    // resto de los campos de cada tipo se guardan igual, sin declarar.
    this.version(1).stores({
      asociados: 'id, Activo',
      granjas: 'id, AsociadoId, Activa',
      vehiculos: 'id, AsociadoId, Activo',
      usuarios: 'id, Correo',

      recepciones: 'id, spId, Consecutivo, EstadoSync, FechaRecepcion',
      ubicaciones: 'id, spId, RecepcionId, EstadoSync',
      novedadesCorral: 'id, spId, RecepcionId, EstadoSync',
      consolidadoTiquetes: 'id, spId, RecepcionId, EstadoSync, EstadoTiquete',

      meta: 'clave',
    })

    // v2: agrega el índice CapturadaEn en recepciones. Ubicacion.tsx y
    // NovedadesCorral.tsx ordenan las recepciones por esa columna
    // (db.recepciones.orderBy('CapturadaEn')) para mostrar primero las más
    // recientes en el selector de "a qué recepción pertenece" — sin el
    // índice, Dexie lanza un SchemaError no capturado y esas dos pantallas
    // quedan en blanco. Dexie migra solo, sin perder datos, cualquier
    // dispositivo que ya hubiera creado la versión 1 de esta base local.
    this.version(2).stores({
      recepciones: 'id, spId, Consecutivo, EstadoSync, FechaRecepcion, CapturadaEn',
    })
  }
}

export const db = new RecepcionCerdosDB()

/** Cuántos registros de este dispositivo siguen sin subir — para el badge de la barra superior. */
export async function contarPendientes(): Promise<number> {
  const [r, u, n, c] = await Promise.all([
    db.recepciones.where('EstadoSync').equals('Pendiente').count(),
    db.ubicaciones.where('EstadoSync').equals('Pendiente').count(),
    db.novedadesCorral.where('EstadoSync').equals('Pendiente').count(),
    db.consolidadoTiquetes.where('EstadoSync').equals('Pendiente').count(),
  ])
  return r + u + n + c
}

/** Igual que arriba, pero solo los que necesitan revisión de un Administrador (choque de Consecutivo). */
export async function contarConflictos(): Promise<number> {
  return db.recepciones.where('EstadoSync').equals('ConflictoConsecutivo').count()
}
