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
      // Precachea el shell de la app para que abra sin conexión (los datos viven en IndexedDB,
      // ver src/offline/db.ts — el service worker solo se encarga de los archivos estáticos).
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
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
