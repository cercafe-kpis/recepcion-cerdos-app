import { useRef, useState } from 'react'
import clsx from 'clsx'
import type { ConsolidadoTiquete, Recepcion, TipoNovedad } from '../../types/models'

const BASE = import.meta.env.BASE_URL

/** Siempre es la misma planta (confirmado con el usuario) — no se captura ni se guarda en SharePoint. */
const PLANTA = 'FRIGOTUN'

/**
 * Convierte la fecha de recepción a "03/09/2026". SharePoint guarda FechaRecepcion como columna
 * "Fecha y hora", así que Graph la devuelve como fecha-hora completa (ej. "2026-09-03T07:00:00Z"),
 * no como "2026-09-03" plano — por eso primero se recortan los 10 caracteres de la fecha y luego
 * se parte por guiones, en vez de partir el string completo directamente.
 */
function formatearFecha(iso: string): string {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

/** Las horas se guardan como fecha-hora ISO completa (ver combinarFechaHora en Recepcion.tsx) — esto solo extrae "HH:MM". */
function horaCorta(iso: string | undefined): string {
  if (!iso || iso.length < 16) return '—'
  return iso.slice(11, 16)
}

/** Minutos entre dos horas guardadas como fecha-hora ISO — para Tiempo de espera y Tiempo de desembarque. */
function minutosEntre(desdeIso: string | undefined, hastaIso: string | undefined): string {
  if (!desdeIso || !hastaIso) return '—'
  const desde = new Date(desdeIso).getTime()
  const hasta = new Date(hastaIso).getTime()
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return '—'
  return String(Math.round((hasta - desde) / 60000))
}

/** Agrupa los tiquetes de un tipo de fortuito por Destino, para mostrar "3 Procesado / 1 Decomisado" en la misma celda. */
function agruparPorDestino(tiquetes: ConsolidadoTiquete[], tipo: TipoNovedad): Array<{ cantidad: number; destino: string }> {
  const delTipo = tiquetes.filter((t) => t.TipoNovedad === tipo)
  const porDestino = new Map<string, number>()
  for (const t of delTipo) {
    const clave = t.Destino ?? 'Sin destino'
    porDestino.set(clave, (porDestino.get(clave) ?? 0) + 1)
  }
  return Array.from(porDestino.entries()).map(([destino, cantidad]) => ({ destino, cantidad }))
}

/**
 * Reporte de llegada — el reporte por lote que se le envía a cada asociado
 * apenas termina una recepción (pedido explícito del usuario, con una
 * imagen de referencia del formato en papel que ya se usaba). Mantiene los
 * mismos datos que esa plantilla, con un diseño más cuidado y el logo real
 * de Cercafe (public/cercafe-logo.jpg), y agrega la opción de descargarlo
 * como imagen PNG (además de poder imprimirse / exportarse a PDF con
 * window.print(), que sigue disponible desde donde se usa este componente:
 * Consolidado.tsx y la pestaña "Diario" de Reporte.tsx).
 *
 * Tiempo de espera y Tiempo de desembarque NO se capturan aparte: se
 * calculan solos a partir de Hora programada / Hora de llegada / Hora de
 * inicio / Hora final de desembarque, que sí se capturan en Recepcion.tsx.
 */
export function ReporteDiarioLote({
  recepcion,
  asociadoNombre,
  granjaNombre,
  placa,
  tiquetes,
}: {
  recepcion: Recepcion
  asociadoNombre: string
  granjaNombre: string
  placa: string
  tiquetes: ConsolidadoTiquete[]
}) {
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState<string>()

  const fortuitoTransporte = agruparPorDestino(tiquetes, 'Muerto en Transporte')
  const fortuitoDesembarque = agruparPorDestino(tiquetes, 'Muerto en Desembarque')
  const fortuitoReposo = agruparPorDestino(tiquetes, 'Muerto en Reposo')

  async function descargarImagen() {
    if (!contenedorRef.current) return
    setDescargando(true)
    setError(undefined)
    try {
      // Carga html2canvas-pro solo cuando hace falta (es una librería pesada) — la variante
      // "pro" es necesaria porque Tailwind 4 usa colores oklch() que el html2canvas normal
      // no sabe interpretar y produciría una imagen en blanco o rota.
      const { default: html2canvas } = await import('html2canvas-pro')
      const canvas = await html2canvas(contenedorRef.current, {
        backgroundColor: '#ffffff',
        scale: 2,
      })
      const enlace = document.createElement('a')
      enlace.download = `reporte-llegada-${recepcion.Consecutivo || 'lote'}.png`
      enlace.href = canvas.toDataURL('image/png')
      enlace.click()
    } catch (err) {
      setError(`No se pudo generar la imagen: ${(err as Error).message}`)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div>
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
        className="mx-auto max-w-3xl overflow-hidden rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200 print:break-inside-avoid print:shadow-none"
      >
        {/* Encabezado */}
        <div className="flex items-center justify-between gap-4 border-b-2 border-brand-navy px-5 py-4">
          <img src={`${BASE}cercafe-logo.jpg`} alt="Cercafe" className="h-11 w-auto" />
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-red">Reporte de llegada</p>
            <p className="text-base font-bold text-brand-navy">Consecutivo {recepcion.Consecutivo}</p>
          </div>
        </div>

        {/* Datos generales */}
        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
          <Campo etiqueta="Fecha" valor={formatearFecha(recepcion.FechaRecepcion)} />
          <Campo etiqueta="Planta" valor={PLANTA} />
          <Campo etiqueta="Asociado" valor={asociadoNombre} className="sm:col-span-2" />
          <Campo etiqueta="Granja" valor={granjaNombre} className="sm:col-span-2" />
          <Campo etiqueta="Orden" valor={recepcion.NumeroOrden} />
          <Campo etiqueta="# Animales" valor={recepcion.NumeroTotalCerdos} />
        </div>

        {/* Horas */}
        <div className="px-5 pt-4">
          <table className="w-full border-collapse overflow-hidden rounded-lg text-center text-xs">
            <thead>
              <tr className="bg-brand-navy text-white">
                <th className="px-2 py-1.5 font-semibold">Hora programada</th>
                <th className="px-2 py-1.5 font-semibold">Hora ingreso</th>
                <th className="px-2 py-1.5 font-semibold">Tiempo de espera</th>
                <th className="px-2 py-1.5 font-semibold">Hora inicio</th>
                <th className="px-2 py-1.5 font-semibold">Hora finalización</th>
                <th className="px-2 py-1.5 font-semibold">Tiempo desembarque/min</th>
                <th className="px-2 py-1.5 font-semibold">Placa vehículo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-slate-50">
                <td className="border border-slate-200 px-2 py-1.5">{horaCorta(recepcion.HoraProgramada)}</td>
                <td className="border border-slate-200 px-2 py-1.5">{horaCorta(recepcion.HoraLlegadaVehiculo)}</td>
                <td className="border border-slate-200 px-2 py-1.5">
                  {minutosEntre(recepcion.HoraLlegadaVehiculo, recepcion.HoraInicioDesembarque)}
                </td>
                <td className="border border-slate-200 px-2 py-1.5">{horaCorta(recepcion.HoraInicioDesembarque)}</td>
                <td className="border border-slate-200 px-2 py-1.5">{horaCorta(recepcion.HoraFinalDesembarque)}</td>
                <td className="border border-slate-200 px-2 py-1.5">
                  {minutosEntre(recepcion.HoraInicioDesembarque, recepcion.HoraFinalDesembarque)}
                </td>
                <td className="border border-slate-200 px-2 py-1.5">{placa}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Novedades — se arma con flexbox (nada de rowSpan/colSpan de tabla): html2canvas-pro calcula
            mal el alto de las celdas combinadas de una <table> y produce una imagen descargada con
            texto encimado, aunque en pantalla y al imprimir (que sí usa el motor real del navegador)
            se vea bien. Con flexbox el resultado es idéntico en los tres casos. */}
        <div className="mt-4 px-5">
          <p className="rounded-t-lg bg-amber-400 px-3 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-slate-900">
            Novedades
          </p>
          <div className="overflow-hidden rounded-b-lg border border-t-0 border-slate-200 text-center text-xs">
            <div className="flex bg-slate-100 text-slate-600">
              <div className="flex flex-1 items-center justify-center border-r border-slate-200 px-1 py-1.5 font-semibold">
                Lesión
              </div>
              <div className="flex flex-1 items-center justify-center border-r border-slate-200 px-1 py-1.5 font-semibold">
                Agitados
              </div>
              <div className="flex flex-1 items-center justify-center border-r border-slate-200 px-1 py-1.5 font-semibold">
                Caídos
              </div>
              <div className="flex flex-1 flex-col border-r border-slate-200">
                <p className="border-b border-slate-200 px-1 py-1.5">Fortuito en transporte</p>
                <div className="flex flex-1">
                  <p className="flex-1 border-r border-slate-200 px-1 py-1">#</p>
                  <p className="flex-1 px-1 py-1">Destino</p>
                </div>
              </div>
              <div className="flex flex-1 flex-col border-r border-slate-200">
                <p className="border-b border-slate-200 px-1 py-1.5">Fortuito en desembarque</p>
                <div className="flex flex-1">
                  <p className="flex-1 border-r border-slate-200 px-1 py-1">#</p>
                  <p className="flex-1 px-1 py-1">Destino</p>
                </div>
              </div>
              <div className="flex flex-1 items-center justify-center px-1 py-1.5 font-semibold">
                Fortuito en reposo
              </div>
            </div>

            <div className="flex border-t border-slate-200">
              <div className="flex-1 border-r border-slate-200 px-1 py-1.5">
                {recepcion.NovLlegadaLesionados ? recepcion.NovLlegadaCantLesionados ?? '—' : '—'}
              </div>
              <div className="flex-1 border-r border-slate-200 px-1 py-1.5">
                {recepcion.NovLlegadaAgitados ? recepcion.NovLlegadaCantAgitados ?? '—' : '—'}
              </div>
              <div className="flex-1 border-r border-slate-200 px-1 py-1.5">
                {recepcion.NovLlegadaCaidos ? recepcion.NovLlegadaCantCaidos ?? '—' : '—'}
              </div>
              <FilaFortuito grupos={fortuitoTransporte} />
              <FilaFortuito grupos={fortuitoDesembarque} />
              <div className="flex-1 px-1 py-1.5">
                {fortuitoReposo.length === 0 ? (
                  '—'
                ) : (
                  <div className="flex flex-col">
                    {fortuitoReposo.map((g) => (
                      <span key={g.destino}>
                        {g.cantidad} {g.destino}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Nota y encargado */}
        <div className="mt-4 space-y-2 px-5 pb-5">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Nota</p>
            <p className="text-sm text-slate-800">{recepcion.Observaciones || '—'}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Encargado</p>
            <p className="text-sm text-slate-800">{recepcion.CapturadoPor || '—'}</p>
          </div>
        </div>
      </section>
    </div>
  )
}

function Campo({ etiqueta, valor, className }: { etiqueta: string; valor: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('bg-white px-3 py-2', className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className="text-sm font-semibold text-slate-900">{valor}</p>
    </div>
  )
}

/** Fortuito en transporte / desembarque muestran # y Destino en columnas separadas — una fila por cada Destino distinto que haya. */
function FilaFortuito({ grupos }: { grupos: Array<{ cantidad: number; destino: string }> }) {
  return (
    <div className="flex flex-1 border-r border-slate-200">
      <div className="flex-1 border-r border-slate-200 px-1 py-1.5">
        {grupos.length === 0 ? (
          '—'
        ) : (
          <div className="flex flex-col">
            {grupos.map((g) => (
              <span key={g.destino}>{g.cantidad}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 px-1 py-1.5">
        {grupos.length === 0 ? (
          '—'
        ) : (
          <div className="flex flex-col">
            {grupos.map((g) => (
              <span key={g.destino}>{g.destino}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
