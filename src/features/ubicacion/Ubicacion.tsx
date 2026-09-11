import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../offline/db'
import { sincronizar } from '../../offline/syncService'
import { buscarRecepcionesPorConsecutivo, listarRecepcionesPorRangoFecha } from '../../graph/lists'
import { CampoCheckbox, CampoSelect, CampoTexto, SeccionFormulario } from '../../components/CamposFormulario'
import { ubicacionSchema, type UbicacionFormInput, type UbicacionFormValues } from './ubicacionSchema'
import type { Ubicacion as UbicacionModelo, Usuario } from '../../types/models'

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Igual que formatearDecimal() en src/features/recepcion/Recepcion.tsx — mismo problema, mismo
 * arreglo: algunos celulares con teclado numérico en español no dejan escribir coma ni punto en un
 * <input type="number"> nativo, así que este campo es type="text" con inputMode="decimal" y esta
 * función normaliza a mano (coma -> punto, descarta lo demás, un solo separador).
 */
function formatearDecimal(valor: string): string {
  const conPunto = valor.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [entero, ...resto] = conPunto.split('.')
  return resto.length > 0 ? `${entero}.${resto.join('')}` : entero
}

const VALORES_INICIALES: UbicacionFormInput = {
  RecepcionId: '',
  PesoPromedioPlanta: 0,
  CorralesDesignados: '',
  CoincidenciaNumAnimales: true,
  Observaciones: '',
}

