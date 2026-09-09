import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { cachearTiquetesDeRecepcion, guardarEdicionTiqueteLocal, sincronizar } from '../../offline/syncService'
import {
  generarTiqueteMuertoReposo,
  generarTiquetesFaltantes,
  marcarLoteCompleto,
  obtenerNovedadCorralDeRecepcion,
  reabrirLote,
} from '../../graph/lists'
import { CampoSelect } from '../../components/CamposFormulario'
import { ReporteDiarioLote } from '../reportes/ReporteDiarioLote'
import type { ConsolidadoTiquete, Destino, Usuario } from '../../types/models'

/**
 * El objetivo de todo el flujo (Recepción → Ubicación/Novedades en Corral →
 * Consolidado): ponerle Tiquete y Destino a cada animal que tuvo alguna
 * novedad, uno por uno. Las filas de la tabla las genera el servidor de
 * sincronización (ver generarTiquetesFaltantes / generarTiqueteMuertoReposo
 * en src/graph/lists.ts) — esta pantalla no crea tiquetes, solo permite
 * completarlos. Por eso solo aparecen aquí las Recepciones que ya
 * sincronizaron al menos una vez.
 */
export function Consolidado({ usuario }: { usuario: Usuario }) {
  const [recepcionId, setRecepcionId] = useState('')
  const [actualizando, setActualizando] = useState(false)
  const [regenerando, setRegenerando] = useState(false)
  const [terminando, setTerminando] = useState(false)
  const [reabriendo, setReabriendo] = useState(false)
  const [error, setError] = useState<string>()
  const [verReporteInmediato, setVerReporteInmediato] = useState(false)
  const esAdmin = usuario.Rol === 'Administrador'

  const recepciones =
    useLiveQuery(
      () => db.recepciones.where('EstadoSync').equals('Sincronizada').reverse().sortBy('FechaRecepcion'),
      [],
    ) ?? []

  const recepcion = useMemo(() => recepciones.find((r) => r.id === recepcionId), [recepciones, recepcionId])

  // Único candado de edición, a pedido explícito del usuario: el lote se
  // bloquea para no-Administradores solo cuando ALGUIEN lo marca a mano como
  // terminado con el botón "Terminar proceso" (ver terminarProceso() más
  // abajo, que llama a marcarLoteCompleto()) — nunca automáticamente. Antes
  // se cerraba solo apenas todos los tiquetes tenían Tiquete+Destino (ver la
  // nota histórica sobre cerrarLotesCompletos() en syncService.ts), pero eso
  // podía bloquear un Fortuito antes de alcanzar a ponerle la Factura,
  // justo cuando el proceso se hace en varias partes/sesiones separadas.
  const loteCompleto = recepcion?.EstadoLote === 'Completo'
  const soloLectura = usuario.Rol === 'Consultor' || (loteCompleto && !esAdmin)

  const granja = useLiveQuery(() => (recepcion ? db.granjas.get(recepcion.GranjaId) : undefined), [recepcion])
  const asociado = useLiveQuery(() => (recepcion ? db.asociados.get(recepcion.AsociadoId) : undefined), [recepcion])
  const vehiculo = useLiveQuery(() => (recepcion ? db.vehiculos.get(recepcion.PlacaVehiculoId) : undefined), [recepcion])

  const tiquetes =
    useLiveQuery(
      () => (recepcion?.spId ? db.consolidadoTiquetes.where('RecepcionId').equals(recepcion.spId).sortBy('TipoNovedad') : []),
      [recepcion],
    ) ?? []

  // Al elegir una recepción, trae la versión más fresca de sus tiquetes si hay conexión
  // (por si otro dispositivo ya le puso Tiquete/Destino a alguno).
  useEffect(() => {
    if (recepcion?.spId && navigator.onLine) {
      void cachearTiquetesDeRecepcion(recepcion.spId)
    }
  }, [recepcion?.spId])

  async function actualizar() {
    if (!recepcion?.spId) return
    setActualizando(true)
    try {
      await cachearTiquetesDeRecepcion(recepcion.spId)
    } finally {
      setActualizando(false)
    }
  }

  /**
   * Repara una Recepción que ya quedó "Sincronizada" pero con 0 tiquetes
   * generados — pasó por un bug donde ConsolidadoTiquetes rechazaba el
   * registro en SharePoint (columna Title obligatoria sin llenar, o una
   * columna de Elección con otro nombre/otras opciones) y el error se perdía
   * en silencio (ver el comentario en sincronizar() en syncService.ts, ya
   * corregido). Solo hace falta usar esto para Recepciones capturadas ANTES
   * de esa corrección; de aquí en adelante generarTiquetesFaltantes/
   * generarTiqueteMuertoReposo ya deberían crear los tiquetes solos al
   * sincronizar. Es seguro repetirlo las veces que sea: generarTiquetesFaltantes
   * nunca duplica una fila que ya exista.
   *
   * La novedad de corral se trae de Graph (obtenerNovedadCorralDeRecepcion),
   * no de Dexie local: este botón se usa típicamente desde un dispositivo
   * distinto al que capturó Novedades en Corral (por ejemplo, Consolidado
   * desde el computador de planta y la captura desde el celular), y Dexie
   * local de ESTE dispositivo nunca tiene ese registro — solo SharePoint sí.
   */
  async function regenerarTiquetes() {
    if (!recepcion?.spId) return
    setRegenerando(true)
    setError(undefined)
    try {
      await generarTiquetesFaltantes(recepcion)
      const novedad = await obtenerNovedadCorralDeRecepcion(recepcion.spId)
      if (novedad) {
        await generarTiqueteMuertoReposo(novedad, { spId: recepcion.spId, Consecutivo: recepcion.Consecutivo })
      }
      await cachearTiquetesDeRecepcion(recepcion.spId)
    } catch (err) {
      setError(`No se pudieron generar los tiquetes: ${(err as Error).message}`)
    } finally {
      setRegenerando(false)
    }
  }

  /**
   * Punto final manual y explícito del proceso, a pedido de Nathalia: como
   * Recepción → Ubicación/Novedades en Corral → Consolidado se hace en
   * varias partes y a veces en varias sesiones, hacía falta un gesto claro
   * de "esta recepción ya quedó totalmente gestionada" en vez de que el
   * sistema lo adivinara solo (eso fue justo lo que causó el problema:
   * cerrarse automáticamente antes de que alguien pusiera la Factura de un
   * Fortuito, dejando el campo bloqueado sin poder completarlo). Si todavía
   * falta algo por diligenciar, se avisa y se deja decidir a la persona si
   * de verdad quiere cerrar así.
   */
  async function terminarProceso() {
    if (!recepcion?.spId) return
    const faltantes = tiquetes.filter((t) => !tiqueteYaCompletado(t))
    if (faltantes.length > 0) {
      const continuar = window.confirm(
        `${faltantes.length} de ${tiquetes.length} tiquetes todavía no tienen Tiquete, Destino y Factura (si aplica) completos.\n\n¿Terminar el proceso de todas formas? Después de esto solo un Administrador podrá seguir editando este lote.`,
      )
      if (!continuar) return
    }
    setTerminando(true)
    setError(undefined)
    try {
      await marcarLoteCompleto(recepcion.spId)
      await db.recepciones.update(recepcion.id, { EstadoLote: 'Completo' })
    } catch (err) {
      setError(`No se pudo terminar el proceso: ${(err as Error).message}`)
    } finally {
      setTerminando(false)
    }
  }

  /**
   * Contraparte de terminarProceso(), solo para Administrador: reabre un
   * lote que quedó "Completo" por error — en particular, cualquier lote que
   * se haya cerrado solo bajo la regla automática vieja (ver la nota
   * histórica en syncService.ts) antes de que existiera este botón, sin que
   * los Fortuitos alcanzaran a tener su Factura.
   */
  async function reabrirProceso() {
    if (!recepcion?.spId) return
    setReabriendo(true)
    setError(undefined)
    try {
      await reabrirLote(recepcion.spId)
      await db.recepciones.update(recepcion.id, { EstadoLote: 'En proceso' })
    } catch (err) {
      setError(`No se pudo reabrir el proceso: ${(err as Error).message}`)
    } finally {
      setReabriendo(false)
    }
  }

  async function guardarCambio(t: ConsolidadoTiquete, cambios: Partial<ConsolidadoTiquete>) {
    await guardarEdicionTiqueteLocal(t.id, cambios)
    if (navigator.onLine) {
      void sincronizar(usuario.Correo)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 print:hidden">Consolidado</h1>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Asigna el número de tiquete y el destino (Procesado o Decomisado) a cada animal con novedad.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red print:hidden">{error}</p>}

      <div className="mt-4 max-w-sm print:hidden">
        <CampoSelect
          etiqueta="Recepción"
          value={recepcionId}
          onChange={(e) => setRecepcionId(e.target.value)}
          opciones={recepciones.map((r) => ({ value: r.id, label: r.Title }))}
          placeholder="Selecciona una recepción sincronizada…"
        />
      </div>

      {!recepcion && recepciones.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          Todavía no hay ninguna recepción sincronizada en este dispositivo. Sincroniza primero desde la barra
          superior.
        </p>
      )}

      {recepcion && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-4 print:hidden">
            <Dato etiqueta="Fecha" valor={recepcion.FechaRecepcion} />
            <Dato etiqueta="Granja" valor={granja?.Title ?? '—'} />
            <Dato etiqueta="Consecutivo" valor={recepcion.Consecutivo} />
            <Dato etiqueta="Número de orden" valor={recepcion.NumeroOrden} />
          </div>

          {loteCompleto && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 print:hidden">
              <span>
                {esAdmin
                  ? 'Este lote ya está completo. Como Administrador puedes seguir editándolo.'
                  : 'Este lote ya está completo. Solo un Administrador puede editarlo.'}
              </span>
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => void reabrirProceso()}
                  disabled={reabriendo || !navigator.onLine}
                  title="Vuelve a poner este lote 'En proceso' — útil si se cerró antes de tiempo"
                  className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                >
                  {reabriendo ? 'Reabriendo…' : 'Reabrir proceso'}
                </button>
              )}
            </p>
          )}

          {loteCompleto && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setVerReporteInmediato((v) => !v)}
                className="text-xs font-medium text-brand-navy hover:underline print:hidden"
              >
                {verReporteInmediato ? 'Ocultar reporte del lote' : 'Ver reporte del lote (para enviar al asociado)'}
              </button>
              {verReporteInmediato && (
                <div className="mt-3 print:mt-0">
                  <div className="mb-2 flex justify-end print:hidden">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="text-xs font-medium text-brand-navy hover:underline"
                    >
                      Imprimir / Descargar PDF
                    </button>
                  </div>
                  <ReporteDiarioLote
                    recepcion={recepcion}
                    asociadoNombre={asociado?.Title ?? '—'}
                    granjaNombre={granja?.Title ?? '—'}
                    placa={vehiculo?.Title ?? '—'}
                    tiquetes={tiquetes}
                  />
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-500">
              {tiquetes.length} animal{tiquetes.length === 1 ? '' : 'es'} con novedad en este lote
            </p>
            <div className="flex items-center gap-3">
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => void regenerarTiquetes()}
                  disabled={regenerando || !navigator.onLine}
                  title="Vuelve a intentar crear los tiquetes de esta Recepción — útil si quedó Sincronizada pero sin tiquetes por un error de sincronización"
                  className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                >
                  {regenerando ? 'Generando…' : 'Volver a generar tiquetes'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void actualizar()}
                disabled={actualizando || !navigator.onLine}
                className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
              >
                {actualizando ? 'Actualizando…' : 'Actualizar desde SharePoint'}
              </button>
              {!soloLectura && !loteCompleto && (
                <button
                  type="button"
                  onClick={() => void terminarProceso()}
                  disabled={terminando || !navigator.onLine}
                  title="Marca esta recepción como totalmente gestionada — de ahí en adelante solo un Administrador podrá editar sus tiquetes"
                  className="rounded-md border border-brand-navy px-2.5 py-1 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
                >
                  {terminando ? 'Terminando…' : 'Terminar proceso'}
                </button>
              )}
            </div>
          </div>

          {tiquetes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 print:hidden">Este lote no tiene animales con novedad.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white print:hidden">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Grupo</th>
                    <th className="px-3 py-2">Novedad</th>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Tiquete</th>
                    <th className="px-3 py-2">Destino</th>
                    <th className="px-3 py-2">Factura</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tiquetes.map((t) => (
                    <FilaTiquete
                      key={t.id}
                      tiquete={t}
                      soloLectura={soloLectura}
                      onGuardar={(cambios) => guardarCambio(t, cambios)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className="text-sm font-medium text-slate-700">{valor}</p>
    </div>
  )
}

/**
 * Un tiquete queda "de verdad" completo cuando SharePoint ya lo marcó
 * EstadoTiquete === 'Completo' (eso pasa solo con Tiquete + Destino, ver
 * actualizarTiquete() en src/graph/lists.ts) Y, si es un Fortuito (el único
 * grupo con Factura), también tiene la Factura puesta — sin esta segunda
 * condición, un Fortuito con Tiquete+Destino pero SIN factura ya contaría
 * como completo, aunque a simple vista le falte lo más importante. Se usa
 * solo para lo informativo (la etiqueta "Falta factura" en la tabla, y el
 * aviso de terminarProceso() si se intenta cerrar con tiquetes a medias) —
 * YA NO bloquea la edición por sí solo: ese candado ahora es 100% manual,
 * ver el comentario de soloLectura más arriba.
 */
function tiqueteYaCompletado(t: ConsolidadoTiquete): boolean {
  const esFortuito = t.GrupoNovedad === 'Fortuito'
  return t.EstadoTiquete === 'Completo' && (!esFortuito || Boolean(t.Factura))
}

function FilaTiquete({
  tiquete,
  soloLectura,
  onGuardar,
}: {
  tiquete: ConsolidadoTiquete
  soloLectura: boolean
  onGuardar: (cambios: Partial<ConsolidadoTiquete>) => void
}) {
  const [numeroTiquete, setNumeroTiquete] = useState(tiquete.Tiquete ?? '')
  const [destino, setDestino] = useState<Destino | ''>(tiquete.Destino ?? '')
  const [factura, setFactura] = useState(tiquete.Factura ?? '')

  // Factura solo aplica a Fortuitos (Muerto en Transporte/Desembarque/Reposo) — ver el
  // comentario en el campo Factura de ConsolidadoTiquete en src/types/models.ts.
  const esFortuito = tiquete.GrupoNovedad === 'Fortuito'
  const faltaFactura = tiquete.EstadoTiquete === 'Completo' && esFortuito && !tiquete.Factura
  const completo = tiqueteYaCompletado(tiquete)

  return (
    <tr className={clsx(tiquete.EstadoSync === 'Pendiente' && 'bg-amber-50/60')}>
      <td className="px-3 py-2 text-slate-600">{tiquete.GrupoNovedad}</td>
      <td className="px-3 py-2 text-slate-600">{tiquete.TipoNovedad}</td>
      <td className="px-3 py-2 text-slate-600">{tiquete.NumeroAnimalEnLote}</td>
      <td className="px-3 py-2">
        <input
          value={numeroTiquete}
          disabled={soloLectura}
          onChange={(e) => setNumeroTiquete(e.target.value)}
          onBlur={() => numeroTiquete !== (tiquete.Tiquete ?? '') && onGuardar({ Tiquete: numeroTiquete || undefined })}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
          placeholder="N.º"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={destino}
          disabled={soloLectura}
          onChange={(e) => {
            const nuevo = e.target.value as Destino | ''
            setDestino(nuevo)
            onGuardar({ Destino: nuevo || undefined })
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
        >
          <option value="">—</option>
          <option value="Procesado">Procesado</option>
          <option value="Decomisado">Decomisado</option>
        </select>
      </td>
      <td className="px-3 py-2">
        {esFortuito ? (
          <input
            value={factura}
            disabled={soloLectura}
            onChange={(e) => setFactura(e.target.value)}
            onBlur={() => factura !== (tiquete.Factura ?? '') && onGuardar({ Factura: factura || undefined })}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
            placeholder="N.º factura"
          />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            completo
              ? 'bg-emerald-100 text-emerald-700'
              : faltaFactura
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600',
          )}
        >
          {faltaFactura ? 'Falta factura' : tiquete.EstadoTiquete}
        </span>
        {tiquete.EstadoSync === 'Pendiente' && (
          <span className="ml-1.5 text-xs text-amber-600">sin subir</span>
        )}
      </td>
    </tr>
  )
}
