# Arquitectura — App Recepción de Cerdos (Cercafe)

Aplicación para capturar los datos del ingreso de cerdos a la planta de beneficio, en los 4 momentos
del proceso (Recepción, Ubicación, Novedades en Corral, Consolidado), con el objetivo final de
asignarle un número de tiquete y un destino (Procesado / Decomisado) a cada animal que presentó
alguna novedad.

Sigue la misma dinámica que las demás apps internas de Cercafe (ver `cercafe-kpis/auditoria-HGP7`):
SharePoint Lists como base de datos, una SPA en React consumiendo Microsoft Graph directamente (sin
backend propio), inicio de sesión con la cuenta @cercafe.com.co de cada persona, y funcionamiento
completo sin conexión a internet.

## 1. Stack

- **Vite + React 19 + TypeScript**, publicado como sitio estático en GitHub Pages.
- **Autenticación**: Microsoft Entra ID (`@azure/msal-browser` + `@azure/msal-react`), reutilizando
  a propósito el mismo registro de aplicación (Client ID + Tenant ID) que las demás apps de Cercafe
  — evita pedir un nuevo consentimiento de permisos a IT por cada app nueva. Permiso requerido:
  `Sites.ReadWrite.All`.
- **Datos**: Microsoft Graph API contra Listas de SharePoint (sección 4). No hay backend propio: el
  navegador llama a Graph directamente con el token del usuario que inició sesión.
- **Offline-first**: Dexie (IndexedDB) + `dexie-react-hooks`, con una cola de sincronización que sube
  lo capturado sin conexión apenas vuelve el internet (sección 6). `vite-plugin-pwa` cachea el shell
  de la app para que abra sin conexión desde el primer segundo.
- **Formularios**: `react-hook-form` + `zod`.
- **Estilos**: Tailwind CSS v4, con la paleta de marca de Cercafe (`src/index.css`).

## 2. Perfiles y permisos

| Perfil | Crear/editar maestros | Capturar (Recepción/Ubicación/Novedades/Consolidado) | Consultar |
|---|---|---|---|
| Administrador | Sí | Sí | Sí |
| Supervisor | No | Sí | Sí |
| Auditor | No | Sí | No (solo lo que él mismo capturó) |
| Consultor | No | No | Sí |

El Rol vive como una columna de Elección (`Rol`) en la lista **Usuarios** — no hay una lista
"Perfiles" separada, igual que en `auditoria-HGP7`. La app oculta botones y pantallas según el Rol
leído de esa lista (`src/components/ProtegidoPorRol.tsx`), pero **eso es solo una conveniencia de
interfaz**: el control de acceso real lo hacen los grupos de SharePoint (Administradores /
Supervisores / Auditores / Consulta) a los que pertenece cada cuenta. Aunque alguien manipulara el
cliente para saltarse una pantalla, Graph le rechazaría la escritura si su cuenta no está en el grupo
correspondiente.

## 3. Flujo funcional

1. **Recepción** — se registra la llegada de un lote: guía ICA, remisión, número de animales, y las
   novedades de llegada (lesionado / caído / agitado) y fortuitos (muerto en transporte / muerto en
   desembarque), cada uno con su **cantidad**. El Consecutivo se digita a mano — es el mismo que ya
   manejan en papel en planta, la app no lo genera.
2. **Ubicación** — peso en planta, corrales designados y si el número de animales coincide con lo
   recibido.
3. **Novedades en Corral** — muertos en reposo (con cantidad), comportamiento sexual y disponibilidad
   de agua durante el reposo.
4. **Consolidado** — aquí se le pone Tiquete y Destino a cada animal individual que tuvo alguna
   novedad. La pantalla muestra Fecha / Granja / Consecutivo / Número de orden del lote para
   identificarlo, y una fila por animal.

### Cómo se generan las filas de Consolidado (una por animal)

Los pasos 1–3 capturan **cantidades** (p. ej. "3 lesionados"), no animales individuales. El paso 4
necesita una fila por animal para poder ponerle tiquete uno por uno. Esa explosión la hace el propio
proceso de sincronización, no la persona que captura:

