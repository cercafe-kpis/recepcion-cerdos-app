import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../offline/db'
import type { Usuario } from '../../types/models'

/**
 * Utilidad de mantenimiento, a pedido de Nathalia (2026-09-11): borró a mano todos los registros
 * de las listas transaccionales en SharePoint para empezar pruebas nuevas, pero el desplegable de
 * "Recepción" en Ubicación le seguía mostrando un lote ("111111111") que ya no existía allá.
 *
 * Causa (documentada también en Arquitectura-datos): la copia local en Dexie de este dispositivo
 * es la que alimenta esos desplegables, y un registro transaccional NUNCA se borra solo — el
 * diseño de toda la app es que se actualiza en su sitio al sincronizar, nunca se elimina, para
 * conservar el historial de captura de este dispositivo aunque no haya internet (ver el comentario
 * en db.ts). Eso funciona bien mientras SharePoint solo cambia a través de la propia app, pero si
 * alguien borra datos DIRECTO en SharePoint (como para una prueba nueva), nada le avisa a este
 * dispositivo — el registro se queda huérfano en Dexie hasta que alguien lo limpie a mano.
 *
 * Antes de este botón, la única forma de limpiarlo era entrar a la configuración del navegador y
 * borrar los datos del sitio — lo que de paso borraba TAMBIÉN los combos de Asociado/Granja/
 * Vehículo (maestros), dejando la app sin poder capturar hasta la próxima descarga con conexión.
 * Este botón es más quirúrgico a propósito: borra SOLO las 4 tablas transaccionales (Recepciones,
 * Ubicaciones, Novedades en Corral, Consolidado) de ESTE dispositivo — nunca toca Asociados/
 * Granjas/Vehículos/Usuarios/GruposAsociados (esos siguen haciendo falta para poder seguir
 * trabajando) y NUNCA borra nada en SharePoint, solo la copia local de este navegador.
 *
 * Blindaje explícito para no perder captura real por accidente: antes de borrar, se cuentan y se
 * muestran los registros "Pendiente" (capturados en este dispositivo y todavía sin subir) — si hay
 * alguno, tanto el resumen en pantalla como el diálogo de confirmación lo advierten en rojo, porque
 * esos SÍ se perderían para siempre (no solo de este dispositivo: nunca llegaron a SharePoint).
 */
export function MantenimientoAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'
  const [borrando, setBorrando] = useState(false)
  const [mensaje, setMensaje] = useState<string>()

  const conteos = useLiveQuery(async () => {
    const [
      recepciones,
      recepcionesPendientes,
      ubicaciones,
      ubicacionesPendientes,
      novedades,
      novedadesPendientes,
      tiquetes,
      tiquetesPendientes,
    ] = await Promise.all([
      db.recepciones.count(),
      db.recepciones.where('EstadoSync').equals('Pendiente').count(),
      db.ubicaciones.count(),
      db.ubicaciones.where('EstadoSync').equals('Pendiente').count(),
      db.novedadesCorral.count(),
      db.novedadesCorral.where('EstadoSync').equals('Pendiente').count(),
      db.consolidadoTiquetes.count(),
      db.consolidadoTiquetes.where('EstadoSync').equals('Pendiente').count(),
    ])
    return {
      recepciones,
      recepcionesPendientes,
      ubicaciones,
      ubicacionesPendientes,
      novedades,
      novedadesPendientes,
      tiquetes,
      tiquetesPendientes,
    }
  }, [])

  const totalRegistros =
    (conteos?.recepciones ?? 0) + (conteos?.ubicaciones ?? 0) + (conteos?.novedades ?? 0) + (conteos?.tiquetes ?? 0)
  const totalPendientes =
    (conteos?.recepcionesPendientes ?? 0) +
    (conteos?.ubicacionesPendientes ?? 0) +
    (conteos?.novedadesPendientes ?? 0) +
    (conteos?.tiquetesPendientes ?? 0)

  async function borrarDatosLocales() {
    if (!conteos) return
    const advertenciaPendientes =
      totalPendientes > 0
        ? `\n\n⚠️ OJO: ${totalPendientes} de esos registros todavía NO se han subido a SharePoint (están "Pendiente" por sincronizar) — esos se perderían para siempre, no solo de este dispositivo.`
        : ''
    const continuar = window.confirm(
      `Esto va a borrar SOLO de este dispositivo (no toca SharePoint ni Asociados/Granjas/Vehículos):\n\n` +
        `${conteos.recepciones} Recepciones\n${conteos.ubicaciones} Ubicaciones\n${conteos.novedades} Novedades en Corral\n${conteos.tiquetes} filas de Consolidado` +
        advertenciaPendientes +
        `\n\n¿Continuar?`,
    )
    if (!continuar) return

    setBorrando(true)
    setMensaje(undefined)
    try {
      await db.transaction(
        'rw',
        [db.recepciones, db.ubicaciones, db.novedadesCorral, db.consolidadoTiquetes],
        async () => {
          await db.recepciones.clear()
          await db.ubicaciones.clear()
          await db.novedadesCorral.clear()
          await db.consolidadoTiquetes.clear()
        },
      )
      setMensaje('Datos locales borrados de este dispositivo. Asociados/Granjas/Vehículos no se tocaron.')
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-800">Mantenimiento del dispositivo</h2>
      <p className="mt-1 max-w-xl text-sm text-slate-500">
        Borra la copia local (de ESTE navegador/dispositivo) de Recepciones, Ubicaciones, Novedades
        en Corral y Consolidado. Útil después de vaciar las listas de SharePoint para empezar
        pruebas nuevas, cuando algún desplegable de la app sigue mostrando un lote que ya no existe
        en SharePoint. No borra nada en SharePoint, ni los catálogos de Asociados/Granjas/Vehículos/
        Usuarios de este dispositivo — esos siguen haciendo falta para poder seguir capturando.
      </p>

      {mensaje && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}

      {conteos && (
        <div className="mt-4 max-w-md space-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
          <p>Recepciones: {conteos.recepciones} ({conteos.recepcionesPendientes} sin sincronizar)</p>
          <p>Ubicaciones: {conteos.ubicaciones} ({conteos.ubicacionesPendientes} sin sincronizar)</p>
          <p>Novedades en Corral: {conteos.novedades} ({conteos.novedadesPendientes} sin sincronizar)</p>
          <p>Filas de Consolidado: {conteos.tiquetes} ({conteos.tiquetesPendientes} sin sincronizar)</p>
          {totalPendientes > 0 && (
            <p className="mt-2 text-xs font-medium text-brand-red">
              ⚠️ Hay {totalPendientes} registros sin sincronizar todavía — bórralos solo si sabes que
              no importan, se perderían para siempre.
            </p>
          )}
        </div>
      )}

      {esAdmin && (
        <button
          type="button"
          onClick={() => void borrarDatosLocales()}
          disabled={borrando || !conteos || totalRegistros === 0}
          className="mt-4 rounded-md border border-brand-red px-4 py-2 text-sm font-medium text-brand-red hover:bg-red-50 disabled:opacity-50"
        >
          {borrando ? 'Borrando…' : 'Borrar datos locales de este dispositivo'}
        </button>
      )}
    </div>
  )
}
