import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { cachearTiquetesDeRecepcion } from '../../offline/syncService'
import {
  actualizarNovedadCorral,
  actualizarNovedadesDeRecepcion,
  eliminarNovedadCorral,
  eliminarTiquete,
  generarTiquetesFaltantes,
  generarTiquetesNovedadCorral,
  listarRegistrosNovedadCorral,
  listarTiquetesDeRecepcion,
  obtenerRecepcionActual,
  reabrirLote,
  registrarLog,
  tiquetesSobrantes,
  type CambiosNovedadesRecepcion,
} from '../../graph/lists'
import type { ConsolidadoTiquete, NovedadCorral, Recepcion, Usuario } from '../../types/models'

/** Total reportado + cuántos de esos se beneficiaron de emergencia (solo estos generan tiquete). */
type Par = { total: string; benef: string }

type FormLlegada = { lesionados: Par; caidos: Par; agitados: Par; transporte: string; desembarque: string }

type FormCorral = {
  spId: string
  capturadaEn: string
  capturadoPor?: string
  eliminar: boolean
  lesionados: Par
  caidos: Par
  agitados: Par
  reposo: string
}

const txt = (n: number | undefined) => String(n ?? 0)

/** '' cuenta como 0; cualquier cosa que no sea un entero ≥ 0 devuelve NaN (para marcar error). */
function entero(valor: string): number {
  if (valor.trim() === '') return 0
  const n = Number(valor)
  return Number.isInteger(n) && n >= 0 ? n : NaN
}

function formDeRecepcion(r: Recepcion): FormLlegada {
  return {
    lesionados: { total: txt(r.NovLlegadaCantLesionados), benef: txt(r.NovLlegadaCantLesionadosBeneficioEmergencia) },
    caidos: { total: txt(r.NovLlegadaCantCaidos), benef: txt(r.NovLlegadaCantCaidosBeneficioEmergencia) },
    agitados: { total: txt(r.NovLlegadaCantAgitados), benef: txt(r.NovLlegadaCantAgitadosBeneficioEmergencia) },
    transporte: txt(r.FortuitoCantMuertoTransporte),
    desembarque: txt(r.FortuitoCantMuertoDesembarque),
  }
}

function formDeCorral(n: NovedadCorral): FormCorral {
  return {
    spId: n.spId as string,
    capturadaEn: n.CapturadaEn,
    capturadoPor: n.CapturadoPor,
    eliminar: false,
    lesionados: { total: txt(n.CorralCantLesionados), benef: txt(n.CorralCantLesionadosBenefEmerg) },
    caidos: { total: txt(n.CorralCantCaidos), benef: txt(n.CorralCantCaidosBenefEmerg) },
    agitados: { total: txt(n.CorralCantAgitados), benef: txt(n.CorralCantAgitadosBenefEmerg) },
    reposo: txt(n.CantMuertoReposo),
  }
}

/** Conteos → campos de la Recepción, con cada indicador Sí/No en "Sí" solo si su cantidad es > 0. */
function cambiosDeLlegada(f: FormLlegada): CambiosNovedadesRecepcion {
  const v = (s: string) => entero(s)
  return {
    NovLlegadaLesionados: v(f.lesionados.total) > 0,
    NovLlegadaCantLesionados: v(f.lesionados.total),
    NovLlegadaLesionadosBeneficioEmergencia: v(f.lesionados.benef) > 0,
    NovLlegadaCantLesionadosBeneficioEmergencia: v(f.lesionados.benef),
    NovLlegadaCaidos: v(f.caidos.total) > 0,
    NovLlegadaCantCaidos: v(f.caidos.total),
    NovLlegadaCaidosBeneficioEmergencia: v(f.caidos.benef) > 0,
    NovLlegadaCantCaidosBeneficioEmergencia: v(f.caidos.benef),
    NovLlegadaAgitados: v(f.agitados.total) > 0,
    NovLlegadaCantAgitados: v(f.agitados.total),
    NovLlegadaAgitadosBeneficioEmergencia: v(f.agitados.benef) > 0,
    NovLlegadaCantAgitadosBeneficioEmergencia: v(f.agitados.benef),
    FortuitoMuertoTransporte: v(f.transporte) > 0,
    FortuitoCantMuertoTransporte: v(f.transporte),
    FortuitoMuertoDesembarque: v(f.desembarque) > 0,
    FortuitoCantMuertoDesembarque: v(f.desembarque),
  }
}

