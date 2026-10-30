/**
 * Tipos de lesión (2026-10-28, a pedido de Nathalia). Cuando se marca "Lesionado" en Recepción
 * (Novedad de llegada) o en Novedades en Corral, se desglosa la cantidad de lesionados por tipo
 * (ej. 2 Cojera + 1 Hernia), y la suma tiene que dar el total de lesionados.
 *
 * El desglose se guarda como TEXTO JSON en una sola columna de varias líneas
 * (Recepciones.NovLlegadaLesionesDetalle / NovedadesCorral.CorralLesionesDetalle), con el id Y el
 * nombre del tipo: así el historial no cambia si después se renombra, desactiva o borra el tipo en la
 * maestra `TiposLesion`.
 */

export interface LesionDetalle {
  /** id del tipo en la maestra TiposLesion ('' si llega de un dato viejo sin id). */
  tipoId: string
  /** Nombre del tipo tal como estaba al guardar. */
  tipo: string
  cantidad: number
}

/** Lee el desglose guardado. Nunca lanza: un texto vacío o dañado devuelve []. */
export function parsearLesiones(texto: unknown): LesionDetalle[] {
  if (typeof texto !== 'string' || !texto.trim()) return []
  try {
    const datos: unknown = JSON.parse(texto)
    if (!Array.isArray(datos)) return []
    return datos
      .map((d) => {
        const o = (d ?? {}) as Record<string, unknown>
        return { tipoId: String(o.tipoId ?? ''), tipo: String(o.tipo ?? '').trim(), cantidad: Number(o.cantidad ?? 0) }
      })
      .filter((d) => d.tipo && Number.isFinite(d.cantidad) && d.cantidad > 0)
  } catch {
    return []
  }
}

/** Texto JSON para guardar; `undefined` si no hay nada (así no se manda una columna vacía). */
export function serializarLesiones(lesiones: LesionDetalle[]): string | undefined {
  const limpias = lesiones.filter((l) => l.tipo && l.cantidad > 0)
  return limpias.length > 0 ? JSON.stringify(limpias) : undefined
}

const claveDe = (l: LesionDetalle) => l.tipo.trim().toLocaleLowerCase('es')

/**
 * Suma varios desgloses en uno (llegada + cada envío de corral, o varios lotes de una semana). Se
 * agrupa por NOMBRE del tipo, no por id, para que un mismo tipo capturado antes y después de un
 * cambio menor (o sin id) quede en una sola línea. Ordenado de mayor a menor cantidad.
 */
export function combinarLesiones(...listas: Array<LesionDetalle[] | undefined>): LesionDetalle[] {
  const porTipo = new Map<string, LesionDetalle>()
  for (const lista of listas) {
    for (const l of lista ?? []) {
      const actual = porTipo.get(claveDe(l))
      if (actual) actual.cantidad += l.cantidad
      else porTipo.set(claveDe(l), { ...l })
    }
  }
  return [...porTipo.values()].sort((a, b) => b.cantidad - a.cantidad || a.tipo.localeCompare(b.tipo, 'es'))
}

/** "2 Cojera · 1 Hernia" — '' si no hay desglose. */
export function textoLesiones(lesiones: LesionDetalle[], separador = ' · '): string {
  return lesiones.map((l) => `${l.cantidad} ${l.tipo}`).join(separador)
}

/**
 * Revisa el desglose antes de guardar. Devuelve el mensaje de error o `undefined` si está bien.
 * `hayTiposDisponibles`: si la maestra todavía no tiene tipos activos en este dispositivo (lista sin
 * crear, o nunca se descargó), el desglose NO se exige — no se puede bloquear la captura por eso.
 */
export function validarLesiones(
  lesiones: LesionDetalle[],
  totalLesionados: number,
  hayTiposDisponibles: boolean,
): string | undefined {
  if (!hayTiposDisponibles) return undefined
  if (lesiones.length === 0) return 'Indica el tipo de lesión de los animales lesionados.'
  if (lesiones.some((l) => !l.tipo)) return 'Elige el tipo de lesión en cada fila (o quita la fila vacía).'
  if (lesiones.some((l) => !Number.isInteger(l.cantidad) || l.cantidad <= 0))
    return 'Cada tipo de lesión necesita una cantidad mayor a 0.'
  const claves = lesiones.map(claveDe)
  if (new Set(claves).size !== claves.length) return 'Hay un tipo de lesión repetido — junta las cantidades en una sola fila.'
  const suma = lesiones.reduce((acc, l) => acc + l.cantidad, 0)
  if (suma !== totalLesionados)
    return `La suma por tipo de lesión (${suma}) debe ser igual a la cantidad de lesionados (${totalLesionados || 0}).`
  return undefined
}
