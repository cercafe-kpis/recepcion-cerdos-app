import { useEffect } from 'react'
import { AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { ProtegidoPorRol } from './components/ProtegidoPorRol'
import { PantallaLogin } from './pages/PantallaLogin'
import { Inicio } from './pages/Inicio'
import { Recepcion } from './features/recepcion/Recepcion'
import { Ubicacion } from './features/ubicacion/Ubicacion'
import { NovedadesCorral } from './features/novedades-corral/NovedadesCorral'
import { Consolidado } from './features/consolidado/Consolidado'
import { AsociadosAdmin } from './features/catalogos/AsociadosAdmin'
import { useCurrentUser } from './auth/useCurrentUser'
import { descargarMaestros } from './offline/syncService'

export default function App() {
  return (
    <>
      <UnauthenticatedTemplate>
        <PantallaLogin />
      </UnauthenticatedTemplate>
      <AuthenticatedTemplate>
        <AppAutenticada />
      </AuthenticatedTemplate>
    </>
  )
}

function AppAutenticada() {
  const { usuario, cargando, error } = useCurrentUser()

  // Primera descarga de maestros de la sesión, solo si hay conexión — deja
  // los combos de Asociado/Granja/Placa listos para trabajar sin internet
  // el resto del turno. Si falla (sin red, primera vez), los formularios
  // igual funcionan con lo que ya hubiera en Dexie de una sesión anterior.
  useEffect(() => {
    if (usuario && navigator.onLine) {
      void descargarMaestros()
    }
  }, [usuario])

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
        Verificando tu usuario…
      </div>
    )
  }

  if (error || !usuario) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="max-w-sm text-center text-sm text-brand-red">{error ?? 'No se pudo identificar al usuario.'}</p>
      </div>
    )
  }

  if (!usuario.Activo) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="max-w-sm text-center text-sm text-brand-red">
          Tu usuario está desactivado. Pídele a un Administrador que lo reactive.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar usuario={usuario} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Inicio usuario={usuario} />} />
          <Route
            path="/recepcion"
            element={
              <ProtegidoPorRol usuario={usuario} permitido={['Administrador', 'Supervisor', 'Auditor']}>
                <Recepcion usuario={usuario} />
              </ProtegidoPorRol>
            }
          />
          <Route
            path="/ubicacion"
            element={
              <ProtegidoPorRol usuario={usuario} permitido={['Administrador', 'Supervisor', 'Auditor']}>
                <Ubicacion usuario={usuario} />
              </ProtegidoPorRol>
            }
          />
          <Route
            path="/novedades-corral"
            element={
              <ProtegidoPorRol usuario={usuario} permitido={['Administrador', 'Supervisor', 'Auditor']}>
                <NovedadesCorral usuario={usuario} />
              </ProtegidoPorRol>
            }
          />
          <Route path="/consolidado" element={<Consolidado usuario={usuario} />} />
          <Route
            path="/admin/asociados"
            element={
              <ProtegidoPorRol usuario={usuario} permitido={['Administrador']}>
                <AsociadosAdmin />
              </ProtegidoPorRol>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
