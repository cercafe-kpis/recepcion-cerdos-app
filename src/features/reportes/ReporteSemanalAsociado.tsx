import { useMemo, useRef, useState, type ReactNode } from 'react'
import { descargarElementoComoImagen } from '../../utils/descargarImagen'
import type { ConsolidadoTiquete, Recepcion } from '../../types/models'

const BASE = import.meta.env.BASE_URL

type StatsNovedad = {
  fortuitoTransporte: number
  fortuitoDesembarque: number
  fortuitoReposo: number
  agitados: number
  caidos: number
  lesionados: number
}

function statsVacias(): StatsNovedad {
  return { fortuitoTransporte: 0, fortuitoDesembarque: 0, fortuitoReposo: 0, agitados: 0, caidos: 0, lesionados: 0 }
}

/** "Muerto en Reposo" no vive en Recepcion (viene de NovedadCorral) — se cuenta a partir de los
 * ConsolidadoTiquetes ya generados para esa Recepción, igual que hace ReporteDiarioLote.tsx. */
function contarReposo(tiquetes: ConsolidadoTiquete[]): number {
  return tiquetes.filter((t) => t.TipoNovedad === 'Muerto en Reposo').length
}

function sumarStats(base: StatsNovedad, r: Recepcion, cantReposo: number): StatsNovedad {
  return {
    fortuitoTransporte: base.fortuitoTransporte + (r.FortuitoCantMuertoTransporte ?? 0),
    fortuitoDesembarque: base.fortuitoDesembarque + (r.FortuitoCantMuertoDesembarque ?? 0),
    fortuitoReposo: base.fortuitoReposo + cantReposo,
    agitados: base.agitados + (r.NovLlegadaCantAgitados ?? 0),
    caidos: base.caidos + (r.NovLlegadaCantCaidos ?? 0),
    lesionados: base.lesionados + (r.NovLlegadaCantLesionados ?? 0),
  }
}

function totalNovedades(s: StatsNovedad): number {
  return s.fortuitoTransporte + s.fortuitoDesembarque + s.fortuitoReposo + s.agitados + s.caidos + s.lesionados
}

function listaBadges(s: StatsNovedad): Array<{ etiqueta: string; cantidad: number }> {
  const posibles: Array<[string, number]> = [
    ['Fortuito transporte', s.fortuitoTransporte],
    ['Fortuito desembarque', s.fortuitoDesembarque],
    ['Fortuito reposo', s.fortuitoReposo],
    ['Agitados', s.agitados],
    ['Caídos', s.caidos],
    ['Lesionados', s.lesionados],
  ]
  return posibles.filter(([, cantidad]) => cantidad > 0).map(([etiqueta, cantidad]) => ({ etiqueta, cantidad }))
}

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function formatearRangoSemana(desde: string, hasta: string, mayusculas: boolean): string {
  const d1 = new Date(`${desde}T00:00:00Z`)
  const d2 = new Date(`${hasta}T00:00:00Z`)
  const mes1 = NOMBRES_MES[d1.getUTCMonth()]
  const mes2 = NOMBRES_MES[d2.getUTCMonth()]
  const texto =
    mes1 === mes2
      ? `${d1.getUTCDate()} – ${d2.getUTCDate()} ${mes2} ${d2.getUTCFullYear()}`
      : `${d1.getUTCDate()} ${mes1} – ${d2.getUTCDate()} ${mes2} ${d2.getUTCFullYear()}`
  return mayusculas ? texto.toUpperCase() : texto
}

/**
 * Número de semana ISO 8601 (lunes a domingo, semana 1 = la que contiene el primer jueves del
 * año) calculado a partir de la fecha "desde" elegida en el filtro. Si en Cercafe usan otra
 * convención de numeración de semanas, este número puede no coincidir exactamente — el rango de
 * fechas que sí se ve debajo (y todos los datos) siempre reflejan el filtro real.
 */
