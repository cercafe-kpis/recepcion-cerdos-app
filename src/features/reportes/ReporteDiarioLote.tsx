import type { ConsolidadoTiquete, Recepcion, TipoNovedad } from '../../types/models'

const BASE = import.meta.env.BASE_URL

/** Siempre es la misma planta (confirmado con el usuario) — no se captura ni se guarda en SharePoint. */
const PLANTA = 'FRIGOTUN'

function fechaCorta(iso: string): string {
  const [anio, mes, dia] = iso.split('-')
  if (!anio || !mes || !dia) return iso || '—'
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

const celda = 'border border-slate-700 px-2 py-1'
const celdaEtiqueta = `${celda} bg-slate-50 font-semibold text-slate-700`

/**
 * Reporte diario por lote — reproduce el formato en papel que ya se le
 * envía a cada asociado apenas termina una recepción (pedido explícito del
 * usuario, con una imagen de referencia). A diferencia de ResumenRecepcion
 * (el resumen genérico usado hoy en el reporte semanal, pendiente de
 * rediseñar), este componente sigue el formato EXACTO de esa plantilla:
 * mismas filas, mismas columnas, mismos rótulos.
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
  const fortuitoTransporte = agruparPorDestino(tiquetes, 'Muerto en Transporte')
  const fortuitoDesembarque = agruparPorDestino(tiquetes, 'Muerto en Desembarque')
  const fortuitoReposo = agruparPorDestino(tiquetes, 'Muerto en Reposo')

  return (
    <section className="break-inside-avoid overflow-hidden rounded-md border border-slate-700 bg-white text-sm print:break-inside-avoid">
      <table className="w-full border-collapse">
        <tbody>
          <tr>
            <td className={celdaEtiqueta}>FECHA</td>
            <td className={celda} colSpan={3}>{fechaCorta(recepcion.FechaRecepcion)}</td>
            <td className={celdaEtiqueta}>PLANTA</td>
            <td className={celda} colSpan={4}>{PLANTA}</td>
          </tr>
          <tr>
            <td className={celdaEtiqueta}>ASOCIADO</td>
            <td className={celda} colSpan={3}>{asociadoNombre}</td>
            <td className={celdaEtiqueta}>GRANJA</td>
            <td className={celda} colSpan={4}>{granjaNombre}</td>
          </tr>
          <tr>
            <td className={celdaEtiqueta}>CONSECUTIVO</td>
            <td className={celda} colSpan={2}>{recepcion.Consecutivo}</td>
            <td className={celdaEtiqueta}>ORDEN</td>
            <td className={celda} colSpan={2}>{recepcion.NumeroOrden}</td>
            <td className={celdaEtiqueta}># ANIMALES</td>
            <td className={celda} colSpan={2}>{recepcion.NumeroTotalCerdos}</td>
          </tr>

          <tr className="text-center text-xs font-semibold uppercase tracking-wide text-slate-700">
            <td className={celdaEtiqueta}>Hora programada</td>
            <td className={celdaEtiqueta}>Hora ingreso</td>
            <td className={celdaEtiqueta}>Tiempo de espera</td>
            <td className={celdaEtiqueta}>Hora inicio</td>
            <td className={celdaEtiqueta}>Hora finalización</td>
            <td className={celdaEtiqueta}>Tiempo desembarque/min</td>
            <td className={celdaEtiqueta}>Placa vehículo</td>
            <td className={`${celdaEtiqueta} text-brand-navy`} rowSpan={2}>
              <div className="flex flex-col items-center justify-center gap-1">
                <img src={`${BASE}icon-192.png`} alt="Cercafe" className="h-8 w-8 rounded" />
                <span className="text-sm font-bold tracking-wide">CERCAFE</span>
              </div>
            </td>
          </tr>
          <tr className="text-center">
            <td className={celda}>{horaCorta(recepcion.HoraProgramada)}</td>
            <td className={celda}>{horaCorta(recepcion.HoraLlegadaVehiculo)}</td>
            <td className={celda}>{minutosEntre(recepcion.HoraLlegadaVehiculo, recepcion.HoraInicioDesembarque)}</td>
            <td className={celda}>{horaCorta(recepcion.HoraInicioDesembarque)}</td>
            <td className={celda}>{horaCorta(recepcion.HoraFinalDesembarque)}</td>
            <td className={celda}>{minutosEntre(recepcion.HoraInicioDesembarque, recepcion.HoraFinalDesembarque)}</td>
            <td className={celda}>{placa}</td>
          </tr>

          <tr>
            <td className="border border-slate-700 bg-amber-300 px-2 py-1 text-center text-xs font-bold uppercase tracking-wide text-slate-800" colSpan={8}>
              Novedades
            </td>
          </tr>
          <tr className="text-center text-xs font-semibold uppercase tracking-wide text-slate-700">
            <td className={celdaEtiqueta} rowSpan={2}>Lesión</td>
            <td className={celdaEtiqueta} rowSpan={2}>Agitados</td>
            <td className={celdaEtiqueta} rowSpan={2}>Caídos</td>
            <td className={celdaEtiqueta} colSpan={2}>Fortuito en transporte</td>
            <td className={celdaEtiqueta} colSpan={2}>Fortuito en desembarque</td>
            <td className={celdaEtiqueta}>Fortuito en reposo</td>
          </tr>
          <tr className="text-center text-xs font-semibold uppercase tracking-wide text-slate-700">
            <td className={celdaEtiqueta}>#</td>
            <td className={celdaEtiqueta}>Destino</td>
            <td className={celdaEtiqueta}>#</td>
            <td className={celdaEtiqueta}>Destino</td>
            <td className={celdaEtiqueta}>#</td>
          </tr>
          <tr className="text-center">
            <td className={celda}>{recepcion.NovLlegadaLesionados ? recepcion.NovLlegadaCantLesionados ?? '—' : '—'}</td>
            <td className={celda}>{recepcion.NovLlegadaAgitados ? recepcion.NovLlegadaCantAgitados ?? '—' : '—'}</td>
            <td className={celda}>{recepcion.NovLlegadaCaidos ? recepcion.NovLlegadaCantCaidos ?? '—' : '—'}</td>
            <GrupoFortuito grupos={fortuitoTransporte} />
            <GrupoFortuito grupos={fortuitoDesembarque} />
            <td className={celda}>
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
            </td>
          </tr>

          <tr>
            <td className={celdaEtiqueta}>NOTA</td>
            <td className={celda} colSpan={7}>{recepcion.Observaciones || '—'}</td>
          </tr>
          <tr>
            <td className={celdaEtiqueta}>ENCARGADO</td>
            <td className={celda} colSpan={7}>{recepcion.CapturadoPor || '—'}</td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

/** Fortuito en transporte / desembarque muestran # y Destino en columnas separadas — una fila por cada Destino distinto que haya. */
function GrupoFortuito({ grupos }: { grupos: Array<{ cantidad: number; destino: string }> }) {
  if (grupos.length === 0) {
    return (
      <>
        <td className={celda}>—</td>
        <td className={celda}>—</td>
      </>
    )
  }
  return (
    <>
      <td className={celda}>
        <div className="flex flex-col">
          {grupos.map((g) => (
            <span key={g.destino}>{g.cantidad}</span>
          ))}
        </div>
      </td>
      <td className={celda}>
        <div className="flex flex-col">
          {grupos.map((g) => (
            <span key={g.destino}>{g.destino}</span>
          ))}
        </div>
      </td>
    </>
  )
}
