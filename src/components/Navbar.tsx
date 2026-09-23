import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useMsal } from '@azure/msal-react'
import clsx from 'clsx'
import type { Usuario } from '../types/models'
import { useEstadoSync } from '../offline/useEstadoSync'
import { aplicarActualizacionDisponible, useActualizacionDisponible } from '../registrarServiceWorker'
import { graphScopes } from '../auth/msalConfig'

const BASE = import.meta.env.BASE_URL

const ENLACES = [
  { to: '/', label: 'Inicio', fin: true },
  { to: '/recepcion', label: 'Recepción' },
  { to: '/ubicacion', label: 'Ubicación' },
  { to: '/novedades-corral', label: 'Novedades en Corral' },
  { to: '/consolidado', label: 'Consolidado' },
  { to: '/reporte', label: 'Reporte' },
]

/**
 * Los 2 mensajes que arma getAccessToken() (src/graph/client.ts) cuando la renovación silenciosa de
 * la sesión de Microsoft falla (sesión vencida, o renovación en segundo plano bloqueada por el
 * navegador) terminan siempre en esta misma frase — se usa para detectarlos entre el resto de
 * errores de sincronización (que no tienen arreglo con un clic, solo con "Descartar") y ofrecerles
 * el botón "Confirmar sesión" de abajo. Se busca por esta frase, no por el mensaje completo, porque
 * cada uno llega con un prefijo distinto según qué parte de sincronizar() falló (ver syncService.ts).
 */
function esErrorDeSesion(mensajes: string[]): boolean {
  return mensajes.some((m) => m.includes('Cierra sesión (botón "Salir")'))
}

export function Navbar({ usuario }: { usuario: Usuario }) {
  const { instance } = useMsal()
  const { enLinea, pendientes, conflictos, sincronizando, ultimoErrorSync, descartarErrorSync, sincronizarAhora } =
    useEstadoSync()
  const hayActualizacion = useActualizacionDisponible()
  const [confirmandoSesion, setConfirmandoSesion] = useState(false)
  const [errorConfirmacion, setErrorConfirmacion] = useState<string>()

  /**
   * Alternativa más liviana a "Salir" + volver a entrar para el error de sesión de arriba — ver el
   * comentario grande agregado el 2026-09-24 en getAccessToken() (src/graph/client.ts) sobre por qué
   * un popup disparado DESDE ESTE CLIC (nunca solo) es seguro y por qué suele bastar con un parpadeo
   * sin pedir contraseña. Si de verdad hace falta autenticarse de nuevo (o el navegador bloquea el
   * popup), acquireTokenPopup() se encarga de pedirlo ahí mismo; si el popup no se puede abrir en lo
   * absoluto, cae al catch de abajo y se sigue sugiriendo "Salir" como respaldo.
   */
  async function confirmarSesion() {
    const cuenta = instance.getActiveAccount()
    if (!cuenta) return
    setConfirmandoSesion(true)
    setErrorConfirmacion(undefined)
    try {
      await instance.acquireTokenPopup({ scopes: graphScopes, account: cuenta })
      await descartarErrorSync()
      void sincronizarAhora(usuario.Correo)
    } catch {
      setErrorConfirmacion(
        'No se pudo confirmar con la ventana emergente — revisa que el navegador no la haya bloqueado para este sitio, o usa "Salir" y vuelve a iniciar sesión.',
      )
    } finally {
      setConfirmandoSesion(false)
    }
  }

  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
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

      {hayActualizacion && (
        <div className="border-t border-brand-navy/20 bg-brand-navy-tint px-4 py-2">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <p className="text-xs text-brand-navy">
              Hay una versión nueva de la app lista. Termina lo que estés haciendo (guarda o descarga lo que
              necesites) y actualiza cuando puedas.
            </p>
            <button
              type="button"
              onClick={aplicarActualizacionDisponible}
              className="shrink-0 rounded-md bg-brand-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-navy-hover"
            >
              Actualizar ahora
            </button>
          </div>
        </div>
      )}

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
              {errorConfirmacion && <p className="mt-1 font-medium">{errorConfirmacion}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {esErrorDeSesion(ultimoErrorSync.mensajes) && (
                <button
                  type="button"
                  onClick={() => void confirmarSesion()}
                  disabled={confirmandoSesion}
                  className="rounded-md border border-brand-red/40 px-2 py-1 text-xs font-medium text-brand-red hover:bg-red-100 disabled:opacity-50"
                >
                  {confirmandoSesion ? 'Confirmando…' : 'Confirmar sesión'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void descartarErrorSync()}
                className="text-xs font-medium text-brand-red hover:underline"
              >
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
