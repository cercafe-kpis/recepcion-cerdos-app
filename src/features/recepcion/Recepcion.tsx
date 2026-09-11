import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { sincronizar } from '../../offline/syncService'
import { CampoCheckbox, CampoSelect, CampoTexto, SeccionFormulario } from '../../components/CamposFormulario'
import { buscarLlegadaPendientePorConsecutivo, crearLlegadaPendiente } from '../../graph/lists'
import { recepcionSchema, type RecepcionFormInput, type RecepcionFormValues } from './recepcionSchema'
import type { Recepcion as RecepcionModelo, Usuario } from '../../types/models'

/**
 * Las 3 horas del formulario (HoraLlegadaVehiculo/HoraInicioDesembarque/HoraFinalDesembarque) son
 * columnas "Fecha y hora" en SharePoint — no existe un tipo "solo hora" ahí — así que hay que
 * combinarlas con la fecha de recepción para mandar una fecha-hora completa. Se usa un offset FIJO
 * de -05:00 (Colombia no tiene horario de verano) en vez de `new Date(...).toISOString()`, para que
 * el valor guardado no dependa de cómo tenga configurada la hora el dispositivo que capturó — solo
 * de lo que la persona escribió. El sitio de SharePoint debe quedar configurado con la zona horaria
 * (UTC-05:00) Bogotá, Lima, Quito para que sus propias vistas muestren la hora correcta; la app,
 * como guarda el offset explícito, la muestra bien sin importar esa configuración.
 */
