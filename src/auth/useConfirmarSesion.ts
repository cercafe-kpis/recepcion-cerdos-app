import { useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { graphScopes } from './msalConfig'

/**
 * Hook compartido por cualquier pantalla que quiera ofrecer el botón "Confirmar sesión" junto a un
 * error de sesión de Microsoft (ver esErrorDeSesion() en src/graph/client.ts) — antes vivía solo
 * dentro de Navbar.tsx (agregado 2026-09-24 para el banner global de sincronización), movido aquí
 * el mismo día al notar que el mismo error puede salir en el banner LOCAL de cualquier pantalla que
 * llame directo a graph/lists.ts sin pasar por sincronizar() (Consolidado.tsx, NovedadesCorral.tsx
 * y Ubicacion.tsx ya tenían sus propios buscadores por fecha/Consecutivo con este mismo problema).
 *
 * `acquireTokenPopup()` navega directo al dominio real de Microsoft (no es un iframe metido en la
 * página), así que no lo alcanza el bloqueo de cookies de terceros que sí tumba la renovación
 * silenciosa — y como solo se llama desde el clic real de "Confirmar sesión" (nunca solo), el
 * navegador no lo bloquea como popup no solicitado. Ver el comentario grande de getAccessToken() en
 * src/graph/client.ts para el detalle completo de por qué esto es seguro.
 */
export function useConfirmarSesion() {
  const { instance } = useMsal()
  const [confirmando, setConfirmando] = useState(false)
  const [errorConfirmacion, setErrorConfirmacion] = useState<string>()

  /** true si logró confirmar la sesión — quien llama decide qué hacer después (descartar su error,
   * reintentar su última acción, o simplemente pedirle a la persona que reintente ella misma). */
  async function confirmarSesion(): Promise<boolean> {
    const cuenta = instance.getActiveAccount()
    if (!cuenta) return false
    setConfirmando(true)
    setErrorConfirmacion(undefined)
    try {
      await instance.acquireTokenPopup({ scopes: graphScopes, account: cuenta })
      return true
    } catch {
      setErrorConfirmacion(
        'No se pudo confirmar con la ventana emergente — revisa que el navegador no la haya bloqueado para este sitio, o usa "Salir" y vuelve a iniciar sesión.',
      )
      return false
    } finally {
      setConfirmando(false)
    }
  }

  return { confirmarSesion, confirmando, errorConfirmacion }
}
