import { Link } from 'react-router-dom'
import type { Usuario } from '../types/models'

/**
 * Antes esta pantalla repetía, como tarjetas grandes, las mismas 4 opciones
 * que ya están en la barra de arriba (Navbar.tsx) — en pantallas de celular
 * las dos listas quedaban una encima de la otra mostrando lo mismo dos
 * veces. La navegación real vive solo en la barra de arriba (aparece en
 * todas las páginas, no solo aquí); esta pantalla se queda con el saludo y,
 * si aplica, el acceso a administración.
 */
export function Inicio({ usuario }: { usuario: Usuario }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Hola, {usuario.Title.split(' ')[0]}</h1>
      <p className="mt-1 text-sm text-slate-500">
        Usa los botones de arriba para elegir el momento de la captura. Puedes seguir trabajando sin conexión — se
        sincroniza solo al volver a tener internet.
      </p>

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
