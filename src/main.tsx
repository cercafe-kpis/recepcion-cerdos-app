import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MsalProvider } from '@azure/msal-react'
import { BrowserRouter } from 'react-router-dom'
import { msalInstance } from './auth/msalInstance'
import App from './App'
import './index.css'

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
