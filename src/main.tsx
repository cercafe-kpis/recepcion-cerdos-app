import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MsalProvider } from '@azure/msal-react'
import { BrowserRouter } from 'react-router-dom'
import { msalInstance } from './auth/msalInstance'
import { registrarServiceWorker } from './registrarServiceWorker'
import App from './App'
import './index.css'

/**
 * Cuando getAccessToken() (src/graph/client.ts) recurre a loginPopup() como respaldo,
 * MSAL abre esta MISMA app en una ventana emergente para completar el login — esa
 * ventana solo existe unos segundos: MSAL la vigila desde la ventana original y la
 * cierra sola en cuanto detecta la respuesta, sin que el código de adentro tenga que
 * hacer nada. Si dejamos que la app normal monte ahí, alcanza a intentar cargar el
 * usuario contra SharePoint antes de que MSAL termine de cerrarla, y por un instante
 * se veía el mensaje de "sin conexión". Evitamos montar la app en ese caso — la
 * ventana se queda en blanco hasta que se cierra sola, que es invisible para quien
 * la usa.
 */
const esVentanaEmergenteDeLogin = window.opener !== null && window.opener !== window

if (!esVentanaEmergenteDeLogin) {
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
