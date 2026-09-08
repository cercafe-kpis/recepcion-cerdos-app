import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

/** Cada cuánto se le pregunta al navegador "¿hay una versión nueva publicada?" mientras la
 * pestaña sigue abierta — sin esto, con registerType: 'autoUpdate' igual se instala sola la
 * versión nueva, pero solo la próxima vez que el navegador decida revisar por su cuenta (que en
 * el celular puede tardar bastante, sobre todo si la app quedó abierta en segundo plano). */
const INTERVALO_REVISION_MS = 5 * 60 * 1000

// --- Aviso de actualización disponible --------------------------------------
// Antes, con registerType: 'autoUpdate' (vite.config.ts) y sin pasarle onNeedReload a
// registerSW(), en cuanto el service worker nuevo terminaba de activarse la librería recargaba
// la página SOLA con window.location.reload() — sin avisar ni preguntar. Si eso pasaba justo
// mientras alguien tenía un formulario a medio llenar, o justo después de generar un reporte y
// antes de alcanzar a tocar "Descargar imagen", perdía lo que estaba haciendo sin ningún aviso
// (y como esta app se sigue desplegando seguido, entre más seguido se publican cambios más
// seguido puede pasar esto). Ahora, en vez de recargar sola, solo AVISA (con esta mini librería
// de "suscribirse a un valor" — useSyncExternalStore, ver useActualizacionDisponible más abajo,
// usado en Navbar.tsx para mostrar el botón "Actualizar ahora") y la persona decide cuándo es un
// buen momento para recargar. Nada se pierde: el service worker nuevo ya quedó instalado y
// controlando la app igual, recargar más tarde no cambia eso — solo hace que la página use la
// versión nueva del código en vez de la que ya tenía cargada.

let hayActualizacionDisponible = false
const escuchas = new Set<() => void>()

function avisarActualizacionDisponible() {
  hayActualizacionDisponible = true
  for (const escucha of escuchas) escucha()
}

/**
 * Registra el service worker a mano (en vez del script automático que generaría
 * injectRegister: 'auto' en vite.config.ts) para poder pedirle que revise si hay una versión
 * nueva cada INTERVALO_REVISION_MS y, sobre todo, cada vez que la persona vuelve a esta pestaña
 * después de tenerla en segundo plano — el mismo patrón que ya usa App.tsx para la sincronización
 * de datos con visibilitychange.
 */
export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  registerSW({
    immediate: true,
    onNeedReload() {
      avisarActualizacionDisponible()
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      // Revisa una vez de una, apenas se registra el service worker — que es lo que pasa cada
      // vez que se abre la app, incluso después de tenerla cerrada del todo. Antes esto no
      // estaba: una apertura nueva de la app se quedaba esperando a que se cumplieran los
      // INTERVALO_REVISION_MS de abajo o a un cambio de visibilidad, y ninguna de esas dos cosas
      // pasa necesariamente apenas se abre la app — así que en el celular podía quedarse abierta
      // un buen rato con la versión vieja sin que nada disparara la revisión.
      void registration.update()

      window.setInterval(() => {
        void registration.update()
      }, INTERVALO_REVISION_MS)

      const revisarSiEstaVisible = () => {
        if (document.visibilityState === 'visible') {
          void registration.update()
        }
      }
      document.addEventListener('visibilitychange', revisarSiEstaVisible)
      // Además de visibilitychange: en el celular, sobre todo con la app instalada (agregada a
      // la pantalla de inicio), volver a ella desde otra app no siempre dispara
      // visibilitychange de forma confiable — 'focus' es un segundo aviso que cubre esos casos.
      window.addEventListener('focus', revisarSiEstaVisible)
    },
  })
}

/** true apenas hay una versión nueva ya instalada esperando a que se recargue la página para
 * usarse — Navbar.tsx lo usa para mostrar el aviso con el botón "Actualizar ahora". */
export function useActualizacionDisponible(): boolean {
  return useSyncExternalStore(
    (escucha) => {
      escuchas.add(escucha)
      return () => escuchas.delete(escucha)
    },
    () => hayActualizacionDisponible,
  )
}

/** Aplica la actualización ya instalada — simplemente recarga la página: el service worker nuevo
 * ya está activo y controlando la app (registerType: 'autoUpdate' hizo eso solo), recargar solo
 * hace que la página cargue el HTML/JS nuevo en vez del que ya tenía abierto. */
export function aplicarActualizacionDisponible() {
  window.location.reload()
}
