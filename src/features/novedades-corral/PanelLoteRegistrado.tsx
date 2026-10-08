import {
  fraseConteo,
  fraseDeConteos,
  haceCuanto,
  hayConteos,
  lineasDeSuma,
  sumarConteos,
  type Conteos,
  type ResumenNovedadCorral,
} from '../../utils/resumenNovedades'

interface Props {
  /** Nombre del lote, tal como sale en el selector (ej. "12679 · 2026-10-06"). */
  tituloLote: string
  llegada: Conteos
  registros: ResumenNovedadCorral[]
  /** false = no se pudo consultar SharePoint: solo se ven las capturas de ESTE dispositivo. */
  completo: boolean
  /** Lo que el formulario trae sin guardar (ya filtrado a las casillas marcadas). */
  nuevo: Conteos
  corral: Conteos
}

/**
 * Antes de guardar una Novedad en Corral: qué tiene ya el lote (llegada + cada envío de corral, con
 * hora y quién lo guardó) y, mientras se llena el formulario, cuánto quedaría después de sumar lo
 * nuevo. Pedido por Nathalia (2026-10-08): los usuarios duplicaban novedades porque el formulario no
 * mostraba que cada "Guardar" se SUMA a lo anterior en vez de reemplazarlo.
 */
export function PanelLoteRegistrado({ tituloLote, llegada, registros, completo, nuevo, corral }: Props) {
  const totalYaTiene = sumarConteos(llegada, corral)
  const suma = lineasDeSuma(totalYaTiene, nuevo)

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-medium text-slate-800">Lo que ya tiene el lote {tituloLote}</p>
        <p className="mt-1">
          <span className="font-medium">Llegada:</span> {hayConteos(llegada) ? fraseDeConteos(llegada) : 'sin novedades'}
        </p>
        <div className="mt-1">
          <span className="font-medium">Corral:</span>{' '}
          {registros.length === 0 ? (
            'sin novedades registradas'
          ) : (
            <ul className="ml-4 list-disc">
              {registros.map((r) => (
                <li key={r.id}>
                  {haceCuanto(r.CapturadaEn)}
                  {r.CapturadoPor ? ` · ${r.CapturadoPor}` : ''}:{' '}
                  {hayConteos(r.conteos) ? fraseDeConteos(r.conteos) : 'sin cantidades (solo observaciones)'}
                  {hayConteos(r.conBeneficioEmergencia) && ` (beneficio de emergencia: ${fraseDeConteos(r.conBeneficioEmergencia)})`}
                  {r.pendiente && <span className="text-amber-700"> · pendiente de enviar</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
        {hayConteos(totalYaTiene) && (
          <p className="mt-1 text-xs text-slate-500">
            Total hoy en el lote (llegada + corral, que es lo que suman los reportes): {fraseDeConteos(totalYaTiene)}.
          </p>
        )}
        {!completo && (
          <p className="mt-1 text-xs text-amber-700">
            No se pudo consultar SharePoint (sin conexión): solo se ven las capturas hechas en este dispositivo. Si otro
            dispositivo guardó algo de este lote, todavía no aparece aquí.
          </p>
        )}
      </div>

      {suma.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Lo que estás agregando se SUMA a lo anterior (no lo reemplaza):</p>
          <ul className="mt-1 ml-4 list-disc">
            {suma.map((l) => (
              <li key={l.clave}>
                Vas a sumar {fraseConteo(l.clave, l.agrega)} → el lote quedará con {fraseConteo(l.clave, l.quedara)}
                {l.yaTiene > 0 ? ` (ya tenía ${l.yaTiene})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
