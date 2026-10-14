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

### Calibración de básculas (agregado 2026-10-13)

Dos listas más en el mismo sitio de SharePoint. Escribe el nombre **exactamente igual** al crear
cada columna (sin tildes ni espacios): ese es el nombre interno que usa la app.

**`Basculas`** (maestra — se administra en Asociados → Básculas):

| Columna | Tipo |
|---|---|
| `Title` | (viene por defecto) nombre de la báscula |
| `PesaPatronKg` | Número (2 decimales) |
| `EMPKg` | Número (3 decimales) |
| `Activa` | Sí/No (predeterminado Sí) |

**`CalibracionesBascula`** (una fila por verificación diaria):

| Columna | Tipo |
|---|---|
| `Title` | (viene por defecto) "Báscula · fecha" |
| `FechaCalibracion` | Fecha y hora (solo fecha) |
| `BasculaId` | Una línea de texto |
| `BasculaNombre` | Una línea de texto |
| `PesaPatronKg`, `EMPKg` | Número |
| `Medicion1`, `Medicion2`, `Medicion3` | Número (3 decimales) |
| `PromedioKg`, `ErrorKg` | Número (3 decimales) — ErrorKg puede ser negativo |
| `Resultado` | Una línea de texto ("Conforme" / "No conforme") |
| `Realizo`, `Verifico`, `VerificoCorreo` | Una línea de texto |
| `Observaciones` | Varias líneas de texto |
| `CapturadaEn`, `RecibidaEn` | Fecha y hora (con hora) |

**`Operarios`** (maestra — se administra en Asociados → Operarios; son los nombres del campo
"Realizó"):

| Columna | Tipo |
|---|---|
| `Title` | (viene por defecto) nombre completo del operario |
| `Activo` | Sí/No (predeterminado Sí) |

Después de crear `Basculas`, agrega "Báscula Frigotun · 50 · 0,05" desde Asociados → Básculas.

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
