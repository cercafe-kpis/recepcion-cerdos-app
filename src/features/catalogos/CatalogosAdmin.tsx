import { useState } from 'react'
import clsx from 'clsx'
import { AsociadosAdmin } from './AsociadosAdmin'
import { GruposAsociadosAdmin } from './GruposAsociadosAdmin'
import { GranjasAdmin } from './GranjasAdmin'
import { VehiculosAdmin } from './VehiculosAdmin'
import { UsuariosAdmin } from './UsuariosAdmin'
import type { Usuario } from '../../types/models'

type Pestana = 'asociados' | 'gruposAsociados' | 'granjas' | 'vehiculos' | 'usuarios'

const PESTANAS: Array<{ id: Pestana; etiqueta: string }> = [
  { id: 'asociados', etiqueta: 'Asociados' },
  { id: 'gruposAsociados', etiqueta: 'Grupos de Asociados' },
  { id: 'granjas', etiqueta: 'Granjas' },
  { id: 'vehiculos', etiqueta: 'Vehículos' },
  { id: 'usuarios', etiqueta: 'Usuarios' },
]

/**
 * Une las 5 pantallas de administración de maestros bajo una sola ruta
 * (/admin/asociados, enlazada desde Inicio.tsx como "Administrar Asociados,
 * Granjas y Vehículos"). Cada pestaña es un componente independiente — ver
 * AsociadosAdmin.tsx (la pantalla de referencia original),
 * GruposAsociadosAdmin.tsx, GranjasAdmin.tsx, VehiculosAdmin.tsx y
 * UsuariosAdmin.tsx.
 *
 * `usuario` se recibe de App.tsx y se reparte a las 5 pestañas para que cada
 * una decida si mostrar Editar/Eliminar (ver ProtegidoPorRol.tsx — esta ruta
 * completa ya está restringida a Administrador, pero se deja el chequeo
 * también dentro de cada pantalla por si alguna se reutiliza en un lugar
 * menos restringido más adelante).
 */
export function CatalogosAdmin({ usuario }: { usuario: Usuario }) {
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

      {pestana === 'asociados' && <AsociadosAdmin usuario={usuario} />}
      {pestana === 'gruposAsociados' && <GruposAsociadosAdmin usuario={usuario} />}
      {pestana === 'granjas' && <GranjasAdmin usuario={usuario} />}
      {pestana === 'vehiculos' && <VehiculosAdmin usuario={usuario} />}
      {pestana === 'usuarios' && <UsuariosAdmin usuario={usuario} />}
    </div>
  )
}
