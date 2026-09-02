import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../offline/db'
import { sincronizar } from '../../offline/syncService'
import { CampoCheckbox, CampoSelect, CampoTexto, SeccionFormulario } from '../../components/CamposFormulario'
import { novedadCorralSchema, type NovedadCorralFormInput, type NovedadCorralFormValues } from './novedadCorralSchema'
import type { NovedadCorral, Usuario } from '../../types/models'

const VALORES_INICIALES: NovedadCorralFormInput = {
  RecepcionId: '',
  MuertoReposo: false,
  ComportamientoSexual: false,
  DisponibilidadAgua: true,
}

/** Sigue el mismo patrón que src/features/recepcion/Recepcion.tsx — ver los comentarios allí. */
export function NovedadesCorral({ usuario }: { usuario: Usuario }) {
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string>()

  const recepciones = useLiveQuery(() => db.recepciones.orderBy('CapturadaEn').reverse().toArray(), []) ?? []

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<NovedadCorralFormInput, unknown, NovedadCorralFormValues>({
    resolver: zodResolver(novedadCorralSchema),
    defaultValues: VALORES_INICIALES,
  })

  async function onSubmit(valores: NovedadCorralFormValues) {
    setGuardando(true)
    setMensaje(undefined)
    try {
      const registro: NovedadCorral = {
        ...valores,
        id: crypto.randomUUID(),
        EstadoSync: 'Pendiente',
        CapturadaEn: new Date().toISOString(),
      }
      await db.novedadesCorral.put(registro)
      reset(VALORES_INICIALES)
      setMensaje('Novedad de corral guardada en este dispositivo.')

      if (navigator.onLine) {
        void sincronizar(usuario.Correo)
      }
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Novedades en Corral</h1>
      <p className="mt-1 text-sm text-slate-500">Registra lo observado durante el reposo del lote en corral.</p>

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
        </SeccionFormulario>

        <SeccionFormulario titulo="Observaciones en corral">
          <div className="space-y-2">
            <CampoCheckbox etiqueta="Muerto en reposo" {...register('MuertoReposo')} />
            {watch('MuertoReposo') && (
              <CampoTexto
                type="number"
                step="1"
                etiqueta="Cantidad muertos en reposo"
                {...register('CantMuertoReposo')}
                error={errors.CantMuertoReposo?.message}
              />
            )}
          </div>
          <CampoCheckbox etiqueta="Comportamiento sexual atípico" {...register('ComportamientoSexual')} />
          <CampoCheckbox etiqueta="Hay disponibilidad de agua" {...register('DisponibilidadAgua')} />
        </SeccionFormulario>

        <button
          type="submit"
          disabled={isSubmitting || guardando}
          className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar novedad'}
        </button>
      </form>
    </div>
  )
}
