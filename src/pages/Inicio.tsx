import { Link } from 'react-router-dom'
import type { Usuario } from '../types/models'

const BOTONES = [
  {
    to: '/recepcion',
    titulo: 'Recepción',
    descripcion: 'Registrar la llegada de un lote: guía ICA, remisión, novedades de llegada y fortuitos.',
  },
  {
    to: '/ubicacion',
    titulo: 'Ubicación',
    descripcion: 'Peso en planta, corrales asignados y coincidencia del número de animales.',
  },
  {
    to: '/novedades-corral',
    titulo: 'Novedades en Corral',
    descripcion: 'Muertos en reposo, comportamiento sexual y disponibilidad de agua.',
  },
  {
    to: '/consolidado',
    titulo: 'Consolidado',
    descripcion: 'Asignar tiquete y destino (Procesado / Decomisado) a cada animal con novedad.',
  },
]

export function Inicio({ usuario }: { usuario: Usuario }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Hola, {usuario.Title.split(' ')[0]}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Elige el momento de la captura. Puedes seguir trabajando sin conexión — se sincroniza solo al volver a tener internet.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {BOTONES.map((boton) => (
          <Link
            key={boton.to}
            to={boton.to}
            className="rounded-xl bg-brand-navy p-5 text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-brand-navy-hover"
          >
            <h2 className="text-base font-semibold">{boton.titulo}</h2>
            <p className="mt-1.5 text-sm text-white/80">{boton.descripcion}</p>
          </Link>
        ))}
      </div>

      {usuario.Rol === 'Administrador' && (
        <Link
          to="/admin/asociados"
          className="mt-4 inline-block rounded-lg border border-brand-navy/20 px-4 py-2 text-sm font-medium text-brand-navy hover:bg-brand-navy-tint"
        >
          Administrar Asociados, Granjas y Vehículos →
        </Link>
      )}
    </div>
  )
}
