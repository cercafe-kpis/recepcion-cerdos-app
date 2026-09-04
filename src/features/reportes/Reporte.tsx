import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { listarRecepcionesPorRangoFecha, listarTiquetesDeRecepcion } from '../../graph/lists'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { ResumenRecepcion } from './ResumenRecepcion'
import { ReporteDiarioLote } from './ReporteDiarioLote'
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
 * Pantalla de reportes — accesible a TODOS los perfiles (pedido explícito
 * del usuario), por eso se monta sin pasar por ProtegidoPorRol (ver
 * App.tsx). Se divide en dos pestañas, a pedido del usuario:
 *
 *  - "Diario": el reporte por lote que se envía a cada asociado apenas
 *    termina una recepción (mismo formato que aparece dentro de
 *    Consolidado.tsx cuando un lote queda Completo) — aquí sirve para
 *    volver a ver/imprimir el de cualquier lote de un día, sin tener que
 *    ir hasta Consolidado.
 *  - "Semanal": el consolidado agrupado por Grupo Asociado → Asociado →
 *    Granja → Consecutivo, filtrable por rango de fechas — su formato
 *    definitivo todavía está pendiente de definir con el usuario, así que
 *    por ahora sigue usando ResumenRecepcion (el resumen genérico).
 *
 * Ninguna de las dos pestañas descarga nada en segundo plano ni lo guarda
 * en Dexie: ambas consultan SharePoint directo, solo al tocar "Generar",
 * para no reintroducir el problema de que cada dispositivo vaya
 * acumulando cada vez más historial (igual que descargarRecepcionesEnProceso
 * en syncService.ts, que sigue trayendo solo las recepciones "En proceso").
 */
export function Reporte() {
  const [tab, setTab] = useState<'diario' | 'semanal'>('diario')

  const asociados = useLiveQuery(() => db.asociados.toArray(), []) ?? []
  const granjas = useLiveQuery(() => db.granjas.toArray(), []) ?? []
  const vehiculos = useLiveQuery(() => db.vehiculos.toArray(), []) ?? []
  const gruposAsociados = useLiveQuery(() => db.gruposAsociados.toArray(), []) ?? []

  const mapaAsociados = useMemo(() => new Map(asociados.map((a) => [a.id, a])), [asociados])
  const mapaGranjas = useMemo(() => new Map(granjas.map((g) => [g.id, g])), [granjas])
  const mapaVehiculos = useMemo(() => new Map(vehiculos.map((v) => [v.id, v])), [vehiculos])
  const mapaGrupos = useMemo(() => new Map(gruposAsociados.map((g) => [g.id, g])), [gruposAsociados])

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 print:hidden">Reporte</h1>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Reporte diario por lote (para enviar al asociado apenas termina una recepción) o consolidado semanal por
        Grupo Asociado, Asociado, Granja y Consecutivo.
      </p>

      <div className="mt-4 flex gap-1 print:hidden">
        <button
          type="button"
          onClick={() => setTab('diario')}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'diario' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
          )}
        >
          Diario
        </button>
        <button
          type="button"
          onClick={() => setTab('semanal')}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'semanal' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
          )}
        >
          Semanal
        </button>
      </div>

      {tab === 'diario' ? (
        <ReporteDiario mapaVehiculos={mapaVehiculos} />
      ) : (
        <ReporteSemanal
          mapaAsociados={mapaAsociados}
          mapaGranjas={mapaGranjas}
          mapaVehiculos={mapaVehiculos}
          mapaGrupos={mapaGrupos}
          gruposAsociados={gruposAsociados}
        />
      )}
    </div>
  )
}

