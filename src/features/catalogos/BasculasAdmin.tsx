import { useEffect, useState } from 'react'
import { actualizarBascula, crearBascula, eliminarBascula, listarBasculas } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoTexto } from '../../components/CamposFormulario'
import { formatoKg } from '../../utils/calibracion'
import type { Bascula, Usuario } from '../../types/models'

function aNumero(texto: string): number {
  return Number(texto.replace(',', '.'))
}

/**
 * Maestra de básculas para "Calibración báscula" (2026-10-13). Mismo patrón que
 * GruposAsociadosAdmin.tsx, con 2 campos más: la pesa patrón (kg) y el EMP (± kg). Cambiar estos
 * valores NO altera las verificaciones ya guardadas: cada verificación guarda su propia copia.
 */
export function BasculasAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'

  const [basculas, setBasculas] = useState<Bascula[]>()
  const [error, setError] = useState<string>()
  const [nuevo, setNuevo] = useState({ Title: '', PesaPatronKg: '50', EMPKg: '0,05' })
  const [guardando, setGuardando] = useState(false)
  const [editandoId, setEditandoId] = useState<string>()
  const [edicion, setEdicion] = useState({ Title: '', PesaPatronKg: '', EMPKg: '' })

  async function recargar() {
    try {
      const lista = await listarBasculas()
      setBasculas(lista)
      setError(undefined)
      await db.transaction('rw', db.basculas, async () => {
        await db.basculas.clear()
        await db.basculas.bulkPut(lista)
      })
    } catch (err) {
      setError(
        `No se pudo cargar Básculas: ${(err as Error).message}. Si la lista "Basculas" todavía no existe en ` +
          'SharePoint, hay que crearla primero (ver README).',
      )
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  function valoresValidos(v: { Title: string; PesaPatronKg: string; EMPKg: string }) {
    const pesa = aNumero(v.PesaPatronKg)
    const emp = aNumero(v.EMPKg)
    return v.Title.trim() !== '' && pesa > 0 && emp > 0
  }

  async function agregar() {
    if (!valoresValidos(nuevo)) return
    setGuardando(true)
    try {
      await crearBascula({
        Title: nuevo.Title.trim(),
        PesaPatronKg: aNumero(nuevo.PesaPatronKg),
        EMPKg: aNumero(nuevo.EMPKg),
      })
      setNuevo({ Title: '', PesaPatronKg: '50', EMPKg: '0,05' })
      await recargar()
    } catch (err) {
      setError(`No se pudo crear la báscula: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function guardarEdicion(id: string) {
    if (!valoresValidos(edicion)) return
    try {
      await actualizarBascula(id, {
        Title: edicion.Title.trim(),
        PesaPatronKg: aNumero(edicion.PesaPatronKg),
        EMPKg: aNumero(edicion.EMPKg),
      })
      setEditandoId(undefined)
      await recargar()
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    }
  }

  async function alternarActiva(b: Bascula) {
    try {
      await actualizarBascula(b.id, { Activa: !b.Activa })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  async function eliminar(b: Bascula) {
    const ok = window.confirm(
      `¿Eliminar definitivamente la báscula "${b.Title}"? Las verificaciones ya registradas se conservan, pero ` +
        'ya no se podrá elegir para nuevas. Si solo deja de usarse, es mejor "Desactivar".',
    )
    if (!ok) return
    try {
      await eliminarBascula(b.id)
      await recargar()
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  const claseInput = 'w-full rounded-md border border-slate-300 px-2 py-1 text-sm'

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Básculas</h1>
      <p className="mt-1 text-sm text-slate-500">
        Tabla maestra para "Calibración báscula" — requiere conexión a internet. Cambiar la pesa patrón o el EMP solo
        aplica a las verificaciones nuevas.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-56">
          <CampoTexto etiqueta="Nombre" value={nuevo.Title} onChange={(e) => setNuevo({ ...nuevo, Title: e.target.value })} />
        </div>
        <div className="w-32">
          <CampoTexto
            etiqueta="Pesa patrón (kg)"
            inputMode="decimal"
            value={nuevo.PesaPatronKg}
            onChange={(e) => setNuevo({ ...nuevo, PesaPatronKg: e.target.value })}
          />
        </div>
        <div className="w-32">
          <CampoTexto
            etiqueta="EMP ± (kg)"
            inputMode="decimal"
            value={nuevo.EMPKg}
            onChange={(e) => setNuevo({ ...nuevo, EMPKg: e.target.value })}
          />
        </div>
        <button
          type="button"
          onClick={() => void agregar()}
          disabled={guardando || !valoresValidos(nuevo)}
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
              <th className="px-3 py-2">Pesa patrón</th>
              <th className="px-3 py-2">EMP</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {basculas === undefined && !error && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {basculas?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay básculas registradas.
                </td>
              </tr>
            )}
            {basculas?.map((b) =>
              editandoId === b.id ? (
                <tr key={b.id} className="bg-brand-navy-tint/40">
                  <td className="px-3 py-2">
                    <input value={edicion.Title} onChange={(e) => setEdicion({ ...edicion, Title: e.target.value })} className={claseInput} />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      inputMode="decimal"
                      value={edicion.PesaPatronKg}
                      onChange={(e) => setEdicion({ ...edicion, PesaPatronKg: e.target.value })}
                      className={claseInput}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      inputMode="decimal"
                      value={edicion.EMPKg}
                      onChange={(e) => setEdicion({ ...edicion, EMPKg: e.target.value })}
                      className={claseInput}
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{b.Activa ? 'Activa' : 'Inactiva'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => void guardarEdicion(b.id)}
                      disabled={!valoresValidos(edicion)}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button type="button" onClick={() => setEditandoId(undefined)} className="text-xs font-medium text-slate-500 hover:underline">
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={b.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{b.Title}</td>
                  <td className="px-3 py-2 text-slate-600">{formatoKg(b.PesaPatronKg, 2)} kg</td>
                  <td className="px-3 py-2 text-slate-600">± {formatoKg(b.EMPKg, 2)} kg</td>
                  <td className="px-3 py-2 text-slate-600">{b.Activa ? 'Activa' : 'Inactiva'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditandoId(b.id)
                          setEdicion({
                            Title: b.Title,
                            PesaPatronKg: String(b.PesaPatronKg).replace('.', ','),
                            EMPKg: String(b.EMPKg).replace('.', ','),
                          })
                        }}
                        className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                      >
                        Editar
                      </button>
                    )}
                    <button type="button" onClick={() => void alternarActiva(b)} className="mr-3 text-xs font-medium text-brand-navy hover:underline">
                      {b.Activa ? 'Desactivar' : 'Activar'}
                    </button>
                    {esAdmin && (
                      <button type="button" onClick={() => void eliminar(b)} className="text-xs font-medium text-brand-red hover:underline">
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
