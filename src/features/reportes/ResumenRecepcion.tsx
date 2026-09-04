import clsx from 'clsx'
import type { ConsolidadoTiquete, Recepcion } from '../../types/models'

/**
 * Resumen visual de una sola Recepción (lote): condiciones de llegada +
 * qué pasó con los animales que presentaron novedad o fortuito. Es un
 * componente puramente de presentación (no consulta nada), reutilizado en
 * dos lugares:
 *  - El "reporte inmediato" que aparece dentro de Consolidado.tsx apenas un
 *    lote queda Completo, para enviárselo de una vez al asociado.
 *  - La pantalla Reporte.tsx (consolidado filtrable, todos los lotes de un
 *    rango de fechas), que arma uno de estos por cada Recepción encontrada.
 *
 * Las clases `print:...` son para cuando se imprime o se descarga como PDF
 * con el botón "Imprimir / Descargar PDF" (usa window.print() del
 * navegador, sin librerías nuevas): `print:break-inside-avoid` evita que una
 * hoja corte un lote a la mitad.
 */
export function ResumenRecepcion({
  recepcion,
  asociadoNombre,
  granjaNombre,
  placa,
  tiquetes,
}: {
  recepcion: Recepcion
  asociadoNombre: string
  granjaNombre: string
  placa: string
  tiquetes: ConsolidadoTiquete[]
}) {
  const novedadesLlegada = [
    recepcion.NovLlegadaLesionados && `Lesionados: ${recepcion.NovLlegadaCantLesionados ?? '—'}`,
    recepcion.NovLlegadaCaidos && `Caídos: ${recepcion.NovLlegadaCantCaidos ?? '—'}`,
    recepcion.NovLlegadaAgitados && `Agitados: ${recepcion.NovLlegadaCantAgitados ?? '—'}`,
  ].filter(Boolean) as string[]

  const fortuitos = [
    recepcion.FortuitoMuertoTransporte && `Muertos en transporte: ${recepcion.FortuitoCantMuertoTransporte ?? '—'}`,
    recepcion.FortuitoMuertoDesembarque && `Muertos en desembarque: ${recepcion.FortuitoCantMuertoDesembarque ?? '—'}`,
  ].filter(Boolean) as string[]

  return (
    <section className="break-inside-avoid rounded-lg border border-slate-200 bg-white p-4 print:break-inside-avoid print:border-slate-400">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
        <h3 className="text-sm font-semibold text-brand-navy">
          Consecutivo {recepcion.Consecutivo} · Orden {recepcion.NumeroOrden}
        </h3>
        <p className="text-xs text-slate-500">{recepcion.FechaRecepcion}</p>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Dato etiqueta="Asociado" valor={asociadoNombre} />
        <Dato etiqueta="Granja" valor={granjaNombre} />
        <Dato etiqueta="Placa" valor={placa} />
        <Dato etiqueta="Total cerdos" valor={String(recepcion.NumeroTotalCerdos)} />
        <Dato etiqueta="Peso promedio granja" valor={`${recepcion.PesoPromedioGranja} kg`} />
        <Dato etiqueta="Guía sanitaria ICA" valor={recepcion.GuiaSanitariaICA || '—'} />
        <Dato etiqueta="Remisión granja" valor={recepcion.RemisionGranja || '—'} />
        <Dato etiqueta="Suciedad" valor={recepcion.SuciedadCerdos} />
        <Dato etiqueta="QR del lote" valor={recepcion.QRLote ? 'Sí' : 'No'} />
        <Dato etiqueta="Certificado inmunocastración" valor={recepcion.CertificadoInmunocastracion ? 'Sí' : 'No'} />
        <Dato etiqueta="Guía ICA vs. QR coinciden" valor={recepcion.CoincideGuiaICAvsQR ? 'Sí' : 'No'} />
        <Dato etiqueta="Estado del lote" valor={recepcion.EstadoLote} />
      </div>

      {(novedadesLlegada.length > 0 || fortuitos.length > 0 || recepcion.Observaciones) && (
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {novedadesLlegada.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">Novedades de llegada: </span>
              {novedadesLlegada.join(' · ')}
            </p>
          )}
          {fortuitos.length > 0 && (
            <p>
              <span className="font-medium text-slate-700">Fortuitos: </span>
              {fortuitos.join(' · ')}
            </p>
          )}
          {recepcion.Observaciones && (
            <p className="sm:col-span-2">
              <span className="font-medium text-slate-700">Observaciones: </span>
              {recepcion.Observaciones}
            </p>
          )}
        </div>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Condición de los animales con novedad o fortuito
        </p>
        {tiquetes.length === 0 ? (
          <p className="text-sm text-slate-500">Sin novedades ni fortuitos — todo el lote llegó y se procesó en condiciones normales.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Grupo</th>
                  <th className="py-1 pr-3">Novedad</th>
                  <th className="py-1 pr-3">#</th>
                  <th className="py-1 pr-3">Tiquete</th>
                  <th className="py-1 pr-3">Destino</th>
                  <th className="py-1 pr-3">Factura</th>
                  <th className="py-1 pr-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tiquetes.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1 pr-3 text-slate-600">{t.GrupoNovedad}</td>
                    <td className="py-1 pr-3 text-slate-600">{t.TipoNovedad}</td>
                    <td className="py-1 pr-3 text-slate-600">{t.NumeroAnimalEnLote}</td>
                    <td className="py-1 pr-3 text-slate-600">{t.Tiquete || '—'}</td>
                    <td className="py-1 pr-3 text-slate-600">{t.Destino || '—'}</td>
                    <td className="py-1 pr-3 text-slate-600">{t.Factura || '—'}</td>
                    <td className="py-1 pr-3">
                      <span
                        className={clsx(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          t.EstadoTiquete === 'Completo' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
                        )}
                      >
                        {t.EstadoTiquete}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className="font-medium text-slate-700">{valor}</p>
    </div>
  )
}