function ReporteDiario({ mapaVehiculos }: { mapaVehiculos: Map<string, { Title: string }> }) {
  const [fecha, setFecha] = useState(hoyISO())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string>()
  const [generado, setGenerado] = useState(false)
  const [recepciones, setRecepciones] = useState<Recepcion[]>([])
  const [tiquetesPorRecepcion, setTiquetesPorRecepcion] = useState<Record<string, ConsolidadoTiquete[]>>({})
  // Cuando no es undefined, todas las tarjetas EXCEPTO esta se ocultan al imprimir — así el botón
  // "Imprimir" de una tarjeta imprime solo ese lote y no el día completo. Ver el botón más abajo.
  const [imprimiendoSoloId, setImprimiendoSoloId] = useState<string>()

  const asociados = useLiveQuery(() => db.asociados.toArray(), []) ?? []
  const granjas = useLiveQuery(() => db.granjas.toArray(), []) ?? []
  const mapaAsociados = useMemo(() => new Map(asociados.map((a) => [a.id, a])), [asociados])
  const mapaGranjas = useMemo(() => new Map(granjas.map((g) => [g.id, g])), [granjas])

  async function generar() {
    setCargando(true)
    setError(undefined)
    setGenerado(false)
    try {
      const traidas = await listarRecepcionesPorRangoFecha(fecha, fecha)
      traidas.sort((a, b) => a.Consecutivo.localeCompare(b.Consecutivo))
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

  function imprimirSolo(id: string) {
    setImprimiendoSoloId(id)
    // Espera a que se aplique la clase print:hidden a las demás tarjetas antes de abrir el diálogo.
    requestAnimationFrame(() => {
      window.print()
      setImprimiendoSoloId(undefined)
    })
  }

  return (
    <div>
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden">
        <div className="max-w-xs">
          <CampoTexto type="date" etiqueta="Fecha" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <button
          type="button"
          onClick={() => void generar()}
          disabled={cargando || !navigator.onLine}
          title={navigator.onLine ? undefined : 'Sin conexión — no se puede generar el reporte'}
          className="rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:bg-slate-300"
        >
          {cargando ? 'Generando…' : 'Generar reporte del día'}
        </button>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red print:hidden">{error}</p>}

      {generado && (
        <>
          <p className="mt-4 text-sm text-slate-500 print:hidden">
            {recepciones.length} lote{recepciones.length === 1 ? '' : 's'} recibido{recepciones.length === 1 ? '' : 's'} el{' '}
            {fecha}
          </p>

          {recepciones.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No hay recepciones registradas ese día.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {recepciones.map((r) => (
                <div
                  key={r.id}
                  className={clsx(imprimiendoSoloId && imprimiendoSoloId !== r.id && 'print:hidden')}
                >
                  <div className="mb-1 flex justify-end print:hidden">
                    <button
                      type="button"
                      onClick={() => imprimirSolo(r.id)}
                      className="text-xs font-medium text-brand-navy hover:underline"
                    >
                      Imprimir / Descargar PDF
                    </button>
                  </div>
                  <ReporteDiarioLote
                    recepcion={r}
                    asociadoNombre={mapaAsociados.get(r.AsociadoId)?.Title ?? '—'}
                    granjaNombre={mapaGranjas.get(r.GranjaId)?.Title ?? '—'}
                    placa={mapaVehiculos.get(r.PlacaVehiculoId)?.Title ?? '—'}
                    tiquetes={r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : []}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function ReporteSemanal({
  mapaAsociados,
  mapaGranjas,
  mapaVehiculos,
  mapaGrupos,
  gruposAsociados,
}: {
  mapaAsociados: Map<string, { Title: string; GrupoAsociadoId?: string }>
  mapaGranjas: Map<string, { Title: string }>
  mapaVehiculos: Map<string, { Title: string }>
  mapaGrupos: Map<string, { Title: string }>
  gruposAsociados: Array<{ id: string; Title: string }>
}) {
  const [desde, setDesde] = useState(haceDiasISO(7))
  const [hasta, setHasta] = useState(hoyISO())
  const [grupoAsociadoId, setGrupoAsociadoId] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string>()
  const [generado, setGenerado] = useState(false)
  const [recepciones, setRecepciones] = useState<Recepcion[]>([])
  const [tiquetesPorRecepcion, setTiquetesPorRecepcion] = useState<Record<string, ConsolidadoTiquete[]>>({})

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
      <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 print:hidden">
        Formato provisional — todavía falta definir la estructura definitiva del reporte semanal.
      </p>

      <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden sm:grid-cols-4">
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