function numeroSemanaISO(fechaISO: string): number {
  const fecha = new Date(`${fechaISO}T00:00:00Z`)
  const dia = (fecha.getUTCDay() + 6) % 7
  fecha.setUTCDate(fecha.getUTCDate() - dia + 3)
  const primerJueves = new Date(Date.UTC(fecha.getUTCFullYear(), 0, 4))
  const diaPrimerJueves = (primerJueves.getUTCDay() + 6) % 7
  primerJueves.setUTCDate(primerJueves.getUTCDate() - diaPrimerJueves + 3)
  return 1 + Math.round((fecha.getTime() - primerJueves.getTime()) / (7 * 86400000))
}

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso || '—'
  return `${dia}/${mes}/${anio}`
}

function semaforo(porcentaje: number): { bg: string } {
  if (porcentaje < 1) return { bg: 'bg-emerald-500' }
  if (porcentaje <= 3) return { bg: 'bg-amber-500' }
  return { bg: 'bg-brand-red' }
}

const claseBadge = 'rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800'

/**
 * Informe semanal de novedades en corrales — reproduce el formato del PDF de referencia que
 * Cercafe ya le envía a los asociados ("Informe Semana N"), con el logo real de Cercafe. La
 * pantalla que lo genera (Reporte.tsx, pestaña "Semanal") arma UN informe de estos por cada
 * Grupo Asociado seleccionado, con TODAS las granjas/recepciones de ese grupo juntas (ej. el
 * grupo HBM con sus granjas La Fabiola, Los Mellos, Miraflores, El Trébol y El Jazmín sale en un
 * solo informe) — por eso el título que se recibe en `nombreEncabezado` es el nombre del Grupo
 * Asociado, no el de un asociado individual.
 *
 * Trae su propio botón "Descargar imagen" (mismo patrón que ReporteDiarioLote.tsx) — quien lo usa
 * no necesita armar ese botón aparte.
 */
