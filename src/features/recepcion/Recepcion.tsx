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
  RemisionGranja: '',
  QRLote: false,
  CertificadoInmunocastracion: false,
  CoincideGuiaICAvsQR: false,
  NovLlegadaLesionados: false,
  NovLlegadaCaidos: false,
  NovLlegadaAgitados: false,
  FortuitoMuertoTransporte: false,
  FortuitoMuertoDesembarque: false,
  SuciedadCerdos: 'Baja',
  Observaciones: '',
}

/**
 * Formulario de referencia de la app: los otros dos (Ubicación y Novedades
 * en Corral, en src/features/ubicacion y src/features/novedades-corral)
 * siguen exactamente este mismo patrón con menos campos — react-hook-form +
 * zodResolver para validar, un id local (crypto.randomUUID()) para poder
 * guardar sin conexión, y sincronizar() disparada sin esperarla si hay
 * internet en ese momento.
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
          <CampoTexto type="number" step="0.1" etiqueta="Peso promedio en granja (kg)" requerido {...register('PesoPromedioGranja')} error={errors.PesoPromedioGranja?.message} />
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
          <CampoTexto etiqueta="Guía sanitaria ICA" requerido {...register('GuiaSanitariaICA')} error={errors.GuiaSanitariaICA?.message} />
          <CampoTexto etiqueta="Remisión de granja" requerido {...register('RemisionGranja')} error={errors.RemisionGranja?.message} />
          <CampoCheckbox etiqueta="Tiene QR de lote" {...register('QRLote')} />
          <CampoCheckbox etiqueta="Tiene certificado de inmunocastración" {...register('CertificadoInmunocastracion')} />
          <CampoCheckbox etiqueta="La guía ICA coincide con el QR" {...register('CoincideGuiaICAvsQR')} />
        </SeccionFormulario>

        <SeccionFormulario titulo="Novedad de llegada">
          <div className="space-y-2">
            <CampoCheckbox etiqueta="Lesionado" {...register('NovLlegadaLesionados')} />
            {watch('NovLlegadaLesionados') && (
              <CampoTexto type="number" step="1" etiqueta="Cantidad lesionados" {...register('NovLlegadaCantLesionados')} error={errors.NovLlegadaCantLesionados?.message} />
            )}
          </div>
          <div className="space-y-2">
            <CampoCheckbox etiqueta="Caído" {...register('NovLlegadaCaidos')} />
            {watch('NovLlegadaCaidos') && (
              <CampoTexto type="number" step="1" etiqueta="Cantidad caídos" {...register('NovLlegadaCantCaidos')} error={errors.NovLlegadaCantCaidos?.message} />
            )}
          </div>
          <div className="space-y-2">
            <CampoCheckbox etiqueta="Agitado" {...register('NovLlegadaAgitados')} />
            {watch('NovLlegadaAgitados') && (
              <CampoTexto type="number" step="1" etiqueta="Cantidad agitados" {...register('NovLlegadaCantAgitados')} error={errors.NovLlegadaCantAgitados?.message} />
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