/** Sigue el mismo patrón que src/features/recepcion/Recepcion.tsx — ver los comentarios allí. */
export function Ubicacion({ usuario }: { usuario: Usuario }) {
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string>()
  const [fechaBusqueda, setFechaBusqueda] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [consecutivoBusqueda, setConsecutivoBusqueda] = useState('')
  const [buscandoConsecutivo, setBuscandoConsecutivo] = useState(false)
  const [errorBusqueda, setErrorBusqueda] = useState<string>()

  // Recepciones capturadas en este dispositivo (con o sin sincronizar), más las que otro
  // dispositivo ya haya sincronizado y sigan "En proceso" — ver descargarRecepcionesEnProceso()
  // en syncService.ts, que las trae de SharePoint apenas hay conexión.
  const recepciones = useLiveQuery(() => db.recepciones.orderBy('CapturadaEn').reverse().toArray(), []) ?? []

  // A pedido de Nathalia (2026-09-09): antes se podía seguir agregando Ubicación a una Recepción
  // ya cerrada con "Terminar proceso" en Consolidado — este formulario no revisaba EstadoLote para
  // nada. Mismo criterio que ya existe en Consolidado.tsx: una vez cerrada, solo un Administrador
  // puede seguir usándola (por ejemplo, para corregir un error) — el resto ni la ve en el selector.
  const esAdmin = usuario.Rol === 'Administrador'
  const recepcionesDisponibles = esAdmin
    ? recepciones
    : recepciones.filter((r) => r.EstadoLote !== 'Completo')

  // A pedido de Nathalia (2026-09-11): mismo criterio que se agregó en Consolidado.tsx — por
  // defecto el desplegable solo muestra los lotes de HOY (crecía cada vez más con los meses), con
  // dos formas de traer cualquier otro: buscar por Consecutivo o por fecha (ver buscarPorConsecutivo
  // y buscarPorFecha más abajo). Las Recepciones que este mismo dispositivo capturó pero todavía no
  // ha alcanzado a sincronizar (EstadoSync !== 'Sincronizada') se dejan SIEMPRE visibles sin
  // importar la fecha: un buscador remoto contra SharePoint nunca las va a encontrar (todavía no
  // tienen spId), así que ocultarlas por fecha las dejaría inalcanzables hasta que sincronicen solas.
  const [idsFueraDeHoy, setIdsFueraDeHoy] = useState<string[]>([])
  const hoy = hoyISO()
  const recepcionesVisibles = useMemo(
    () =>
      recepcionesDisponibles.filter(
        (r) => r.FechaRecepcion === hoy || idsFueraDeHoy.includes(r.id) || r.EstadoSync !== 'Sincronizada',
      ),
    [recepcionesDisponibles, hoy, idsFueraDeHoy],
  )

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<UbicacionFormInput, unknown, UbicacionFormValues>({
    resolver: zodResolver(ubicacionSchema),
    defaultValues: VALORES_INICIALES,
  })

  /**
   * Igual que buscarPorFecha() en Consolidado.tsx — trae de SharePoint las Recepciones
   * sincronizadas de esa fecha exacta (sea cual sea) y las agrega a Dexie de este dispositivo si
   * no estaban, sin pisar nada si ya existían. Si la fecha buscada no es la de hoy, se agrega a
   * idsFueraDeHoy para que no vuelva a desaparecer del desplegable.
   */
  async function buscarPorFecha() {
    if (!fechaBusqueda) return
    setBuscando(true)
    setErrorBusqueda(undefined)
    try {
      const remotas = await listarRecepcionesPorRangoFecha(fechaBusqueda, fechaBusqueda)
      let nuevas = 0
      const idsEncontrados: string[] = []
      for (const rec of remotas) {
        const local = await db.recepciones.where('spId').equals(rec.spId as string).first()
        if (!local) {
          await db.recepciones.put(rec)
          nuevas++
        }
        idsEncontrados.push(local?.id ?? rec.id)
      }
      if (fechaBusqueda !== hoy) {
        setIdsFueraDeHoy((actuales) => [...new Set([...actuales, ...idsEncontrados])])
      }
      if (remotas.length === 0) {
        setErrorBusqueda('No se encontró ninguna Recepción sincronizada con esa fecha.')
      } else if (nuevas === 0) {
        setErrorBusqueda('Las Recepciones de esa fecha ya estaban en este dispositivo — revisa el selector de arriba.')
      }
    } catch (err) {
      setErrorBusqueda(`No se pudo buscar por esa fecha: ${(err as Error).message}`)
    } finally {
      setBuscando(false)
    }
  }

  /**
   * Igual que buscarPorConsecutivo() en Consolidado.tsx — busca por Consecutivo EXACTO sin
   * importar la fecha, y si encuentra exactamente una la selecciona de una vez en el desplegable.
   */
  async function buscarPorConsecutivo() {
    const consecutivo = consecutivoBusqueda.trim()
    if (!consecutivo) return
    setBuscandoConsecutivo(true)
    setErrorBusqueda(undefined)
    try {
      const remotas = await buscarRecepcionesPorConsecutivo(consecutivo)
      if (remotas.length === 0) {
        setErrorBusqueda(`No se encontró ninguna Recepción sincronizada con el Consecutivo "${consecutivo}".`)
        return
      }
      const idsEncontrados: string[] = []
      for (const rec of remotas) {
        const local = await db.recepciones.where('spId').equals(rec.spId as string).first()
        if (!local) await db.recepciones.put(rec)
        idsEncontrados.push(local?.id ?? rec.id)
      }
      setIdsFueraDeHoy((actuales) => [...new Set([...actuales, ...idsEncontrados])])
      if (idsEncontrados.length === 1) {
        setValue('RecepcionId', idsEncontrados[0])
      } else {
        setErrorBusqueda(
          `Se encontraron ${idsEncontrados.length} recepciones con ese Consecutivo — elige cuál es en el desplegable de arriba.`,
        )
      }
    } catch (err) {
      setErrorBusqueda(`No se pudo buscar por Consecutivo: ${(err as Error).message}`)
    } finally {
      setBuscandoConsecutivo(false)
    }
  }

  // Aparte del spread normal de register(...) porque este campo necesita reformatear lo que la
  // persona escribió ANTES de que react-hook-form lo guarde — ver formatearDecimal() arriba.
  const registroPeso = register('PesoPromedioPlanta')

  async function onSubmit(valores: UbicacionFormValues) {
    setGuardando(true)
    setMensaje(undefined)
    try {
      const registro: UbicacionModelo = {
        ...valores,
        id: crypto.randomUUID(),
        EstadoSync: 'Pendiente',
        CapturadaEn: new Date().toISOString(),
      }
      await db.ubicaciones.put(registro)
      reset(VALORES_INICIALES)
      setMensaje('Ubicación guardada en este dispositivo.')

      if (navigator.onLine) {
        void sincronizar(usuario.Correo)
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Ubicación</h1>
      <p className="mt-1 text-sm text-slate-500">Registra dónde quedó ubicado un lote ya recibido.</p>

      {mensaje && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
      {errorBusqueda && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{errorBusqueda}</p>
      )}

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="mt-4 space-y-5">
        <SeccionFormulario titulo="Lote">
          <CampoSelect
            etiqueta="Recepción"
            requerido
            {...register('RecepcionId')}
            error={errors.RecepcionId?.message}
            opciones={recepcionesVisibles.map((r) => ({
              value: r.id,
              label: r.EstadoLote === 'Completo' ? `${r.Title} (cerrada)` : r.Title,
            }))}
            placeholder="Selecciona la recepción…"
          />
          {!esAdmin && recepciones.length !== recepcionesDisponibles.length && (
            <p className="text-xs text-slate-400">
              Las recepciones ya cerradas (con "Terminar proceso" en Consolidado) no aparecen aquí —
              solo un Administrador puede seguir usándolas.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Por defecto solo se ven los lotes de hoy — busca por Consecutivo o por fecha para
            encontrar cualquier otro.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <CampoTexto
                etiqueta="Buscar por Consecutivo"
                ayuda="Encuentra cualquier lote sin importar la fecha en que se recibió"
                value={consecutivoBusqueda}
                onChange={(e) => setConsecutivoBusqueda(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void buscarPorConsecutivo()
                  }
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => void buscarPorConsecutivo()}
              disabled={buscandoConsecutivo || !consecutivoBusqueda.trim() || !navigator.onLine}
              className="rounded-md border border-brand-navy px-3 py-2 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
            >
              {buscandoConsecutivo ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <CampoTexto
                etiqueta="¿No sabes el Consecutivo? Buscar por fecha"
                type="date"
                value={fechaBusqueda}
                onChange={(e) => setFechaBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              />
            </div>
            <button
              type="button"
              onClick={() => void buscarPorFecha()}
              disabled={buscando || !fechaBusqueda || !navigator.onLine}
              className="rounded-md border border-brand-navy px-3 py-2 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
            >
              {buscando ? 'Buscando…' : 'Buscar'}
            </button>
          </div>
          <CampoTexto
            type="text"
            inputMode="decimal"
            placeholder="Ej: 120,15"
            etiqueta="Peso promedio en planta (kg)"
            requerido
            {...registroPeso}
            onChange={(e) => {
              e.target.value = formatearDecimal(e.target.value)
              void registroPeso.onChange(e)
            }}
            error={errors.PesoPromedioPlanta?.message}
          />
          <CampoTexto
            etiqueta="Corrales designados"
            requerido
            {...register('CorralesDesignados')}
            error={errors.CorralesDesignados?.message}
          />
          <CampoCheckbox etiqueta="El número de animales coincide con lo recibido" {...register('CoincidenciaNumAnimales')} />
        </SeccionFormulario>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Observaciones</label>
          <textarea
            {...register('Observaciones')}
            rows={3}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || guardando}
          className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar ubicación'}
        </button>
      </form>
    </div>
  )
}
