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
  CorralLesionados: false,
  CorralLesionadosBenefEmerg: false,
  CorralCaidos: false,
  CorralCaidosBenefEmerg: false,
  CorralAgitados: false,
  CorralAgitadosBenefEmerg: false,
}

/** Sigue el mismo patrón que src/features/recepcion/Recepcion.tsx — ver los comentarios allí. */
export function NovedadesCorral({ usuario }: { usuario: Usuario }) {
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string>()

  const recepciones = useLiveQuery(() => db.recepciones.orderBy('CapturadaEn').reverse().toArray(), []) ?? []

  // A pedido de Nathalia (2026-09-09): mismo candado que se agregó en Ubicacion.tsx — ver el
  // comentario ahí. Antes se podía seguir agregando Novedades en Corral a una Recepción ya cerrada
  // con "Terminar proceso" en Consolidado, sin ningún aviso.
  const esAdmin = usuario.Rol === 'Administrador'
  const recepcionesDisponibles = esAdmin
    ? recepciones
    : recepciones.filter((r) => r.EstadoLote !== 'Completo')

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
            opciones={recepcionesDisponibles.map((r) => ({
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

        {/* Mismo patrón que "Novedad de llegada" en src/features/recepcion/Recepcion.tsx: checkbox +
            cantidad, y si hubo alguno que no se recuperó y tocó beneficiar de emergencia, checkbox +
            cantidad de eso también — esa segunda cantidad es la que genera tiquete en Consolidado
            (ver generarTiquetesNovedadCorral() en src/graph/lists.ts), con GrupoNovedad "Novedad en
            corral" para distinguirlo de una novedad reportada en Recepción. sm:col-span-2 por la
            misma razón que allá: evita que dos novedades expandidas queden visualmente pegadas. */}
        <SeccionFormulario titulo="Novedad en corral">
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <CampoCheckbox etiqueta="Lesionado" {...register('CorralLesionados')} />
            {watch('CorralLesionados') && (
              <>
                <CampoTexto type="number" step="1" etiqueta="Cantidad lesionados" {...register('CorralCantLesionados')} error={errors.CorralCantLesionados?.message} />
                <CampoCheckbox etiqueta="¿Alguno se benefició de emergencia por la lesión? (no se recuperó)" {...register('CorralLesionadosBenefEmerg')} />
                {watch('CorralLesionadosBenefEmerg') && (
                  <CampoTexto
                    type="number"
                    step="1"
                    etiqueta="Cantidad beneficiados de emergencia por lesión"
                    {...register('CorralCantLesionadosBenefEmerg')}
                    error={errors.CorralCantLesionadosBenefEmerg?.message}
                  />
                )}
              </>
            )}
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <CampoCheckbox etiqueta="Caído" {...register('CorralCaidos')} />
            {watch('CorralCaidos') && (
              <>
                <CampoTexto type="number" step="1" etiqueta="Cantidad caídos" {...register('CorralCantCaidos')} error={errors.CorralCantCaidos?.message} />
                <CampoCheckbox etiqueta="¿Alguno se benefició de emergencia por la caída? (no se recuperó)" {...register('CorralCaidosBenefEmerg')} />
                {watch('CorralCaidosBenefEmerg') && (
                  <CampoTexto
                    type="number"
                    step="1"
                    etiqueta="Cantidad beneficiados de emergencia por caída"
                    {...register('CorralCantCaidosBenefEmerg')}
                    error={errors.CorralCantCaidosBenefEmerg?.message}
                  />
                )}
              </>
            )}
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:col-span-2">
            <CampoCheckbox etiqueta="Agitado" {...register('CorralAgitados')} />
            {watch('CorralAgitados') && (
              <>
                <CampoTexto type="number" step="1" etiqueta="Cantidad agitados" {...register('CorralCantAgitados')} error={errors.CorralCantAgitados?.message} />
                <CampoCheckbox etiqueta="¿Alguno se benefició de emergencia por estar agitado? (no se recuperó)" {...register('CorralAgitadosBenefEmerg')} />
                {watch('CorralAgitadosBenefEmerg') && (
                  <CampoTexto
                    type="number"
                    step="1"
                    etiqueta="Cantidad beneficiados de emergencia por agitación"
                    {...register('CorralCantAgitadosBenefEmerg')}
                    error={errors.CorralCantAgitadosBenefEmerg?.message}
                  />
                )}
              </>
            )}
          </div>
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
