import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Publicado en GitHub Pages bajo /recepcion-cerdos-app/ (usuario.github.io/recepcion-cerdos-app/).
// Si el repositorio se llama distinto, este `base` debe cambiar para que coincida EXACTAMENTE
// con la ruta publicada — igual que VITE_AAD_REDIRECT_URI en .env.example.
export default defineConfig({
  base: '/recepcion-cerdos-app/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // El registro del service worker lo hace src/registrarServiceWorker.ts a mano (con
      // virtual:pwa-register), no el script automático que inyectaría injectRegister: 'auto' —
      // así se le puede pedir que revise si hay una versión nueva cada cierto tiempo y cada vez
      // que se vuelve a la pestaña, en vez de solo la primera vez que carga la página (que es la
      // razón por la que en el celular una recarga tarda en "notarse": el navegador no vuelve a
      // preguntar por su cuenta hasta la siguiente visita).
      injectRegister: false,
      // Precachea el shell de la app para que abra sin conexión (los datos viven en IndexedDB,
      // ver src/offline/db.ts — el service worker solo se encarga de los archivos estáticos).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // Borra del caché del navegador las versiones de archivos de despliegues anteriores en
        // cuanto el service worker nuevo queda activo, para que no se vayan acumulando.
        cleanupOutdatedCaches: true,
        // *** Esta era la causa real de que en el celular una actualización publicada nunca
        // "llegara" a la app, ni con el botón "Actualizar ahora" ni sola ***
        // Con registerType: 'autoUpdate', vite-plugin-pwa normalmente activa por su cuenta estas
        // dos opciones de Workbox — pero SOLO cuando también se usa su registro automático
        // (injectRegister: 'auto'). Como este proyecto registra el service worker a mano
        // (injectRegister: false, ver el comentario de arriba y src/registrarServiceWorker.ts,
        // necesario para poder revisar solo cada cierto tiempo y al volver a la pestaña), ese
        // encendido automático NUNCA se activaba, y el archivo del service worker se generaba
        // SIN skipWaiting/clientsClaim. Sin skipWaiting, un service worker nuevo se instala pero
        // se queda "esperando" sin activarse nunca (el navegador solo lo activa solo cuando se
        // cierran TODAS las pestañas/instancias abiertas de la app — algo que casi nunca pasa de
        // verdad en un celular, porque la app queda "en segundo plano" en vez de cerrarse del
        // todo). Por eso nunca aparecía el aviso "Actualizar ahora": el service worker nuevo
        // jamás llegaba a activarse para poder avisar. Con estas dos líneas, en cuanto el service
        // worker nuevo termina de descargarse se activa solo (skipWaiting) y toma control de
        // inmediato de la app ya abierta (clientsClaim) — ahí sí se dispara el aviso.
        skipWaiting: true,
        clientsClaim: true,
      },
      manifest: {
        name: 'Recepción de Cerdos — Cercafe',
        short_name: 'Recepción Cerdos',
        description: 'Captura de datos al ingreso de cerdos a la planta de beneficio',
        theme_color: '#1D3557',
        background_color: '#F7F8FA',
        display: 'standalone',
        start_url: '/recepcion-cerdos-app/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
