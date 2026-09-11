import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import {
  listarRecepcionesPorRangoFecha,
  listarTiquetesDeRecepcion,
  obtenerNovedadCorralDeRecepcion,
} from '../../graph/lists'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { ReporteDiarioLote } from './ReporteDiarioLote'
import { ReporteSemanalAsociado } from './ReporteSemanalAsociado'
import { ReporteCierreDiario } from './ReporteCierreDiario'
import type { ConsolidadoTiquete, NovedadCorral, Recepcion } from '../../types/models'

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
 *  - "Cierre diario" (agregada 2026-09-11, a pedido de Nathalia): la tabla que arman al final del
 *    día con TODAS las recepciones del día (mismo cuadro que ya usaban en Excel), donde se toca la
 *    celda de "N.° animales" para marcar/desmarcar cuáles ya se beneficiaron el mismo día —
 *    reemplaza la práctica manual de pintar esa celda de azul. Ver el comentario de
 *    `BeneficiadoMismoDia` en models.ts y el de ReporteCierreDiario.tsx.
 *
 * Ninguna de las tres pestañas descarga nada en segundo plano ni lo guarda
 * en Dexie: las tres consultan SharePoint directo, solo al tocar "Generar",
 * para no reintroducir el problema de que cada dispositivo vaya
 * acumulando cada vez más historial (igual que descargarRecepcionesEnProceso
 * en syncService.ts, que sigue trayendo solo las recepciones "En proceso").
 */
export function Reporte() {
  const [tab, setTab] = useState<'diario' | 'semanal' | 'cierre'>('diario')

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
        <button
          type="button"
          onClick={() => setTab('cierre')}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            tab === 'cierre' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
          )}
        >
          Cierre diario
        </button>
      </div>

      {tab === 'diario' ? (
        <ReporteDiario mapaVehiculos={mapaVehiculos} />
      ) : tab === 'semanal' ? (
        <ReporteSemanal
          mapaAsociados={mapaAsociados}
          mapaGranjas={mapaGranjas}
          mapaVehiculos={mapaVehiculos}
          gruposAsociados={gruposAsociados}
        />
      ) : (
        <ReporteCierre mapaAsociados={mapaAsociados} mapaGranjas={mapaGranjas} />
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
  const [novedadCorralPorRecepcion, setNovedadCorralPorRecepcion] = useState<Record<string, NovedadCorral>>({})

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
      const novedadCorralPorRec: Record<string, NovedadCorral> = {}
      await Promise.all(
        traidas.map(async (r) => {
          if (!r.spId) return
          porRecepcion[r.spId] = await listarTiquetesDeRecepcion(r.spId)
          const novedad = await obtenerNovedadCorralDeRecepcion(r.spId)
          if (novedad) novedadCorralPorRec[r.spId] = novedad
        }),
      )
      setRecepciones(traidas)
      setTiquetesPorRecepcion(porRecepcion)
      setNovedadCorralPorRecepcion(novedadCorralPorRec)
      setGenerado(true)
    } catch (err) {
      setError(`No se pudo generar el reporte: ${(err as Error).message}`)
    } finally {
      setCargando(false)
    }
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
                <ReporteDiarioLote
                  key={r.id}
                  recepcion={r}
                  asociadoNombre={mapaAsociados.get(r.AsociadoId)?.Title ?? '—'}
                  granjaNombre={mapaGranjas.get(r.GranjaId)?.Title ?? '—'}
                  placa={mapaVehiculos.get(r.PlacaVehiculoId)?.Title ?? '—'}
                  tiquetes={r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : []}
                  novedadCorral={r.spId ? novedadCorralPorRecepcion[r.spId] : undefined}
                />
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
  const [novedadCorralPorRecepcion, setNovedadCorralPorRecepcion] = useState<Record<string, NovedadCorral>>({})

  async function generar() {
    if (!grupoAsociadoId) return
    setCargando(true)
    setError(undefined)
    setGenerado(false)
    try {
      const traidas = await listarRecepcionesPorRangoFecha(desde, hasta)
      const porRecepcion: Record<string, ConsolidadoTiquete[]> = {}
      const novedadCorralPorRec: Record<string, NovedadCorral> = {}
      await Promise.all(
        traidas.map(async (r) => {
          if (!r.spId) return
          porRecepcion[r.spId] = await listarTiquetesDeRecepcion(r.spId)
          const novedad = await obtenerNovedadCorralDeRecepcion(r.spId)
          if (novedad) novedadCorralPorRec[r.spId] = novedad
        }),
      )
      setRecepciones(traidas)
      setTiquetesPorRecepcion(porRecepcion)
      setNovedadCorralPorRecepcion(novedadCorralPorRec)
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
          {/* Antes había aquí un botón "Imprimir / Descargar PDF" con window.print() — ahora ese
              botón vive dentro de ReporteSemanalAsociado.tsx (junto a "Descargar imagen"), porque
              genera el PDF a partir del contenido real del informe en vez de abrir el diálogo de
              impresión del navegador. */}
          <p className="mt-4 text-sm text-slate-500 print:hidden">
            {recepcionesDelGrupo.length} recepci{recepcionesDelGrupo.length === 1 ? 'ón' : 'ones'} de {nombreGrupo}{' '}
            entre {desde} y {hasta}
          </p>

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
                novedadCorralPorRecepcion={novedadCorralPorRecepcion}
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

/**
 * "Cierre diario" — ver el comentario grande de Reporte() y el de ReporteCierreDiario.tsx. Este
 * componente solo trae los datos (consulta directa a Graph, sin Dexie, igual que ReporteDiario /
 * ReporteSemanal de arriba) y resuelve nombres de Asociado/Granja; toda la tabla y la interacción de
 * marcar/desmarcar viven en ReporteCierreDiario.tsx.
 *
 * Se ordena por HoraLlegadaVehiculo (no por Consecutivo, como "Diario") para que el orden de las
 * filas coincida con el orden cronológico de llegada del cuadro de referencia que ya usaban en
 * Excel.
 */
function ReporteCierre({
  mapaAsociados,
  mapaGranjas,
}: {
  mapaAsociados: Map<string, { Title: string }>
  mapaGranjas: Map<string, { Title: string }>
}) {
  const [fecha, setFecha] = useState(hoyISO())
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string>()
  const [generado, setGenerado] = useState(false)
  const [recepciones, setRecepciones] = useState<Recepcion[]>([])

  async function generar() {
    setCargando(true)
    setError(undefined)
    setGenerado(false)
    try {
      const traidas = await listarRecepcionesPorRangoFecha(fecha, fecha)
      traidas.sort((a, b) => a.HoraLlegadaVehiculo.localeCompare(b.HoraLlegadaVehiculo))
      setRecepciones(traidas)
      setGenerado(true)
    } catch (err) {
      setError(`No se pudo generar el reporte: ${(err as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  function onCambio(recepcionId: string, cambios: Partial<Recepcion>) {
    setRecepciones((actuales) => actuales.map((r) => (r.id === recepcionId ? { ...r, ...cambios } : r)))
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
          {cargando ? 'Generando…' : 'Generar cierre del día'}
        </button>
      </div>

      <ReporteCierreDiario
        fecha={fecha}
        error={error}
        generado={generado}
        recepciones={recepciones}
        asociadoNombre={(r) => mapaAsociados.get(r.AsociadoId)?.Title ?? '—'}
        granjaNombre={(r) => mapaGranjas.get(r.GranjaId)?.Title ?? '—'}
        onCambio={onCambio}
      />
    </div>
  )
}