function cambiosDeCorral(f: FormCorral): Partial<NovedadCorral> {
  const v = (s: string) => entero(s)
  return {
    CorralLesionados: v(f.lesionados.total) > 0,
    CorralCantLesionados: v(f.lesionados.total),
    CorralLesionadosBenefEmerg: v(f.lesionados.benef) > 0,
    CorralCantLesionadosBenefEmerg: v(f.lesionados.benef),
    CorralCaidos: v(f.caidos.total) > 0,
    CorralCantCaidos: v(f.caidos.total),
    CorralCaidosBenefEmerg: v(f.caidos.benef) > 0,
    CorralCantCaidosBenefEmerg: v(f.caidos.benef),
    CorralAgitados: v(f.agitados.total) > 0,
    CorralCantAgitados: v(f.agitados.total),
    CorralAgitadosBenefEmerg: v(f.agitados.benef) > 0,
    CorralCantAgitadosBenefEmerg: v(f.agitados.benef),
    MuertoReposo: v(f.reposo) > 0,
    CantMuertoReposo: v(f.reposo),
  }
}

/** ¿Algún valor de `nuevos` es distinto del que ya tenía `actual`? (undefined cuenta como 0/No) */
function hayCambios(actual: object, nuevos: object): boolean {
  const a = actual as Record<string, unknown>
  return Object.entries(nuevos).some(([k, v]) => {
    const previo = a[k]
    if (typeof v === 'number') return Number(previo ?? 0) !== v
    return Boolean(previo) !== v
  })
}

const TIPOS_TIQUETE: Array<{ grupo: ConsolidadoTiquete['GrupoNovedad']; tipo: ConsolidadoTiquete['TipoNovedad']; etiqueta: string }> = [
  { grupo: 'Novedad de llegada', tipo: 'Lesionado', etiqueta: 'Lesionados de llegada' },
  { grupo: 'Novedad de llegada', tipo: 'Caído', etiqueta: 'Caídos de llegada' },
  { grupo: 'Novedad de llegada', tipo: 'Agitado', etiqueta: 'Agitados de llegada' },
  { grupo: 'Fortuito', tipo: 'Muerto en Transporte', etiqueta: 'Fortuito en transporte' },
  { grupo: 'Fortuito', tipo: 'Muerto en Desembarque', etiqueta: 'Fortuito en desembarque' },
  { grupo: 'Novedad en corral', tipo: 'Lesionado', etiqueta: 'Lesionados de corral' },
  { grupo: 'Novedad en corral', tipo: 'Caído', etiqueta: 'Caídos de corral' },
  { grupo: 'Novedad en corral', tipo: 'Agitado', etiqueta: 'Agitados de corral' },
  { grupo: 'Fortuito', tipo: 'Muerto en Reposo', etiqueta: 'Fortuito en reposo' },
]

// --- Filas del formulario (a nivel de módulo: si vivieran dentro del componente se recrearían en
// cada tecla y el campo perdería el foco) ------------------------------------------------------------------------------
const claseNum =
  'w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-100'

function FilaPar({
  nombre,
  par,
  onPar,
  deshabilitado,
}: {
  nombre: string
  par: Par
  onPar: (p: Par) => void
  deshabilitado?: boolean
}) {
  return (
    <tr>
      <td className="py-1.5 pr-3 text-slate-700">{nombre}</td>
      <td className="py-1.5 pr-3">
        <input inputMode="numeric" className={claseNum} disabled={deshabilitado} value={par.total} onChange={(e) => onPar({ ...par, total: e.target.value })} />
      </td>
      <td className="py-1.5 pr-3">
        <input inputMode="numeric" className={claseNum} disabled={deshabilitado} value={par.benef} onChange={(e) => onPar({ ...par, benef: e.target.value })} />
      </td>
      <td className="py-1.5 text-right">
        {!deshabilitado && (par.total !== '0' || par.benef !== '0') && (
          <button type="button" onClick={() => onPar({ total: '0', benef: '0' })} className="text-xs font-medium text-brand-red hover:underline">
            Quitar
          </button>
        )}
      </td>
    </tr>
  )
}

