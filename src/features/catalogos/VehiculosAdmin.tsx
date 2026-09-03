import { useEffect, useState } from 'react'
import { actualizarVehiculo, crearVehiculo, eliminarVehiculo, listarAsociados, listarVehiculos } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import type { Asociado, Usuario, Vehiculo } from '../../types/models'

/**
 * Sigue el mismo patrón que AsociadosAdmin.tsx — ver los comentarios allí,
 * incluido el chequeo `usuario.Rol === 'Administrador'` para Editar/Eliminar.
 */
export function VehiculosAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'

  const [vehiculos, setVehiculos] = useState<Vehiculo[]>()
  const [asociados, setAsociados] = useState<Asociado[]>([])
  const [error, setError] = useState<string>()
  const [nuevaPlaca, setNuevaPlaca] = useState('')
  const [nuevoAsociadoId, setNuevoAsociadoId] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [editandoId, setEditandoId] = useState<string>()
  const [editPlaca, setEditPlaca] = useState('')
  const [editAsociadoId, setEditAsociadoId] = useState('')

  async function recargar() {
    try {
      const [listaVehiculos, listaAsociados] = await Promise.all([listarVehiculos(), listarAsociados()])
      setVehiculos(listaVehiculos)
      setAsociados(listaAsociados.filter((a) => a.Activo))
      setError(undefined)
      await db.vehiculos.bulkPut(listaVehiculos) // refresca la copia offline que usa el formulario de Recepción
    } catch (err) {
      setError(`No se pudo cargar Vehículos: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function agregar() {
    if (!nuevaPlaca.trim()) return
    setGuardando(true)
    try {
      await crearVehiculo({ Title: nuevaPlaca.trim(), AsociadoId: nuevoAsociadoId || undefined })
      setNuevaPlaca('')
      setNuevoAsociadoId('')
      await recargar()
    } catch (err) {
      setError(`No se pudo crear el vehículo: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function alternarActivo(vehiculo: Vehiculo) {
    try {
      await actualizarVehiculo(vehiculo.id, { Activo: !vehiculo.Activo })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  function empezarEdicion(vehiculo: Vehiculo) {
    setEditandoId(vehiculo.id)
    setEditPlaca(vehiculo.Title)
    setEditAsociadoId(vehiculo.AsociadoId ?? '')
  }

  async function guardarEdicion(id: string) {
    if (!editPlaca.trim()) return
    try {
      await actualizarVehiculo(id, { Title: editPlaca.trim(), AsociadoId: editAsociadoId })
      setEditandoId(undefined)
      await recargar()
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    }
  }

  async function eliminar(vehiculo: Vehiculo) {
    const confirmado = window.confirm(
      `¿Eliminar definitivamente la placa "${vehiculo.Title}"? Esto la borra de SharePoint sin poder deshacerlo. ` +
        'Si ya tiene Recepciones asociadas, mejor usa "Desactivar" en vez de esto.',
    )
    if (!confirmado) return
    try {
      await eliminarVehiculo(vehiculo.id)
      await recargar()
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  function nombreAsociado(asociadoId?: string) {
    if (!asociadoId) return '—'
    return asociados.find((a) => a.id === asociadoId)?.Title ?? '—'
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Vehículos</h1>
      <p className="mt-1 text-sm text-slate-500">Tabla maestra — requiere conexión a internet.</p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-40">
          <CampoTexto etiqueta="Placa" value={nuevaPlaca} onChange={(e) => setNuevaPlaca(e.target.value)} />
        </div>
        <div className="w-52">
          <CampoSelect
            etiqueta="Asociado (opcional)"
            value={nuevoAsociadoId}
            onChange={(e) => setNuevoAsociadoId(e.target.value)}
            opciones={asociados.map((a) => ({ value: a.id, label: a.Title }))}
          />
        </div>
        <button
          type="button"
          onClick={() => void agregar()}
          disabled={guardando || !nuevaPlaca.trim()}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          Agregar
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Placa</th>
              <th className="px-3 py-2">Asociado</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {vehiculos === undefined && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {vehiculos?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay vehículos registrados.
                </td>
              </tr>
            )}
            {vehiculos?.map((v) =>
              editandoId === v.id ? (
                <tr key={v.id} className="bg-brand-navy-tint/40">
                  <td className="px-3 py-2">
                    <input
                      value={editPlaca}
                      onChange={(e) => setEditPlaca(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={editAsociadoId}
                      onChange={(e) => setEditAsociadoId(e.target.value)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      <option value="">Sin asociado</option>
                      {asociados.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.Title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{v.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => void guardarEdicion(v.id)}
                      disabled={!editPlaca.trim()}
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
                <tr key={v.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{v.Title}</td>
                  <td className="px-3 py-2 text-slate-600">{nombreAsociado(v.AsociadoId)}</td>
                  <td className="px-3 py-2 text-slate-600">{v.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => empezarEdicion(v)}
                        className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void alternarActivo(v)}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                    >
                      {v.Activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => void eliminar(v)}
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
