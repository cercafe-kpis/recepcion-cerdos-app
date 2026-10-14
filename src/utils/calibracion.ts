import type { ResultadoCalibracion } from '../types/models'

/** Redondea a 3 decimales (gramos) para no arrastrar ruido de punto flotante (0,1 + 0,2 …). */
export function redondear3(valor: number): number {
  return Math.round(valor * 1000) / 1000
}

export interface CalculoCalibracion {
  promedioKg: number
  errorKg: number
  resultado: ResultadoCalibracion
}

/**
 * Cálculo del "Formato de verificación básculas":
 *  - Promedio = (M1 + M2 + M3) / 3
 *  - Error    = Pesa patrón − Promedio (todo en kg)
 *  - Conforme si |Error| ≤ EMP; si no, No conforme.
 * El error se compara ya redondeado a gramos, así un error de exactamente 0,050 kg con EMP 0,05
 * queda Conforme y no falla por un 0,0500000001 de punto flotante.
 */
export function calcularCalibracion(
  mediciones: [number, number, number],
  pesaPatronKg: number,
  empKg: number,
): CalculoCalibracion {
  const promedioKg = redondear3((mediciones[0] + mediciones[1] + mediciones[2]) / 3)
  const errorKg = redondear3(pesaPatronKg - promedioKg)
  const resultado: ResultadoCalibracion = Math.abs(errorKg) <= redondear3(empKg) ? 'Conforme' : 'No conforme'
  return { promedioKg, errorKg, resultado }
}

/** "0,050" — número con coma decimal y 3 decimales fijos, como se lee en planta. */
export function formatoKg(valor: number | undefined, decimales = 3): string {
  if (valor === undefined || Number.isNaN(valor)) return '—'
  return valor.toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
}

/** "+0,020" / "−0,010" — el signo del error importa (de más o de menos). */
export function formatoErrorKg(valor: number | undefined): string {
  if (valor === undefined || Number.isNaN(valor)) return '—'
  const texto = formatoKg(Math.abs(valor))
  if (valor > 0) return `+${texto}`
  if (valor < 0) return `−${texto}`
  return texto
}

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']

/** "Lunes" para "2026-10-12" (sin desfase de zona horaria: se arma la fecha en UTC). */
export function diaDeLaSemana(fechaISO: string): string {
  const [a, m, d] = fechaISO.slice(0, 10).split('-').map(Number)
  if (!a || !m || !d) return ''
  return DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]
}
