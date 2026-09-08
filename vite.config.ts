import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Publicado en GitHub Pages bajo /recepcion-cerdos-app/ (usuario.github.io/recepcion-cerdos-app/).
// Si el repositorio se llama distinto, este `base` debe cambiar para que coincida EXACTAMENTE
// con la ruta publicada — igual que VITE_AAD_REDIRECT_URI en .env.example.
export default defineConfig({
  base: '/recepcion-cerdos-app/',
  // Sello de "a qué hora se generó este build", visible en el pie de página (App.tsx) — sirve
  // para comprobar a simple vista, desde el celular, si un despliegue ya llegó o todavía no
  // (compara la hora que ves en la app con la hora en que se corrió el despliegue en GitHub
  // Actions), en vez de adivinar por si aparece o no el aviso "Actualizar ahora".
  define: {
    __FECHA_BUILD__: JSON.stringify(new Date().toISOString()),
  },
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
        // jsPDF (usado por descargarElementoComoPDF, en src/utils/descargarImagen.ts, para el
        // botón "Descargar / Compartir PDF") trae, sin que esta app los use nunca, tres paquetes
        // opcionales de más de 200 KB en total: html2canvas, dompurify y canvg — solo hacen falta
        // para su método .html() (convertir una página HTML entera a PDF), que aquí NO se usa
        // (el PDF se arma a partir de la imagen ya capturada, con addImage()). Como jsPDF los
        // pide con un import() dinámico, Vite los separa solos en su propio archivo cada uno —
        // así que normalmente nunca se descargan, a menos que algo llegue a llamar ese método
        // .html(). El problema es que, sin esta exclusión, el service worker los precachea IGUAL
        // (por el globPatterns de arriba, que agarra todo lo que haya en dist), obligando a
        // cualquier celular a bajarse esos 200+ KB de más cada vez que se instala o actualiza la
        // app, sin que sirvan para nada. Los nombres (html2canvas-*, purify.es-*, index.es-* —
        // este último es el paquete canvg) son fijos, aunque la parte final del nombre (el hash)
        // cambie en cada build.
        globIgnores: ['**/html2canvas-*.js', '**/purify.es-*.js', '**/index.es-*.js'],
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
