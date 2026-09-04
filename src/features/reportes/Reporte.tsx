import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../offline/db'
import { listarRecepcionesPorRangoFecha, listarTiquetesDeRecepcion } from '../../graph/lists'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { ResumenRecepcion } from './ResumenRecepcion'
import type { ConsolidadoTiquete, Recepcion } from '../../types/models'

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function haceDiasISO(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Reporte consolidado, filtrable por fecha y Grupo Asociado — a diferencia
 * del resto de la app, NO está restringido por rol: "todos los perfiles
 * pueden tener acceso a este reporte" (pedido explícito del usuario), así
 * que esta pantalla se monta sin pasar por ProtegidoPorRol (ver App.tsx).
 *
 * Solo trae datos al tocar "Generar reporte" — nunca se descarga solo ni se
 * guarda en Dexie (usa listarRecepcionesPorRangoFecha(), que consulta
 * SharePoint directamente para el rango pedido), así que no reintroduce el
 * problema de que cada dispositivo vaya acumulando cada vez más historial.
 *
 * El agrupamiento pedido es Grupo Asociado → Asociado → Granja →
 * Consecutivo. Asociados/Granjas/Vehículos/GruposAsociados se resuelven
 * contra la copia local de "maestros" (Dexie), que ya está disponible sin
 * conexión — ver descargarMaestros() en syncService.ts.
 */
export function Reporte() {
  const [desde, setDesde] = useState(haceDiasISO(7))
  const [hasta, setHasta] = useState(hoyISO())
  const [grupoAsociadoId, setGrupoAsociadoId] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string>()
  const [generado, setGenerado] = useState(false)
  const [recepciones, setRecepciones] = useState<Recepcion[]>([])
  const [tiquetesPorRecepcion, setTiquetesPorRecepcion] = useState<Record<string, ConsolidadoTiquete[]>>({})

  const asociados = useLiveQuery(() => db.asociados.toArray(), []) ?? []
  const granjas = useLiveQuery(() => db.granjas.toArray(), []) ?? []
  const vehiculos = useLiveQuery(() => db.vehiculos.toArray(), []) ?? []
  const gruposAsociados = useLiveQuery(() => db.gruposAsociados.toArray(), []) ?? []

  const mapaAsociados = useMemo(() => new Map(asociados.map((a) => [a.id, a])), [asociados])
  const mapaGranjas = useMemo(() => new Map(granjas.map((g) => [g.id, g])), [granjas])
  const mapaVehiculos = useMemo(() => new Map(vehiculos.map((v) => [v.id, v])), [vehiculos])
  const mapaGrupos = useMemo(() => new Map(gruposAsociados.map((g) => [g.id, g])), [gruposAsociados])

  async function generar() {
    setCargando(true)
    setError(undefined)
    setGenerado(false)
    try {
      const traidas = await listarRecepcionesPorRangoFecha(desde, hasta)
      const porRecepcion: Record<string, ConsolidadoTiquete[]> = {}
      await Promise.all(
        traidas.map(async (r) => {
          if (!r.spId) return
          porRecepcion[r.spId] = await listarTiquetesDeRecepcion(r.spId)
        }),
      )
      setRecepciones(traidas)
      setTiquetesPorRecepcion(porRecepcion)
      setGenerado(true)
    } catch (err) {
      setError(`No se pudo generar el reporte: ${(err as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  const grupos = useMemo(() => {
    const filtradas = recepciones.filter((r) => {
      if (!grupoAsociadoId) return true
      const asociado = mapaAsociados.get(r.AsociadoId)
      return asociado?.GrupoAsociadoId === grupoAsociadoId
    })

    type Nodo = {
      grupoNombre: string
      asociados: Map<string, { asociadoNombre: string; granjas: Map<string, { granjaNombre: string; recepciones: Recepcion[] }> }>
    }
    const porGrupo = new Map<string, Nodo>()

    for (const r of filtradas) {
      const asociado = mapaAsociados.get(r.AsociadoId)
      const grupoId = asociado?.GrupoAsociadoId ?? '__sin-grupo__'
      const grupoNombre = (grupoId !== '__sin-grupo__' && mapaGrupos.get(grupoId)?.Title) || 'Sin grupo asociado'
      const granja = mapaGranjas.get(r.GranjaId)

      if (!porGrupo.has(grupoId)) porGrupo.set(grupoId, { grupoNombre, asociados: new Map() })
      const nodoGrupo = porGrupo.get(grupoId)!

      const asociadoId = r.AsociadoId || '__sin-asociado__'
      const asociadoNombre = asociado?.Title ?? 'Sin asociado'
      if (!nodoGrupo.asociados.has(asociadoId)) nodoGrupo.asociados.set(asociadoId, { asociadoNombre, granjas: new Map() })
      const nodoAsociado = nodoGrupo.asociados.get(asociadoId)!

      const granjaId = r.GranjaId || '__sin-granja__'
      const granjaNombre = granja?.Title ?? 'Sin granja'
      if (!nodoAsociado.granjas.has(granjaId)) nodoAsociado.granjas.set(granjaId, { granjaNombre, recepciones: [] })
      nodoAsociado.granjas.get(granjaId)!.recepciones.push(r)
    }

    for (const nodoGrupo of porGrupo.values()) {
      for (const nodoAsociado of nodoGrupo.asociados.values()) {
        for (const nodoGranja of nodoAsociado.granjas.values()) {
          nodoGranja.recepciones.sort((a, b) => a.Consecutivo.localeCompare(b.Consecutivo))
        }
      }
    }

    return Array.from(porGrupo.values()).sort((a, b) => a.grupoNombre.localeCompare(b.grupoNombre))
  }, [recepciones, grupoAsociadoId, mapaAsociados, mapaGranjas, mapaGrupos])

  const totalRecepciones = grupos.reduce(
    (total, g) => total + Array.from(g.asociados.values()).reduce((t, a) => t + Array.from(a.granjas.values()).reduce((t2, gr) => t2 + gr.recepciones.length, 0), 0),
    0,
  )

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Reporte</h1>
      <p className="mt-1 text-sm text-slate-500">
        Consolidado por Grupo Asociado, Asociado, Granja y Consecutivo — filtra por fecha y Grupo Asociado y genera el
        reporte para ver en pantalla o descargar/imprimir como PDF.
      </p>

      <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden sm:grid-cols-4">
        <CampoTexto type="date" etiqueta="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <CampoTexto type="date" etiqueta="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <CampoSelect
          etiqueta="Grupo Asociado"
          value={grupoAsociadoId}
          onChange={(e) => setGrupoAsociadoId(e.target.value)}
          opciones={gruposAsociados.map((g) => ({ value: g.id, label: g.Title }))}
          placeholder="Todos"
        />
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void generar()}
            disabled={cargando || !navigator.onLine}
            title={navigator.onLine ? undefined : 'Sin conexión — no se puede generar el reporte'}
            className="w-full rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:bg-slate-300"
          >
            {cargando ? 'Generando…' : 'Generar reporte'}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red print:hidden">{error}</p>}

      {generado && (
        <>
          <div className="mt-4 flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-500">
              {totalRecepciones} recepci{totalRecepciones === 1 ? 'ón' : 'ones'} entre {desde} y {hasta}
            </p>
            {totalRecepciones > 0 && (
              <button
                type="button"
                onClick={() => window.print()}
                className="text-xs font-medium text-brand-navy hover:underline"
              >
                Imprimir / Descargar PDF
              </button>
            )}
          </div>

          {totalRecepciones === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No hay recepciones en ese rango de fechas y filtro.</p>
          ) : (
            <div className="mt-4 space-y-6">
              {grupos.map((g) => (
                <div key={g.grupoNombre} className="space-y-4 print:break-before-page">
                  <h2 className="text-base font-semibold text-brand-navy">{g.grupoNombre}</h2>
                  {Array.from(g.asociados.values()).map((a) => (
                    <div key={a.asociadoNombre} className="space-y-3 pl-2">
                      <h3 className="text-sm font-semibold text-slate-700">{a.asociadoNombre}</h3>
                      {Array.from(a.granjas.values()).map((gr) => (
                        <div key={gr.granjaNombre} className="space-y-3 pl-2">
                          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{gr.granjaNombre}</p>
                          {gr.recepciones.map((r) => (
                            <ResumenRecepcion
                              key={r.id}
                              recepcion={r}
                              asociadoNombre={a.asociadoNombre}
                              granjaNombre={gr.granjaNombre}
                              placa={mapaVehiculos.get(r.PlacaVehiculoId)?.Title ?? '—'}
                              tiquetes={r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : []}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
