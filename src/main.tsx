import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MsalProvider } from '@azure/msal-react'
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge'
import { BrowserRouter } from 'react-router-dom'
import { msalInstance } from './auth/msalInstance'
import { registrarServiceWorker } from './registrarServiceWorker'
import App from './App'
import './index.css'

/**
 * Cuando getAccessToken() (src/graph/client.ts) o useConfirmarSesion.ts recurren a
 * loginPopup()/acquireTokenPopup() como respaldo, MSAL abre esta MISMA app en una ventana
 * emergente para completar el login — esa ventana solo existe unos segundos y nunca debe
 * mostrar la app normal (evita que alcance a intentar cargar el usuario contra SharePoint
 * y se vea, por un instante, el mensaje de "sin conexión").
 *
 * Hasta @azure/msal-browser 5.17, bastaba con NO montar nada aquí: la ventana original
 * vigilaba sola la URL de esta ventana emergente (sondeándola) y la cerraba apenas veía la
 * respuesta, sin que este lado tuviera que hacer nada. Desde 5.20 (ver CHANGELOG de
 * @azure/msal-browser — el rango "^5.17.3" de package.json trajo 5.20 sin que nadie lo
 * pidiera a mano) ese sondeo se reemplazó por un "redirect bridge": la ventana original
 * ahora espera un mensaje por BroadcastChannel, y es ESTA ventana la que tiene que leer el
 * código de la URL, mandarlo por ese canal y cerrarse sola — si nadie llama esta función
 * nueva, la ventana emergente se queda en blanco para siempre y la original nunca se entera
 * de que ya terminó (quedándose en "Confirmando…"). broadcastResponseToMainFrame() es
 * exactamente ese paso que falta: lee la respuesta de la URL, se la pasa a la ventana
 * original y cierra esta ventana. No usamos loginRedirect() en Login.tsx a través de este
 * bridge — ese flujo de página completa no pasa por una ventana emergente y sigue
 * funcionando igual que siempre.
 *
 * `window.opener` NO alcanza para detectar la ventana emergente: login.microsoftonline.com
 * manda cabeceras "Cross-Origin-Opener-Policy" que hacen que el navegador BORRE ese enlace
 * de vuelta hacia la ventana original en cuanto la emergente navega hacia allá — y como
 * después vuelve a nuestro propio dominio con `window.opener` ya en null, esta página no se
 * daba cuenta de que seguía siendo la ventana emergente y montaba la app normal ADENTRO de
 * ella (le pasó a Nathalia el 24/09: en vez de quedarse en blanco, la ventana abría la app
 * pidiendo iniciar sesión otra vez). Ese mismo aislamiento NO borra `window.name` — MSAL le
 * pone a la ventana emergente un nombre que siempre empieza en "msal." (ver
 * generatePopupName()/generateLogoutPopupName() en el propio
 * node_modules/@azure/msal-browser/dist/interaction_client/PopupClient.mjs), así que se usa
 * ESE como señal de respaldo cuando `window.opener` ya no sirve.
 */
const esVentanaEmergenteDeLogin =
  (window.opener !== null && window.opener !== window) || window.name.startsWith('msal.')

if (esVentanaEmergenteDeLogin) {
  void broadcastResponseToMainFrame().catch(() => {
    // Si por lo que sea no hay una respuesta válida en la URL (por ejemplo, alguien abrió
    // esta ventana a mano), igual la cerramos en vez de dejarla en blanco para siempre.
    window.close()
  })
} else {
  registrarServiceWorker()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        {/* BASE_URL trae el /recepcion-cerdos-app/ de vite.config.ts — así los enlaces
            funcionan igual en local (npm run dev, base "/") y en GitHub Pages. */}
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <App />
        </BrowserRouter>
      </MsalProvider>
    </StrictMode>,
  )
}
