import { useEffect, useRef, useState } from 'react'
import {
  compartirOGuardarArchivo,
  descargarElementoComoImagen,
  generarArchivoPDF,
  precargarLibreriaDeImagen,
} from '../../utils/descargarImagen'
import { marcarBeneficiadoMismoDia } from '../../graph/lists'
import type { Recepcion } from '../../types/models'

const BASE = import.meta.env.BASE_URL

/** "03/09/2026" — misma idea que formatearFecha() en ReporteDiarioLote.tsx (duplicada a propósito,
 * cada reporte es independiente por diseño en esta app). */
function formatearFecha(iso: string): string {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

/** "HH:MM" a partir de la fecha-hora ISO completa que se guarda en Recepcion — mismo patrón que
 * horaCorta() en ReporteDiarioLote.tsx. */
function horaCorta(iso: string | undefined): string {
  if (!iso || iso.length < 16) return '—'
  return iso.slice(11, 16)
}

/**
 * "Cierre diario": pestaña de Reporte.tsx que arma la tabla con la que Nathalia y su equipo
 * revisan, al final del día, todas las recepciones recibidas ESE día — mismo cuadro que ya usaban
 * en Excel (columnas Fecha/Hora llegada/Inicio desembarque/Termina desembarque/Asociado/Granja/
 * Consecutivo/Orden/N° animales/#ICA), reemplazando la práctica manual de pintar de azul la celda
 * de cantidad de los lotes que ya se beneficiaron: acá se toca esa misma celda para marcarla/
 * desmarcarla, y el color se guarda de una vez en `Recepcion.BeneficiadoMismoDia` (ver el
 * comentario de ese campo en models.ts) — no hay una columna de check aparte.
 *
 * Igual que "Diario" y "Semanal" en Reporte.tsx, esta pestaña trabaja SOLO en línea: consulta
 * SharePoint directo al generar y al marcar/desmarcar una celda, sin pasar por Dexie ni por la cola
 * de sincronización — un solo día no debería tener tantas recepciones como para que valga la pena
 * complicarla con soporte sin conexión.
 */
export function ReporteCierreDiario({
  fecha,
  error,
  generado,
  recepciones,
  asociadoNombre,
  granjaNombre,
  onCambio,
}: {
  fecha: string
  error: string | undefined
  generado: boolean
  recepciones: Recepcion[]
  asociadoNombre: (r: Recepcion) => string
  granjaNombre: (r: Recepcion) => string
  /** Avisa al padre que una recepción cambió de estado (Cierre diario no guarda su propia copia —
   * la lista viene y se actualiza desde Reporte.tsx, igual que tiquetesPorRecepcion en las otras
   * pestañas). */
  onCambio: (recepcionId: string, cambios: Partial<Recepcion>) => void
}) {
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [marcando, setMarcando] = useState<string>()
  const [errorMarcado, setErrorMarcado] = useState<string>()

  const [descargando, setDescargando] = useState(false)
  const [descargada, setDescargada] = useState(false)
  const [errorImagen, setErrorImagen] = useState<string>()

  const [generandoPDF, setGenerandoPDF] = useState(false)
  const [archivoPDF, setArchivoPDF] = useState<File>()
  const [errorPDF, setErrorPDF] = useState<string>()
  const [pdfListo, setPdfListo] = useState(false)

  // Mismo motivo que en ReporteDiarioLote.tsx / ReporteSemanalAsociado.tsx: precargar la librería
  // de captura de imagen apenas se ve el reporte, para que el primer clic en "Descargar imagen" o
  // "Generar PDF" no se demore ese segundo de más buscándola.
  useEffect(() => {
    precargarLibreriaDeImagen()
  }, [])

  // El PDF ya armado queda obsoleto en cuanto alguien marca/desmarca una celda después de generarlo
  // — sin este reseteo, "Compartir / Descargar PDF" seguiría reusando uno viejo sin el cambio.
  useEffect(() => {
    setArchivoPDF(undefined)
    setPdfListo(false)
  }, [recepciones])

  async function alternarBeneficiado(r: Recepcion) {
    if (!r.spId || marcando) return
    const nuevoValor = !r.BeneficiadoMismoDia
    setMarcando(r.id)
    setErrorMarcado(undefined)
    // Optimista: se refleja de una vez en la tabla, y si Graph falla se revierte abajo — el clic
    // en la celda de cantidad debe sentirse inmediato, igual que pintarla de azul a mano.
    onCambio(r.id, { BeneficiadoMismoDia: nuevoValor })
    try {
      await marcarBeneficiadoMismoDia(r.spId, nuevoValor)
    } catch (err) {
      onCambio(r.id, { BeneficiadoMismoDia: !nuevoValor })
      setErrorMarcado(`No se pudo guardar el cambio: ${(err as Error).message}`)
    } finally {
      setMarcando(undefined)
    }
  }

  async function descargarImagen() {
    if (!contenedorRef.current) return
    setDescargando(true)
    setErrorImagen(undefined)
    setDescargada(false)
    try {
      await descargarElementoComoImagen(contenedorRef.current, `cierre-diario-${fecha}.png`)
      setDescargada(true)
    } catch (err) {
      setErrorImagen(`No se pudo generar la imagen: ${(err as Error).message}`)
    } finally {
      setDescargando(false)
    }
  }

  // Mismo patrón de "armar" y "compartir" en dos pasos separados que ReporteSemanalAsociado.tsx —
  // ver el comentario grande de generarArchivoPDF() en descargarImagen.ts sobre por qué.
  async function generarOCompartirPDF() {
    if (archivoPDF) {
      setErrorPDF(undefined)
      try {
        await compartirOGuardarArchivo(archivoPDF)
        setPdfListo(true)
      } catch (err) {
        setErrorPDF(`No se pudo compartir el PDF: ${(err as Error).message}`)
      }
      return
    }

    if (!contenedorRef.current) return
    setGenerandoPDF(true)
    setErrorPDF(undefined)
    setPdfListo(false)
    try {
      const archivo = await generarArchivoPDF(contenedorRef.current, `cierre-diario-${fecha}.pdf`)
      setArchivoPDF(archivo)
    } catch (err) {
      setErrorPDF(`No se pudo generar el PDF: ${(err as Error).message}`)
    } finally {
      setGenerandoPDF(false)
    }
  }

  if (!generado) return error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p> : null

  return (
    <div className="mt-4">
      <div className="mb-2 flex flex-wrap items-center justify-end gap-3 print:hidden">
        {errorImagen && <p className="text-xs text-brand-red">{errorImagen}</p>}
        {descargada && !errorImagen && <p className="text-xs font-medium text-emerald-600">Imagen descargada ✓</p>}
        <button
          type="button"
          onClick={() => void descargarImagen()}
          disabled={descargando || recepciones.length === 0}
          className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
        >
          {descargando ? 'Generando imagen…' : 'Descargar imagen'}
        </button>
        {errorPDF && <p className="text-xs text-brand-red">{errorPDF}</p>}
        {pdfListo && !errorPDF && <p className="text-xs font-medium text-emerald-600">PDF enviado ✓</p>}
        <button
          type="button"
          onClick={() => void generarOCompartirPDF()}
          disabled={generandoPDF || recepciones.length === 0}
          className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
        >
          {generandoPDF ? 'Generando PDF…' : archivoPDF ? 'Compartir / Descargar PDF' : 'Generar PDF'}
        </button>
      </div>

      {errorMarcado && <p className="mb-2 text-xs text-brand-red print:hidden">{errorMarcado}</p>}

      <p className="mb-2 text-sm text-slate-500 print:hidden">
        {recepciones.length} lote{recepciones.length === 1 ? '' : 's'} recibido{recepciones.length === 1 ? '' : 's'} el{' '}
        {formatearFecha(fecha)} — toca la celda de "N.° animales" para marcar cuáles ya se beneficiaron el mismo día.
      </p>

      {recepciones.length === 0 ? (
        <p className="text-sm text-slate-500">No hay recepciones registradas ese día.</p>
      ) : (
        <section
          ref={contenedorRef}
          className="mx-auto max-w-5xl overflow-hidden rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200 print:shadow-none"
        >
          <div className="flex items-start justify-between gap-4 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Cierre diario</p>
              <p className="mt-1 text-xl font-bold text-brand-navy">{formatearFecha(fecha)}</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Recepciones y beneficio del día — Frigotún
              </p>
            </div>
            <img src={`${BASE}cercafe-logo.jpg`} alt="Cercafe" className="h-11 w-auto shrink-0" />
          </div>

          {/* Envuelta en overflow-x-auto (10 columnas no caben en un celular angosto) con un min-w
              fijo — mismo patrón que las demás tablas de reportes en esta app. */}
          <div className="overflow-x-auto px-5 pb-5">
            <table className="w-full min-w-[920px] border-collapse text-center text-xs">
              <thead>
                <tr className="bg-brand-navy text-white">
                  <th className="px-2 py-1.5 font-semibold">Fecha</th>
                  <th className="px-2 py-1.5 font-semibold">Hora llegada</th>
                  <th className="px-2 py-1.5 font-semibold">Inicio desembarque</th>
                  <th className="px-2 py-1.5 font-semibold">Termina desembarque</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Asociado</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Granja</th>
                  <th className="px-2 py-1.5 font-semibold">Consecutivo</th>
                  <th className="px-2 py-1.5 font-semibold">Orden</th>
                  <th className="px-2 py-1.5 font-semibold">N.° animales</th>
                  <th className="px-2 py-1.5 font-semibold">#ICA</th>
                </tr>
              </thead>
              <tbody>
                {recepciones.map((r, i) => (
                  <tr
                    key={r.id}
                    data-pdf-bloque=""
                    className={i % 2 === 1 ? 'bg-purple-50/30' : 'bg-white'}
                  >
                    <td className="border border-slate-200 px-2 py-1.5">{formatearFecha(r.FechaRecepcion)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{horaCorta(r.HoraLlegadaVehiculo)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{horaCorta(r.HoraInicioDesembarque)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{horaCorta(r.HoraFinalDesembarque)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-left">{asociadoNombre(r)}</td>
                    <td className="border border-slate-200 px-2 py-1.5 text-left">{granjaNombre(r)}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.Consecutivo}</td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.NumeroOrden}</td>
                    <td className="border border-slate-200 p-0">
                      <button
                        type="button"
                        onClick={() => void alternarBeneficiado(r)}
                        disabled={!r.spId || marcando === r.id}
                        title={
                          r.BeneficiadoMismoDia
                            ? 'Beneficiado el mismo día — toca para desmarcar'
                            : 'Toca para marcar como beneficiado el mismo día'
                        }
                        className={
                          'block w-full px-2 py-1.5 font-semibold transition-colors disabled:cursor-wait ' +
                          (r.BeneficiadoMismoDia
                            ? 'bg-sky-400 text-white hover:bg-sky-500'
                            : 'bg-transparent text-slate-800 hover:bg-slate-100 print:hover:bg-transparent')
                        }
                      >
                        {r.BeneficiadoMismoDia ? `✓ ${r.NumeroTotalCerdos}` : r.NumeroTotalCerdos}
                      </button>
                    </td>
                    <td className="border border-slate-200 px-2 py-1.5">{r.GuiaSanitariaICA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-200 px-5 py-3 text-center text-[11px] text-slate-400">
            <p>Cierre diario · {formatearFecha(fecha)} · Informe de uso interno · Cercafe</p>
            <p className="mt-0.5">Desarrollado por Gestión Técnica Especializada</p>
          </div>
        </section>
      )}
    </div>
  )
}
