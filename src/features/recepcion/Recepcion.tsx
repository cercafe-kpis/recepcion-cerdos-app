import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../offline/db'
import { sincronizar } from '../../offline/syncService'
import { CampoCheckbox, CampoSelect, CampoTexto, SeccionFormulario } from '../../components/CamposFormulario'
import { recepcionSchema, type RecepcionFormInput, type RecepcionFormValues } from './recepcionSchema'
import type { Recepcion as RecepcionModelo, Usuario } from '../../types/models'

/**
 * Las 3 horas obligatorias del formulario (HoraProgramada/HoraLlegadaVehiculo) y las 2 horas
 * opcionales (HoraInicioDesembarque/HoraFinalDesembarque, ver el comentario junto a ellas más abajo)
 * son columnas "Fecha y hora" en SharePoint — no existe un tipo "solo hora" ahí — así que hay que
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
 * Pantalla de Recepción — formulario de referencia de la app: los otros dos (Ubicación y Novedades
 * en Corral, en src/features/ubicacion y src/features/novedades-corral) siguen exactamente este
 * mismo patrón con menos campos — react-hook-form + zodResolver para validar, un id local
 * (crypto.randomUUID()) para poder guardar sin conexión, y sincronizar() disparada sin esperarla si
 * hay internet en ese momento.
 *
 * NOTA HISTÓRICA (2026-09-11): entre la cuarta y la octava ronda de esa fecha esta pantalla tuvo una
 * segunda pestaña, "Llegada en espera", para registrar un camión que llega y queda esperando en el
 * patio sin desembarcar todavía (ver `LlegadaPendiente`, ya retirado de src/types/models.ts).
 * Nathalia pidió deshacerlo por completo — "el proceso no es así" — porque un lote puede llegar
 * después de la jornada y HoraInicioDesembarque/HoraFinalDesembarque simplemente nunca se van a
 * conocer, no es que se completen después con un botón. El reemplazo, más simple, es dejar esas 2
 * horas como campos opcionales aquí abajo (ver el comentario junto a ellas).
 */
export function Recepcion({ usuario }: { usuario: Usuario }) {
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
    formState: { errors, isSubmitting },
  } = useForm<RecepcionFormInput, unknown, RecepcionFormValues>({
    resolver: zodResolver(recepcionSchema),
    defaultValues: VALORES_INICIALES,
  })

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
        HoraInicioDesembarque: valores.HoraInicioDesembarque
          ? combinarFechaHora(valores.FechaRecepcion, valores.HoraInicioDesembarque)
          : undefined,
        HoraFinalDesembarque: valores.HoraFinalDesembarque
          ? combinarFechaHora(valores.FechaRecepcion, valores.HoraFinalDesembarque)
          : undefined,
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
      <h1 className="text-xl font-semibold text-slate-800">Recepción</h1>
      <p className="mt-1 text-sm text-slate-500">Registra la llegada de un lote de cerdos a la planta.</p>

      {mensaje && (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>
      )}

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="mt-4 space-y-5">
        <SeccionFormulario titulo="Identificación del lote">
          <CampoTexto etiqueta="Consecutivo" requerido {...register('Consecutivo')} error={errors.Consecutivo?.message} />
          <CampoTexto etiqueta="Número de orden" requerido {...register('NumeroOrden')} error={errors.NumeroOrden?.message} />
          <CampoTexto type="date" etiqueta="Fecha de recepción" requerido {...register('FechaRecepcion')} error={errors.FechaRecepcion?.message} />
          <CampoTexto type="time" etiqueta="Hora programada" requerido {...register('HoraProgramada')} error={errors.HoraProgramada?.message} />
          <CampoTexto type="time" etiqueta="Hora de llegada del vehículo" requerido {...register('HoraLlegadaVehiculo')} error={errors.HoraLlegadaVehiculo?.message} />
          {/* Opcionales (revertido a esto 2026-09-11, octava ronda, a pedido de Nathalia): algunos
              lotes llegan después de la jornada y estas 2 horas simplemente nunca se van a conocer.
              Ver el comentario grande junto a estos 2 campos en src/types/models.ts. */}
          <CampoTexto
            type="time"
            etiqueta="Hora de inicio de desembarque"
            ayuda="Opcional — algunos lotes llegan después de la jornada y no se alcanza a registrar esta hora"
            {...register('HoraInicioDesembarque')}
            error={errors.HoraInicioDesembarque?.message}
          />
          <CampoTexto
            type="time"
            etiqueta="Hora final de desembarque"
            ayuda="Opcional — algunos lotes llegan después de la jornada y no se alcanza a registrar esta hora"
            {...register('HoraFinalDesembarque')}
            error={errors.HoraFinalDesembarque?.message}
          />
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
