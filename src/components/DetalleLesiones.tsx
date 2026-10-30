import type { TipoLesion } from '../types/models'
import type { LesionDetalle } from '../utils/lesiones'

/**
 * Una fila del desglose mientras se diligencia: el tipo elegido (id de TiposLesion) y la cantidad
 * tal como está escrita. Se convierte a LesionDetalle con filasALesiones() al guardar.
 */
export interface FilaLesion {
  tipoId: string
  cantidad: string
}

export const FILAS_LESION_INICIALES: FilaLesion[] = [{ tipoId: '', cantidad: '' }]

/**
 * Convierte las filas del formulario en el desglose a guardar. Atajo: si hay UNA sola fila con tipo y
 * sin cantidad, se toma el total de lesionados (el caso más común: todos con la misma lesión).
 * Las filas totalmente vacías se descartan; las que tienen cantidad pero no tipo se dejan (con tipo
 * '') para que validarLesiones() avise.
 */
export function filasALesiones(filas: FilaLesion[], tipos: TipoLesion[], totalLesionados: number): LesionDetalle[] {
  const conAlgo = filas.filter((f) => f.tipoId || f.cantidad.trim())
  return conAlgo.map((f) => {
    const tipo = tipos.find((t) => t.id === f.tipoId)
    const cantidadEscrita = f.cantidad.trim()
    const cantidad = cantidadEscrita === '' && conAlgo.length === 1 ? totalLesionados : Number(cantidadEscrita)
    return { tipoId: f.tipoId, tipo: tipo?.Title ?? '', cantidad }
  })
}

/**
 * Campo "Tipo de lesión" (2026-10-28): aparece debajo de "Cantidad lesionados" cuando se marca
 * "Lesionado", en Recepción (Novedad de llegada) y en Novedades en Corral. Una fila por tipo, con su
 * cantidad; la suma tiene que dar el total de lesionados (lo revisa validarLesiones() al guardar).
 * Componente "tonto": el formulario guarda las filas en su propio estado.
 */
export function DetalleLesiones({
  tipos,
  filas,
  onCambiar,
  totalLesionados,
  error,
}: {
  /** Solo los tipos ACTIVOS de la maestra. */
  tipos: TipoLesion[]
  filas: FilaLesion[]
  onCambiar: (filas: FilaLesion[]) => void
  totalLesionados: number
  error?: string
}) {
  if (tipos.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 bg-white px-3 py-2 text-xs text-slate-500">
        Todavía no hay tipos de lesión configurados en este dispositivo — un Administrador los crea en Asociados →
        Tipos de lesión. Mientras tanto se puede guardar sin indicar el tipo.
      </p>
    )
  }

  const suma = filas.reduce((acc, f) => acc + (Number(f.cantidad) || 0), 0)
  const unaSolaSinCantidad = filas.length === 1 && filas[0].tipoId && !filas[0].cantidad.trim()
  const sumaMostrada = unaSolaSinCantidad ? totalLesionados : suma
  const cuadra = totalLesionados > 0 && sumaMostrada === totalLesionados

  function cambiarFila(i: number, cambios: Partial<FilaLesion>) {
    onCambiar(filas.map((f, j) => (j === i ? { ...f, ...cambios } : f)))
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-700">
        Tipo de lesión <span className="text-brand-red">*</span>
      </p>
      <p className="mb-2 text-xs text-slate-400">
        Si todos tienen la misma lesión, elige el tipo y deja la cantidad vacía. Si hay varias, agrega una fila por tipo.
      </p>

      <div className="space-y-2">
        {filas.map((fila, i) => {
          const elegidosEnOtras = new Set(filas.filter((_, j) => j !== i).map((f) => f.tipoId))
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                value={fila.tipoId}
                onChange={(e) => cambiarFila(i, { tipoId: e.target.value })}
                aria-label={`Tipo de lesión ${i + 1}`}
                className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy"
              >
                <option value="">Selecciona el tipo…</option>
                {tipos
                  .filter((t) => t.id === fila.tipoId || !elegidosEnOtras.has(t.id))
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.Title}
                    </option>
                  ))}
              </select>
              <input
                type="number"
                step="1"
                min="1"
                inputMode="numeric"
                value={fila.cantidad}
                onChange={(e) => cambiarFila(i, { cantidad: e.target.value })}
                placeholder={filas.length === 1 && totalLesionados > 0 ? String(totalLesionados) : 'Cant.'}
                aria-label={`Cantidad de la lesión ${i + 1}`}
                className="w-24 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy"
              />
              {filas.length > 1 && (
                <button
                  type="button"
                  onClick={() => onCambiar(filas.filter((_, j) => j !== i))}
                  className="text-xs font-medium text-slate-500 hover:text-brand-red"
                >
                  Quitar
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {filas.length < tipos.length ? (
          <button
            type="button"
            onClick={() => onCambiar([...filas, { tipoId: '', cantidad: '' }])}
            className="text-xs font-medium text-brand-navy hover:underline"
          >
            + Agregar otro tipo de lesión
          </button>
        ) : (
          <span />
        )}
        <span className={cuadra ? 'text-xs font-medium text-emerald-600' : 'text-xs text-slate-500'}>
          Suma: {sumaMostrada} de {totalLesionados || 0} lesionados
        </span>
      </div>
      {error && <p className="mt-1 text-xs text-brand-red">{error}</p>}
    </div>
  )
}
