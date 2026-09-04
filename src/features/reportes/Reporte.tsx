import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { listarRecepcionesPorRangoFecha, listarTiquetesDeRecepcion } from '../../graph/lists'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { ReporteDiarioLote } from './ReporteDiarioLote'
import { ReporteSemanalAsociado } from './ReporteSemanalAsociado'
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
 *  - "Semanal": el informe semanal de novedades en corrales (mismo formato
 *    que el PDF "Informe Semana N" que Cercafe ya le envía a los asociados),
 *    UN solo informe por Grupo Asociado — el filtro obligatorio es el Grupo
 *    Asociado, y al generar se junta en un mismo informe todas las
 *    recepciones de todas las granjas/asociados de ese grupo en el rango de
 *    fechas elegido (ej. el grupo HBM con sus granjas La Fabiola, Los
 *    Mellos, Miraflores, El Trébol y El Jazmín sale en un único PDF).
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

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 print:hidden">Reporte</h1>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Reporte diario por lote (para enviar al asociado apenas termina una recepción) o informe semanal de
        novedades en corrales por Grupo Asociado.
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
  gruposAsociados,
}: {
  mapaAsociados: Map<string, { Title: string; GrupoAsociadoId?: string }>
  mapaGranjas: Map<string, { Title: string }>
  mapaVehiculos: Map<string, { Title: string }>
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
    if (!grupoAsociadoId) return
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

  // Un solo informe (ReporteSemanalAsociado) para TODO el grupo elegido, con las recepciones de
  // todos sus asociados/granjas juntas — ej. el grupo HBM (La Fabiola, Los Mellos, Miraflores, El
  // Trébol, El Jazmín) sale en un único informe, no uno por cada granja o asociado. Dentro del
  // informe, "Novedades por granja" y "Vehículos con novedades" ya desglosan el detalle.
  const recepcionesDelGrupo = useMemo(
    () => recepciones.filter((r) => mapaAsociados.get(r.AsociadoId)?.GrupoAsociadoId === grupoAsociadoId),
    [recepciones, grupoAsociadoId, mapaAsociados],
  )

  const nombreGrupo = gruposAsociados.find((g) => g.id === grupoAsociadoId)?.Title ?? 'Grupo asociado'

  return (
    <div>
      <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden sm:grid-cols-4">
        <CampoTexto type="date" etiqueta="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <CampoTexto type="date" etiqueta="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <CampoSelect
          etiqueta="Grupo Asociado"
          requerido
          value={grupoAsociadoId}
          onChange={(e) => setGrupoAsociadoId(e.target.value)}
          opciones={gruposAsociados.map((g) => ({ value: g.id, label: g.Title }))}
          placeholder="Selecciona un grupo…"
        />
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void generar()}
            disabled={cargando || !grupoAsociadoId || !navigator.onLine}
            title={
              !navigator.onLine
                ? 'Sin conexión — no se puede generar el reporte'
                : !grupoAsociadoId
                  ? 'Selecciona un Grupo Asociado'
                  : undefined
            }
            className="w-full rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:bg-slate-300"
          >
            {cargando ? 'Generando…' : 'Generar informe semanal'}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red print:hidden">{error}</p>}

      {generado && (
        <>
          <div className="mt-4 flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-500">
              {recepcionesDelGrupo.length} recepci{recepcionesDelGrupo.length === 1 ? 'ón' : 'ones'} de {nombreGrupo}{' '}
              entre {desde} y {hasta}
            </p>
            {recepcionesDelGrupo.length > 0 && (
              <button
                type="button"
                onClick={() => window.print()}
                className="text-xs font-medium text-brand-navy hover:underline"
              >
                Imprimir / Descargar PDF
              </button>
            )}
          </div>

          {recepcionesDelGrupo.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Ese grupo no tuvo recepciones en ese rango de fechas.</p>
          ) : (
            <div className="mt-4">
              <ReporteSemanalAsociado
                nombreEncabezado={nombreGrupo}
                desde={desde}
                hasta={hasta}
                recepciones={recepcionesDelGrupo}
                tiquetesPorRecepcion={tiquetesPorRecepcion}
                mapaGranjas={mapaGranjas}
                mapaVehiculos={mapaVehiculos}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
