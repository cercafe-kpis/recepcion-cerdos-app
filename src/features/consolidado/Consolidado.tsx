import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { cachearTiquetesDeRecepcion, guardarEdicionTiqueteLocal, sincronizar } from '../../offline/syncService'
import { CampoSelect } from '../../components/CamposFormulario'
import type { ConsolidadoTiquete, Destino, Usuario } from '../../types/models'

/**
 * El objetivo de todo el flujo (Recepción → Ubicación/Novedades en Corral →
 * Consolidado): ponerle Tiquete y Destino a cada animal que tuvo alguna
 * novedad, uno por uno. Las filas de la tabla las genera el servidor de
 * sincronización (ver generarTiquetesFaltantes / generarTiqueteMuertoReposo
 * en src/graph/lists.ts) — esta pantalla no crea tiquetes, solo permite
 * completarlos. Por eso solo aparecen aquí las Recepciones que ya
 * sincronizaron al menos una vez.
 */
export function Consolidado({ usuario }: { usuario: Usuario }) {
  const [recepcionId, setRecepcionId] = useState('')
  const [actualizando, setActualizando] = useState(false)
  const soloLectura = usuario.Rol === 'Consultor'

  const recepciones =
    useLiveQuery(
      () => db.recepciones.where('EstadoSync').equals('Sincronizada').reverse().sortBy('FechaRecepcion'),
      [],
    ) ?? []

  const recepcion = useMemo(() => recepciones.find((r) => r.id === recepcionId), [recepciones, recepcionId])

  const granja = useLiveQuery(() => (recepcion ? db.granjas.get(recepcion.GranjaId) : undefined), [recepcion])

  const tiquetes =
    useLiveQuery(
      () => (recepcion?.spId ? db.consolidadoTiquetes.where('RecepcionId').equals(recepcion.spId).sortBy('TipoNovedad') : []),
      [recepcion],
    ) ?? []

  // Al elegir una recepción, trae la versión más fresca de sus tiquetes si hay conexión
  // (por si otro dispositivo ya le puso Tiquete/Destino a alguno).
  useEffect(() => {
    if (recepcion?.spId && navigator.onLine) {
      void cachearTiquetesDeRecepcion(recepcion.spId)
    }
  }, [recepcion?.spId])

  async function actualizar() {
    if (!recepcion?.spId) return
    setActualizando(true)
    try {
      await cachearTiquetesDeRecepcion(recepcion.spId)
    } finally {
      setActualizando(false)
    }
  }

  async function guardarCambio(t: ConsolidadoTiquete, cambios: Partial<ConsolidadoTiquete>) {
    await guardarEdicionTiqueteLocal(t.id, cambios)
    if (navigator.onLine) {
      void sincronizar(usuario.Correo)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Consolidado</h1>
      <p className="mt-1 text-sm text-slate-500">
        Asigna el número de tiquete y el destino (Procesado o Decomisado) a cada animal con novedad.
      </p>

      <div className="mt-4 max-w-sm">
        <CampoSelect
          etiqueta="Recepción"
          value={recepcionId}
          onChange={(e) => setRecepcionId(e.target.value)}
          opciones={recepciones.map((r) => ({ value: r.id, label: r.Title }))}
          placeholder="Selecciona una recepción sincronizada…"
        />
      </div>

      {!recepcion && recepciones.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          Todavía no hay ninguna recepción sincronizada en este dispositivo. Sincroniza primero desde la barra
          superior.
        </p>
      )}

      {recepcion && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <Dato etiqueta="Fecha" valor={recepcion.FechaRecepcion} />
            <Dato etiqueta="Granja" valor={granja?.Title ?? '—'} />
            <Dato etiqueta="Consecutivo" valor={recepcion.Consecutivo} />
            <Dato etiqueta="Número de orden" valor={recepcion.NumeroOrden} />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {tiquetes.length} animal{tiquetes.length === 1 ? '' : 'es'} con novedad en este lote
            </p>
            <button
              type="button"
              onClick={() => void actualizar()}
              disabled={actualizando || !navigator.onLine}
              className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
            >
              {actualizando ? 'Actualizando…' : 'Actualizar desde SharePoint'}
            </button>
          </div>

          {tiquetes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Este lote no tiene animales con novedad.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Grupo</th>
                    <th className="px-3 py-2">Novedad</th>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Tiquete</th>
                    <th className="px-3 py-2">Destino</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tiquetes.map((t) => (
                    <FilaTiquete
                      key={t.id}
                      tiquete={t}
                      soloLectura={soloLectura}
                      onGuardar={(cambios) => guardarCambio(t, cambios)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className="text-sm font-medium text-slate-700">{valor}</p>
    </div>
  )
}

function FilaTiquete({
  tiquete,
  soloLectura,
  onGuardar,
}: {
  tiquete: ConsolidadoTiquete
  soloLectura: boolean
  onGuardar: (cambios: Partial<ConsolidadoTiquete>) => void
}) {
  const [numeroTiquete, setNumeroTiquete] = useState(tiquete.Tiquete ?? '')
  const [destino, setDestino] = useState<Destino | ''>(tiquete.Destino ?? '')

  const completo = tiquete.EstadoTiquete === 'Completo'

  return (
    <tr className={clsx(tiquete.EstadoSync === 'Pendiente' && 'bg-amber-50/60')}>
      <td className="px-3 py-2 text-slate-600">{tiquete.GrupoNovedad}</td>
      <td className="px-3 py-2 text-slate-600">{tiquete.TipoNovedad}</td>
      <td className="px-3 py-2 text-slate-600">{tiquete.NumeroAnimalEnLote}</td>
      <td className="px-3 py-2">
        <input
          value={numeroTiquete}
          disabled={soloLectura}
          onChange={(e) => setNumeroTiquete(e.target.value)}
          onBlur={() => numeroTiquete !== (tiquete.Tiquete ?? '') && onGuardar({ Tiquete: numeroTiquete || undefined })}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
          placeholder="N.º"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={destino}
          disabled={soloLectura}
          onChange={(e) => {
            const nuevo = e.target.value as Destino | ''
            setDestino(nuevo)
            onGuardar({ Destino: nuevo || undefined })
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
        >
          <option value="">—</option>
          <option value="Procesado">Procesado</option>
          <option value="Decomisado">Decomisado</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            completo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
          )}
        >
          {tiquete.EstadoTiquete}
        </span>
        {tiquete.EstadoSync === 'Pendiente' && (
          <span className="ml-1.5 text-xs text-amber-600">sin subir</span>
        )}
      </td>
    </tr>
  )
}
