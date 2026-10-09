import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import {
  listarRecepcionesPorRangoFecha,
  listarTiquetesDeRecepcion,
  obtenerNovedadCorralDeRecepcion,
} from '../../graph/lists'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { descargarElementoComoImagen } from '../../utils/descargarImagen'
import type { ConsolidadoTiquete, NovedadCorral, Recepcion, TipoNovedad } from '../../types/models'

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

function haceDiasISO(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

/** FechaRecepcion llega de SharePoint como fecha-hora completa — se recortan los 10 primeros caracteres (ver formatearFecha en ReporteDiarioLote.tsx). */
function formatearFecha(iso: string): string {
  if (!iso) return '—'
  const [anio, mes, dia] = iso.slice(0, 10).split('-')
  if (!anio || !mes || !dia) return iso
  return `${dia}/${mes}/${anio}`
}

const TIPOS_EMERGENCIA: TipoNovedad[] = ['Lesionado', 'Caído', 'Agitado']
const TIPOS_FORTUITO = ['Muerto en Transporte', 'Muerto en Desembarque', 'Muerto en Reposo'] as const
type TipoFortuito = (typeof TIPOS_FORTUITO)[number]

/** Máximo de lotes cuyos tiquetes/novedades se consultan a SharePoint al mismo tiempo. */
const CONSULTAS_SIMULTANEAS = 6

type DatosLote = {
  recepcion: Recepcion
  tiquetes: ConsolidadoTiquete[]
  novedadCorral?: NovedadCorral
}

type LineaNovedad = { etiqueta: string; total: number; emergencia: number }

/** Lesionados / Caídos / Agitados de un lote, separados por origen (llegada vs. corral). */
function lineasDeNovedades(d: DatosLote): { llegada: LineaNovedad[]; corral: LineaNovedad[] } {
  const r = d.recepcion
  const c = d.novedadCorral
  const llegada: LineaNovedad[] = [
    {
      etiqueta: 'Lesionados',
      total: r.NovLlegadaCantLesionados ?? 0,
      emergencia: r.NovLlegadaCantLesionadosBeneficioEmergencia ?? 0,
    },
    { etiqueta: 'Caídos', total: r.NovLlegadaCantCaidos ?? 0, emergencia: r.NovLlegadaCantCaidosBeneficioEmergencia ?? 0 },
    {
      etiqueta: 'Agitados',
      total: r.NovLlegadaCantAgitados ?? 0,
      emergencia: r.NovLlegadaCantAgitadosBeneficioEmergencia ?? 0,
    },
  ]
  const corral: LineaNovedad[] = [
    { etiqueta: 'Lesionados', total: c?.CorralCantLesionados ?? 0, emergencia: c?.CorralCantLesionadosBenefEmerg ?? 0 },
    { etiqueta: 'Caídos', total: c?.CorralCantCaidos ?? 0, emergencia: c?.CorralCantCaidosBenefEmerg ?? 0 },
    { etiqueta: 'Agitados', total: c?.CorralCantAgitados ?? 0, emergencia: c?.CorralCantAgitadosBenefEmerg ?? 0 },
  ]
  return { llegada: llegada.filter((l) => l.total > 0), corral: corral.filter((l) => l.total > 0) }
}

/**
 * Cantidad de fortuitos de cada tipo. Transporte y desembarque se capturan en Recepción; "Muerto
 * en reposo" en Novedades en Corral. Si los tiquetes ya generados son más que lo capturado en el
 * origen (caso raro: un tiquete de más sin limpiar), se muestra el mayor para no ocultar nada —
 * Consolidado marca esos casos como "De más".
 */
function cantidadesFortuitos(d: DatosLote): Record<TipoFortuito, number> {
  const contar = (tipo: TipoNovedad) => d.tiquetes.filter((t) => t.TipoNovedad === tipo).length
  return {
    'Muerto en Transporte': Math.max(d.recepcion.FortuitoCantMuertoTransporte ?? 0, contar('Muerto en Transporte')),
    'Muerto en Desembarque': Math.max(d.recepcion.FortuitoCantMuertoDesembarque ?? 0, contar('Muerto en Desembarque')),
    'Muerto en Reposo': Math.max(d.novedadCorral?.CantMuertoReposo ?? 0, contar('Muerto en Reposo')),
  }
}

function ordenarTiquetes(tiquetes: ConsolidadoTiquete[]): ConsolidadoTiquete[] {
  return [...tiquetes].sort(
    (a, b) =>
      a.GrupoNovedad.localeCompare(b.GrupoNovedad) ||
      a.TipoNovedad.localeCompare(b.TipoNovedad) ||
      a.NumeroAnimalEnLote - b.NumeroAnimalEnLote,
  )
}

/** Escapa un valor para CSV (comillas dobles, comas y saltos de línea). */
function celdaCSV(valor: string | number): string {
  const texto = String(valor)
  return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
}

/**
 * "Resumen por lote" (agregado 2026-10-09, a pedido de Nathalia): para cada lote recibido en el rango
 * de fechas elegido, una tarjeta con su detalle — Grupo Asociado, asociado, granja, fecha de
 * recepción, cantidad de cerdos, las novedades que tuvo (de llegada y en corral), los tiquetes de los
 * animales beneficiados de emergencia y los fortuitos — para que cualquier perfil vea de un vistazo
 * qué pasó con cada lote sin tener que abrir Consolidado.
 *
 * Igual que las otras pestañas de Reporte.tsx, consulta SharePoint directo solo al tocar "Generar"
 * (nada se guarda en Dexie). Las novedades de corral de cada lote vienen YA sumadas entre todos sus
 * registros (obtenerNovedadCorralDeRecepcion), así que un lote con varias novedades en corral aparece
 * una sola vez con el total correcto.
 */
export function ResumenPorLote({
  mapaAsociados,
  mapaGranjas,
  gruposAsociados,
}: {
  mapaAsociados: Map<string, { Title: string; GrupoAsociadoId?: string }>
  mapaGranjas: Map<string, { Title: string }>
  gruposAsociados: Array<{ id: string; Title: string }>
}) {
  const [desde, setDesde] = useState(haceDiasISO(7))
  const [hasta, setHasta] = useState(hoyISO())
  const [grupoAsociadoId, setGrupoAsociadoId] = useState('')
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string>()
  const [generado, setGenerado] = useState(false)
  const [lotes, setLotes] = useState<DatosLote[]>([])
  const [filtro, setFiltro] = useState('')

  const mapaGrupos = useMemo(() => new Map(gruposAsociados.map((g) => [g.id, g.Title])), [gruposAsociados])

  function grupoDe(r: Recepcion): string {
    const grupoId = mapaAsociados.get(r.AsociadoId)?.GrupoAsociadoId
    return (grupoId && mapaGrupos.get(grupoId)) || 'Sin grupo'
  }

  async function generar() {
    setCargando(true)
    setError(undefined)
    setGenerado(false)
    try {
      let traidas = await listarRecepcionesPorRangoFecha(desde, hasta)
      if (grupoAsociadoId) {
        traidas = traidas.filter((r) => mapaAsociados.get(r.AsociadoId)?.GrupoAsociadoId === grupoAsociadoId)
      }
      traidas.sort(
        (a, b) => a.FechaRecepcion.localeCompare(b.FechaRecepcion) || a.Consecutivo.localeCompare(b.Consecutivo),
      )

      // Consulta de tiquetes y novedades de corral por lote, de a pocos a la vez para no saturar Graph.
      const resultado: DatosLote[] = traidas.map((recepcion) => ({ recepcion, tiquetes: [] }))
      let siguiente = 0
      async function trabajador() {
        while (siguiente < resultado.length) {
          const i = siguiente++
          const spId = resultado[i].recepcion.spId
          if (!spId) continue
          const [tiquetes, novedadCorral] = await Promise.all([
            listarTiquetesDeRecepcion(spId),
            obtenerNovedadCorralDeRecepcion(spId),
          ])
          resultado[i] = { recepcion: resultado[i].recepcion, tiquetes, novedadCorral }
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONSULTAS_SIMULTANEAS, resultado.length) }, trabajador))

      setLotes(resultado)
      setGenerado(true)
    } catch (err) {
      setError(`No se pudo generar el resumen: ${(err as Error).message}`)
    } finally {
      setCargando(false)
    }
  }

  const lotesVisibles = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return lotes
    return lotes.filter((d) => {
      const r = d.recepcion
      const texto = [
        r.Consecutivo,
        r.NumeroOrden,
        mapaAsociados.get(r.AsociadoId)?.Title ?? '',
        mapaGranjas.get(r.GranjaId)?.Title ?? '',
        grupoDe(r),
      ]
        .join(' ')
        .toLowerCase()
      return texto.includes(q)
    })
    // grupoDe depende solo de mapaAsociados y mapaGrupos
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotes, filtro, mapaAsociados, mapaGranjas, mapaGrupos])

  const totales = useMemo(() => {
    let cerdos = 0
    let novedades = 0
    let emergencia = 0
    let fortuitos = 0
    for (const d of lotesVisibles) {
      cerdos += d.recepcion.NumeroTotalCerdos ?? 0
      const { llegada, corral } = lineasDeNovedades(d)
      for (const l of [...llegada, ...corral]) novedades += l.total
      emergencia += d.tiquetes.filter((t) => TIPOS_EMERGENCIA.includes(t.TipoNovedad)).length
      fortuitos += Object.values(cantidadesFortuitos(d)).reduce((a, b) => a + b, 0)
    }
    return { cerdos, novedades, emergencia, fortuitos }
  }, [lotesVisibles])

  function descargarCSV() {
    const encabezado = [
      'Consecutivo',
      'Fecha recepción',
      'Grupo asociado',
      'Asociado',
      'Granja',
      '# Cerdos',
      'Lesionados (llegada)',
      'Caídos (llegada)',
      'Agitados (llegada)',
      'Lesionados (corral)',
      'Caídos (corral)',
      'Agitados (corral)',
      'Fortuito transporte',
      'Fortuito desembarque',
      'Fortuito reposo',
      'Tiquetes de emergencia',
    ]
    const filas = lotesVisibles.map((d) => {
      const r = d.recepcion
      const f = cantidadesFortuitos(d)
      const tiquetesEmergencia = ordenarTiquetes(d.tiquetes.filter((t) => TIPOS_EMERGENCIA.includes(t.TipoNovedad)))
        .map((t) => `${t.TipoNovedad} #${t.NumeroAnimalEnLote}: ${t.Tiquete || 'sin tiquete'}${t.Destino ? ` (${t.Destino})` : ''}`)
        .join(' | ')
      return [
        r.Consecutivo,
        formatearFecha(r.FechaRecepcion),
        grupoDe(r),
        mapaAsociados.get(r.AsociadoId)?.Title ?? '',
        mapaGranjas.get(r.GranjaId)?.Title ?? '',
        r.NumeroTotalCerdos ?? 0,
        r.NovLlegadaCantLesionados ?? 0,
        r.NovLlegadaCantCaidos ?? 0,
        r.NovLlegadaCantAgitados ?? 0,
        d.novedadCorral?.CorralCantLesionados ?? 0,
        d.novedadCorral?.CorralCantCaidos ?? 0,
        d.novedadCorral?.CorralCantAgitados ?? 0,
        f['Muerto en Transporte'],
        f['Muerto en Desembarque'],
        f['Muerto en Reposo'],
        tiquetesEmergencia,
      ]
    })
    // Punto y coma como separador y BOM: así Excel en español abre las columnas bien y con tildes.
    const contenido = [encabezado, ...filas].map((fila) => fila.map(celdaCSV).join(';')).join('\r\n')
    const blob = new Blob(['﻿', contenido], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `resumen-por-lote-${desde}_a_${hasta}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div>
      <div className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 print:hidden sm:grid-cols-4">
        <CampoTexto type="date" etiqueta="Desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <CampoTexto type="date" etiqueta="Hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <CampoSelect
          etiqueta="Grupo Asociado (opcional)"
          value={grupoAsociadoId}
          onChange={(e) => setGrupoAsociadoId(e.target.value)}
          opciones={gruposAsociados.map((g) => ({ value: g.id, label: g.Title }))}
          placeholder="Todos los grupos"
        />
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => void generar()}
            disabled={cargando || !navigator.onLine}
            title={navigator.onLine ? undefined : 'Sin conexión — no se puede generar el resumen'}
            className="w-full rounded-md bg-brand-navy px-3 py-2 text-sm font-medium text-white hover:bg-brand-navy/90 disabled:bg-slate-300"
          >
            {cargando ? 'Generando…' : 'Generar resumen por lote'}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red print:hidden">{error}</p>}

      {generado && (
        <>
          {lotes.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No hay lotes recibidos en ese rango de fechas.</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <Resumen etiqueta="Lotes" valor={lotesVisibles.length} />
                <Resumen etiqueta="Cerdos recibidos" valor={totales.cerdos} />
                <Resumen etiqueta="Novedades (llegada + corral)" valor={totales.novedades} />
                <Resumen etiqueta="Tiquetes de emergencia" valor={totales.emergencia} />
                <Resumen etiqueta="Fortuitos" valor={totales.fortuitos} />
              </div>

              <div className="mt-3 flex flex-wrap items-end justify-between gap-3 print:hidden">
                <div className="w-full max-w-xs">
                  <CampoTexto
                    etiqueta="Buscar lote"
                    placeholder="Consecutivo, asociado, granja o grupo"
                    value={filtro}
                    onChange={(e) => setFiltro(e.target.value)}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={descargarCSV}
                    className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint"
                  >
                    Descargar Excel (CSV)
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint"
                  >
                    Imprimir
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {lotesVisibles.map((d) => (
                  <TarjetaLote
                    key={d.recepcion.id}
                    datos={d}
                    grupo={grupoDe(d.recepcion)}
                    asociado={mapaAsociados.get(d.recepcion.AsociadoId)?.Title ?? '—'}
                    granja={mapaGranjas.get(d.recepcion.GranjaId)?.Title ?? '—'}
                  />
                ))}
                {lotesVisibles.length === 0 && (
                  <p className="text-sm text-slate-500">Ningún lote coincide con la búsqueda.</p>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Resumen({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className="text-xl font-bold text-brand-navy">{valor}</p>
    </div>
  )
}

function TarjetaLote({
  datos,
  grupo,
  asociado,
  granja,
}: {
  datos: DatosLote
  grupo: string
  asociado: string
  granja: string
}) {
  const { recepcion, tiquetes, novedadCorral } = datos
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState<string>()

  const { llegada, corral } = lineasDeNovedades(datos)
  const fortuitos = cantidadesFortuitos(datos)
  const tiquetesEmergencia = ordenarTiquetes(tiquetes.filter((t) => TIPOS_EMERGENCIA.includes(t.TipoNovedad)))
  const tiquetesFortuito = ordenarTiquetes(tiquetes.filter((t) => (TIPOS_FORTUITO as readonly TipoNovedad[]).includes(t.TipoNovedad)))
  const hayFortuitos = Object.values(fortuitos).some((n) => n > 0)
  const sinNovedades = llegada.length === 0 && corral.length === 0 && !novedadCorral?.ComportamientoSexual

  async function descargarImagen() {
    if (!contenedorRef.current) return
    setDescargando(true)
    setError(undefined)
    try {
      await descargarElementoComoImagen(contenedorRef.current, `resumen-lote-${recepcion.Consecutivo || 'lote'}.png`)
    } catch (err) {
      setError(`No se pudo generar la imagen: ${(err as Error).message}`)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="print:break-inside-avoid">
      <div className="mb-1 flex items-center justify-end gap-3 print:hidden">
        {error && <p className="text-xs text-brand-red">{error}</p>}
        <button
          type="button"
          onClick={() => void descargarImagen()}
          disabled={descargando}
          className="rounded-md border border-brand-navy px-3 py-1 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
        >
          {descargando ? 'Generando imagen…' : 'Descargar imagen'}
        </button>
      </div>

      <section
        ref={contenedorRef}
        className="overflow-hidden rounded-xl bg-white text-sm shadow-sm ring-1 ring-slate-200 print:shadow-none"
      >
        {/* Encabezado del lote */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-brand-navy px-4 py-3">
          <p className="text-base font-bold text-brand-navy">Lote {recepcion.Consecutivo}</p>
          <span
            className={clsx(
              'rounded-full px-2 py-0.5 text-[11px] font-semibold',
              recepcion.EstadoLote === 'Completo' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800',
            )}
          >
            {recepcion.EstadoLote}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
          <Dato etiqueta="Fecha de recepción" valor={formatearFecha(recepcion.FechaRecepcion)} />
          <Dato etiqueta="Grupo asociado" valor={grupo} />
          <Dato etiqueta="Asociado" valor={asociado} />
          <Dato etiqueta="Granja" valor={granja} />
          <Dato etiqueta="# Cerdos" valor={recepcion.NumeroTotalCerdos} />
        </div>

        <div className="space-y-4 px-4 py-4">
          {/* Novedades */}
          <div>
            <Titulo>Novedades</Titulo>
            {sinNovedades ? (
              <p className="text-xs text-slate-500">Sin novedades de llegada ni en corral.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <BloqueNovedades titulo="Novedades de llegada" lineas={llegada} />
                <BloqueNovedades
                  titulo="Novedades en corral"
                  lineas={corral}
                  extra={novedadCorral?.ComportamientoSexual ? 'Comportamiento sexual registrado' : undefined}
                />
              </div>
            )}
          </div>

          {/* Tiquetes de emergencia */}
          <div>
            <Titulo>Tiquetes de beneficiados de emergencia</Titulo>
            {tiquetesEmergencia.length === 0 ? (
              <p className="text-xs text-slate-500">Ningún animal de este lote se benefició de emergencia.</p>
            ) : (
              <TablaTiquetes tiquetes={tiquetesEmergencia} />
            )}
          </div>

          {/* Fortuitos */}
          <div>
            <Titulo>Fortuitos</Titulo>
            {!hayFortuitos ? (
              <p className="text-xs text-slate-500">Sin fortuitos en este lote.</p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-2 text-xs">
                  {TIPOS_FORTUITO.filter((t) => fortuitos[t] > 0).map((t) => (
                    <span key={t} className="rounded-md bg-red-50 px-2 py-1 font-medium text-brand-red">
                      {t.replace('Muerto en ', 'En ')}: {fortuitos[t]}
                    </span>
                  ))}
                </div>
                {tiquetesFortuito.length > 0 ? (
                  <TablaTiquetes tiquetes={tiquetesFortuito} mostrarFactura />
                ) : (
                  <p className="text-xs text-slate-500">Aún no tienen tiquete en Consolidado.</p>
                )}
              </>
            )}
          </div>

          {recepcion.Observaciones && (
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Nota</p>
              <p className="text-sm text-slate-800">{recepcion.Observaciones}</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div className="bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className="text-sm font-semibold text-slate-900">{valor}</p>
    </div>
  )
}

function Titulo({ children }: { children: React.ReactNode }) {
  return <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">{children}</p>
}

function BloqueNovedades({ titulo, lineas, extra }: { titulo: string; lineas: LineaNovedad[]; extra?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2">
      <p className="text-xs font-semibold text-slate-700">{titulo}</p>
      {lineas.length === 0 && !extra ? (
        <p className="mt-1 text-xs text-slate-400">—</p>
      ) : (
        <ul className="mt-1 space-y-0.5 text-xs text-slate-800">
          {lineas.map((l) => (
            <li key={l.etiqueta} className="flex justify-between gap-2">
              <span>{l.etiqueta}</span>
              <span>
                <strong>{l.total}</strong>
                {l.emergencia > 0 && <span className="text-brand-red"> · {l.emergencia} de emergencia</span>}
              </span>
            </li>
          ))}
          {extra && <li className="text-slate-600">{extra}</li>}
        </ul>
      )}
    </div>
  )
}

function TablaTiquetes({ tiquetes, mostrarFactura }: { tiquetes: ConsolidadoTiquete[]; mostrarFactura?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] border-collapse text-left text-xs">
        <thead>
          <tr className="bg-slate-100 text-slate-600">
            <th className="border border-slate-200 px-2 py-1 font-semibold">Origen</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Tipo</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">N.°</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Tiquete</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Destino</th>
            {mostrarFactura && <th className="border border-slate-200 px-2 py-1 font-semibold">Factura</th>}
          </tr>
        </thead>
        <tbody>
          {tiquetes.map((t) => (
            <tr key={t.id}>
              <td className="border border-slate-200 px-2 py-1">{t.GrupoNovedad.replace('Novedad de ', '').replace('Novedad en ', '')}</td>
              <td className="border border-slate-200 px-2 py-1">{t.TipoNovedad}</td>
              <td className="border border-slate-200 px-2 py-1">{t.NumeroAnimalEnLote}</td>
              <td className="border border-slate-200 px-2 py-1">
                {t.Tiquete || <span className="text-slate-400">Pendiente</span>}
              </td>
              <td className="border border-slate-200 px-2 py-1">
                {t.Destino || <span className="text-slate-400">—</span>}
              </td>
              {mostrarFactura && <td className="border border-slate-200 px-2 py-1">{t.Factura || '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
