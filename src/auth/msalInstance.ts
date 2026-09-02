import { PublicClientApplication, EventType, type AccountInfo } from '@azure/msal-browser'
import { msalConfig } from './msalConfig'

// Instancia única compartida entre el <MsalProvider> (src/main.tsx) y el
// cliente de Graph (src/graph/client.ts), que la usa para pedir tokens fuera
// de un componente React.
export const msalInstance = new PublicClientApplication(msalConfig)

await msalInstance.initialize()

// Si ya hay una cuenta de una sesión anterior, la deja activa; si el login
// redirige de vuelta con una cuenta nueva, la vuelve la activa.
const existing = msalInstance.getAllAccounts()
if (existing.length > 0) {
  msalInstance.setActiveAccount(existing[0])
}

msalInstance.addEventCallback((event) => {
  if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
    const account = (event.payload as { account: AccountInfo }).account
    msalInstance.setActiveAccount(account)
  }
})
