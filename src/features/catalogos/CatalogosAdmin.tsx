import { useState } from 'react'
import clsx from 'clsx'
import { AsociadosAdmin } from './AsociadosAdmin'
import { GranjasAdmin } from './GranjasAdmin'
import { VehiculosAdmin } from './VehiculosAdmin'
import { UsuariosAdmin } from './UsuariosAdmin'

type Pestana = 'asociados' | 'granjas' | 'vehiculos' | 'usuarios'

const PESTANAS: Array<{ id: Pestana; etiqueta: string }> = [
  { id: 'asociados', etiqueta: 'Asociados' },
  { id: 'granjas', etiqueta: 'Granjas' },
  { id: 'vehiculos', etiqueta: 'Vehículos' },
  { id: 'usuarios', etiqueta: 'Usuarios' },
]

/**
 * Une las 4 pantallas de administración de maestros bajo una sola ruta
 * (/admin/asociados, enlazada desde Inicio.tsx como "Administrar Asociados,
 * Granjas y Vehículos"). Cada pestaña es un componente independiente — ver
 * AsociadosAdmin.tsx (la pantalla de referencia original), GranjasAdmin.tsx,
 * VehiculosAdmin.tsx y UsuariosAdmin.tsx.
 */
export function CatalogosAdmin() {
  const [pestana, setPestana] = useState<Pestana>('asociados')

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestana(p.id)}
            className={clsx(
              'rounded-t-md px-3 py-2 text-sm font-medium',
              pestana === p.id ? 'border-b-2 border-brand-navy text-brand-navy' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>

      {pestana === 'asociados' && <AsociadosAdmin />}
      {pestana === 'granjas' && <GranjasAdmin />}
      {pestana === 'vehiculos' && <VehiculosAdmin />}
      {pestana === 'usuarios' && <UsuariosAdmin />}
    </div>
  )
}