export function ReporteSemanalAsociado({
  nombreEncabezado,
  desde,
  hasta,
  recepciones,
  tiquetesPorRecepcion,
  mapaGranjas,
  mapaVehiculos,
}: {
  nombreEncabezado: string
  desde: string
  hasta: string
  recepciones: Recepcion[]
  tiquetesPorRecepcion: Record<string, ConsolidadoTiquete[]>
  mapaGranjas: Map<string, { Title: string }>
  mapaVehiculos: Map<string, { Title: string }>
}) {
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState<string>()

  const numeroSemana = numeroSemanaISO(desde)
  const rangoMayus = formatearRangoSemana(desde, hasta, true)
  const rangoMinus = formatearRangoSemana(desde, hasta, false)

  const totales = useMemo(() => {
    let animales = 0
    let stats = statsVacias()
    for (const r of recepciones) {
      animales += r.NumeroTotalCerdos
      const cantReposo = contarReposo(r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : [])
      stats = sumarStats(stats, r, cantReposo)
    }
    const porcentaje = animales > 0 ? (totalNovedades(stats) / animales) * 100 : 0
    return { animales, stats, porcentaje, lotes: recepciones.length }
  }, [recepciones, tiquetesPorRecepcion])

  const porGranja = useMemo(() => {
    const mapa = new Map<string, { nombre: string; lotes: number; animales: number; stats: StatsNovedad }>()
    for (const r of recepciones) {
      const granjaId = r.GranjaId || '__sin-granja__'
      const nombre = mapaGranjas.get(r.GranjaId)?.Title ?? 'Sin granja'
      const cantReposo = contarReposo(r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : [])
      const actual = mapa.get(granjaId) ?? { nombre, lotes: 0, animales: 0, stats: statsVacias() }
      actual.lotes += 1
      actual.animales += r.NumeroTotalCerdos
      actual.stats = sumarStats(actual.stats, r, cantReposo)
      mapa.set(granjaId, actual)
    }
    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [recepciones, tiquetesPorRecepcion, mapaGranjas])

  const porVehiculo = useMemo(() => {
    const mapa = new Map<string, { placa: string; lotes: number; animales: number; granjas: Set<string>; stats: StatsNovedad }>()
    for (const r of recepciones) {
      const vehId = r.PlacaVehiculoId || '__sin-vehiculo__'
      const placa = mapaVehiculos.get(r.PlacaVehiculoId)?.Title ?? 'Sin placa'
      const granjaNombre = mapaGranjas.get(r.GranjaId)?.Title ?? 'Sin granja'
      const cantReposo = contarReposo(r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : [])
      const actual = mapa.get(vehId) ?? { placa, lotes: 0, animales: 0, granjas: new Set<string>(), stats: statsVacias() }
      actual.lotes += 1
      actual.animales += r.NumeroTotalCerdos
      actual.granjas.add(granjaNombre)
      actual.stats = sumarStats(actual.stats, r, cantReposo)
      mapa.set(vehId, actual)
    }
    return Array.from(mapa.values())
      .filter((v) => totalNovedades(v.stats) > 0)
      .sort((a, b) => totalNovedades(b.stats) - totalNovedades(a.stats))
  }, [recepciones, tiquetesPorRecepcion, mapaGranjas, mapaVehiculos])

  const detalle = useMemo(
    () =>
      [...recepciones].sort(
        (a, b) => a.FechaRecepcion.localeCompare(b.FechaRecepcion) || a.Consecutivo.localeCompare(b.Consecutivo),
      ),
    [recepciones],
  )

  async function descargarImagen() {
    if (!contenedorRef.current) return
    setDescargando(true)
    setError(undefined)
    try {
      const nombreArchivo = nombreEncabezado.trim().toLowerCase().replace(/\s+/g, '-')
      await descargarElementoComoImagen(contenedorRef.current, `informe-semanal-${nombreArchivo}-semana${numeroSemana}.png`)
    } catch (err) {
      setError(`No se pudo generar la imagen: ${(err as Error).message}`)
    } finally {
      setDescargando(false)
    }
  }

  const semaforoActual = semaforo(totales.porcentaje)

  return (
    <div className="print:break-before-page">
      <div className="mb-2 flex items-center justify-end gap-3 print:hidden">
        {error && <p className="text-xs text-brand-red">{error}</p>}
        <button
          type="button"
          onClick={() => void descargarImagen()}
          disabled={descargando}
          className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
        >
          {descargando ? 'Generando imagen…' : 'Descargar imagen'}
        </button>
      </div>

      <section
        ref={contenedorRef}
        className="mx-auto max-w-4xl overflow-hidden rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200 print:shadow-none"
      >
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">
              Semana {numeroSemana} · {rangoMayus}
            </p>
            <p className="mt-1 text-xl font-bold text-brand-navy">{nombreEncabezado}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Informe de novedades en corrales</p>
          </div>
          <img src={`${BASE}cercafe-logo.jpg`} alt="Cercafe" className="h-11 w-auto shrink-0" />
        </div>

        {/* Semáforo */}
        <div className={`flex items-center gap-3 px-5 py-3 ${semaforoActual.bg}`}>
          <span className="text-xl font-extrabold text-white">{totales.porcentaje.toFixed(2)}%</span>
          <span className="text-xs font-medium text-white/90">de novedades registradas esta semana</span>
        </div>

        {/* Resumen semanal */}
        <div className="p-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Resumen semanal</p>
          <div className="flex flex-wrap gap-2">
            <TileResumen valor={totales.lotes} etiqueta="Lotes enviados" tipo="info" />
            <TileResumen valor={totales.animales} etiqueta="Animales" tipo="info" />
            <TileResumen valor={totales.stats.fortuitoTransporte} etiqueta="Fortuito transporte" tipo="novedad" />
            <TileResumen valor={totales.stats.fortuitoDesembarque} etiqueta="Fortuito desembarque" tipo="novedad" />
            <TileResumen valor={totales.stats.fortuitoReposo} etiqueta="Fortuito reposo" tipo="novedad" />
            <TileResumen valor={totales.stats.agitados} etiqueta="Agitados" tipo="novedad" />
            <TileResumen valor={totales.stats.caidos} etiqueta="Caídos" tipo="novedad" />
            <TileResumen valor={totales.stats.lesionados} etiqueta="Lesionados" tipo="novedad" />
          </div>
        </div>

        {/* Novedades por granja */}
        <div className="px-5 pb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Novedades por granja</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {porGranja.map((g) => {
              const badges = listaBadges(g.stats)
              return (
                <div
                  key={g.nombre}
                  className={`rounded-md border-l-4 bg-slate-50 p-3 ${badges.length > 0 ? 'border-purple-400' : 'border-emerald-400'}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-slate-800">{g.nombre}</p>
                    <p className="shrink-0 text-xs text-slate-500">
                      {g.lotes} lote{g.lotes === 1 ? '' : 's'} · {g.animales} animales
                    </p>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {badges.length === 0 ? (
                      <span className="text-xs italic text-slate-400">Sin novedades</span>
                    ) : (
                      badges.map((b) => (
                        <span key={b.etiqueta} className={claseBadge}>
                          {b.cantidad} {b.etiqueta}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Vehículos con novedades — solo se listan los que tuvieron alguna */}
        {porVehiculo.length > 0 && (
          <div className="px-5 pb-5">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Vehículos con novedades</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {porVehiculo.map((v) => (
                <div key={v.placa} className="rounded-md border-l-4 border-purple-400 bg-purple-50/40 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-semibold text-slate-800">🚛 {v.placa}</p>
                    <p className="shrink-0 text-xs text-slate-500">
                      {v.lotes} lote{v.lotes === 1 ? '' : 's'} · {v.animales} animales
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">Granjas atendidas: {Array.from(v.granjas).join(', ')}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {listaBadges(v.stats).map((b) => (
                      <span key={b.etiqueta} className={claseBadge}>
                        {b.cantidad} {b.etiqueta}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detalle por lote — encabezado en flexbox (no rowSpan/colSpan de tabla): ver la misma
            nota en ReporteDiarioLote.tsx sobre por qué html2canvas-pro rompe las celdas
            combinadas de una <table> al descargar la imagen. Envuelta en overflow-x-auto con un
            min-w fijo (misma razón que la tabla de Horas de ReporteDiarioLote.tsx) para que en un
            celular angosto se pueda deslizar en vez de quedar recortada. */}
        <div className="px-5 pb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Detalle por lote</p>
          <div className="overflow-x-auto">
            <div className="min-w-[820px] overflow-hidden rounded-md border border-slate-200 text-center text-xs">
              <div className="flex bg-brand-navy font-semibold text-white">
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Fecha</div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Granja</div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Consec.</div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Animales</div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Placa</div>
                <div className="flex flex-[3_3_0%] flex-col border-l border-white/20">
                  <p className="px-1 py-1 text-center">Fortuitos</p>
                  <div className="flex flex-1 border-t border-white/20">
                    <p className="flex-1 px-1 py-1">Transp.</p>
                    <p className="flex-1 border-l border-white/20 px-1 py-1">Desemb.</p>
                    <p className="flex-1 border-l border-white/20 px-1 py-1">Reposo</p>
                  </div>
                </div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Agitados</div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Caídos</div>
                <div className="flex flex-1 items-center justify-center px-1 py-1.5">Lesion.</div>
              </div>
              {detalle.map((r, i) => {
                const cantReposo = contarReposo(r.spId ? (tiquetesPorRecepcion[r.spId] ?? []) : [])
                return (
                  <div key={r.id} className={`flex border-t border-slate-200 ${i % 2 === 1 ? 'bg-purple-50/30' : 'bg-white'}`}>
                    <div className="flex-1 px-1 py-1.5">{fechaCorta(r.FechaRecepcion)}</div>
                    <div className="flex-1 px-1 py-1.5">{mapaGranjas.get(r.GranjaId)?.Title ?? '—'}</div>
                    <div className="flex-1 px-1 py-1.5">{r.Consecutivo}</div>
                    <div className="flex-1 px-1 py-1.5">{r.NumeroTotalCerdos}</div>
                    <div className="flex-1 px-1 py-1.5">{mapaVehiculos.get(r.PlacaVehiculoId)?.Title ?? '—'}</div>
                    <div className="flex flex-[3_3_0%]">
                      <CeldaCantidad valor={r.FortuitoCantMuertoTransporte} />
                      <CeldaCantidad valor={r.FortuitoCantMuertoDesembarque} />
                      <CeldaCantidad valor={cantReposo} />
                    </div>
                    <CeldaCantidad valor={r.NovLlegadaCantAgitados} />
                    <CeldaCantidad valor={r.NovLlegadaCantCaidos} />
                    <CeldaCantidad valor={r.NovLlegadaCantLesionados} />
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Buenas prácticas — contenido fijo, igual cada semana */}
        <div className="px-5 pb-5">
          <div className="overflow-hidden rounded-md border border-slate-200">
            <p className="bg-brand-navy px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">
              🐷 Buenas prácticas para el transporte de cerdos a planta de beneficio
            </p>
            <div className="grid gap-3 bg-white p-3 sm:grid-cols-2">
              <TipTransporte emoji="🛣️" titulo="Planificación de la ruta">
                En recorridos largos, verificar el estado de los animales durante el trayecto. Las paradas deben
                realizarse en lugares ventilados y seguros.
              </TipTransporte>
              <TipTransporte emoji="🚦" titulo="Velocidad y manejo del vehículo">
                Conducción suave, evitando frenadas bruscas y aceleraciones abruptas. Esto reduce el estrés y el
                riesgo de caídas durante el trayecto.
              </TipTransporte>
              <TipTransporte emoji="📦" titulo="Densidad de carga">
                Respetar la densidad recomendada según el peso de los animales para evitar agotamiento, agitación y
                lesiones por aplastamiento.
              </TipTransporte>
              <TipTransporte emoji="⏱️" titulo="Ayuno previo al embarque">
                Un ayuno adecuado (máximo 12 horas) reduce el estrés digestivo y el riesgo de contaminación de la
                canal.
              </TipTransporte>
              <TipTransporte emoji="🔍" titulo="Inspección antes del embarque">
                Revisar el estado de los animales antes del embarque, incluyendo signos de enfermedad, cojera,
                prolapsos, heridas abiertas y estado de suciedad.
              </TipTransporte>
            </div>
          </div>
        </div>

        {/* Metodología del semáforo — contenido fijo */}
        <div className="px-5 pb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Metodología del semáforo</p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs text-slate-600">
              La semaforización es una métrica propia de Cercafe para evaluar el desempeño semanal de cada asociado
              en el transporte de animales a planta de beneficio. Se basa en el promedio ponderado de novedades en
              relación con la cantidad total de cerdos enviados, lo que permite una evaluación justa
              independientemente del volumen de despacho.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white">
                ✅ Verde → &lt; 1%
              </span>
              <span className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white">
                🟡 Amarillo → 1% – 3%
              </span>
              <span className="rounded-md bg-brand-red px-3 py-1.5 text-xs font-semibold text-white">
                🔴 Rojo → &gt; 3%
              </span>
            </div>
          </div>
        </div>

        {/* Glosario — contenido fijo */}
        <div className="px-5 pb-5">
          <div className="overflow-hidden rounded-md border border-slate-200">
            <p className="bg-brand-navy px-3 py-2 text-xs font-bold uppercase tracking-wide text-white">📋 Definiciones</p>
            <div className="grid gap-3 bg-white p-3 sm:grid-cols-2">
              <Definicion color="purple" titulo="Cerdo agitado">
                Presenta respiración rápida, jadeo, vocalizaciones frecuentes e intensas y temblores corporales.
                Requiere sacrificio de emergencia.
              </Definicion>
              <Definicion color="purple" titulo="Cerdo caído">
                No puede levantarse ni desplazarse por sí mismo debido a enfermedad, lesión o agotamiento. Requiere
                sacrificio de emergencia.
              </Definicion>
              <Definicion color="purple" titulo="Cerdo lesionado">
                Presenta herida o daño físico que afecta su bienestar: cojera, fracturas, lesiones superficiales,
                prolapsos, heridas abiertas o hematomas. Requiere sacrificio de emergencia.
              </Definicion>
              <Definicion color="amber" titulo="Fortuito en transporte — Decomisado">
                Cerdo muerto durante el transporte que, por congestionamiento, no es apto para consumo humano. →
                Decomiso.
              </Definicion>
              <Definicion color="amber" titulo="Fortuito en transporte — Procesado">
                Cerdo muerto durante el transporte en condición limpia. Puede pasar a proceso según criterio del
                veterinario de planta.
              </Definicion>
              <Definicion color="amber" titulo="Fortuito en desembarque">
                Llega caído al desembarque y no logra reincorporarse. Se conduce a beneficio de emergencia, pero
                puede morir súbitamente derivando en decomiso o proceso.
              </Definicion>
              <Definicion color="amber" titulo="Fortuito en reposo">
                Cerdo muerto durante el reposo en corrales. Su destino es decomiso o proceso según el estado del
                animal.
              </Definicion>
              <Definicion color="purple" titulo="Novedades">
                Eventualidades que se presentan previo, durante y posterior al ingreso de los cerdos a planta de
                beneficio. Incluyen todos los eventos registrados en este informe.
              </Definicion>
            </div>
          </div>
        </div>

        {/* Pie */}
        <div className="border-t border-slate-200 px-5 py-3 text-center text-[11px] text-slate-400">
          <p>Semana {numeroSemana} · {rangoMinus} · Informe de uso interno · Cercafe · Área de Corrales</p>
          <p className="mt-0.5">Desarrollado por Gestión Técnica Especializada</p>
        </div>
      </section>
    </div>
  )
}

function TileResumen({ valor, etiqueta, tipo }: { valor: number; etiqueta: string; tipo: 'info' | 'novedad' }) {
  const clase =
    tipo === 'info'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : valor > 0
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-white text-slate-600'
  return (
    <div className={`min-w-[92px] flex-1 rounded-md border p-2 text-center ${clase}`}>
      <p className="text-lg font-extrabold">{valor}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide">{etiqueta}</p>
    </div>
  )
}

function CeldaCantidad({ valor }: { valor: number | undefined }) {
  return <div className="flex-1 px-1 py-1.5">{valor && valor > 0 ? valor : '—'}</div>
}

function TipTransporte({ emoji, titulo, children }: { emoji: string; titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs font-semibold text-brand-navy">
        {emoji} {titulo}
      </p>
      <p className="mt-1 text-xs text-slate-600">{children}</p>
    </div>
  )
}

function Definicion({ color, titulo, children }: { color: 'purple' | 'amber'; titulo: string; children: ReactNode }) {
  return (
    <div className={`rounded-md border-l-4 bg-slate-50 p-3 ${color === 'purple' ? 'border-purple-400' : 'border-amber-400'}`}>
      <p className="text-xs font-semibold text-slate-800">{titulo}</p>
      <p className="mt-0.5 text-xs text-slate-600">{children}</p>
    </div>
  )
}
