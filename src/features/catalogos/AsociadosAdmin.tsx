import { useEffect, useState } from 'react'
import {
  actualizarAsociado,
  crearAsociado,
  eliminarAsociado,
  listarAsociados,
  listarGruposAsociados,
} from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import type { Asociado, GrupoAsociado, Usuario } from '../../types/models'

/**
 * PANTALLA DE REFERENCIA para las 3 tablas maestras (Asociados, Granjas,
 * Vehículos) — solo para el rol Administrador (ver App.tsx, que la protege
 * con ProtegidoPorRol). Granjas y Vehiculos ya tienen su propia pantalla
 * (GranjasAdmin.tsx / VehiculosAdmin.tsx), siguiendo el mismo patrón.
 * A diferencia de las pantallas de captura, esta requiere conexión — la
 * administración de maestros no está pensada para hacerse sin internet.
 *
 * "Grupo asociado" es un Lookup opcional de un solo valor a GrupoAsociado
 * (ver src/features/catalogos/GruposAsociadosAdmin.tsx) — como cualquier
 * Asociado creado antes de este campo puede no tener grupo todavía, aquí se
 * puede asignar o cambiar el grupo tanto al crear como después, desde el
 * desplegable de cada fila (igual que el Rol en UsuariosAdmin.tsx).
 *
 * Editar/Eliminar solo se muestran si `usuario.Rol === 'Administrador'` —
 * en la práctica esta pantalla ya solo la ve un Administrador (la ruta
 * /admin/asociados está protegida en App.tsx con ProtegidoPorRol), pero se
 * deja el chequeo también aquí por si esta pantalla se reutiliza algún día
 * en un lugar menos restringido. Activar/Desactivar (que ya existía) no se
 * restringió más porque no borra nada — Editar y sobre todo Eliminar sí son
 * el tipo de acción que conviene limitar de las dos formas a la vez.
 */
export function AsociadosAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'

  const [asociados, setAsociados] = useState<Asociado[]>()
  const [grupos, setGrupos] = useState<GrupoAsociado[]>([])
  const [error, setError] = useState<string>()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoNit, setNuevoNit] = useState('')
  const [nuevoGrupoId, setNuevoGrupoId] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [editandoId, setEditandoId] = useState<string>()
  const [editNombre, setEditNombre] = useState('')
  const [editNit, setEditNit] = useState('')

  async function recargar() {
    try {
      const [listaAsociados, listaGrupos] = await Promise.all([listarAsociados(), listarGruposAsociados()])
      setAsociados(listaAsociados)
      setGrupos(listaGrupos.filter((g) => g.Activo))
      setError(undefined)
      await db.asociados.bulkPut(listaAsociados) // refresca la copia offline que usan los formularios de captura
      await db.gruposAsociados.bulkPut(listaGrupos)
    } catch (err) {
      setError(`No se pudo cargar Asociados: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function agregar() {
    if (!nuevoNombre.trim()) return
    setGuardando(true)
    try {
      await crearAsociado({
        Title: nuevoNombre.trim(),
        NIT: nuevoNit.trim() || undefined,
        GrupoAsociadoId: nuevoGrupoId || undefined,
      })
      setNuevoNombre('')
      setNuevoNit('')
      setNuevoGrupoId('')
      await recargar()
    } catch (err) {
      setError(`No se pudo crear el asociado: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarGrupo(asociado: Asociado, grupoId: string) {
    try {
      await actualizarAsociado(asociado.id, { GrupoAsociadoId: grupoId })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar el grupo: ${(err as Error).message}`)
    }
  }

  async function alternarActivo(asociado: Asociado) {
    try {
      await actualizarAsociado(asociado.id, { Activo: !asociado.Activo })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  function empezarEdicion(asociado: Asociado) {
    setEditandoId(asociado.id)
    setEditNombre(asociado.Title)
    setEditNit(asociado.NIT ?? '')
  }

  async function guardarEdicion(id: string) {
    if (!editNombre.trim()) return
    try {
      await actualizarAsociado(id, { Title: editNombre.trim(), NIT: editNit.trim() || undefined })
      setEditandoId(undefined)
      await recargar()
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    }
  }

  async function eliminar(asociado: Asociado) {
    const confirmado = window.confirm(
      `¿Eliminar definitivamente a "${asociado.Title}"? Esto lo borra de SharePoint sin poder deshacerlo. ` +
        'Si ya tiene Granjas, Vehículos o Recepciones asociadas, mejor usa "Desactivar" en vez de esto.',
    )
    if (!confirmado) return
    try {
      await eliminarAsociado(asociado.id)
      await recargar()
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Asociados</h1>
      <p className="mt-1 text-sm text-slate-500">Tabla maestra — requiere conexión a internet.</p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-56">
          <CampoTexto etiqueta="Nombre del asociado" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        </div>
        <div className="w-40">
          <CampoTexto etiqueta="NIT" value={nuevoNit} onChange={(e) => setNuevoNit(e.target.value)} />
        </div>
        <div className="w-52">
          <CampoSelect
            etiqueta="Grupo asociado (opcional)"
            value={nuevoGrupoId}
            onChange={(e) => setNuevoGrupoId(e.target.value)}
            opciones={grupos.map((g) => ({ value: g.id, label: g.Title }))}
          />
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

      {grupos.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">
          Todavía no hay grupos activos — créalos en la pestaña "Grupos de Asociados" para poder asignarlos aquí.
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">NIT</th>
              <th className="px-3 py-2">Grupo asociado</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {asociados === undefined && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {asociados?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay asociados registrados.
                </td>
              </tr>
            )}
            {asociados?.map((a) =>
              editandoId === a.id ? (
                <tr key={a.id} className="bg-brand-navy-tint/40">
                  <td className="px-3 py-2">
                    <input
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={editNit}
                      onChange={(e) => setEditNit(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-400">—</td>
                  <td className="px-3 py-2 text-slate-600">{a.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void guardarEdicion(a.id)}
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
                <tr key={a.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{a.Title}</td>
                  <td className="px-3 py-2 text-slate-600">{a.NIT ?? '—'}</td>
                  <td className="px-3 py-2">
                    <select
                      value={a.GrupoAsociadoId ?? ''}
                      onChange={(e) => void cambiarGrupo(a, e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">Sin grupo</option>
                      {grupos.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.Title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{a.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => empezarEdicion(a)}
                        className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void alternarActivo(a)}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                    >
                      {a.Activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => void eliminar(a)}
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
