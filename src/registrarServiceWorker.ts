import { registerSW } from 'virtual:pwa-register'

/** Cada cuánto se le pregunta al navegador "¿hay una versión nueva publicada?" mientras la
 * pestaña sigue abierta — sin esto, con registerType: 'autoUpdate' igual se instala sola la
 * versión nueva, pero solo la próxima vez que el navegador decida revisar por su cuenta (que en
 * el celular puede tardar bastante, sobre todo si la app quedó abierta en segundo plano). */
const INTERVALO_REVISION_MS = 30 * 60 * 1000

/**
 * Registra el service worker a mano (en vez del script automático que generaría
 * injectRegister: 'auto' en vite.config.ts) para poder pedirle que revise si hay una versión
 * nueva cada INTERVALO_REVISION_MS y, sobre todo, cada vez que la persona vuelve a esta pestaña
 * después de tenerla en segundo plano — el mismo patrón que ya usa App.tsx para la sincronización
 * de datos con visibilitychange. Con registerType: 'autoUpdate' (vite.config.ts), en cuanto
 * encuentra una versión nueva la activa y recarga la página sola, sin pedir confirmación.
 */
export function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  const actualizar = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      window.setInterval(() => {
        void registration.update()
      }, INTERVALO_REVISION_MS)

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void registration.update()
        }
      })
    },
  })

  // No se usa el resultado de actualizar() (activaría la versión nueva a mano, con prompt) porque
  // registerType: 'autoUpdate' ya lo hace solo — se referencia igual para que no quede como
  // "declarada pero no usada" si en algún momento se necesita forzarlo desde otro lado.
  void actualizar
}
