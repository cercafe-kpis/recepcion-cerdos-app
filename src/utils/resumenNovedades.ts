/**
 * Lógica pura (sin React ni red) para mostrar, antes de guardar una Novedad en Corral, lo que el
 * lote YA tiene registrado — y para decir de forma explícita que lo nuevo se SUMA a eso. Los reportes
 * (ReporteDiarioLote.tsx, ReporteSemanalAsociado.tsx) suman las cantidades de Llegada (Recepción) y
 * de TODOS los registros de Corral del lote, así que estas mismas sumas son las que verá el reporte.
 */
import type { Recepcion } from '../types/models'

export interface Conteos {
  muertosReposo: number
  lesionados: number
  caidos: number
  agitados: number
}

export type ClaveConteo = keyof Conteos

export const CONTEOS_VACIOS: Conteos = { muertosReposo: 0, lesionados: 0, caidos: 0, agitados: 0 }

const NOMBRES: Record<ClaveConteo, { singular: string; plural: string }> = {
  muertosReposo: { singular: 'muerto en reposo', plural: 'muertos en reposo' },
  lesionados: { singular: 'lesionado', plural: 'lesionados' },
  caidos: { singular: 'caído', plural: 'caídos' },
  agitados: { singular: 'agitado', plural: 'agitados' },
}

export const CLAVES_CONTEO: ClaveConteo[] = ['muertosReposo', 'lesionados', 'caidos', 'agitados']

/** "1 caído", "2 caídos". */
export function fraseConteo(clave: ClaveConteo, cantidad: number): string {
  const nombre = NOMBRES[clave]
  return `${cantidad} ${cantidad === 1 ? nombre.singular : nombre.plural}`
}

/** "1 caído, 5 agitados" — solo lo que sea mayor a 0; vacío si no hay nada. */
export function fraseDeConteos(conteos: Conteos): string {
  return CLAVES_CONTEO.filter((c) => conteos[c] > 0)
    .map((c) => fraseConteo(c, conteos[c]))
    .join(', ')
}

export function hayConteos(conteos: Conteos): boolean {
  return CLAVES_CONTEO.some((c) => conteos[c] > 0)
}

export function sumarConteos(a: Conteos, b: Conteos): Conteos {
  return {
    muertosReposo: a.muertosReposo + b.muertosReposo,
    lesionados: a.lesionados + b.lesionados,
    caidos: a.caidos + b.caidos,
    agitados: a.agitados + b.agitados,
  }
}