function FilaUno({
  nombre,
  valor,
  onValor,
  deshabilitado,
}: {
  nombre: string
  valor: string
  onValor: (v: string) => void
  deshabilitado?: boolean
}) {
  return (
    <tr>
      <td className="py-1.5 pr-3 text-slate-700">{nombre}</td>
      <td className="py-1.5 pr-3">
        <input inputMode="numeric" className={claseNum} disabled={deshabilitado} value={valor} onChange={(e) => onValor(e.target.value)} />
      </td>
      <td className="py-1.5 pr-3 text-xs text-slate-400">(todos generan tiquete)</td>
      <td className="py-1.5 text-right">
        {!deshabilitado && valor !== '0' && (
          <button type="button" onClick={() => onValor('0')} className="text-xs font-medium text-brand-red hover:underline">
            Quitar
          </button>
        )}
      </td>
    </tr>
  )
}

function Encabezado() {
  return (
    <thead>
      <tr className="text-left text-xs text-slate-500">
        <th className="pb-1 pr-3 font-medium">Novedad</th>
        <th className="pb-1 pr-3 font-medium">Total</th>
        <th className="pb-1 pr-3 font-medium">Benef. emergencia</th>
        <th />
      </tr>
    </thead>
  )
}

/**
 * "Corregir novedades y fortuitos" (2026-10-15, a pedido de Nathalia) — SOLO Administrador, abierto
 * desde la tarjeta del lote en Consolidado. Deja cambiar o poner en 0 cualquier conteo de origen de
 * los tiquetes, se hayan beneficiado de emergencia o no:
 *  - Recepción: lesionados/caídos/agitados de llegada (total y beneficiados de emergencia) y los
 *    fortuitos en transporte y en desembarque.
 *  - Novedades en Corral: cada registro por separado (un lote puede tener varios envíos), con
 *    lesionados/caídos/agitados de corral y Muerto en reposo; o eliminar un registro completo.
 *
 * Al guardar deja los tiquetes cuadrados en el mismo paso: si una cantidad BAJA, borra los tiquetes
 * sobrantes (los de número más alto, igual que tiquetesSobrantes()) después de mostrar cuáles y si
 * ya tenían N.° de tiquete/destino; si SUBE, crea los que falten. Todo se lee fresco de SharePoint
 * al abrir y se vuelve a leer antes de guardar, y queda registrado en RecepcionLog.
 */
