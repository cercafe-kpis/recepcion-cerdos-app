import { useEffect, useState } from 'react'
import { actualizarGrupoAsociado, crearGrupoAsociado, listarGruposAsociados } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoTexto } from '../../components/CamposFormulario'
import type { GrupoAsociado } from '../../types/models'

/**
 * Tabla maestra simple (solo Title + Activo) que agrupa Asociados — se creó
 * para el campo "Grupo asociado" que aparece en AsociadosAdmin.tsx. Sigue el
 * mismo patrón que AsociadosAdmin.tsx, sin ningún campo extra.
 */
export function GruposAsociadosAdmin() {
  const [grupos, setGrupos] = useState<GrupoAsociado[]>()
  const [error, setError] = useState<string>()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function recargar() {
    try {
      const lista = await listarGruposAsociados()
      setGrupos(lista)
      setError(undefined)
      await db.gruposAsociados.bulkPut(lista)
    } catch (err) {
      setError(`No se pudo cargar Grupos de Asociados: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function agregar() {
    if (!nuevoNombre.trim()) return
    setGuardando(true)
    try {
      await crearGrupoAsociado({ Title: nuevoNombre.trim() })
      setNuevoNombre('')
      await recargar()
    } catch (err) {
      setError(`No se pudo crear el grupo: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActivo(grupo: GrupoAsociado) {
    try {
      await actualizarGrupoAsociado(grupo.id, { Activo: !grupo.Activo })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Grupos de Asociados</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tabla maestra — requiere conexión a internet. Se usa para clasificar a los Asociados desde la pestaña
        "Asociados".
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-56">
          <CampoTexto etiqueta="Nombre del grupo" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
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
            {grupos === undefined && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {grupos?.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay grupos registrados.
                </td>
              </tr>
            )}
            {grupos?.map((g) => (
              <tr key={g.id}>
                <td className="px-3 py-2 font-medium text-slate-700">{g.Title}</td>
                <td className="px-3 py-2 text-slate-600">{g.Activo ? 'Activo' : 'Inactivo'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void alternarActivo(g)}
                    className="text-xs font-medium text-brand-navy hover:underline"
                  >
                    {g.Activo ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
