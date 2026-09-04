import { useMsal } from '@azure/msal-react'
import { graphScopes } from '../auth/msalConfig'

const BASE = import.meta.env.BASE_URL

export function PantallaLogin() {
  const { instance } = useMsal()

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-brand-navy px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-8 text-center shadow-xl">
        <img src={`${BASE}icon-192.png`} alt="Cercafe" className="mx-auto mb-4 h-16 w-16 rounded-lg" />
        <h1 className="text-lg font-semibold text-brand-navy">Recepción de Cerdos</h1>
        <p className="mt-1 text-sm text-slate-500">Planta de beneficio · Cercafe</p>

        <button
          type="button"
          onClick={() => void instance.loginRedirect({ scopes: graphScopes })}
          className="mt-6 w-full rounded-md bg-brand-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-navy-hover"
        >
          Iniciar sesión con Microsoft
        </button>
        <p className="mt-4 text-xs text-slate-400">
          Solo cuentas @cercafe.com.co registradas previamente por un Administrador.
        </p>
      </div>
      <p className="absolute bottom-4 left-0 right-0 text-center text-xs text-white/70">
        Desarrollado por Gestión Técnica Especializada
      </p>
    </div>
  )
}