- `generarTiquetesFaltantes()` (en `src/graph/lists.ts`) corre justo después de sincronizar una
  Recepción, y por cada campo de cantidad > 0 (lesionados, caídos, agitados, muerto en transporte,
  muerto en desembarque) crea las filas de `ConsolidadoTiquetes` que falten hasta igualar la
  cantidad, numeradas `NumeroAnimalEnLote` (1 de 3, 2 de 3, …).
- `generarTiqueteMuertoReposo()` hace lo mismo para "Muerto en Reposo", justo después de sincronizar
  su NovedadCorral — es la única cantidad que no viene de Recepción sino de esa lista.
- Ninguna de las dos borra una fila que ya tenga Tiquete diligenciado: solo agrega las que faltan.

## 4. Listas de SharePoint

Los nombres deben coincidir EXACTAMENTE con los que usa `src/graph/client.ts` (`ListName`). Todas
las columnas de tipo "Lookup" se leen/escriben en Graph como `<Nombre>LookupId` (con el id numérico
del elemento relacionado) — nunca bajo el nombre de la columna tal cual; ver `mapRecepcionAFields()`
en `src/graph/lists.ts`.

No marques ninguna columna nueva como obligatoria en SharePoint ("Requerir que esta columna contenga
información"): la app decide qué es obligatorio en sus propios formularios, y si SharePoint exige un
valor que la app no siempre manda, la sincronización falla en vez de guardar el registro. Excepción:
la columna `Title`, que SharePoint crea automáticamente en toda lista nueva y trae la obligatoriedad
activada por defecto — se usa tal cual en Usuarios, Asociados, Granjas, Vehiculos y Recepciones, pero
en Ubicaciones, NovedadesCorral, ConsolidadoTiquetes y RecepcionLog el código nunca la llena, así que
hay que desmarcarle esa obligatoriedad o la app no podrá crear registros ahí. Hay una guía
interactiva con este mismo detalle, casilla por casilla, en el archivo `sharepoint-listas-guia.html`
que se entregó junto con este repositorio.

### Usuarios
| Columna | Tipo | Notas |
|---|---|---|
| Title | Texto | Nombre completo |
| Correo | Texto | Debe ser @cercafe.com.co; es la llave para identificar al usuario logueado |
| Rol | Elección | Administrador / Supervisor / Auditor / Consultor |
| AsociadosAsignados | Lookup (múltiple) a Asociados | Opcional — para limitar qué asociados ve |
| GranjasAsignadas | Lookup (múltiple) a Granjas | Opcional |
| Activo | Sí/No | Un usuario inactivo no puede iniciar sesión en la app |

### Asociados
| Columna | Tipo |
|---|---|
| Title | Texto (nombre del asociado) |
| NIT | Texto |
| Activo | Sí/No |

### Granjas
| Columna | Tipo |
|---|---|
| Title | Texto |
| AsociadoId | Lookup a Asociados |
| Municipio | Texto |
| Activa | Sí/No |

### Vehiculos (Placas)
| Columna | Tipo |
|---|---|
| Title | Texto (placa) |
| AsociadoId | Lookup a Asociados (opcional) |
| Activo | Sí/No |

### Recepciones
| Columna | Tipo | Notas |
|---|---|---|
| Title | Texto | Se arma como "Consecutivo · Fecha" |
| Consecutivo | Texto | **Se digita a mano**, no lo genera la app — ver `existeConsecutivo()` |
| NumeroOrden | Texto | |
| FechaRecepcion | Fecha | |
| HoraLlegadaVehiculo / HoraInicioDesembarque / HoraFinalDesembarque | Fecha y hora | Ver nota de zona horaria abajo |
| AsociadoId | Lookup a Asociados | |
| GranjaId | Lookup a Granjas | |
| NumeroTotalCerdos | Número | |
| PesoPromedioGranja | Número | |
| PlacaVehiculoId | Lookup a Vehiculos | |
| GuiaSanitariaICA / RemisionGranja | Texto | |
| QRLote / CertificadoInmunocastracion / CoincideGuiaICAvsQR | Sí/No | |
| NovLlegadaLesionados / NovLlegadaCaidos / NovLlegadaAgitados | Sí/No | |
| NovLlegadaCantLesionados / NovLlegadaCantCaidos / NovLlegadaCantAgitados | Número | |
| FortuitoMuertoTransporte / FortuitoMuertoDesembarque | Sí/No | |
| FortuitoCantMuertoTransporte / FortuitoCantMuertoDesembarque | Número | |
| SuciedadCerdos | Elección (Alta/Baja) | |
| Observaciones | Texto multilínea | |
| EstadoLote | Elección (En proceso/Completo) | |
| EstadoSync / CapturadaEn / RecibidaEn | Texto / Fecha | Ver sección 6 |

**Zona horaria de HoraLlegadaVehiculo / HoraInicioDesembarque / HoraFinalDesembarque**: SharePoint no
tiene un tipo de columna "solo hora", así que estos tres campos se guardan como fecha-hora completa
(`FechaRecepcion` + la hora digitada), con un offset FIJO `-05:00` (Colombia no tiene horario de
verano) armado por `combinarFechaHora()` en `src/features/recepcion/Recepcion.tsx` — no depende de
cómo tenga configurada la hora el dispositivo que capturó. Para que las vistas nativas de SharePoint
(no solo la app) también muestren la hora correcta, configura el sitio con la zona horaria
**(UTC-05:00) Bogotá, Lima, Quito** en Configuración del sitio → Configuración regional.

### Ubicaciones
| Columna | Tipo | Notas |
|---|---|---|
| Title | (la de siempre) | El código nunca la llena — desmarcar su obligatoriedad |
| RecepcionId | **Texto** (no Lookup) | Guarda el id numérico real de la Recepción; se referencia por texto, no por una relación Lookup, para poder capturar Ubicación sin conexión antes de que la Recepción exista formalmente en SharePoint. Recomendado indizarla. |
| PesoPromedioPlanta | Número | |
| CorralesDesignados | Texto | |
| CoincidenciaNumAnimales | Sí/No | |
| Observaciones | Texto multilínea | |
| EstadoSync / CapturadaEn / RecibidaEn | Elección / Fecha | Ver sección 6 |

### NovedadesCorral
| Columna | Tipo | Notas |
|---|---|---|
| Title | (la de siempre) | El código nunca la llena — desmarcar su obligatoriedad |
| RecepcionId | **Texto** (no Lookup) | Mismo motivo que en Ubicaciones. Recomendado indizarla. |
| MuertoReposo | Sí/No | |
| CantMuertoReposo | Número | |
| ComportamientoSexual | Sí/No | |
| DisponibilidadAgua | Sí/No | |
| EstadoSync / CapturadaEn / RecibidaEn | Elección / Fecha | |

### ConsolidadoTiquetes
| Columna | Tipo | Notas |
|---|---|---|
| Title | (la de siempre) | El código nunca la llena — desmarcar su obligatoriedad |
| RecepcionId | **Texto** (no Lookup) | Mismo motivo que en Ubicaciones — las filas las crea el propio proceso de sincronización, nunca se capturan a mano. Recomendado indizarla. |
| GrupoNovedad | Elección (Fortuito / Novedad de llegada) | |
| TipoNovedad | Elección (Muerto en Transporte / Muerto en Desembarque / Muerto en Reposo / Lesionado / Caído / Agitado) | |
| NumeroAnimalEnLote | Número | 1, 2, 3… dentro del mismo Tipo |
| Tiquete | Texto | Lo diligencia la persona en Consolidado |
| Destino | Elección (Procesado / Decomisado) | |
| Factura | Texto | Solo aplica a Fortuitos |
| FechaDespacho / FechaBeneficio | Fecha | |
| EstadoTiquete | Elección (Pendiente / Completo) | Se calcula solo: Completo cuando Tiquete y Destino ya están |

### RecepcionLog
| Columna | Tipo | Notas |
|---|---|---|
| Title | (la de siempre) | El código nunca la llena — desmarcar su obligatoriedad |
| RecepcionId | Texto | El spId real de la Recepción |
| Usuario | Texto | Correo de quien sincronizó |
| Accion | Texto | |
| DetalleJson | Texto multilínea | |
| CreadoEn | Fecha y hora | |

## 5. Autenticación

Un Administrador de M365 debe:
1. Agregar la app al mismo registro de Entra ID que usan las demás apps de Cercafe (o crear uno
   nuevo si esta es la primera), con `Sites.ReadWrite.All` consentido para todo el tenant.
2. Agregar `http://localhost:5173/` (desarrollo) y la URL de GitHub Pages (producción) como Redirect
   URIs de tipo SPA.
3. Crear los 4 grupos de seguridad en SharePoint (Administradores / Supervisores / Auditores /
   Consulta) con los permisos correspondientes sobre el sitio, y agregar a cada persona según su Rol
   real — la columna `Rol` en Usuarios es solo para la interfaz, el permiso real vive en estos
   grupos (sección 2).

## 6. Offline-first

Todo lo que se captura en el dispositivo se guarda primero en IndexedDB (Dexie, `src/offline/db.ts`)
con un **id local** (UUID) y `EstadoSync: 'Pendiente'` — nunca se intenta escribir a Graph desde la
pantalla de captura. `sincronizar()` (`src/offline/syncService.ts`) sube la cola completa cuando hay
conexión, en un orden fijo: primero Recepciones (de ellas dependen las demás), luego Ubicación y
Novedades en Corral, y al final las ediciones de tiquetes en Consolidado.

Cada registro capturado sin conexión tiene dos identificadores:
- `id` — el UUID local, que nunca cambia. Los registros hijos (Ubicación, NovedadCorral) lo usan
  para referenciar a su Recepción padre desde el instante de la captura, esté o no sincronizada.
- `spId` — el id real que asigna SharePoint, que solo existe después de sincronizar. Es lo único que
  hace falta para mandar a Graph el lookup correcto al sincronizar un registro hijo — por eso el
  orden de sincronización no es negociable.

**Consecutivo repetido**: como se digita a mano, dos dispositivos sin conexión pueden capturar el
mismo Consecutivo por error. Eso solo se puede detectar al sincronizar (`existeConsecutivo()`,
requiere internet) — si ya existe, la Recepción queda en `EstadoSync: 'ConflictoConsecutivo'` en vez
de subirse, y un Administrador debe revisarla a mano (la Navbar muestra un aviso cuando hay alguna).

## 7. Qué falta por construir

- Pantallas de administración para Granjas, Vehículos y Usuarios (siguen exactamente el patrón de
  `src/features/catalogos/AsociadosAdmin.tsx` — ver el comentario al inicio de ese archivo).
- Bitácora visible en pantalla de `RecepcionLog` (hoy solo se escribe, no se consulta desde la app).
- Reintentos con backoff en `sincronizar()` para errores transitorios de red (hoy reintenta en la
  siguiente sincronización manual o automática, pero sin backoff explícito).
- Pruebas automatizadas (unitarias para `generarTiquetesFaltantes` / `generarTiqueteMuertoReposo`,
  que son la lógica más delicada de todo el sistema).

## 8. Correcciones aplicadas después de la primera entrega

- `crearRecepcionEnSharePoint()` esparcía `AsociadoId`/`GranjaId`/`PlacaVehiculoId` directo al cuerpo
  de la petición a Graph, pero esas son columnas Lookup — Graph solo las acepta como
  `<Columna>LookupId` con el id numérico. Se corrigió con `mapRecepcionAFields()` en
  `src/graph/lists.ts`, que arma esos tres campos a mano y deja el resto igual.
- `actualizarUsuario()` tenía el mismo problema con `AsociadosAsignados`/`GranjasAsignadas` (Lookup de
  varios valores) — se corrigió de la misma forma.
- `HoraLlegadaVehiculo`/`HoraInicioDesembarque`/`HoraFinalDesembarque` pasaron de columna de Texto a
  Fecha y hora (a pedido del usuario, para poder ordenar/filtrar por hora dentro de SharePoint) — ver
  la nota de zona horaria en la sección 4 y `combinarFechaHora()` en `Recepcion.tsx`.
