import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../offline/db'
import { sincronizar } from '../../offline/syncService'
import { CampoCheckbox, CampoSelect, CampoTexto, SeccionFormulario } from '../../components/CamposFormulario'
import { ubicacionSchema, type UbicacionFormInput, type UbicacionFormValues } from './ubicacionSchema'
import type { Ubicacion as UbicacionModelo, Usuario } from '../../types/models'

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

  // Recepciones capturadas en este dispositivo (con o sin sincronizar), más las que otro
  // dispositivo ya haya sincronizado y sigan "En proceso" — ver descargarRecepcionesEnProceso()
  // en syncService.ts, que las trae de SharePoint apenas hay conexión.
  const recepciones = useLiveQuery(() => db.recepciones.orderBy('CapturadaEn').reverse().toArray(), []) ?? []

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UbicacionFormInput, unknown, UbicacionFormValues>({
    resolver: zodResolver(ubicacionSchema),
    defaultValues: VALORES_INICIALES,
  })

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

      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="mt-4 space-y-5">
        <SeccionFormulario titulo="Lote">
          <CampoSelect
            etiqueta="Recepción"
            requerido
            {...register('RecepcionId')}
            error={errors.RecepcionId?.message}
            opciones={recepciones.map((r) => ({ value: r.id, label: r.Title }))}
            placeholder="Selecciona la recepción…"
          />
          <CampoTexto
            type="number"
            step="0.1"
            etiqueta="Peso promedio en planta (kg)"
            requerido
            {...register('PesoPromedioPlanta')}
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
