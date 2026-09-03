import { useEffect, useState } from 'react'
import { actualizarGranja, crearGranja, eliminarGranja, listarAsociados, listarGranjas } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import type { Asociado, Granja, Usuario } from '../../types/models'

/**
 * Sigue el mismo patrón que AsociadosAdmin.tsx — ver los comentarios allí,
 * incluido el chequeo `usuario.Rol === 'Administrador'` para Editar/Eliminar.
 *
 * id_dhc (número) y nombre_vista (texto) son obligatorios al crear o editar
 * una granja desde aquí — el botón Agregar/Guardar se queda deshabilitado
 * hasta llenarlos, igual que ya pasa con Nombre y Asociado. Una granja creada
 * antes de agregar estas 2 columnas puede llegar sin ese dato desde
 * SharePoint (ver listarGranjas() en graph/lists.ts) — en ese caso se ve
 * "0" / en blanco en la tabla hasta que alguien la edite y los complete.
 */
export function GranjasAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'

  const [granjas, setGranjas] = useState<Granja[]>()
  const [asociados, setAsociados] = useState<Asociado[]>([])
  const [error, setError] = useState<string>()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoMunicipio, setNuevoMunicipio] = useState('')
  const [nuevoAsociadoId, setNuevoAsociadoId] = useState('')
  const [nuevoIdDhc, setNuevoIdDhc] = useState('')
  const [nuevoNombreVista, setNuevoNombreVista] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [editandoId, setEditandoId] = useState<string>()
  const [editNombre, setEditNombre] = useState('')
  const [editMunicipio, setEditMunicipio] = useState('')
  const [editAsociadoId, setEditAsociadoId] = useState('')
  const [editIdDhc, setEditIdDhc] = useState('')
  const [editNombreVista, setEditNombreVista] = useState('')

  async function recargar() {
    try {
      const [listaGranjas, listaAsociados] = await Promise.all([listarGranjas(), listarAsociados()])
      setGranjas(listaGranjas)
      setAsociados(listaAsociados.filter((a) => a.Activo))
      setError(undefined)
      await db.granjas.bulkPut(listaGranjas) // refresca la copia offline que usa el formulario de Recepción
    } catch (err) {
      setError(`No se pudo cargar Granjas: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function agregar() {
    if (!nuevoNombre.trim() || !nuevoAsociadoId || !nuevoIdDhc.trim() || !nuevoNombreVista.trim()) return
    setGuardando(true)
    try {
      await crearGranja({
        Title: nuevoNombre.trim(),
        AsociadoId: nuevoAsociadoId,
        Municipio: nuevoMunicipio.trim() || undefined,
        id_dhc: Number(nuevoIdDhc),
        nombre_vista: nuevoNombreVista.trim(),
      })
      setNuevoNombre('')
      setNuevoMunicipio('')
      setNuevoAsociadoId('')
      setNuevoIdDhc('')
      setNuevoNombreVista('')
      await recargar()
    } catch (err) {
      setError(`No se pudo crear la granja: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActiva(granja: Granja) {
    try {
      await actualizarGranja(granja.id, { Activa: !granja.Activa })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  function empezarEdicion(granja: Granja) {
    setEditandoId(granja.id)
    setEditNombre(granja.Title)
    setEditMunicipio(granja.Municipio ?? '')
    setEditAsociadoId(granja.AsociadoId)
    setEditIdDhc(granja.id_dhc ? String(granja.id_dhc) : '')
    setEditNombreVista(granja.nombre_vista ?? '')
  }

  async function guardarEdicion(id: string) {
    if (!editNombre.trim() || !editAsociadoId || !editIdDhc.trim() || !editNombreVista.trim()) return
    try {
      await actualizarGranja(id, {
        Title: editNombre.trim(),
        Municipio: editMunicipio.trim() || undefined,
        AsociadoId: editAsociadoId,
        id_dhc: Number(editIdDhc),
        nombre_vista: editNombreVista.trim(),
      })
      setEditandoId(undefined)
      await recargar()
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    }
  }

  async function eliminar(granja: Granja) {
    const confirmado = window.confirm(
      `¿Eliminar definitivamente la granja "${granja.Title}"? Esto la borra de SharePoint sin poder deshacerlo. ` +
        'Si ya tiene Recepciones asociadas, mejor usa "Desactivar" en vez de esto.',
    )
    if (!confirmado) return
    try {
      await eliminarGranja(granja.id)
      await recargar()
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  function nombreAsociado(asociadoId: string) {
    return asociados.find((a) => a.id === asociadoId)?.Title ?? '—'
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Granjas</h1>
      <p className="mt-1 text-sm text-slate-500">Tabla maestra — requiere conexión a internet.</p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-52">
          <CampoSelect
            etiqueta="Asociado"
            value={nuevoAsociadoId}
            onChange={(e) => setNuevoAsociadoId(e.target.value)}
            opciones={asociados.map((a) => ({ value: a.id, label: a.Title }))}
          />
        </div>
        <div className="w-56">
          <CampoTexto etiqueta="Nombre de la granja" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        </div>
        <div className="w-40">
          <CampoTexto etiqueta="Municipio" value={nuevoMunicipio} onChange={(e) => setNuevoMunicipio(e.target.value)} />
        </div>
        <div className="w-32">
          <CampoTexto
            type="number"
            etiqueta="ID DHC"
            requerido
            value={nuevoIdDhc}
            onChange={(e) => setNuevoIdDhc(e.target.value)}
          />
        </div>
        <div className="w-48">
          <CampoTexto
            etiqueta="Nombre vista"
            requerido
            value={nuevoNombreVista}
            onChange={(e) => setNuevoNombreVista(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => void agregar()}
          disabled={guardando || !nuevoNombre.trim() || !nuevoAsociadoId || !nuevoIdDhc.trim() || !nuevoNombreVista.trim()}
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
              <th className="px-3 py-2">Asociado</th>
              <th className="px-3 py-2">Municipio</th>
              <th className="px-3 py-2">ID DHC</th>
              <th className="px-3 py-2">Nombre vista</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {granjas === undefined && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {granjas?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay granjas registradas.
                </td>
              </tr>
            )}
            {granjas?.map((g) =>
              editandoId === g.id ? (
                <tr key={g.id} className="bg-brand-navy-tint/40">
                  <td className="px-3 py-2">
                    <input
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={editAsociadoId}
                      onChange={(e) => setEditAsociadoId(e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">Selecciona…</option>
                      {asociados.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.Title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={editMunicipio}
                      onChange={(e) => setEditMunicipio(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={editIdDhc}
                      onChange={(e) => setEditIdDhc(e.target.value)}
                      className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      value={editNombreVista}
                      onChange={(e) => setEditNombreVista(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{g.Activa ? 'Activa' : 'Inactiva'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => void guardarEdicion(g.id)}
                      disabled={!editNombre.trim() || !editAsociadoId || !editIdDhc.trim() || !editNombreVista.trim()}
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
                  <td className="px-3 py-2 text-slate-600">{nombreAsociado(g.AsociadoId)}</td>
                  <td className="px-3 py-2 text-slate-600">{g.Municipio ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{g.id_dhc || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{g.nombre_vista || '—'}</td>
                  <td className="px-3 py-2 text-slate-600">{g.Activa ? 'Activa' : 'Inactiva'}</td>
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
                      onClick={() => void alternarActiva(g)}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                    >
                      {g.Activa ? 'Desactivar' : 'Activar'}
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