/** Número entero >= 0; cualquier otra cosa (vacío, NaN, texto, negativo) cuenta como 0. */
function cantidad(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** Lo reportado al llegar (Recepción) — el total, no el de beneficio de emergencia. */
export function conteosDeLlegada(r: Pick<Recepcion, 'NovLlegadaCantLesionados' | 'NovLlegadaCantCaidos' | 'NovLlegadaCantAgitados'>): Conteos {
  return {
    muertosReposo: 0,
    lesionados: cantidad(r.NovLlegadaCantLesionados),
    caidos: cantidad(r.NovLlegadaCantCaidos),
    agitados: cantidad(r.NovLlegadaCantAgitados),
  }
}

/** Una Novedad en Corral ya guardada (en SharePoint o pendiente en este dispositivo). */
export interface ResumenNovedadCorral {
  id: string
  CapturadaEn: string
  CapturadoPor?: string
  /** true = todavía solo existe en este dispositivo, no se ha enviado a SharePoint. */
  pendiente: boolean
  conteos: Conteos
  /** De esos, cuántos se beneficiaron de emergencia (los que generan tiquete). */
  conBeneficioEmergencia: Conteos
}

/** Sirve tanto para los `fields` de SharePoint como para un registro de Dexie (mismos nombres). */
export function resumenDeCampos(id: string, f: Record<string, unknown>, pendiente: boolean): ResumenNovedadCorral {
  return {
    id,
    CapturadaEn: f.CapturadaEn ? String(f.CapturadaEn) : '',
    CapturadoPor: f.CapturadoPor ? String(f.CapturadoPor) : undefined,
    pendiente,
    conteos: {
      muertosReposo: cantidad(f.CantMuertoReposo),
      lesionados: cantidad(f.CorralCantLesionados),
      caidos: cantidad(f.CorralCantCaidos),
      agitados: cantidad(f.CorralCantAgitados),
    },
    conBeneficioEmergencia: {
      muertosReposo: 0,
      lesionados: cantidad(f.CorralCantLesionadosBenefEmerg),
      caidos: cantidad(f.CorralCantCaidosBenefEmerg),
      agitados: cantidad(f.CorralCantAgitadosBenefEmerg),
    },
  }
}

export function conteosDeCorral(registros: ResumenNovedadCorral[]): Conteos {
  return registros.reduce((total, r) => sumarConteos(total, r.conteos), CONTEOS_VACIOS)
}

/**
 * Junta lo guardado en este dispositivo (Dexie) con lo que SharePoint dice (si se pudo consultar).
 * - Con SharePoint: sus registros + los de este dispositivo que todavía no se enviaron.
 * - Sin SharePoint (sin conexión o falló la consulta): solo lo de este dispositivo, y se avisa con
 *   `completo: false` que puede haber más capturas hechas en otros dispositivos.
 */
export function combinarRegistros(
  locales: Array<Record<string, unknown> & { id: string; EstadoSync: string; spId?: string }>,
  remotos: ResumenNovedadCorral[] | undefined,
): { registros: ResumenNovedadCorral[]; completo: boolean } {
  const masReciente = (a: ResumenNovedadCorral, b: ResumenNovedadCorral) => b.CapturadaEn.localeCompare(a.CapturadaEn)
  if (!remotos) {
    return {
      registros: locales.map((l) => resumenDeCampos(l.id, l, l.EstadoSync === 'Pendiente')).sort(masReciente),
      completo: false,
    }
  }
  const idsRemotos = new Set(remotos.map((r) => r.id))
  const pendientes = locales
    .filter((l) => l.EstadoSync === 'Pendiente' && !(l.spId && idsRemotos.has(l.spId)))
    .map((l) => resumenDeCampos(l.id, l, true))
  return { registros: [...remotos, ...pendientes].sort(masReciente), completo: true }
}

/** Lo que trae el formulario sin guardar. Solo cuenta lo que tiene su casilla marcada. */
export function conteosNuevosDelFormulario(v: Record<string, unknown>): Conteos {
  const siMarcado = (casilla: string, cant: string) => (v[casilla] ? cantidad(v[cant]) : 0)
  return {
    muertosReposo: siMarcado('MuertoReposo', 'CantMuertoReposo'),
    lesionados: siMarcado('CorralLesionados', 'CorralCantLesionados'),
    caidos: siMarcado('CorralCaidos', 'CorralCantCaidos'),
    agitados: siMarcado('CorralAgitados', 'CorralCantAgitados'),
  }
}

export interface LineaDeSuma {
  clave: ClaveConteo
  yaTiene: number
  agrega: number
  quedara: number
}

/** Una línea por cada tipo de novedad que se está agregando (los que no se agregan no aparecen). */
export function lineasDeSuma(yaTiene: Conteos, nuevo: Conteos): LineaDeSuma[] {
  return CLAVES_CONTEO.filter((c) => nuevo[c] > 0).map((c) => ({
    clave: c,
    yaTiene: yaTiene[c],
    agrega: nuevo[c],
    quedara: yaTiene[c] + nuevo[c],
  }))
}

/** "hace 5 min", "hace 2 h", "hace 3 días". */
export function haceCuanto(iso: string, ahora: number = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'fecha desconocida'
  const minutos = Math.max(0, Math.round((ahora - t) / 60000))
  if (minutos < 1) return 'hace un momento'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.round(horas / 24)
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}
