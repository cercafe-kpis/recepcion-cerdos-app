import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import clsx from 'clsx'

/**
 * Envoltorios de campo compartidos por los 3 formularios de captura
 * (Recepción, Ubicación, Novedades en Corral). Son componentes "tontos": no
 * saben nada de react-hook-form, solo reciben las props que devuelve
 * `register(...)` y muestran el mensaje de error debajo. Así los tres
 * formularios se ven y se comportan igual sin repetir el marcado de cada
 * campo — para agregar un campo nuevo basta con seguir el mismo patrón que
 * los que ya existen en src/features/recepcion/Recepcion.tsx.
 */

function Etiqueta({ children, requerido }: { children: ReactNode; requerido?: boolean }) {
  return (
    <label className="mb-1 block text-sm font-medium text-slate-700">
      {children}
      {requerido && <span className="text-brand-red"> *</span>}
    </label>
  )
}

function MensajeError({ mensaje }: { mensaje?: string }) {
  if (!mensaje) return null
  return <p className="mt-1 text-xs text-brand-red">{mensaje}</p>
}

const claseInput =
  'block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy'

type PropsCampoTexto = InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string
  requerido?: boolean
  error?: string
}

export const CampoTexto = forwardRef<HTMLInputElement, PropsCampoTexto>(function CampoTexto(
  { etiqueta, requerido, error, className, ...resto },
  ref,
) {
  return (
    <div>
      <Etiqueta requerido={requerido}>{etiqueta}</Etiqueta>
      <input ref={ref} className={clsx(claseInput, className)} {...resto} />
      <MensajeError mensaje={error} />
    </div>
  )
})

type PropsCampoSelect = SelectHTMLAttributes<HTMLSelectElement> & {
  etiqueta: string
  requerido?: boolean
  error?: string
  opciones: Array<{ value: string; label: string }>
  placeholder?: string
}

export const CampoSelect = forwardRef<HTMLSelectElement, PropsCampoSelect>(function CampoSelect(
  { etiqueta, requerido, error, opciones, placeholder, className, ...resto },
  ref,
) {
  return (
    <div>
      <Etiqueta requerido={requerido}>{etiqueta}</Etiqueta>
      <select ref={ref} className={clsx(claseInput, 'bg-white', className)} {...resto}>
        <option value="">{placeholder ?? 'Selecciona…'}</option>
        {opciones.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>
      <MensajeError mensaje={error} />
    </div>
  )
})

type PropsCampoCheckbox = InputHTMLAttributes<HTMLInputElement> & { etiqueta: string }

export const CampoCheckbox = forwardRef<HTMLInputElement, PropsCampoCheckbox>(function CampoCheckbox(
  { etiqueta, className, ...resto },
  ref,
) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input
        ref={ref}
        type="checkbox"
        className={clsx('h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy', className)}
        {...resto}
      />
      {etiqueta}
    </label>
  )
})

/** Título de sección dentro de un formulario largo (p. ej. "Novedades de llegada" dentro de Recepción). */
export function SeccionFormulario({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-semibold text-brand-navy">{titulo}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}
