import { useEffect, useState } from 'react'
import { actualizarTipoLesion, crearTipoLesion, eliminarTipoLesion, listarTiposLesion } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoTexto } from '../../components/CamposFormulario'
import type { TipoLesion, Usuario } from '../../types/models'

/**
 * Maestra de tipos de lesión (2026-10-28, a pedido de Nathalia) — copia del patrón de
 * GruposAsociadosAdmin.tsx (solo Title + Activo). Los tipos ACTIVOS son los que aparecen al marcar
 * "Lesionado" en Recepción y en Novedades en Corral (ver src/utils/lesiones.ts). Desactivar o borrar
 * un tipo no cambia las lesiones ya registradas: cada registro guarda el nombre del tipo.
 */
export function TiposLesionAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'

  const [tipos, setTipos] = useState<TipoLesion[]>()
  const [error, setError] = useState<string>()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [editandoId, setEditandoId] = useState<string>()
  const [editNombre, setEditNombre] = useState('')

  async function recargar() {
    try {
      const lista = await listarTiposLesion()
      setTipos(lista)
      setError(undefined)
      // Copia local completa (clear + put) para que un tipo borrado aquí deje de salir en los
      // formularios de este dispositivo de inmediato.
      await db.transaction('rw', db.tiposLesion, async () => {
        await db.tiposLesion.clear()
        await db.tiposLesion.bulkPut(lista)
      })
    } catch (err) {
      setError(
        `No se pudo cargar Tipos de lesión: ${(err as Error).message}. ¿Ya existe la lista "TiposLesion" en SharePoint?`,
      )
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function agregar() {
    if (!nuevoNombre.trim()) return
    setGuardando(true)
    try {
      await crearTipoLesion({ Title: nuevoNombre.trim() })
      setNuevoNombre('')
      await recargar()
    } catch (err) {
      setError(`No se pudo crear el tipo de lesión: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActivo(tipo: TipoLesion) {
    try {
      await actualizarTipoLesion(tipo.id, { Activo: !tipo.Activo })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  function empezarEdicion(tipo: TipoLesion) {
    setEditandoId(tipo.id)
    setEditNombre(tipo.Title)
  }

  async function guardarEdicion(id: string) {
    if (!editNombre.trim()) return
    try {
      await actualizarTipoLesion(id, { Title: editNombre.trim() })
      setEditandoId(undefined)
      await recargar()
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    }
  }

  async function eliminar(tipo: TipoLesion) {
    const confirmado = window.confirm(
      `¿Eliminar definitivamente el tipo de lesión "${tipo.Title}"? Esto lo borra de SharePoint sin poder deshacerlo. ` +
        'Las lesiones ya registradas con este tipo lo conservan. Si solo quieres que deje de aparecer en los formularios, usa "Desactivar".',
    )
    if (!confirmado) return
    try {
      await eliminarTipoLesion(tipo.id)
      await recargar()
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Tipos de lesión</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tabla maestra — requiere conexión a internet. Los tipos activos aparecen al marcar "Lesionado" en
        Recepción y en Novedades en Corral.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-56">
          <CampoTexto etiqueta="Tipo de lesión" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        </div>
        <button
          type="button"
          onClick={() => void agregar()}
          disabled={guardando || !nuevoNombre.trim()}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          Agregar
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tipos === undefined && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {tipos?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay tipos de lesión registrados.
                </td>
              </tr>
            )}
            {tipos?.map((g) =>
              editandoId === g.id ? (
                <tr key={g.id} className="bg-brand-navy-tint/40">
                  <td className="px-3 py-2">
                    <input
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{g.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void guardarEdicion(g.id)}
                      disabled={!editNombre.trim()}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditandoId(undefined)}
                      className="text-xs font-medium text-slate-500 hover:underline"
                    >
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={g.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{g.Title}</td>
                  <td className="px-3 py-2 text-slate-600">{g.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => empezarEdicion(g)}
                        className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void alternarActivo(g)}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                    >
                      {g.Activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => void eliminar(g)}
                        className="text-xs font-medium text-brand-red hover:underline"
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
