import { useEffect, useState } from 'react'
import { actualizarAsociado, crearAsociado, listarAsociados, listarGruposAsociados } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import type { Asociado, GrupoAsociado } from '../../types/models'

/**
 * PANTALLA DE REFERENCIA para las 3 tablas maestras (Asociados, Granjas,
 * Vehículos) — solo para el rol Administrador (ver App.tsx, que la protege
 * con ProtegidoPorRol). Granjas y Vehiculos todavía no tienen su propia
 * pantalla: para construirlas, copiar este archivo a
 * src/features/catalogos/GranjasAdmin.tsx / VehiculosAdmin.tsx y:
 *   1. cambiar listarAsociados/crearAsociado/actualizarAsociado por sus
 *      equivalentes de src/graph/lists.ts (listarGranjas/crearGranja/... o
 *      listarVehiculos/crearVehiculo/...), que ya existen y siguen la misma
 *      firma;
 *   2. agregar el campo extra de cada una al formulario (Granjas: selector
 *      de Asociado + Municipio; Vehiculos: selector de Asociado opcional);
 *   3. agregar la entrada de menú en src/components/Navbar.tsx igual que
 *      "Asociados".
 * A diferencia de las pantallas de captura, esta requiere conexión — la
 * administración de maestros no está pensada para hacerse sin internet.
 *
 * "Grupo asociado" es un Lookup opcional de un solo valor a GrupoAsociado
 * (ver src/features/catalogos/GruposAsociadosAdmin.tsx) — como cualquier
 * Asociado creado antes de este campo puede no tener grupo todavía, aquí se
 * puede asignar o cambiar el grupo tanto al crear como después, desde el
 * desplegable de cada fila (igual que el Rol en UsuariosAdmin.tsx).
 */
export function AsociadosAdmin() {
  const [asociados, setAsociados] = useState<Asociado[]>()
  const [grupos, setGrupos] = useState<GrupoAsociado[]>([])
  const [error, setError] = useState<string>()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoNit, setNuevoNit] = useState('')
  const [nuevoGrupoId, setNuevoGrupoId] = useState('')
  const [guardando, setGuardando] = useState(false)

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
            {asociados?.map((a) => (
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
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void alternarActivo(a)}
                    className="text-xs font-medium text-brand-navy hover:underline"
                  >
                    {a.Activo ? 'Desactivar' : 'Activar'}
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