function combinarFechaHora(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00-05:00`
}

/**
 * Fuerza el formato "3 cifras - resto" mientras la persona escribe (ej.
 * "026-445555552"): se queda solo con los dígitos que ya escribió y vuelve a
 * armar el guion en la posición correcta, así que no importa si pegó el
 * número completo, si el teclado le puso algo raro, o si intenta borrar el
 * guion — siempre queda bien. El backstop final es la validación por regex
 * en recepcionSchema.ts.
 */
function formatearGuiaICA(valor: string): string {
  const soloDigitos = valor.replace(/\D/g, '')
  const prefijo = soloDigitos.slice(0, 3)
  const resto = soloDigitos.slice(3)
  return resto ? `${prefijo}-${resto}` : prefijo
}

/**
 * Normaliza lo que la persona escribe como peso en kg para que acepte coma o
 * punto como separador decimal (ej. "120,15" o "120.15") — algunos celulares
 * con teclado numérico en español no dejan escribir la coma ni el punto en un
 * <input type="number"> nativo, por eso este campo es type="text" con
 * inputMode="decimal" y esta función hace la limpieza a mano: cambia coma por
 * punto, quita cualquier otro caracter que no sea dígito o punto, y si queda
 * más de un punto (por ejemplo al pegar texto raro) se queda solo con el
 * primero. z.coerce.number() en recepcionSchema.ts hace el resto al guardar.
 */
function formatearDecimal(valor: string): string {
  const conPunto = valor.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [entero, ...resto] = conPunto.split('.')
  return resto.length > 0 ? `${entero}.${resto.join('')}` : entero
}

const VALORES_INICIALES: RecepcionFormInput = {
  Consecutivo: '',
  NumeroOrden: '',
  FechaRecepcion: new Date().toISOString().slice(0, 10),
  HoraProgramada: '',
  HoraLlegadaVehiculo: '',
  HoraInicioDesembarque: '',
  HoraFinalDesembarque: '',
  AsociadoId: '',
  GranjaId: '',
  NumeroTotalCerdos: 0,
  PesoPromedioGranja: 0,
  PlacaVehiculoId: '',
  GuiaSanitariaICA: '',
  RemisionGranja: 'No',
  QRLote: false,
  CertificadoInmunocastracion: false,
  CoincideGuiaICAvsQR: false,
  NovLlegadaLesionados: false,
  NovLlegadaLesionadosBeneficioEmergencia: false,
  NovLlegadaCaidos: false,
  NovLlegadaCaidosBeneficioEmergencia: false,
  NovLlegadaAgitados: false,
  NovLlegadaAgitadosBeneficioEmergencia: false,
  FortuitoMuertoTransporte: false,
  FortuitoMuertoDesembarque: false,
  SuciedadCerdos: 'Baja',
  Observaciones: '',
}

/**
 * Pantalla de Recepción — dos pestañas (agregada la segunda 2026-09-11, cuarta ronda, a pedido de
 * Nathalia, con el mismo estilo de pestañas que ya usa Reporte.tsx):
 *
 *  - "Recepción completa" (RecepcionCompleta, más abajo): el formulario de siempre, sin cambios.
 *  - "Llegada en espera" (LlegadaEnEspera, más abajo): registro rápido para cuando el camión llega
 *    y queda esperando en el patio sin desembarcar todavía — antes este registro se creaba desde un
 *    botón en la pestaña "Cierre diario" de Reporte.tsx; se movió aquí porque es quien recibe el
 *    camión, no quien arma el cierre del día, quien normalmente sabe estos datos apenas llega. Ver
 *    el comentario grande de LlegadaPendiente en models.ts. "Cierre diario" sigue mostrando y
 *    resolviendo solas estas llegadas — solo dejó de ser quien las crea.
 */
export function Recepcion({ usuario }: { usuario: Usuario }) {
  const [modo, setModo] = useState<'completa' | 'espera'>('completa')

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Recepción</h1>
      <p className="mt-1 text-sm text-slate-500">Registra la llegada de un lote de cerdos a la planta.</p>

      <div className="mt-4 flex gap-1">
        <button
          type="button"
          onClick={() => setModo('completa')}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            modo === 'completa' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
          )}
        >
          Recepción completa
        </button>
        <button
          type="button"
          onClick={() => setModo('espera')}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            modo === 'espera' ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
          )}
        >
          Llegada en espera
        </button>
      </div>

      {modo === 'completa' ? <RecepcionCompleta usuario={usuario} /> : <LlegadaEnEspera usuario={usuario} />}
    </div>
  )
}

/**
 * Formulario de referencia de la app: los otros dos (Ubicación y Novedades
 * en Corral, en src/features/ubicacion y src/features/novedades-corral)
 * siguen exactamente este mismo patrón con menos campos — react-hook-form +
 * zodResolver para validar, un id local (crypto.randomUUID()) para poder
 * guardar sin conexión, y sincronizar() disparada sin esperarla si hay
 * internet en ese momento.
 */
function RecepcionCompleta({ usuario }: { usuario: Usuario }) {
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string>()

  const asociados = useLiveQuery(() => db.asociados.filter((a) => a.Activo).toArray(), []) ?? []
  const granjas = useLiveQuery(() => db.granjas.filter((g) => g.Activa).toArray(), []) ?? []
  const vehiculos = useLiveQuery(() => db.vehiculos.filter((v) => v.Activo).toArray(), []) ?? []

  // Tres genéricos porque el schema usa z.coerce.number(): el primero es el tipo de lo que hay en
  // los <input> (Input, antes de coaccionar), el tercero es lo que recibe onSubmit ya validado y
  // coaccionado (Output) — ver el comentario en recepcionSchema.ts.
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<RecepcionFormInput, unknown, RecepcionFormValues>({
    resolver: zodResolver(recepcionSchema),
    defaultValues: VALORES_INICIALES,
  })

  // "Cargar datos de llegada en espera" (pedido de Nathalia, 2026-09-11, tercera ronda): evita
  // volver a digitar Asociado/Granja/N. Orden/Placa/Hora de llegada cuando ese camión ya se había
  // registrado como "en espera" desde "Cierre diario" (ver LlegadaPendiente en models.ts). A
  // pedido explícito con 3 preguntas: (1) botón aparte, no automático al escribir el Consecutivo —
  // así no dispara búsquedas de más mientras se escribe; (2) solo funciona con conexión, por ahora
  // — igual que "Cierre diario" ya trabaja, sin bajar LlegadasPendientes a Dexie; si no hay señal,
  // simplemente no se auto-completa nada y se sigue llenando a mano como siempre; (3) el registro
  // de LlegadaPendiente NO se borra ni se toca al usarlo — sigue resolviéndose solo en "Cierre
  // diario" en cuanto esta Recepción se sincronice con el mismo Consecutivo.
  const [buscandoLlegada, setBuscandoLlegada] = useState(false)
  const [mensajeLlegada, setMensajeLlegada] = useState<string>()
  const [errorLlegada, setErrorLlegada] = useState<string>()

  async function cargarLlegadaPendiente() {
    const consecutivo = getValues('Consecutivo').trim()
    setMensajeLlegada(undefined)
    setErrorLlegada(undefined)
    if (!consecutivo) {
      setErrorLlegada('Escribe primero el Consecutivo.')
      return
    }
    setBuscandoLlegada(true)
    try {
      const llegada = await buscarLlegadaPendientePorConsecutivo(consecutivo)
      if (!llegada) {
        setMensajeLlegada(`No se encontró ninguna llegada en espera con el Consecutivo "${consecutivo}".`)
        return
      }
      // FechaLlegada/HoraLlegadaVehiculo de LlegadaPendiente son fecha-hora ISO completa (igual que
      // en Recepcion) — se recorta a "YYYY-MM-DD" y "HH:MM" para los <input> de fecha/hora. Se
      // sobrescribe FechaRecepcion (no solo la hora) a propósito: si el camión llegó un día y
      // desembarcó al siguiente, la Recepción debe quedar fechada el día en que de verdad llegó —
      // si no, "Cierre diario" de ese día de llegada nunca encontraría esta Recepción para resolver
      // solo la fila "Pendiente" (ver el comentario de LlegadaPendiente en models.ts).
      setValue('FechaRecepcion', llegada.FechaLlegada.slice(0, 10))
      setValue('HoraLlegadaVehiculo', llegada.HoraLlegadaVehiculo.slice(11, 16))
      setValue('AsociadoId', llegada.AsociadoId)
      setValue('GranjaId', llegada.GranjaId)
      if (llegada.NumeroOrden) setValue('NumeroOrden', llegada.NumeroOrden)
      if (llegada.PlacaVehiculoId) setValue('PlacaVehiculoId', llegada.PlacaVehiculoId)
      setMensajeLlegada('Datos de la llegada en espera cargados — revisa y completa el resto del formulario.')
    } catch (err) {
      setErrorLlegada(`No se pudo buscar: ${(err as Error).message}`)
    } finally {
      setBuscandoLlegada(false)
    }
  }

  // Se capturan aparte (en vez de solo hacer spread de register(...) en el <input>) porque estos
  // dos campos necesitan reformatear lo que la persona escribió ANTES de que react-hook-form lo
  // guarde — ver formatearGuiaICA() y formatearDecimal() arriba.
  const registroGuiaICA = register('GuiaSanitariaICA')
  const registroPeso = register('PesoPromedioGranja')

  const asociadoSeleccionado = watch('AsociadoId')
  const granjasDelAsociado = useMemo(
    () => (asociadoSeleccionado ? granjas.filter((g) => g.AsociadoId === asociadoSeleccionado) : granjas),
    [granjas, asociadoSeleccionado],
  )

  async function onSubmit(valores: RecepcionFormValues) {
    setGuardando(true)
    setMensaje(undefined)
    try {
      const registro: RecepcionModelo = {
        ...valores,
        id: crypto.randomUUID(),
        Title: `${valores.Consecutivo} · ${valores.FechaRecepcion}`,
        HoraProgramada: combinarFechaHora(valores.FechaRecepcion, valores.HoraProgramada),
        HoraLlegadaVehiculo: combinarFechaHora(valores.FechaRecepcion, valores.HoraLlegadaVehiculo),
        HoraInicioDesembarque: combinarFechaHora(valores.FechaRecepcion, valores.HoraInicioDesembarque),
        HoraFinalDesembarque: combinarFechaHora(valores.FechaRecepcion, valores.HoraFinalDesembarque),
        EstadoLote: 'En proceso',
        // Se marca aparte, al final del día, desde la pestaña "Cierre diario" de Reporte.tsx — ver
        // el comentario de BeneficiadoMismoDia en models.ts.
        BeneficiadoMismoDia: false,
        EstadoSync: 'Pendiente',
        CapturadaEn: new Date().toISOString(),
        // Se guarda solo, sin pedirlo en el formulario — es el "Encargado" del reporte diario por
        // lote (ver ReporteDiarioLote.tsx): la persona que registra la Recepción en la app.
        CapturadoPor: usuario.Title,
      }
      await db.recepciones.put(registro)
      reset(VALORES_INICIALES)
      setMensaje('Recepción guardada en este dispositivo.')

      if (navigator.onLine) {
        void sincronizar(usuario.Correo) // no bloquea: la captura ya quedó guardada localmente
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      {mensaje && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>
      )}

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="mt-4 space-y-5">
        <SeccionFormulario titulo="Identificación del lote">
          <CampoTexto etiqueta="Consecutivo" requerido {...register('Consecutivo')} error={errors.Consecutivo?.message} />
          <CampoTexto etiqueta="Número de orden" requerido {...register('NumeroOrden')} error={errors.NumeroOrden?.message} />
          <div className="sm:col-span-2 -mt-2">
            <button
              type="button"
              onClick={() => void cargarLlegadaPendiente()}
              disabled={buscandoLlegada || !navigator.onLine}
              title={navigator.onLine ? undefined : 'Sin conexión — no se puede buscar'}
              className="rounded-md border border-brand-navy px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
            >
              {buscandoLlegada ? 'Buscando…' : 'Cargar datos de llegada en espera'}
            </button>
            <p className="mt-1 text-xs text-slate-400">
              Si este camión ya quedó registrado como "en espera" en Cierre diario, escribe su Consecutivo arriba y
              toca este botón para traer Asociado, Granja, N.° de orden, Placa y Hora de llegada sin volver a
              digitarlos.
            </p>
            {mensajeLlegada && <p className="mt-1 text-xs text-emerald-600">{mensajeLlegada}</p>}
            {errorLlegada && <p className="mt-1 text-xs text-brand-red">{errorLlegada}</p>}
          </div>
          <CampoTexto type="date" etiqueta="Fecha de recepción" requerido {...register('FechaRecepcion')} error={errors.FechaRecepcion?.message} />
          <CampoTexto type="time" etiqueta="Hora programada" requerido {...register('HoraProgramada')} error={errors.HoraProgramada?.message} />
          <CampoTexto type="time" etiqueta="Hora de llegada del vehículo" requerido {...register('HoraLlegadaVehiculo')} error={errors.HoraLlegadaVehiculo?.message} />
          <CampoTexto type="time" etiqueta="Hora de inicio de desembarque" requerido {...register('HoraInicioDesembarque')} error={errors.HoraInicioDesembarque?.message} />
          <CampoTexto type="time" etiqueta="Hora final de desembarque" requerido {...register('HoraFinalDesembarque')} error={errors.HoraFinalDesembarque?.message} />
        </SeccionFormulario>

        <SeccionFormulario titulo="Origen">
          <CampoSelect
            etiqueta="Asociado"
            requerido
            {...register('AsociadoId')}
            error={errors.AsociadoId?.message}
            opciones={asociados.map((a) => ({ value: a.id, label: a.Title }))}
          />
          <CampoSelect
            etiqueta="Granja"
            requerido
            {...register('GranjaId')}
            error={errors.GranjaId?.message}
            opciones={granjasDelAsociado.map((g) => ({ value: g.id, label: g.Title }))}
          />
          <CampoSelect
            etiqueta="Placa del vehículo"
            requerido
            {...register('PlacaVehiculoId')}
            error={errors.PlacaVehiculoId?.message}
            opciones={vehiculos.map((v) => ({ value: v.id, label: v.Title }))}
          />
          <CampoTexto type="number" step="1" etiqueta="Número total de cerdos" requerido {...register('NumeroTotalCerdos')} error={errors.NumeroTotalCerdos?.message} />
          <CampoTexto
            type="text"
            inputMode="decimal"
            placeholder="Ej: 120,15"
            etiqueta="Peso promedio en granja (kg)"
            requerido
            {...registroPeso}
            onChange={(e) => {
              e.target.value = formatearDecimal(e.target.value)
              void registroPeso.onChange(e)
            }}
            error={errors.PesoPromedioGranja?.message}
          />
          <CampoSelect
            etiqueta="Suciedad de los cerdos"
            requerido
            {...register('SuciedadCerdos')}
            error={errors.SuciedadCerdos?.message}
            opciones={[
              { value: 'Alta', label: 'Alta' },
              { value: 'Baja', label: 'Baja' },
            ]}
          />
        </SeccionFormulario>

        <SeccionFormulario titulo="Documentos">
          <CampoTexto
            inputMode="numeric"
            placeholder="026-445555552"
            etiqueta="Guía sanitaria ICA"
            requerido
            {...registroGuiaICA}
            onChange={(e) => {
              e.target.value = formatearGuiaICA(e.target.value)
              void registroGuiaICA.onChange(e)
            }}
            error={errors.GuiaSanitariaICA?.message}
          />
          <CampoSelect
            etiqueta="Remisión de granja"
            requerido
            {...register('RemisionGranja')}
            error={errors.RemisionGranja?.message}
            opciones={[
              { value: 'Sí', label: 'Sí' },
              { value: 'No', label: 'No' },
            ]}
          />
          <CampoCheckbox etiqueta="Tiene QR de lote" {...register('QRLote')} />
          <CampoCheckbox etiqueta="Tiene certificado de inmunocastración" {...register('CertificadoInmunocastracion')} />
          <CampoCheckbox etiqueta="La guía ICA coincide con el QR" {...register('CoincideGuiaICAvsQR')} />
        </SeccionFormulario>

        <SeccionFormulario titulo="Novedad de llegada">
          {/* sm:col-span-2 saca cada novedad de la grilla de 2 columnas que usa SeccionFormulario
              y la vuelve una tarjeta propia de ancho completo — antes, con la grilla, "Caído" y
              "Agitado" podían terminar visualmente pegados debajo de "Lesionado" apenas este se
              expandía (checkbox + cantidad + beneficio de emergencia), dando la impresión de que
              una novedad estaba anidada dentro de otra. */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <CampoCheckbox etiqueta="Lesionado" {...register('NovLlegadaLesionados')} />
            {watch('NovLlegadaLesionados') && (
              <>
                <CampoTexto type="number" step="1" etiqueta="Cantidad lesionados" {...register('NovLlegadaCantLesionados')} error={errors.NovLlegadaCantLesionados?.message} />
                <CampoCheckbox etiqueta="¿Alguno se benefició de emergencia por la lesión? (no se recuperó)" {...register('NovLlegadaLesionadosBeneficioEmergencia')} />
                {watch('NovLlegadaLesionadosBeneficioEmergencia') && (
                  <CampoTexto
                    type="number"
                    step="1"
                    etiqueta="Cantidad beneficiados de emergencia por lesión"
                    {...register('NovLlegadaCantLesionadosBeneficioEmergencia')}
                    error={errors.NovLlegadaCantLesionadosBeneficioEmergencia?.message}
                  />
                )}
              </>
            )}
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <CampoCheckbox etiqueta="Caído" {...register('NovLlegadaCaidos')} />
            {watch('NovLlegadaCaidos') && (
              <>
                <CampoTexto type="number" step="1" etiqueta="Cantidad caídos" {...register('NovLlegadaCantCaidos')} error={errors.NovLlegadaCantCaidos?.message} />
                <CampoCheckbox etiqueta="¿Alguno se benefició de emergencia por la caída? (no se recuperó)" {...register('NovLlegadaCaidosBeneficioEmergencia')} />
                {watch('NovLlegadaCaidosBeneficioEmergencia') && (
                  <CampoTexto
                    type="number"
                    step="1"
                    etiqueta="Cantidad beneficiados de emergencia por caída"
                    {...register('NovLlegadaCantCaidosBeneficioEmergencia')}
                    error={errors.NovLlegadaCantCaidosBeneficioEmergencia?.message}
                  />
                )}
              </>
            )}
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <CampoCheckbox etiqueta="Agitado" {...register('NovLlegadaAgitados')} />
            {watch('NovLlegadaAgitados') && (
              <>
                <CampoTexto type="number" step="1" etiqueta="Cantidad agitados" {...register('NovLlegadaCantAgitados')} error={errors.NovLlegadaCantAgitados?.message} />
                <CampoCheckbox etiqueta="¿Alguno se benefició de emergencia por estar agitado? (no se recuperó)" {...register('NovLlegadaAgitadosBeneficioEmergencia')} />
                {watch('NovLlegadaAgitadosBeneficioEmergencia') && (
                  <CampoTexto
                    type="number"
                    step="1"
                    etiqueta="Cantidad beneficiados de emergencia por agitación"
                    {...register('NovLlegadaCantAgitadosBeneficioEmergencia')}
                    error={errors.NovLlegadaCantAgitadosBeneficioEmergencia?.message}
                  />
                )}
              </>
            )}
          </div>
        </SeccionFormulario>

        <SeccionFormulario titulo="Fortuitos">
          <div className="space-y-2">
            <CampoCheckbox etiqueta="Muerto en transporte" {...register('FortuitoMuertoTransporte')} />
            {watch('FortuitoMuertoTransporte') && (
              <CampoTexto type="number" step="1" etiqueta="Cantidad muertos en transporte" {...register('FortuitoCantMuertoTransporte')} error={errors.FortuitoCantMuertoTransporte?.message} />
            )}
          </div>
          <div className="space-y-2">
            <CampoCheckbox etiqueta="Muerto en desembarque" {...register('FortuitoMuertoDesembarque')} />
            {watch('FortuitoMuertoDesembarque') && (
              <CampoTexto type="number" step="1" etiqueta="Cantidad muertos en desembarque" {...register('FortuitoCantMuertoDesembarque')} error={errors.FortuitoCantMuertoDesembarque?.message} />
            )}
          </div>
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
          {guardando ? 'Guardando…' : 'Guardar recepción'}
        </button>
      </form>
    </div>
  )
}

const VALORES_INICIALES_ESPERA = {
  hora: '',
  asociadoId: '',
  granjaId: '',
  consecutivo: '',
  numeroOrden: '',
  placaId: '',
  guiaSanitariaICA: '',
  numeroTotalCerdos: '',
}

/**
 * "Llegada en espera" — pestaña de Recepcion.tsx (movida aquí 2026-09-11, cuarta ronda; antes era
 * el botón "+ Registrar llegada en espera" dentro de "Cierre diario" en Reporte.tsx — ver el
 * comentario grande de Recepcion() arriba y el de LlegadaPendiente en models.ts). Registro rápido,
 * SOLO EN LÍNEA (igual que crearLlegadaPendiente() en graph/lists.ts), para cuando el camión llega
 * y queda esperando en el patio sin desembarcar todavía: guarda solo lo que ya se sabe en ese
 * momento y NO reemplaza la Recepción completa — cuando el desembarque termine, esta misma persona
 * (u otra) sigue llenando "Recepción completa" como siempre, y ahí puede tocar "Cargar datos de
 * llegada en espera" con el mismo Consecutivo para traer lo ya digitado aquí sin repetirlo.
 *
 * A diferencia de Recepción completa, la fecha NO se pide — siempre es HOY (`FechaLlegada`), porque
 * este registro es para el camión que está llegando en este momento, nunca para capturar algo
 * atrasado de otro día.
 */
function LlegadaEnEspera({ usuario }: { usuario: Usuario }) {
  const asociados = useLiveQuery(() => db.asociados.filter((a) => a.Activo).toArray(), []) ?? []
  const granjas = useLiveQuery(() => db.granjas.filter((g) => g.Activa).toArray(), []) ?? []
  const vehiculos = useLiveQuery(() => db.vehiculos.filter((v) => v.Activo).toArray(), []) ?? []

  const [form, setForm] = useState(VALORES_INICIALES_ESPERA)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string>()
  const [error, setError] = useState<string>()

  const granjasDelAsociado = useMemo(
    () => (form.asociadoId ? granjas.filter((g) => g.AsociadoId === form.asociadoId) : granjas),
    [granjas, form.asociadoId],
  )

  async function guardar() {
    if (guardando) return
    setMensaje(undefined)
    setError(undefined)
    if (!form.hora || !form.asociadoId || !form.granjaId || !form.consecutivo.trim()) {
      setError('Completa hora de llegada, asociado, granja y consecutivo.')
      return
    }
    setGuardando(true)
    try {
      const hoy = new Date().toISOString().slice(0, 10)
      await crearLlegadaPendiente({
        FechaLlegada: hoy,
        HoraLlegadaVehiculo: combinarFechaHora(hoy, form.hora),
        AsociadoId: form.asociadoId,
        GranjaId: form.granjaId,
        Consecutivo: form.consecutivo.trim(),
        NumeroOrden: form.numeroOrden.trim() || undefined,
        PlacaVehiculoId: form.placaId || undefined,
        GuiaSanitariaICA: form.guiaSanitariaICA.trim() || undefined,
        NumeroTotalCerdos: form.numeroTotalCerdos.trim() ? Number(form.numeroTotalCerdos) : undefined,
        CapturadoPor: usuario.Title,
      })
      setForm(VALORES_INICIALES_ESPERA)
      setMensaje('Llegada en espera guardada — aparecerá en "Cierre diario" hasta que se complete la Recepción.')
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      {mensaje && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 space-y-5">
        <SeccionFormulario titulo="Datos conocidos al llegar">
          <CampoTexto
            type="time"
            etiqueta="Hora de llegada"
            requerido
            value={form.hora}
            onChange={(e) => setForm((actual) => ({ ...actual, hora: e.target.value }))}
          />
          <CampoTexto
            etiqueta="Consecutivo"
            requerido
            value={form.consecutivo}
            onChange={(e) => setForm((actual) => ({ ...actual, consecutivo: e.target.value }))}
          />
          <CampoSelect
            etiqueta="Asociado"
            requerido
            value={form.asociadoId}
            onChange={(e) => setForm((actual) => ({ ...actual, asociadoId: e.target.value, granjaId: '' }))}
            opciones={asociados.map((a) => ({ value: a.id, label: a.Title }))}
          />
          <CampoSelect
            etiqueta="Granja"
            requerido
            value={form.granjaId}
            onChange={(e) => setForm((actual) => ({ ...actual, granjaId: e.target.value }))}
            opciones={granjasDelAsociado.map((g) => ({ value: g.id, label: g.Title }))}
          />
          <CampoTexto
            etiqueta="Número de orden"
            ayuda="Opcional — si ya se sabe"
            value={form.numeroOrden}
            onChange={(e) => setForm((actual) => ({ ...actual, numeroOrden: e.target.value }))}
          />
          <CampoSelect
            etiqueta="Placa del vehículo"
            placeholder="Si ya se sabe…"
            value={form.placaId}
            onChange={(e) => setForm((actual) => ({ ...actual, placaId: e.target.value }))}
            opciones={vehiculos.map((v) => ({ value: v.id, label: v.Title }))}
          />
          <CampoTexto
            inputMode="numeric"
            placeholder="026-445555552"
            etiqueta="Guía sanitaria ICA"
            ayuda="Opcional — si ya se sabe"
            value={form.guiaSanitariaICA}
            onChange={(e) => setForm((actual) => ({ ...actual, guiaSanitariaICA: formatearGuiaICA(e.target.value) }))}
          />
          <CampoTexto
            type="number"
            step="1"
            etiqueta="Número total de cerdos"
            ayuda="Opcional — si ya se sabe"
            value={form.numeroTotalCerdos}
            onChange={(e) => setForm((actual) => ({ ...actual, numeroTotalCerdos: e.target.value }))}
          />
        </SeccionFormulario>

        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando || !navigator.onLine}
          title={navigator.onLine ? undefined : 'Sin conexión — no se puede guardar'}
          className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar llegada en espera'}
        </button>
      </div>
    </div>
  )
}
