# Recepción de Cerdos — Cercafe

App para capturar los datos del ingreso de cerdos a la planta de beneficio (Recepción, Ubicación,
Novedades en Corral y Consolidado), con inicio de sesión @cercafe.com.co, datos en SharePoint Lists
vía Microsoft Graph, y funcionamiento completo sin conexión a internet.

El diseño completo (listas de SharePoint necesarias, matriz de permisos, cómo funciona la
sincronización offline) está en [`Arquitectura-App-Recepcion-Cerdos.md`](./Arquitectura-App-Recepcion-Cerdos.md).
Este README es solo para poner el proyecto a correr.

## Requisitos previos (los hace un Administrador, una sola vez)

1. Crear las 9 Listas de SharePoint descritas en la sección 4 de `Arquitectura-...md`, con esos
   nombres y columnas exactos.
2. Registrar (o reutilizar) la app en Microsoft Entra ID — sección 5 de `Arquitectura-...md`.
3. Crear los 4 grupos de seguridad de SharePoint y agregar a cada persona según su rol.

## Configuración local

```bash
npm install
cp .env.example .env.local
# completa .env.local con el Client ID / Tenant ID / sitio de SharePoint reales
npm run dev
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite) |
| `npm run build` | Verifica tipos (`tsc -b`) y genera el sitio estático en `dist/` |
| `npm run preview` | Sirve `dist/` localmente, para probar el build de producción |
| `npm run lint` | `oxlint` sobre `src/` |

## Despliegue

`.github/workflows/deploy.yml` construye y publica `dist/` a GitHub Pages en cada push a `main`. Las
variables de entorno de producción se configuran como Repository Variables de GitHub
(`Settings → Secrets and variables → Actions → Variables`), con los mismos nombres que
`.env.example`. Si el repositorio se llama distinto a `recepcion-cerdos-app`, hay que actualizar
`base` en `vite.config.ts` y `VITE_AAD_REDIRECT_URI` para que coincidan con la URL real publicada.

## Estructura del proyecto

```
src/
  auth/            Configuración de MSAL y el hook useCurrentUser (resuelve el Usuario + Rol)
  graph/           Cliente genérico de Microsoft Graph + funciones específicas por lista
  offline/         Base local (Dexie) y el servicio de sincronización
  types/           Tipos que reflejan las columnas de SharePoint
  components/      Navbar, campos de formulario compartidos, control de acceso por Rol
  pages/           Login e Inicio
  features/
    recepcion/         Formulario de referencia — los otros dos siguen el mismo patrón
    ubicacion/
    novedades-corral/
    consolidado/       Asignación de Tiquete + Destino por animal
    catalogos/         Administración de tablas maestras (Asociados hecho; Granjas/Vehículos/Usuarios
                        pendientes, siguen el mismo patrón — ver el comentario en AsociadosAdmin.tsx)
```

## Estado actual

Compila y pasa `tsc -b` + `oxlint` sin errores (`npm run build` genera el sitio completo, incluido el
service worker de PWA). Ver la sección 7 de `Arquitectura-...md` para lo que falta por construir.
