/**
 * Pareja "casilla + cantidad" de un formulario: [casilla, cantidad, casillaPadre?]. Si hay
 * `casillaPadre`, la pareja solo vale mientras esa casilla siga marcada (ej.: "¿se benefició de
 * emergencia?" solo tiene sentido si "Caído" sigue marcado).
 */
export type ParejaCasillaCantidad = readonly [casilla: string, cantidad: string, casillaPadre?: string]

/**
 * Quita las cantidades de las casillas que quedaron SIN marcar antes de guardar.
 *
 * Por qué hace falta: en estos formularios la cantidad solo aparece mientras su casilla está marcada,
 * pero react-hook-form CONSERVA el valor de un campo aunque deje de mostrarse (comportamiento por
 * defecto, `shouldUnregister: false`). Si alguien marca "Caído", escribe 5 y luego desmarca la
 * casilla porque se equivocó, la cantidad 5 seguía viajando en el registro — y los reportes suman
 * las cantidades sin mirar la casilla, así que el lote aparecía con 5 caídos que nadie reportó.
 *
 * Las parejas deben venir ordenadas con los padres ANTES que sus hijas, porque desmarcar el padre
 * también desmarca (y vacía) a la pareja hija. No modifica el objeto original.
 */
export function limpiarCantidadesSinMarcar<T extends object>(
  valores: T,
  parejas: ReadonlyArray<ParejaCasillaCantidad>,
): T {
  const copia = { ...valores } as Record<string, unknown>
  for (const [casilla, cantidad, casillaPadre] of parejas) {
    if (casillaPadre && !copia[casillaPadre]) copia[casilla] = false
    if (!copia[casilla]) copia[cantidad] = undefined
  }
  return copia as T
}
