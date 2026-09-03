import { NavLink } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import clsx from 'clsx'
import type { Usuario } from '../types/models'
import { useEstadoSync } from '../offline/useEstadoSync'

const BASE = import.meta.env.BASE_URL

const ENLACES = [
  { to: '/', label: 'Inicio', fin: true },
  { to: '/recepcion', label: 'Recepción' },
  { to: '/ubicacion', label: 'Ubicación' },
  { to: '/novedades-corral', label: 'Novedades en Corral' },
  { to: '/consolidado', label: 'Consolidado' },
]

export function Navbar({ usuario }: { usuario: Usuario }) {
  const { instance } = useMsal()
  const { enLinea, pendientes, conflictos, sincronizando, ultimoErrorSync, descartarErrorSync, sincronizarAhora } =
    useEstadoSync()

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <img src={`${BASE}icon-192.png`} alt="Cercafe" className="h-9 w-9 rounded-md" />
        <div className="mr-4">
          <p className="text-sm font-semibold text-brand-navy">Recepción de Cerdos</p>
          <p className="text-xs text-slate-500">Cercafe · Planta de beneficio</p>
        </div>

        <nav className="flex flex-1 flex-wrap gap-1">
          {ENLACES.map((enlace) => (
            <NavLink
              key={enlace.to}
              to={enlace.to}
              end={enlace.fin}
              className={({ isActive }) =>
                clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
                )
              }
            >
              {enlace.label}
            </NavLink>
          ))}
          {usuario.Rol === 'Administrador' && (
            <NavLink
              to="/admin/asociados"
              className={({ isActive }) =>
                clsx(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-brand-navy text-white' : 'text-slate-600 hover:bg-brand-navy-tint',
                )
              }
            >
              Asociados
            </NavLink>
          )}
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void sincronizarAhora(usuario.Correo)}
            disabled={!enLinea || sincronizando}
            title={enLinea ? 'Subir capturas pendientes a SharePoint' : 'Sin conexión — no se puede sincronizar'}
            className={clsx(
              'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium',
              enLinea ? 'border-brand-navy/30 text-brand-navy hover:bg-brand-navy-tint' : 'border-slate-200 text-slate-400',
            )}
          >
            <span className={clsx('h-2 w-2 rounded-full', enLinea ? 'bg-emerald-500' : 'bg-slate-400')} />
            {sincronizando ? 'Sincronizando…' : enLinea ? 'En línea' : 'Sin conexión'}
            {pendientes > 0 && (
              <span className="ml-1 rounded-full bg-brand-red px-1.5 text-white">{pendientes}</span>
            )}
          </button>

          {conflictos > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
              {conflictos} consecutivo{conflictos > 1 ? 's' : ''} repetido{conflictos > 1 ? 's' : ''}
            </span>
          )}

          <div className="text-right text-xs leading-tight">
            <p className="font-medium text-slate-700">{usuario.Title}</p>
            <p className="text-slate-500">{usuario.Rol}</p>
          </div>
          <button
            type="button"
            onClick={() => void instance.logoutRedirect()}
            className="text-xs font-medium text-slate-500 hover:text-brand-red"
          >
            Salir
          </button>
        </div>
      </div>

      {ultimoErrorSync && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2">
          <div className="mx-auto flex max-w-5xl items-start justify-between gap-3">
            <div className="text-xs text-brand-red">
              <p className="font-semibold">
                Algo no se sincronizó bien con SharePoint ({new Date(ultimoErrorSync.en).toLocaleString('es-CO')}):
              </p>
              <ul className="mt-0.5 list-inside list-disc">
                {ultimoErrorSync.mensajes.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => void descartarErrorSync()}
              className="shrink-0 text-xs font-medium text-brand-red hover:underline"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