export function CorregirNovedades({
  recepcion,
  usuario,
  onCerrar,
  onGuardado,
}: {
  recepcion: Recepcion
  usuario: Usuario
  onCerrar: () => void
  onGuardado: () => Promise<void> | void
}) {
  const spId = recepcion.spId as string
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string>()
  const [original, setOriginal] = useState<{ recepcion: Recepcion; corral: NovedadCorral[]; tiquetes: ConsolidadoTiquete[] }>()
  const [llegada, setLlegada] = useState<FormLlegada>()
  const [corral, setCorral] = useState<FormCorral[]>([])

  useEffect(() => {
    let vigente = true
    ;(async () => {
      try {
        const [rec, registros, tiquetes] = await Promise.all([
          obtenerRecepcionActual(spId),
          listarRegistrosNovedadCorral(spId),
          listarTiquetesDeRecepcion(spId),
        ])
        if (!vigente) return
        setOriginal({ recepcion: rec, corral: registros, tiquetes })
        setLlegada(formDeRecepcion(rec))
        setCorral(registros.map(formDeCorral))
      } catch (err) {
        if (vigente) setError(`No se pudieron leer las novedades del lote: ${(err as Error).message}`)
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => {
      vigente = false
    }
  }, [spId])

  // --- Validación: enteros ≥ 0 y beneficiados ≤ total ----------------------------------------
  const errores = useMemo(() => {
    const lista: string[] = []
    const revisarPar = (p: Par, nombre: string) => {
      const t = entero(p.total)
      const b = entero(p.benef)
      if (Number.isNaN(t) || Number.isNaN(b)) lista.push(`${nombre}: escribe números enteros (0 o más).`)
      else if (b > t) lista.push(`${nombre}: los beneficiados de emergencia (${b}) no pueden ser más que el total (${t}).`)
    }
    const revisarUno = (s: string, nombre: string) => {
      if (Number.isNaN(entero(s))) lista.push(`${nombre}: escribe un número entero (0 o más).`)
    }
    if (llegada) {
      revisarPar(llegada.lesionados, 'Lesionados de llegada')
      revisarPar(llegada.caidos, 'Caídos de llegada')
      revisarPar(llegada.agitados, 'Agitados de llegada')
      revisarUno(llegada.transporte, 'Fortuito en transporte')
      revisarUno(llegada.desembarque, 'Fortuito en desembarque')
    }
    corral.forEach((c, i) => {
      if (c.eliminar) return
      const n = `Registro de corral ${i + 1}`
      revisarPar(c.lesionados, `${n} · lesionados`)
      revisarPar(c.caidos, `${n} · caídos`)
      revisarPar(c.agitados, `${n} · agitados`)
      revisarUno(c.reposo, `${n} · muerto en reposo`)
    })
    return lista
  }, [llegada, corral])

  // --- Cómo quedan los tiquetes con lo escrito ---------------------------------------------
  const plan = useMemo(() => {
    if (!original || !llegada || errores.length > 0) return undefined
    const nuevaRecepcion: Recepcion = { ...original.recepcion, ...cambiosDeLlegada(llegada) }
    const vigentes = corral.filter((c) => !c.eliminar)
    const suma = (campo: keyof NovedadCorral) =>
      vigentes.reduce((s, c) => s + (Number(cambiosDeCorral(c)[campo] ?? 0) || 0), 0)
    const corralSumado: NovedadCorral | undefined =
      vigentes.length === 0
        ? undefined
        : {
            ...(original.corral.find((o) => o.spId === vigentes[0].spId) as NovedadCorral),
            CantMuertoReposo: suma('CantMuertoReposo'),
            CorralCantLesionadosBenefEmerg: suma('CorralCantLesionadosBenefEmerg'),
            CorralCantCaidosBenefEmerg: suma('CorralCantCaidosBenefEmerg'),
            CorralCantAgitadosBenefEmerg: suma('CorralCantAgitadosBenefEmerg'),
          }
    const aBorrar = tiquetesSobrantes(original.tiquetes, nuevaRecepcion, corralSumado)
    const objetivo = (grupo: string, tipo: string): number => {
      const r = nuevaRecepcion
      if (grupo === 'Novedad de llegada') {
        if (tipo === 'Lesionado') return r.NovLlegadaCantLesionadosBeneficioEmergencia ?? 0
        if (tipo === 'Caído') return r.NovLlegadaCantCaidosBeneficioEmergencia ?? 0
        return r.NovLlegadaCantAgitadosBeneficioEmergencia ?? 0
      }
      if (tipo === 'Muerto en Transporte') return r.FortuitoCantMuertoTransporte ?? 0
      if (tipo === 'Muerto en Desembarque') return r.FortuitoCantMuertoDesembarque ?? 0
      if (tipo === 'Muerto en Reposo') return corralSumado?.CantMuertoReposo ?? 0
      if (tipo === 'Lesionado') return corralSumado?.CorralCantLesionadosBenefEmerg ?? 0
      if (tipo === 'Caído') return corralSumado?.CorralCantCaidosBenefEmerg ?? 0
      return corralSumado?.CorralCantAgitadosBenefEmerg ?? 0
    }
    const filas = TIPOS_TIQUETE.map((t) => {
      const actuales = original.tiquetes.filter((x) => x.GrupoNovedad === t.grupo && x.TipoNovedad === t.tipo).length
      const quedan = objetivo(t.grupo, t.tipo)
      return { ...t, actuales, quedan }
    }).filter((f) => f.actuales > 0 || f.quedan > 0)
    const seCrean = filas.reduce((s, f) => s + Math.max(0, f.quedan - f.actuales), 0)
    return { nuevaRecepcion, corralSumado, aBorrar, filas, seCrean }
  }, [original, llegada, corral, errores])

  const cambiosRecepcion = original && llegada && errores.length === 0 ? cambiosDeLlegada(llegada) : undefined
  const recepcionCambia = Boolean(original && cambiosRecepcion && hayCambios(original.recepcion, cambiosRecepcion))
  const corralQueCambia = original
    ? corral.filter((c) => {
        if (c.eliminar) return true
        const o = original.corral.find((x) => x.spId === c.spId)
        return o ? hayCambios(o, cambiosDeCorral(c)) : false
      })
    : []
  const hayAlgoQueGuardar = recepcionCambia || corralQueCambia.length > 0

  async function guardar() {
    if (!original || !llegada || !plan || !cambiosRecepcion || !hayAlgoQueGuardar) return
    if (!navigator.onLine) {
      setError('Necesitas conexión a internet para guardar la corrección.')
      return
    }
    const eliminados = corral.filter((c) => c.eliminar)
    const lineasBorrar = plan.aBorrar
      .map(
        (t) =>
          `• ${t.GrupoNovedad} · ${t.TipoNovedad} #${t.NumeroAnimalEnLote}` +
          (t.Tiquete ? ` — tiene el tiquete ${t.Tiquete}${t.Destino ? ` (${t.Destino})` : ''}` : ''),
      )
      .join('\n')
    const mensaje =
      'Vas a corregir las novedades de este lote.\n\n' +
      (eliminados.length > 0
        ? `Se eliminará${eliminados.length === 1 ? '' : 'n'} ${eliminados.length} registro${eliminados.length === 1 ? '' : 's'} completo${eliminados.length === 1 ? '' : 's'} de Novedades en Corral.\n\n`
        : '') +
      (plan.aBorrar.length > 0
        ? `Se BORRARÁN estos tiquetes de Consolidado (no se puede deshacer):\n${lineasBorrar}\n\n`
        : 'No se borra ningún tiquete.\n\n') +
      (plan.seCrean === 1 ? 'Se creará 1 tiquete nuevo pendiente.\n\n' : plan.seCrean > 1 ? `Se crearán ${plan.seCrean} tiquetes nuevos pendientes.\n\n` : '') +
      (plan.seCrean > 0 && original.recepcion.EstadoLote === 'Completo'
        ? 'El lote está Completo: se volverá a poner "En proceso" para completar los tiquetes nuevos.\n\n'
        : '') +
      '¿Guardar la corrección?'
    if (!window.confirm(mensaje)) return

    setGuardando(true)
    setError(undefined)
    try {
      // 1) Releer: si alguien cambió algo mientras se editaba, se avisa en vez de pisarlo.
      const [recFresca, corralFresco] = await Promise.all([obtenerRecepcionActual(spId), listarRegistrosNovedadCorral(spId)])
      const recepcionMovida = hayCambios(recFresca, cambiosDeLlegada(formDeRecepcion(original.recepcion)))
      const corralMovido =
        corralFresco.length !== original.corral.length ||
        corralFresco.some((f) => {
          const o = original.corral.find((x) => x.spId === f.spId)
          return !o || hayCambios(o, cambiosDeCorral(formDeCorral(f)))
        })
      if (recepcionMovida || corralMovido) {
        setError('Alguien cambió las novedades de este lote mientras corregías. Cierra y vuelve a abrir "Corregir novedades" para ver los datos actuales.')
        return
      }

      // 2) Recepción
      if (recepcionCambia) {
        await actualizarNovedadesDeRecepcion(spId, cambiosRecepcion)
        await db.recepciones.update(recepcion.id, cambiosRecepcion)
      }

      // 3) Novedades en Corral: editar o eliminar cada registro
      for (const c of corralQueCambia) {
        if (c.eliminar) {
          await eliminarNovedadCorral(c.spId)
          await db.novedadesCorral.where('spId').equals(c.spId).delete()
        } else {
          const cambios = cambiosDeCorral(c)
          await actualizarNovedadCorral(c.spId, cambios)
          await db.novedadesCorral.where('spId').equals(c.spId).modify(cambios)
        }
      }

      // 4) Tiquetes: borrar los que sobran y crear los que falten
      for (const t of plan.aBorrar) {
        if (!t.spId) continue
        await eliminarTiquete(t.spId)
        await db.consolidadoTiquetes.delete(t.id)
      }
      await generarTiquetesFaltantes({ ...plan.nuevaRecepcion, spId })
      if (plan.corralSumado) await generarTiquetesNovedadCorral(plan.corralSumado, { spId, Consecutivo: recepcion.Consecutivo })

      if (plan.seCrean > 0 && original.recepcion.EstadoLote === 'Completo') {
        await reabrirLote(spId)
        await db.recepciones.update(recepcion.id, { EstadoLote: 'En proceso' })
      }
      await cachearTiquetesDeRecepcion(spId)

      await registrarLog({
        RecepcionId: spId,
        Usuario: usuario.Title,
        Accion: 'Novedades corregidas',
        DetalleJson: JSON.stringify({
          antes: { llegada: formDeRecepcion(original.recepcion), corral: original.corral.map(formDeCorral) },
          despues: { llegada, corral },
          tiquetesBorrados: plan.aBorrar.map((t) => `${t.GrupoNovedad} · ${t.TipoNovedad} #${t.NumeroAnimalEnLote}${t.Tiquete ? ` (${t.Tiquete})` : ''}`),
          tiquetesCreados: plan.seCrean,
        }),
        CreadoEn: new Date().toISOString(),
      }).catch(() => undefined) // la bitácora nunca debe tumbar la operación

      await onGuardado()
      onCerrar()
    } catch (err) {
      setError(
        `No se pudo terminar de guardar: ${(err as Error).message}. Revisa el lote con "Actualizar desde SharePoint" ` +
          'antes de volver a intentarlo (parte del cambio pudo haber quedado guardado).',
      )
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">Corregir novedades y fortuitos</p>
          <p className="text-xs text-slate-500">
            Solo Administrador. "Benef. emergencia" es cuántos del total se beneficiaron de emergencia — solo esos (y los
            fortuitos) generan tiquete. "Quitar" deja la novedad en 0.
          </p>
        </div>
        <button type="button" onClick={onCerrar} disabled={guardando} className="text-xs font-medium text-slate-500 hover:text-brand-red">
          Cerrar
        </button>
      </div>

      {cargando && <p className="mt-3 text-sm text-slate-500">Leyendo las novedades del lote en SharePoint…</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      {llegada && original && (
        <>
          <div className="mt-4 overflow-x-auto">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-navy">Recepción — novedades de llegada</p>
            <table className="text-sm">
              <Encabezado />
              <tbody>
                <FilaPar nombre="Lesionados" par={llegada.lesionados} onPar={(p) => setLlegada({ ...llegada, lesionados: p })} />
                <FilaPar nombre="Caídos" par={llegada.caidos} onPar={(p) => setLlegada({ ...llegada, caidos: p })} />
                <FilaPar nombre="Agitados" par={llegada.agitados} onPar={(p) => setLlegada({ ...llegada, agitados: p })} />
              </tbody>
            </table>
            <p className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-brand-navy">Recepción — fortuitos</p>
            <table className="text-sm">
              <tbody>
                <FilaUno nombre="Muerto en transporte" valor={llegada.transporte} onValor={(v) => setLlegada({ ...llegada, transporte: v })} />
                <FilaUno nombre="Muerto en desembarque" valor={llegada.desembarque} onValor={(v) => setLlegada({ ...llegada, desembarque: v })} />
              </tbody>
            </table>
          </div>

          <div className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-navy">Novedades en corral</p>
            {corral.length === 0 && <p className="mt-1 text-xs text-slate-500">Este lote no tiene registros de Novedades en Corral.</p>}
            {corral.map((c, i) => {
              const actualizar = (cambios: Partial<FormCorral>) =>
                setCorral((lista) => lista.map((x) => (x.spId === c.spId ? { ...x, ...cambios } : x)))
              return (
                <div
                  key={c.spId}
                  className={clsx('mt-2 overflow-x-auto rounded-md border p-3', c.eliminar ? 'border-red-200 bg-red-50/60' : 'border-slate-200 bg-white')}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold">Registro {i + 1}</span>
                      {c.capturadaEn && ` · ${new Date(c.capturadaEn).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}`}
                      {c.capturadoPor && ` · ${c.capturadoPor}`}
                    </p>
                    <button
                      type="button"
                      onClick={() => actualizar({ eliminar: !c.eliminar })}
                      className={clsx('text-xs font-medium hover:underline', c.eliminar ? 'text-brand-navy' : 'text-brand-red')}
                    >
                      {c.eliminar ? 'No eliminar' : 'Eliminar registro completo'}
                    </button>
                  </div>
                  {c.eliminar ? (
                    <p className="mt-1 text-xs text-brand-red">
                      Este registro se borrará completo de Novedades en Corral (incluido lo que diga de comportamiento sexual
                      y agua).
                    </p>
                  ) : (
                    <table className="mt-1 text-sm">
                      <Encabezado />
                      <tbody>
                        <FilaPar nombre="Lesionados" par={c.lesionados} onPar={(p) => actualizar({ lesionados: p })} />
                        <FilaPar nombre="Caídos" par={c.caidos} onPar={(p) => actualizar({ caidos: p })} />
                        <FilaPar nombre="Agitados" par={c.agitados} onPar={(p) => actualizar({ agitados: p })} />
                        <FilaUno nombre="Muerto en reposo (fortuito)" valor={c.reposo} onValor={(v) => actualizar({ reposo: v })} />
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })}
          </div>

          {errores.length > 0 && (
            <ul className="mt-4 list-inside list-disc rounded-md bg-red-50 px-3 py-2 text-xs text-brand-red">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {plan && plan.filas.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Así quedan los tiquetes</p>
              <table className="text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="pb-1 pr-4 font-medium">Tipo</th>
                    <th className="pb-1 pr-4 font-medium">Hoy</th>
                    <th className="pb-1 pr-4 font-medium">Quedan</th>
                    <th className="pb-1 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {plan.filas.map((f) => (
                    <tr key={`${f.grupo}|${f.tipo}`}>
                      <td className="py-0.5 pr-4 text-slate-700">{f.etiqueta}</td>
                      <td className="py-0.5 pr-4 tabular-nums">{f.actuales}</td>
                      <td className="py-0.5 pr-4 font-semibold tabular-nums">{f.quedan}</td>
                      <td
                        className={clsx(
                          'py-0.5 text-xs',
                          f.quedan < f.actuales ? 'text-brand-red' : f.quedan > f.actuales ? 'text-emerald-700' : 'text-slate-400',
                        )}
                      >
                        {f.quedan < f.actuales
                          ? `se borra${f.actuales - f.quedan === 1 ? '' : 'n'} ${f.actuales - f.quedan}`
                          : f.quedan > f.actuales
                            ? `se crea${f.quedan - f.actuales === 1 ? '' : 'n'} ${f.quedan - f.actuales}`
                            : 'sin cambio'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.aBorrar.some((t) => t.Tiquete) && (
                <p className="mt-1 text-xs text-brand-red">
                  Ojo: entre los tiquetes que se borran hay alguno con N.° de tiquete ya diligenciado — al guardar verás cuáles.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || !plan || !hayAlgoQueGuardar || !navigator.onLine}
              className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar corrección'}
            </button>
            <button type="button" onClick={onCerrar} disabled={guardando} className="text-sm font-medium text-slate-500 hover:text-brand-red">
              Cancelar
            </button>
            {!hayAlgoQueGuardar && errores.length === 0 && <span className="text-xs text-slate-400">No has cambiado nada todavía.</span>}
          </div>
        </>
      )}
    </div>
  )
}
