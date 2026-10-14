import { useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db } from '../../offline/db'
import { eliminarCalibracion, listarCalibracionesPorRangoFecha } from '../../graph/lists'
import { esErrorDeSesion } from '../../graph/client'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { BotonConfirmarSesion } from '../../components/BotonConfirmarSesion'
import { compartirOGuardarArchivo, descargarElementoComoImagen, generarArchivoPDF } from '../../utils/descargarImagen'
import { crearExcel, type Celda } from '../../utils/crearExcel'
import { diaDeLaSemana, formatoErrorKg, formatoKg, redondear3 } from '../../utils/calibracion'
import type { CalibracionBascula, Usuario } from '../../types/models'

const BASE = import.meta.env.BASE_URL

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function haceDiasISO(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/** "13/10/2026" */
function fechaCorta(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

/** Colores de la marca + estado (verde/rojo reservados para Conforme/No conforme). */
const COLOR_LINEA = '#1d3557'
const COLOR_NO_CONFORME = '#e31e24'
const COLOR_BANDA = '#10b981'

/**
 * Reporte → "Calibración báscula" (2026-10-13, a pedido de Nathalia): las verificaciones de un rango
 * de fechas con sus 3 mediciones, el promedio, el error en kg y si quedó dentro del EMP, más una
 * gráfica del error por fecha con la banda de tolerancia. Igual que las demás pestañas de Reporte,
 * consulta SharePoint directo al tocar "Generar" (las verificaciones que este dispositivo todavía no
 * ha subido no aparecen hasta que sincronicen).
 *
 * El Administrador tiene un "Modo corrección" para eliminar una verificación mal registrada (y
 * volver a capturarla). Va apagado por defecto para que la columna "Eliminar" nunca salga en la
 * imagen/PDF que se guarda como evidencia.
 */
export function ReporteCalibracionBascula({ usuario }: { usuario?: Usuario }) {
  const esAdmin = usuario?.Rol === 'Administrador'
  const basculas = useLiveQuery(() => db.basculas.toArray(), []) ?? []

  const [desde, setDesde] = useState(haceDiasISO(30))
  const [hasta, setHasta] = useState(hoyISO())
  const [basculaId, setBasculaId] = useState('')
  const [datos, setDatos] = useState<CalibracionBascula[]>()
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string>()
  const [modoCorreccion, setModoCorreccion] = useState(false)

  const contenedorRef = useRef<HTMLDivElement>(null)
  const [descargando, setDescargando] = useState(false)
  const [archivoPDF, setArchivoPDF] = useState<File>()
  const [generandoPDF, setGenerandoPDF] = useState(false)
  const [avisoDescarga, setAvisoDescarga] = useState<string>()

  async function generar() {
    if (!desde || !hasta || desde > hasta) {
      setError('Revisa el rango de fechas: "Desde" debe ser anterior o igual a "Hasta".')
      return
    }
    setCargando(true)
    setError(undefined)
    setArchivoPDF(undefined)
    setAvisoDescarga(undefined)
    try {
      const lista = await listarCalibracionesPorRangoFecha(desde, hasta)
      setDatos(lista)
    } catch (err) {
      setError(`No se pudo generar el reporte: ${(err as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  const filas = useMemo(
    () =>
      (datos ?? [])
        .filter((c) => !basculaId || c.BasculaId === basculaId)
        .sort((a, b) => a.FechaCalibracion.localeCompare(b.FechaCalibracion) || a.BasculaNombre.localeCompare(b.BasculaNombre)),
    [datos, basculaId],
  )

  // Una gráfica por báscula (cada una tiene su propio EMP y su propia banda).
  const porBascula = useMemo(() => {
    const grupos = new Map<string, CalibracionBascula[]>()
    for (const c of filas) {
      const clave = c.BasculaNombre || c.BasculaId
      grupos.set(clave, [...(grupos.get(clave) ?? []), c])
    }
    return [...grupos.entries()]
  }, [filas])

  const resumen = useMemo(() => {
    const total = filas.length
    const noConformes = filas.filter((c) => c.Resultado === 'No conforme').length
    const errorPromedio = total ? redondear3(filas.reduce((s, c) => s + c.ErrorKg, 0) / total) : undefined
    const errorMaximo = total ? filas.reduce((m, c) => (Math.abs(c.ErrorKg) > Math.abs(m) ? c.ErrorKg : m), 0) : undefined
    return { total, conformes: total - noConformes, noConformes, errorPromedio, errorMaximo }
  }, [filas])

  const nombreBase = `calibracion-bascula-${desde}_a_${hasta}`

  async function descargarImagen() {
    if (!contenedorRef.current) return
    setDescargando(true)
    setAvisoDescarga(undefined)
    try {
      await descargarElementoComoImagen(contenedorRef.current, `${nombreBase}.png`)
      setAvisoDescarga('Imagen descargada ✓')
    } catch (err) {
      setAvisoDescarga(`No se pudo generar la imagen: ${(err as Error).message}`)
    } finally {
      setDescargando(false)
    }
  }

  // Mismo patrón de 2 pasos (armar / compartir) que los demás reportes — ver generarArchivoPDF().
  async function generarOCompartirPDF() {
    if (archivoPDF) {
      try {
        await compartirOGuardarArchivo(archivoPDF)
        setAvisoDescarga('PDF enviado ✓')
      } catch (err) {
        setAvisoDescarga(`No se pudo compartir el PDF: ${(err as Error).message}`)
      }
      return
    }
    if (!contenedorRef.current) return
    setGenerandoPDF(true)
    setAvisoDescarga(undefined)
    try {
      setArchivoPDF(await generarArchivoPDF(contenedorRef.current, `${nombreBase}.pdf`))
    } catch (err) {
      setAvisoDescarga(`No se pudo generar el PDF: ${(err as Error).message}`)
    } finally {
      setGenerandoPDF(false)
    }
  }

  function descargarExcel() {
    const filasExcel: Celda[][] = filas.map((c) => [
      { fecha: c.FechaCalibracion },
      diaDeLaSemana(c.FechaCalibracion),
      c.BasculaNombre,
      c.PesaPatronKg,
      c.EMPKg,
      c.Medicion1,
      c.Medicion2,
      c.Medicion3,
      c.PromedioKg,
      c.ErrorKg,
      c.Resultado,
      c.Realizo,
      c.Verifico,
      c.Observaciones ?? '',
    ])
    const blob = crearExcel([
      {
        nombre: 'Calibración báscula',
        columnas: [
          { titulo: 'Fecha', ancho: 12 },
          { titulo: 'Día', ancho: 11 },
          { titulo: 'Báscula', ancho: 22 },
          { titulo: 'Pesa patrón (kg)', ancho: 11 },
          { titulo: 'EMP ± (kg)', ancho: 10 },
          { titulo: 'Medición 1 (kg)', ancho: 11 },
          { titulo: 'Medición 2 (kg)', ancho: 11 },
          { titulo: 'Medición 3 (kg)', ancho: 11 },
          { titulo: 'Promedio (kg)', ancho: 11 },
          { titulo: 'Error (kg)', ancho: 10 },
          { titulo: 'Resultado', ancho: 13 },
          { titulo: 'Realizó', ancho: 24 },
          { titulo: 'Verificó', ancho: 24 },
          { titulo: 'Observaciones', ancho: 40 },
        ],
        filas: filasExcel,
      },
    ])
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${nombreBase}.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  async function eliminar(c: CalibracionBascula) {
    if (!c.spId) return
    const ok = window.confirm(
      `¿Eliminar la verificación de "${c.BasculaNombre}" del ${fechaCorta(c.FechaCalibracion)} ` +
        `(realizó ${c.Realizo}, verificó ${c.Verifico})? Se borra de SharePoint y no se puede deshacer. ` +
        'Después se puede volver a registrar en "Calibración báscula".',
    )
    if (!ok) return
    try {
      await eliminarCalibracion(c.spId)
      // Si este dispositivo tenía la copia local, también se quita, para que la regla de "una por
      // día" no la siga encontrando al volver a registrar.
      await db.calibracionesBascula.where('spId').equals(c.spId).delete()
      setDatos((actuales) => actuales?.filter((x) => x.spId !== c.spId))
      setArchivoPDF(undefined)
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  return (
    <div>
      <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden sm:grid-cols-4">
        <CampoTexto type="date" etiqueta="Desde" value={desde} max={hoyISO()} onChange={(e) => setDesde(e.target.value)} />
        <CampoTexto type="date" etiqueta="Hasta" value={hasta} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} />
        <CampoSelect
          etiqueta="Báscula"
          value={basculaId}
          onChange={(e) => setBasculaId(e.target.value)}
          opciones={basculas.map((b) => ({ value: b.id, label: b.Title }))}
          placeholder="Todas las básculas"
        />
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void generar()}
            disabled={cargando || !navigator.onLine}
            className="w-full rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
          >
            {cargando ? 'Generando…' : 'Generar reporte'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">
          {error}
          {esErrorDeSesion(error) && <BotonConfirmarSesion alConfirmar={() => setError(undefined)} />}
        </p>
      )}

      {datos && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-end gap-3 print:hidden">
            {avisoDescarga && (
              <p className={clsx('text-xs', avisoDescarga.includes('✓') ? 'font-medium text-emerald-600' : 'text-brand-red')}>
                {avisoDescarga}
              </p>
            )}
            {esAdmin && filas.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" checked={modoCorreccion} onChange={(e) => setModoCorreccion(e.target.checked)} />
                Modo corrección
              </label>
            )}
            <button
              type="button"
              onClick={() => void descargarImagen()}
              disabled={descargando || filas.length === 0 || modoCorreccion}
              className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
            >
              {descargando ? 'Generando imagen…' : 'Descargar imagen'}
            </button>
            <button
              type="button"
              onClick={() => void generarOCompartirPDF()}
              disabled={generandoPDF || filas.length === 0 || modoCorreccion}
              className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
            >
              {generandoPDF ? 'Generando PDF…' : archivoPDF ? 'Compartir / Descargar PDF' : 'Generar PDF'}
            </button>
            <button
              type="button"
              onClick={descargarExcel}
              disabled={filas.length === 0}
              className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
            >
              Descargar Excel
            </button>
          </div>

          {filas.length === 0 ? (
            <p className="text-sm text-slate-500">No hay verificaciones registradas en ese rango de fechas.</p>
          ) : (
            <section
              ref={contenedorRef}
              className="mx-auto max-w-5xl overflow-hidden rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200 print:shadow-none"
            >
              <div className="flex items-start justify-between gap-4 p-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.15em] text-slate-500">Verificación de básculas</p>
                  <p className="mt-1 text-xl font-bold text-brand-navy">
                    {fechaCorta(desde)} — {fechaCorta(hasta)}
                  </p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Error = pesa patrón − promedio de 3 mediciones · Conforme si |error| ≤ EMP
                  </p>
                </div>
                <img src={`${BASE}cercafe-logo.jpg`} alt="Cercafe" className="h-11 w-auto shrink-0" />
              </div>

              <div className="grid grid-cols-2 gap-3 px-5 sm:grid-cols-4">
                <Indicador titulo="Verificaciones" valor={String(resumen.total)} />
                <Indicador titulo="Conformes" valor={`✓ ${resumen.conformes}`} tono="ok" />
                <Indicador titulo="No conformes" valor={`✕ ${resumen.noConformes}`} tono={resumen.noConformes > 0 ? 'mal' : undefined} />
                <Indicador titulo="Error máximo" valor={`${formatoErrorKg(resumen.errorMaximo)} kg`} />
              </div>

              {porBascula.map(([nombre, lista]) => (
                <GraficaError key={nombre} nombre={nombre} datos={lista} />
              ))}

              <div className="overflow-x-auto px-5 pb-5">
                <table className="w-full min-w-[960px] border-collapse text-center text-xs">
                  <thead>
                    <tr className="bg-brand-navy text-white">
                      <th className="px-2 py-1.5 font-semibold">Fecha</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Báscula</th>
                      <th className="px-2 py-1.5 font-semibold">Pesa patrón</th>
                      <th className="px-2 py-1.5 font-semibold">1</th>
                      <th className="px-2 py-1.5 font-semibold">2</th>
                      <th className="px-2 py-1.5 font-semibold">3</th>
                      <th className="px-2 py-1.5 font-semibold">Promedio</th>
                      <th className="px-2 py-1.5 font-semibold">Error (kg)</th>
                      <th className="px-2 py-1.5 font-semibold">EMP ±</th>
                      <th className="px-2 py-1.5 font-semibold">Resultado</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Realizó</th>
                      <th className="px-2 py-1.5 text-left font-semibold">Verificó</th>
                      {modoCorreccion && <th className="px-2 py-1.5 font-semibold" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((c, i) => (
                      <tr key={c.id} data-pdf-bloque="" className={i % 2 === 1 ? 'bg-slate-50' : 'bg-white'}>
                        <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">
                          {fechaCorta(c.FechaCalibracion)}
                          <span className="block text-[10px] text-slate-400">{diaDeLaSemana(c.FechaCalibracion)}</span>
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 text-left">{c.BasculaNombre}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{formatoKg(c.PesaPatronKg, 2)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{formatoKg(c.Medicion1)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{formatoKg(c.Medicion2)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{formatoKg(c.Medicion3)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{formatoKg(c.PromedioKg)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 font-semibold tabular-nums">{formatoErrorKg(c.ErrorKg)}</td>
                        <td className="border border-slate-200 px-2 py-1.5 tabular-nums">{formatoKg(c.EMPKg, 2)}</td>
                        <td
                          className={clsx(
                            'border border-slate-200 px-2 py-1.5 font-semibold whitespace-nowrap',
                            c.Resultado === 'Conforme' ? 'text-emerald-700' : 'bg-red-50 text-brand-red',
                          )}
                        >
                          {c.Resultado === 'Conforme' ? '✓ Conforme' : '✕ No conforme'}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5 text-left">{c.Realizo}</td>
                        <td className="border border-slate-200 px-2 py-1.5 text-left">{c.Verifico}</td>
                        {modoCorreccion && (
                          <td className="border border-slate-200 px-2 py-1.5">
                            <button type="button" onClick={() => void eliminar(c)} className="text-xs font-medium text-brand-red hover:underline">
                              Eliminar
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {filas.some((c) => c.Observaciones) && (
                  <div data-pdf-bloque="" className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observaciones</p>
                    <ul className="mt-1 space-y-1 text-xs text-slate-700">
                      {filas
                        .filter((c) => c.Observaciones)
                        .map((c) => (
                          <li key={c.id}>
                            <span className="font-semibold">
                              {fechaCorta(c.FechaCalibracion)} · {c.BasculaNombre}:
                            </span>{' '}
                            {c.Observaciones}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="border-t border-slate-200 px-5 py-3 text-center text-[11px] text-slate-400">
                <p>Formato de verificación de básculas · Evidencia digital · Cercafe</p>
                <p className="mt-0.5">Desarrollado por Gestión Técnica Especializada</p>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function Indicador({ titulo, valor, tono }: { titulo: string; valor: string; tono?: 'ok' | 'mal' }) {
  return (
    <div
      className={clsx(
        'rounded-lg px-3 py-2',
        tono === 'mal' ? 'bg-red-50' : tono === 'ok' ? 'bg-emerald-50' : 'bg-slate-50',
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{titulo}</p>
      <p className="text-lg font-bold text-slate-800">{valor}</p>
    </div>
  )
}

/**
 * Error por fecha (una sola serie, por eso sin leyenda: el título la nombra). La banda verde es la
 * tolerancia ±EMP; los puntos fuera de ella van en rojo y además el tooltip dice "No conforme",
 * para que el resultado nunca dependa solo del color.
 */
function GraficaError({ nombre, datos }: { nombre: string; datos: CalibracionBascula[] }) {
  const emp = datos[datos.length - 1]?.EMPKg ?? 0
  // Eje simétrico en múltiplos del EMP (…, −EMP, 0, +EMP, …) para que se lea a simple vista cuántas
  // veces la tolerancia se pasa un punto; mínimo ±2·EMP para que la banda no llene toda la gráfica.
  const paso = emp > 0 ? emp : 0.05
  const maxAbs = Math.max(0, ...datos.map((d) => Math.abs(d.ErrorKg)))
  const pasos = Math.max(2, Math.ceil(redondear3(maxAbs / paso) + 0.0001))
  const limite = redondear3(pasos * paso)
  const marcas = Array.from({ length: pasos * 2 + 1 }, (_, i) => redondear3((i - pasos) * paso))
  const puntos = datos.map((d) => ({
    fecha: fechaCorta(d.FechaCalibracion).slice(0, 5),
    fechaCompleta: `${diaDeLaSemana(d.FechaCalibracion)} ${fechaCorta(d.FechaCalibracion)}`,
    error: d.ErrorKg,
    promedio: d.PromedioKg,
    resultado: d.Resultado,
  }))

  return (
    <div data-pdf-bloque="" className="px-5 pt-5 pb-2">
      <p className="text-sm font-semibold text-slate-700">Error (kg) por fecha — {nombre}</p>
      <p className="text-xs text-slate-400">Banda verde: tolerancia ± {formatoKg(emp, 2)} kg</p>
      <div className="mt-2 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={puntos} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <ReferenceArea y1={-emp} y2={emp} fill={COLOR_BANDA} fillOpacity={0.12} stroke="none" />
            <ReferenceLine y={0} stroke="#94a3b8" />
            <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
            <YAxis
              domain={[-limite, limite]}
              ticks={marcas}
              interval={0}
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => formatoKg(v)}
            />
            <Tooltip
              content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload
                if (!p) return null
                return (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                    <p className="font-semibold text-slate-700">{p.fechaCompleta}</p>
                    <p className="text-slate-600">Promedio: {formatoKg(p.promedio)} kg</p>
                    <p className="text-slate-600">Error: {formatoErrorKg(p.error)} kg</p>
                    <p className={p.resultado === 'Conforme' ? 'font-medium text-emerald-700' : 'font-medium text-brand-red'}>
                      {p.resultado === 'Conforme' ? '✓ Conforme' : '✕ No conforme'}
                    </p>
                  </div>
                )
              }}
            />
            <Line
              type="linear"
              dataKey="error"
              stroke={COLOR_LINEA}
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props) => {
                const { cx, cy, payload, index } = props as {
                  cx?: number
                  cy?: number
                  index?: number
                  payload?: { resultado: string }
                }
                if (cx === undefined || cy === undefined) return <g key={index} />
                const mal = payload?.resultado === 'No conforme'
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={mal ? 5 : 4}
                    fill={mal ? COLOR_NO_CONFORME : COLOR_LINEA}
                    stroke="#ffffff"
                    strokeWidth={2}
                  />
                )
              }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
