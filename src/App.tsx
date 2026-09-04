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
import { Reporte } from './features/reportes/Reporte'
import { CatalogosAdmin } from './features/catalogos/CatalogosAdmin'
import { useCurrentUser } from './auth/useCurrentUser'
import { descargarMaestros, descargarRecepcionesEnProceso, sincronizar } from './offline/syncService'

/** Cada cuánto se revisa solo, en segundo plano, si hay novedades de otros dispositivos. */
const INTERVALO_AUTO_SYNC_MS = 2 * 60 * 1000

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

  // Primera descarga de maestros y de Recepciones "en proceso" de la sesión,
  // solo si hay conexión — deja los combos de Asociado/Granja/Placa listos
  // para trabajar sin internet el resto del turno, y trae al selector de
  // Ubicación/NovedadesCorral/Consolidado los lotes que otro dispositivo ya
  // haya capturado y sincronizado (ver descargarRecepcionesEnProceso() en
  // syncService.ts). Si falla (sin red, primera vez), los formularios igual
  // funcionan con lo que ya hubiera en Dexie de una sesión anterior.
  useEffect(() => {
    if (usuario && navigator.onLine) {
      void descargarMaestros()
      void descargarRecepcionesEnProceso()
    }
  }, [usuario])

  // Antes, la única forma de ver en este dispositivo una Recepción capturada
  // en OTRO (celular ↔ computador) era cerrar sesión y volver a entrar —
  // porque descargarRecepcionesEnProceso() de arriba solo corre una vez, al
  // autenticar. Esto la repite sola cada INTERVALO_AUTO_SYNC_MS mientras la
  // pestaña siga abierta y haya conexión (usa sincronizar(), no solo
  // descargarRecepcionesEnProceso(), para que de paso también suba cualquier
  // captura pendiente de este mismo dispositivo) — y también apenas la
  // persona vuelve a esta pestaña después de tenerla en segundo plano (por
  // ejemplo, cambiar de pestaña o de app en el celular y regresar), en vez
  // de esperar a que se cumpla el intervalo completo. El botón "En línea" de
  // la barra superior sigue disponible para forzarlo al toque.
  useEffect(() => {
    if (!usuario) return

    const intentar = () => {
      if (navigator.onLine) {
        void sincronizar(usuario.Correo)
      }
    }

    const intervalo = window.setInterval(intentar, INTERVALO_AUTO_SYNC_MS)

    const alVolverVisible = () => {
      if (document.visibilityState === 'visible') intentar()
    }
    document.addEventListener('visibilitychange', alVolverVisible)

    return () => {
      window.clearInterval(intervalo)
      document.removeEventListener('visibilitychange', alVolverVisible)
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
    <div className="flex min-h-screen flex-col bg-slate-50">
      <Navbar usuario={usuario} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
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
          {/* Sin ProtegidoPorRol a propósito: "todos los perfiles pueden tener acceso a este reporte" (pedido explícito del usuario). */}
          <Route path="/reporte" element={<Reporte />} />
          <Route
            path="/admin/asociados"
            element={
              <ProtegidoPorRol usuario={usuario} permitido={['Administrador']}>
                <CatalogosAdmin usuario={usuario} />
              </ProtegidoPorRol>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <PieDeApp />
    </div>
  )
}

/** Pie fijo de toda la app autenticada, a pedido del usuario. Se oculta al imprimir/descargar un
 * reporte para no aparecer duplicado junto al pie propio de cada reporte (ReporteDiarioLote.tsx,
 * ReporteSemanalAsociado.tsx). */
function PieDeApp() {
  return (
    <footer className="border-t border-slate-200 py-3 text-center text-xs text-slate-400 print:hidden">
      Desarrollado por Gestión Técnica Especializada
    </footer>
  )
}
