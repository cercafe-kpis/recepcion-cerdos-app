# Arquitectura de datos — App Recepción de Cerdos

Diseño técnico (DBA) para la app de captura de datos al ingreso de cerdos a la planta de beneficio de CercafeIA.

## Plataforma acordada (actualizada 2026-09-01 — reemplaza la decisión de Power Apps)

Al mostrarme la estructura real del repositorio `cercafe-kpis/auditoria-HGP7` (otra app interna de
Cercafe ya en producción), el usuario pidió construir esta app con **esa misma estructura**, no como
Power Apps. Esa app real resultó ser un patrón más concreto y ya probado que lo que yo había
diseñado, así que reemplacé la decisión de frontend:

- Backend: listas de SharePoint (misma dinámica que otras apps de Cercafe) — esto no cambió.
- **Frontend: SPA en React 19 + TypeScript + Vite**, publicada como sitio estático en GitHub Pages
  (no Power Apps).
- **Datos**: Microsoft Graph API contra las listas de SharePoint, llamado directamente desde el
  navegador — no hay backend propio ni Power Automate.
- **Autenticación**: Microsoft Entra ID (`@azure/msal-browser`/`@azure/msal-react`), reutilizando a
  propósito el mismo registro de aplicación que las demás apps de Cercafe (evita pedirle a IT un
  nuevo consentimiento de permisos por cada app).
- **Debe funcionar sin conexión** (confirmado con el usuario): en vez de las colecciones locales de
  Power Apps, la versión React usa **Dexie (IndexedDB)** + una cola de sincronización con
  idempotencia por UUID — ver "Funcionamiento sin conexión" más abajo, actualizado a este mecanismo.
- El Rol vive como columna de Elección en la lista `Usuarios` — no hay una lista `Perfiles` separada
  (así lo hace `auditoria-HGP7`; ver "Listas del modelo").

## Actualización 2026-09-02 — puesta en producción y ajustes de datos

Durante las primeras pruebas reales se corrigieron varios problemas de arranque (formato de
`VITE_SP_SITE_PATH`, header `Prefer: HonorNonIndexedQueriesWarningMayFailRandomly` para `$filter`
sobre columnas no indexadas, una condición de carrera en el login, y un `SchemaError` de Dexie por
falta de índice en `CapturadaEn`) y se construyeron las pantallas de administración que quedaban
pendientes: Granjas, Vehículos y Usuarios (esta última con creación de usuario, ver más abajo por
qué crear el registro no equivale a dar acceso real).

Cambio de modelo de datos en esta misma fecha: se agregó la lista maestra **`GruposAsociados`**
(solo `Title` + `Activo`, mismo patrón simple que las demás maestras) y un Lookup opcional de un
solo valor **`GrupoAsociadoId`** en `Asociados`, para poder clasificar los Asociados en grupos. Como
es un campo nuevo, los Asociados existentes quedan sin grupo hasta que se les asigne uno a mano
desde la pestaña "Asociados" (Administrar → Asociados, Granjas y Vehículos).
## Actualización 2026-09-09 — sincronización de Recepciones rota por truncamiento de nombre interno en SharePoint (corregido)

Nathalia reportó que ninguna Recepción nueva estaba sincronizando ("Todavía no hay ninguna recepción
sincronizada en este dispositivo") y capturas de pantalla con el error de Graph `400 invalidRequest:
Field 'NovLlegadaLesionadosBeneficioEmergencia' is not recognized`, para las 6 columnas de "¿se
benefició de emergencia?" (de los lesionados/caídos/agitados de llegada, cuáles NO se recuperaron y
tocó beneficiar de emergencia — esos son los que generan tiquete en Consolidado).

**Causa real (no lo que se pensó al principio)**: la primera hipótesis fue que esas 6 columnas nunca
se habían creado en la lista `Recepciones` de SharePoint — resultó ser incorrecta. Nathalia confirmó
con capturas de "Configuración de lista" que las 6 columnas SÍ existían, con el nombre para mostrar y
el tipo correctos, y el error de Graph seguía idéntico. La causa real, encontrada revisando con ella
la URL de "Editar columna" (que sí muestra el nombre INTERNO real en `?Field=...`, a diferencia de la
lista de columnas): **SharePoint corta a 32 caracteres el nombre interno de una columna** (el que de
verdad usa Graph al leer/escribir) cuando el nombre que se escribe al crearla es más largo — aunque en
pantalla la columna se siga viendo con el nombre completo. Las 6 columnas tienen nombres de 35 a 44
caracteres, todas por encima de ese límite, así que su nombre real en SharePoint no coincidía con el
nombre completo que usaba el código. Confirmado empíricamente para 3 de las 6 con las URLs que envió
Nathalia; los otros 3 se calcularon con la misma regla (primeros 32 caracteres) y coincidieron.

**Corrección** (sin tocar nada en SharePoint): se agregó en `src/graph/lists.ts` una constante
`NOMBRE_SP_BENEFICIO_EMERGENCIA` que mapea el nombre completo de cada columna (el que usa el resto de
la app: tipos, formularios, reportes) hacia su nombre interno real en SharePoint (los primeros 32
caracteres). Se usa solo dentro de `mapFieldsARecepcion` (lectura desde Graph) y
`mapRecepcionAFields` (escritura hacia Graph) — el resto de la app sigue usando los nombres completos
sin ningún cambio. Nathalia confirmó que la sincronización quedó funcionando tras esta corrección.

**No hubo pérdida de datos**: las Recepciones capturadas mientras el problema estuvo activo quedaron
guardadas en el dispositivo (Dexie, `EstadoSync: 'Pendiente'`) y se sincronizaron solas, sin volver a
capturarlas, en el primer intento de sincronización después del arreglo.

## Listas del modelo
**Maestras** (solo Administrador crea/edita): Usuarios (con columna `Rol`, no hay lista Perfiles aparte), Asociados, GruposAsociados (clasifica Asociados, ver actualización 2026-09-02), Granjas, Vehiculos (placas).

**Transaccionales**:
- `Recepciones` (Botón 1) — encabezado del lote, llave de todo lo demás (Consecutivo + Número de Orden).
- `Ubicaciones` (Botón 2) — 1 registro por lote, ligado por `RecepcionId`.
- `NovedadesCorral` (Botón 3) — pensado como 1 registro por lote, ligado por `RecepcionId` (nada lo
  hace cumplir hoy — ver el bug del 2026-09-10 más abajo y "Pendiente"). Desde 2026-09-10 tiene 12
  columnas nuevas para "Novedad en corral" (Lesionado/Caído/Agitado) — ver el punto 2 de "Decisiones
  clave de diseño" y "Sesión del 2026-09-10" abajo para la lista exacta.
- `ConsolidadoTiquetes` (Botón 4) — **N registros por lote**, uno por cada cerdo con novedad. Su
  columna `Destino` es de Elección (Procesado/Decomisado, y desde 2026-09-10 también "Decomisado en
  canal" — ver "Sesión del 2026-09-10").
- `RecepcionLog` — bitácora de auditoría (quién sincronizó qué y cuándo).
- ~~`LlegadasPendientes`~~ (agregada 2026-09-11, segunda ronda rediseñada; retirada por completo en la
  octava ronda del mismo día, a pedido de Nathalia — ver el punto 9 de "Decisiones clave de diseño" y
  "Sesión del 2026-09-11 (octava ronda)" más abajo). La lista en SharePoint no se borró, pero la app
  ya no la usa para nada.

Las 4 listas transaccionales tienen además `EstadoSync` (Pendiente/Sincronizada/ConflictoConsecutivo), `CapturadaEn` (hora real del dispositivo) y `RecibidaEn` (hora en que SharePoint recibió el registro).
## Decisiones clave de diseño
1. **Campos de Cantidad nuevos**: el Excel original solo tenía Sí/No por cada condición de novedad (lesionado, caído, agitado, muerto en transporte/desembarque/reposo). Se agregó un campo "Cantidad" junto a cada uno en `Recepcion` y `NovedadesCorral`, porque el Consolidado necesita saber cuántos cerdos afectados hay para generar esa cantidad de tiquetes individuales. Confirmado con el usuario (opción recomendada).
2. **Consolidado = vista + lista de tiquetes por animal**: no es una lista que se llena desde cero. Es una vista agregada (fecha, granja, consecutivo, orden, cantidad) sobre Recepción + NovedadesCorral, más la lista `ConsolidadoTiquetes` con una fila por cerdo. En la versión React esa explosión (una fila por unidad de Cantidad) la generan `generarTiquetesFaltantes()` (para lo que viene de Recepción) y `generarTiquetesNovedadCorral()` (para lo que viene de NovedadCorral — se llamaba `generarTiqueteMuertoReposo()` antes de ampliarla el 2026-09-10, ver abajo) en `src/graph/lists.ts`, disparadas automáticamente justo después de que su Recepción/NovedadCorral padre termina de sincronizar — reemplazan al flujo de Power Automate de la decisión original. Ahí se captura Tiquete, Destino (Procesado/Decomisado/Decomisado en canal — esta tercera opción agregada 2026-09-10, ver "Sesión del 2026-09-10"), y para Fortuitos también Factura, Fecha despacho y Fecha beneficio.
   - **Cierre del lote y candado de edición** (`src/features/consolidado/Consolidado.tsx`,
     rediseñado 2026-09-09 — ver "Segunda sesión" abajo para el porqué): un tiquete individual queda
     automáticamente `EstadoTiquete: 'Completo'` (calculado en `actualizarTiquete()`,
     `src/graph/lists.ts`) apenas tiene Tiquete + Destino — Factura no cuenta para ese cálculo,
     incluso en los Fortuitos que sí la usan. Los campos de la tabla de Consolidado
     (Tiquete/Destino/Factura) se pueden editar libremente, en cualquier orden y en varias sesiones,
     mientras el lote siga "En proceso" — el único candado es manual: el botón "Terminar proceso"
     marca `Recepcion.EstadoLote = 'Completo'` (vía `marcarLoteCompleto()`) y de ahí en adelante solo
     un Administrador puede seguir editando (quien además tiene "Reabrir proceso" para deshacerlo).
     Ya no existe ningún cierre automático — antes `cerrarLotesCompletos()` en `syncService.ts` lo
     hacía sola en cuanto todos los tiquetes tenían Tiquete+Destino, lo que podía bloquear un
     Fortuito antes de alcanzar a ponerle la Factura; se retiró por pedido explícito de Nathalia,
     precisamente porque el proceso se hace en varias partes/sesiones y necesitaba un punto final
     explícito en vez de uno adivinado por el sistema.
   - **Candado adicional, por TIQUETE individual (2026-09-11, quinta ronda)**: el candado de arriba
     es por LOTE completo; aparte de ese, Auditor y Supervisor ahora tienen un candado más fino en
     `filaSoloLectura()` (`Consolidado.tsx`): pueden completar cualquier tiquete que siga vacío —
     viejo o recién generado por una Ubicación/Novedad en Corral nueva — pero en cuanto un tiquete
     YA tiene Tiquete+Destino cargados (`EstadoTiquete === 'Completo'`), solo un Administrador puede
     seguir modificándolo. Antes, mientras el lote seguía "En proceso", cualquier perfil que no
     fuera Consultor podía editar CUALQUIER tiquete, incluido uno que otra persona ya había
     completado — Nathalia reportó esto como el comportamiento real de Auditor y pidió cerrarlo. El
     candado de LOTE sigue igual (Administrador siempre puede seguir editando un lote ya cerrado,
     viejo y nuevo — confirmado explícitamente que se deja así, ver más abajo).
   - **Mismo candado en Ubicación y Novedades en Corral** (`src/features/ubicacion/Ubicacion.tsx`,
     `src/features/novedades-corral/NovedadesCorral.tsx`, agregado 2026-09-09): ninguna de las dos
     pantallas revisaba `EstadoLote` — se podía seguir agregando Ubicación o Novedades en Corral a
     una Recepción ya cerrada con "Terminar proceso", sin ningún aviso. Ahora el selector de
     Recepción de ambas oculta las que ya están `EstadoLote: 'Completo'` para todos menos
     Administrador (que sí las ve, marcadas "(cerrada)" en el propio selector) — mismo criterio que
     Consolidado. Nota aparte, no resuelta: ninguna de las dos pantallas impide crear un SEGUNDO
     registro de Ubicación o Novedades en Corral para la misma Recepción (el modelo espera "1 por
     lote" pero nada lo hace cumplir) — esto SÍ llegó a causar un bug real, ver la quinta ronda de
     "Sesión del 2026-09-10" más abajo; sigue apuntado en "Pendiente" por si conviene cerrarlo de
     raíz (impedir el segundo registro en la UI) más adelante.
   - **Visibilidad entre dispositivos**: el selector de Recepción de Consolidado solo lista lo que ya
     está en Dexie de ESE dispositivo, y lo único que se trae solo (sin pedirlo) son las Recepciones
     todavía "En proceso" (`descargarRecepcionesEnProceso()`/`listarRecepcionesEnProceso()`, filtrado
     por `EstadoLote eq 'En proceso'` — a propósito, para no descargar cada vez más historial con los
     meses). Una Recepción ya cerrada (con "Terminar proceso", o antes con la regla automática vieja)
     en OTRO dispositivo nunca llega sola a un dispositivo nuevo — solo si ese dispositivo la trajo
     mientras todavía estaba "En proceso". Se agregó un buscador manual por fecha en Consolidado
     (`listarRecepcionesPorRangoFecha()`, ya existente y usado también en Reporte.tsx) que trae
     cualquier Recepción sincronizada de una fecha exacta a Dexie de ese dispositivo, esté completa o
     no, sin pisar nada si ya existía localmente. **Revisado 2026-09-11 (quinta ronda)**: el
     desplegable de Consolidado, con los meses, había vuelto a acumular TODO lo que cada dispositivo
     hubiera traído alguna vez a Dexie (nada lo purga) — se agregó también un buscador por
     Consecutivo (`buscarRecepcionesPorConsecutivo()`, exacto, sin importar fecha) y, por defecto, el
     desplegable ahora solo muestra las Recepciones de HOY; lo que cualquiera de los 2 buscadores
     encuentre se queda visible aparte, sin volver a mostrar todo el historial. Ver el detalle en
     "Sesión del 2026-09-11 (quinta ronda)" más abajo. **Extendido a Ubicación y Novedades en Corral
     en la sexta ronda** (mismo día) — ver más abajo.
   - **"Novedad en corral" — Lesionado/Caído/Agitado ocurridos DESPUÉS de la llegada** (agregado
     2026-09-10, a pedido de Nathalia, ver "Sesión del 2026-09-10" abajo): `NovedadesCorral.tsx` ya
     tenía "Muerto en reposo" con el mismo patrón; ahora agrega Lesionado/Caído/Agitado con
     EXACTAMENTE el mismo patrón que las novedades de LLEGADA en `Recepcion.tsx` (checkbox +
     cantidad total, y si alguno no se recuperó y tocó beneficiarlo de emergencia, checkbox +
     cantidad de eso — solo esa segunda cantidad genera tiquete en Consolidado). Para que Consolidado
     pueda distinguir un Lesionado/Caído/Agitado de LLEGADA de uno de CORRAL (son eventos distintos,
     ambos pueden pasarle al mismo lote), se agregó un tercer valor al tipo `GrupoNovedad`:
     `'Novedad en corral'` — la tabla de Consolidado ya mostraba `GrupoNovedad`/`TipoNovedad` tal
     cual vienen del dato, así que no hizo falta tocar esa pantalla para que se vean igual que las
     demás novedades (columna "Grupo" = "Novedad en corral", sin Factura, igual que "Novedad de
     llegada").
     - **Bug evitado, no solo corregido**: el conteo de "cuántos tiquetes de este tipo ya existen"
       (para no duplicar filas) filtraba SOLO por `TipoNovedad`, nunca por `GrupoNovedad` — inofensivo
       mientras "Lesionado"/"Caído"/"Agitado" solo existía bajo un grupo. Al agregar el mismo
       `TipoNovedad` bajo un segundo grupo, ese filtro se corrigió en `generarTiquetesFaltantes()` y
       `generarTiquetesNovedadCorral()` (ambas en `src/graph/lists.ts`) para exigir grupo Y tipo —
       si no, un Lesionado de llegada y uno de corral en el mismo lote se hubieran mezclado en la
       misma numeración y uno de los dos hubiera terminado sin su tiquete.
     - **12 columnas nuevas requeridas en la lista `NovedadesCorral` de SharePoint** — la app no crea
       columnas sola, hay que crearlas a mano ANTES de usar esta función (si no, Graph las rechaza
       con el mismo tipo de error 400 del incidente de truncamiento del 2026-09-09). Nombres
       elegidos deliberadamente CORTOS (máximo 30 caracteres) para no repetir ese problema —
       "BenefEmerg" en vez de "BeneficioEmergencia":
       - `CorralLesionados` (Sí/No), `CorralCantLesionados` (Número)
       - `CorralLesionadosBenefEmerg` (Sí/No), `CorralCantLesionadosBenefEmerg` (Número)
       - `CorralCaidos` (Sí/No), `CorralCantCaidos` (Número)
       - `CorralCaidosBenefEmerg` (Sí/No), `CorralCantCaidosBenefEmerg` (Número)
       - `CorralAgitados` (Sí/No), `CorralCantAgitados` (Número)
       - `CorralAgitadosBenefEmerg` (Sí/No), `CorralCantAgitadosBenefEmerg` (Número)
     - **Ya incluido en los reportes** (ver "Sesión del 2026-09-10", cuarta y quinta ronda, abajo):
       `ReporteDiarioLote.tsx` (columnas Lesión/Agitados/Caídos) y `ReporteSemanalAsociado.tsx`
       (mismos 3 conteos, en el resumen semanal, por granja, por vehículo y en el detalle por lote)
       ahora suman el total de "Novedad en corral" (`CorralCantLesionados`/`CorralCantCaidos`/
       `CorralCantAgitados`, el total crudo, no el de Benef.Emergencia) junto con el de "Novedad de
       llegada" — en la MISMA celda/columna que ya existía, sin agregar columnas nuevas, para no
       alterar el formato de la plantilla en papel ni el del PDF "Informe Semana N" de referencia.
       Los tiquetes de corral ya aparecían correctamente en la tabla de Consolidado y en
       `ResumenRecepcion.tsx` desde la ronda anterior. Ver la quinta ronda para un bug real que esto
       destapó (`obtenerNovedadCorralDeRecepcion()` solo leía UN registro de NovedadCorral por
       Recepción, y nada impide que existan varios).
3. **Permisos en dos capas** (SharePoint no distingue nativamente "solo capturar" de "solo consultar"):
   - Grupos SharePoint/M365 (capa de seguridad real): Administradores (control total), Supervisores+Auditores (colaborar en transaccionales, lectura en maestras), Consulta (solo lectura).
   - Reglas dentro de la app (capa de interfaz únicamente), leyendo el Rol del usuario desde la lista `Usuarios` (`src/components/ProtegidoPorRol.tsx`): Auditor ve los botones de captura pero no edita en Consolidado; Consultor ve todo en solo lectura. El cumplimiento real sigue siendo el grupo de SharePoint, no esta capa. Crear o reactivar un usuario desde la pantalla de administración (`UsuariosAdmin.tsx`) solo controla esta capa de interfaz — el acceso real de lectura/escritura en SharePoint sigue siendo un paso manual aparte (agregar la cuenta al grupo del sitio correspondiente).
4. **Funcionamiento sin conexión** (confirmado: offline real, seguir en SharePoint): la versión React guarda los datos maestros en Dexie/IndexedDB (`src/offline/db.ts`, `descargarMaestros()`) y cada captura nueva se guarda ahí mismo con un `id` local (UUID) que nunca cambia, más un `spId` (id real de SharePoint) que se completa recién al sincronizar. Los registros hijos (Ubicación, NovedadCorral) referencian a su Recepción padre por `id` desde el instante de la captura, offline o no; `sincronizar()` (`src/offline/syncService.ts`) sube la cola en orden fijo (Recepciones primero) cuando hay conexión. Riesgos vigentes: pérdida de datos si el dispositivo se pierde antes de sincronizar; Consolidado no puede mostrar tiquetes de una Recepción que aún no sincronizó (esas filas las crea el propio proceso de sync); un lote capturado en dos dispositivos distintos requiere que el primero sincronice antes de que el segundo lo vea en Consolidado (mitigado desde 2026-09-09 con el buscador por fecha, ver el punto 2 de arriba).
5. **Consecutivo: se digita manualmente** (corrección del usuario sobre la decisión #4 original — no lo genera el sistema). Es el consecutivo que ya manejan en planta. Como se puede capturar sin conexión, no se puede validar su unicidad en el momento; al sincronizar, `existeConsecutivo()` revisa si ya existe en SharePoint y, si hay choque, marca el registro como `EstadoSync: 'ConflictoConsecutivo'` para que el Administrador lo resuelva a mano (la barra superior de la app avisa cuántos hay), en vez de crear un duplicado silencioso.
6. **Formato/tipo de campos de captura, ajustados a pedido de Nathalia (2026-09-10)** — ver
   "Sesión del 2026-09-10" abajo para el detalle de implementación:
   - `GuiaSanitariaICA` (Recepción): sigue siendo Texto en SharePoint, pero el formulario ahora fuerza
     el formato "3 cifras - resto" mientras se escribe (ej. "026-445555552"), en vez de aceptar
     cualquier texto.
   - `RemisionGranja` (Recepción): pasó de texto libre a una elección `'Sí' | 'No'` en la app — sin
     cambiar el tipo de columna en SharePoint (sigue siendo Texto; se escriben los literales
     "Sí"/"No").
   - `PesoPromedioGranja` (Recepción) y `PesoPromedioPlanta` (Ubicación): ambos aceptan ahora coma o
     punto como separador decimal al escribir (ej. "120,15"), corrigiendo un problema de teclado
     numérico en español que no dejaba escribir ningún separador decimal en el
     `<input type="number">` nativo. No requirió ningún cambio en SharePoint — esas columnas ya
     aceptaban decimales; el bloqueo estaba solo en el campo del formulario.
7. **`BeneficiadoMismoDia` (Recepción), agregado 2026-09-11** — ver "Sesión del 2026-09-11" abajo
   para el detalle completo: campo aparte de `EstadoLote`, marcado a mano desde la pestaña "Cierre
   diario" de `Reporte.tsx`, que digitaliza la práctica de pintar de azul en Excel la celda de
   cantidad de los lotes ya beneficiados el mismo día.
8. **Intento REVERTIDO — `HoraInicioDesembarque`/`HoraFinalDesembarque` (Recepción) opcionales
   (segunda ronda del 2026-09-11, primer diseño)**: se probó hacer estas 2 horas opcionales en
   `Recepcion` para poder registrar la llegada de un camión sin esperar a que desembarcara. Nathalia
   rechazó este cambio ANTES de usarlo en producción: el problema real no eran solo esas 2 horas —
   TODO lo demás del formulario (cantidad de animales, peso, novedades, etc.) también se conoce
   recién cuando el desembarque ya terminó, porque el formulario de Recepción se llena completo en
   una sola vez, nunca por partes. Relajar solo 2 campos hubiera dejado un Recepción a medias con un
   hueco distinto (y peor) al que se quería cerrar. Ver el punto 9 (diseño intermedio, también
   retirado) y el punto 11 (diseño final, vigente) más abajo.
9. **`LlegadaPendiente` — RETIRADO POR COMPLETO en la octava ronda del 2026-09-11 (ver el punto 11 y
   "Sesión del 2026-09-11 (octava ronda)" más abajo)**. Este fue el diseño intermedio: en vez de tocar
   `Recepcion` (que no cambiaba: seguía exigiendo sus 4 horas y llenándose una sola vez, completa,
   cuando el desembarque ya terminaba), se creó un registro APARTE y mínimo — `LlegadaPendiente`,
   lista `LlegadasPendientes` en SharePoint — con solo lo que YA se sabía apenas llegaba el camión
   (hora de llegada, Asociado, Granja, Consecutivo, y opcionalmente Número de orden/Placa/Guía
   sanitaria ICA/Número total de cerdos), que se resolvía solo por Consecutivo apenas existiera una
   Recepción completa del mismo día. Nathalia terminó pidiendo deshacerlo por completo: "el proceso
   no es así" — un lote puede llegar después de la jornada y esas 2 horas simplemente nunca se van a
   conocer, no es que se completen después con un registro y un botón aparte. Se deja este punto como
   registro histórico del diseño intermedio; el diseño VIGENTE es el punto 11.
10. **Autocompletar Recepción desde una LlegadaPendiente por Consecutivo (2026-09-11, tercera
    ronda) — RETIRADO junto con el punto 9** en la octava ronda del mismo día. Existió mientras
    `LlegadaPendiente` existió: un botón ("Cargar datos de llegada en espera") evitaba reingresar
    Asociado/Granja/N. Orden/Placa/Hora de llegada cuando ese camión ya se había registrado como "en
    espera". Se deja este punto como registro histórico; ya no existe ningún botón ni función
    equivalente.
11. **Diseño FINAL y VIGENTE — `HoraInicioDesembarque`/`HoraFinalDesembarque` (Recepción) opcionales,
    sin ningún registro aparte (2026-09-11, octava ronda — reemplaza los puntos 8, 9 y 10)**:
    Nathalia pidió deshacer por completo el subsistema de `LlegadaPendiente`/"Llegada en espera" del
    punto 9 — el proceso real no necesita un pre-registro separado, solo que estas 2 horas puedan
    quedar en blanco cuando el lote llega después de la jornada. A diferencia del intento revertido
    del punto 8 (que SOLO relajaba estas 2 horas mientras el resto del formulario seguía exigiendo
    los mismos datos que solo se conocen al terminar el desembarque), aquí la objeción original de
    Nathalia ya no aplica: el resto del formulario sigue llenándose completo, una sola vez, cuando el
    desembarque termina — lo único que cambia es que, si nunca hubo desembarque registrado para ese
    lote (llegó tarde, quedó para el día siguiente, etc.), estas 2 horas simplemente se guardan en
    blanco en vez de forzar un dato inventado. `Recepcion.tsx` volvió a ser una sola pantalla, sin
    pestañas. Ver "Sesión del 2026-09-11 (octava ronda)" más abajo para el detalle completo.

## Perfiles
- Administrador: crear, capturar y consultar todo, incluidas las maestras; es el único que puede
  seguir editando un lote ya cerrado ("Terminar proceso") y el único que puede modificar un tiquete
  que YA tiene Tiquete+Destino cargados (ver el candado por tiquete agregado en la quinta ronda de
  "Sesión del 2026-09-11").
- Supervisor: capturar y consultar (transaccionales); en Consolidado puede completar cualquier
  tiquete que siga vacío, pero no modificar uno que ya tenga Tiquete+Destino — mismo candado que
  Auditor (revisado 2026-09-11, quinta ronda; antes tenía edición completa mientras el lote
  siguiera abierto).
- Auditor: captura, y en Consolidado puede completar cualquier tiquete que siga vacío — no modificar
  uno que ya tenga Tiquete+Destino cargados, eso solo lo puede hacer un Administrador (revisado
  2026-09-11, quinta ronda; la primera versión de este documento decía "sin editar Tiquete/Destino
  en Consolidado, solo lo ve", que ya no aplica).
- Consultor: solo consultar (sin crear ni editar).
## Entregables generados

**Sesión del 2026-09-01 (fase de diseño, plataforma Power Apps — superada, ver arriba)**:
- `diccionario_datos.xlsx`, documento de arquitectura HTML y mockups estáticos de UI — el contenido
  de campos/tipos/permisos sigue siendo válido y quedó incorporado a la fase siguiente; lo que quedó
  obsoleto fue el frontend (Power Apps) y la sincronización vía Power Automate.

**Misma sesión, fase de construcción (plataforma real, tras conocer `cercafe-kpis/auditoria-HGP7`)**:
- Repositorio completo `recepcion-cerdos-app/` (Vite + React 19 + TypeScript), entregado como .zip:
  configuración (vite/tsconfig/oxlint/PWA/GitHub Actions), tipos de dominio, cliente de Microsoft
  Graph, autenticación MSAL, capa offline completa (Dexie + cola de sincronización con
  idempotencia), y las 6 pantallas: Login, Inicio, Recepción, Ubicación, Novedades en Corral,
  Consolidado (asignación de Tiquete/Destino por animal) y administración de Asociados (patrón de
  referencia para Granjas/Vehículos/Usuarios, documentado pero no construido aún).
- `Arquitectura-App-Recepcion-Cerdos.md` y `README.md` dentro del propio repositorio, con el
  detalle columna por columna de las 9 listas de SharePoint requeridas y los pasos de despliegue.
- Verificado: `tsc -b` y `oxlint` sin errores, `npm run build` genera el sitio completo (incluido el
  service worker de PWA) sin advertencias que bloqueen el build.

**Sesión del 2026-09-02 (primeras pruebas reales en producción)**:
- Corregidos los 4 problemas que bloqueaban el primer uso real (ver "Actualización 2026-09-02"
  arriba): sitio de SharePoint mal formado, columnas no indexadas en `$filter`, condición de
  carrera en el login tras redirect, y `SchemaError` de Dexie en `CapturadaEn`.
- Diagnosticado y corregido un problema más profundo de autenticación: `getAccessToken()`
  abría automáticamente una ventana emergente (`loginPopup`/`acquireTokenPopup`) cada vez que
  fallaba la renovación silenciosa del token, causando una ventana en blanco visible en cada
  carga de la app. Se comparó línea por línea contra `auditoria-HGP7` (que no tiene este problema)
  y se reescribió para que una renovación en segundo plano nunca sea interactiva: solo intenta
  `acquireTokenSilent` con límite de tiempo propio y lanza un error controlado si falla; el login
  interactivo real solo ocurre cuando la persona lo pide explícitamente (botón "Iniciar sesión" o
  "Salir" y volver a entrar).
- Construidas las pantallas de administración que quedaban pendientes: `GranjasAdmin.tsx`,
  `VehiculosAdmin.tsx`, `UsuariosAdmin.tsx` (con creación de usuario) y `GruposAsociadosAdmin.tsx`
  (nueva, ver cambio de modelo de datos arriba), unificadas bajo una sola pantalla con pestañas
  (`CatalogosAdmin.tsx`) en la ruta `/admin/asociados`.
- Simplificada la pantalla de Inicio: tenía tarjetas grandes que repetían exactamente los mismos
  destinos que ya están en la barra de navegación de arriba (visible en todas las páginas) —
  quedaba duplicado, sobre todo en celular. Se quitaron las tarjetas y se dejó solo el saludo y el
  acceso a administración.
- Ícono de la app (pestaña del navegador, pantalla de login, barra superior e ícono de instalación)
  reemplazado por un cerdito sobre el mismo azul marino de la marca, a pedido del usuario.

**Sesión del 2026-09-08/09 (reportes en PDF y diagnóstico de sincronización)**:
- Reemplazado el botón "Imprimir / Descargar PDF" (que abría el diálogo de impresión del navegador)
  por generación directa de PDF (jsPDF, imagen convertida a JPEG para no inflar el peso del archivo)
  con intento de compartir directo por la Web Share API en celular — a pedido de Nathalia, para
  poder enviarlo por WhatsApp sin pasar por la vista previa de impresión.
- Corregido el service worker del PWA para que las actualizaciones publicadas sí lleguen al celular
  (faltaba `skipWaiting`/`clientsClaim`, que `vite-plugin-pwa` solo activa solo cuando el registro es
  automático — este proyecto lo hace a mano para poder revisar cada cierto tiempo). Ver
  `registrarServiceWorker.ts`: a propósito NO se recarga sola la página cuando hay una versión
  nueva instalada (para no perder un formulario a medio llenar) — se avisa con el botón "Actualizar
  ahora" en la barra de navegación, y la persona decide cuándo recargar. Importante para diagnosticar
  cualquier reporte de "no veo el cambio que acaban de desplegar": primero confirmar que se tocó ese
  botón (o se cerró y volvió a abrir del todo la app), antes de asumir que el código no llegó.
- **Enlace `blob:...` de más al compartir el PDF por WhatsApp en iPhone — investigado a fondo, no es
  corregible desde JavaScript**: se probaron, en orden, quitar el pre-chequeo `canShare()`, agregar
  `target="_blank"` al enlace de respaldo, un diagnóstico con `window.alert()` (síncrono, no se lo
  puede saltar la navegación) para capturar el motivo exacto si `navigator.share()` fallaba, y por
  último separar "generar" de "compartir" en dos botones/toques distintos (por si armar el PDF tardaba
  lo suficiente para que Safari dejara de reconocer el toque original como gesto directo de la
  persona). Nathalia confirmó que el flujo de dos toques sí quedó activo, pero el enlace `blob:...`
  seguía apareciendo, y la alerta de diagnóstico nunca se disparó — es decir, `navigator.share()`
  termina bien, sin error: el enlace lo agrega el propio iOS/WebKit al manejar un archivo `Blob` en su
  hoja de compartir, algo que no se puede evitar desde el código de la app. Alternativa manual sin el
  enlace, comunicada a Nathalia: generar el PDF → tocar Compartir → "Guardar en Archivos" (no elegir
  un contacto de WhatsApp directo ahí) → adjuntarlo luego dentro de WhatsApp como documento (📎 →
  Documento → Recientes). Queda pendiente que Nathalia diga si prefiere dejar el botón de dos toques
  como está o simplificarlo, ya que de todos modos no elimina el enlace — ver "Pendiente" abajo.
- Ver "Actualización 2026-09-09" arriba: sincronización de Recepciones rota por el truncamiento a 32
  caracteres del nombre interno de 6 columnas de "¿se benefició de emergencia?" — corregido en código
  (`src/graph/lists.ts`), sin necesidad de tocar nada en SharePoint. Confirmado por Nathalia que quedó
  funcionando.

**Segunda sesión del 2026-09-09 (candado por lote → rediseñado a manual, y huecos relacionados)**:
- Primer intento, a pedido de Nathalia tras confirmar el arreglo de sincronización: bloquear cada
  tiquete individualmente (no solo el lote entero) apenas quedara "de verdad" completo (con Factura
  incluida para los Fortuitos). Al probarlo en el lote real, Nathalia encontró que el lote YA estaba
  cerrado por la regla automática vieja (`cerrarLotesCompletos()`, ver abajo) desde antes de que
  hubiera alcanzado a poner las facturas — así que los campos de Factura salían bloqueados sin poder
  completarlos, aunque la etiqueta dijera "Falta factura".
- **Rediseño definitivo** (reemplaza el intento anterior): a pedido explícito de Nathalia, se quitó
  el cierre automático por completo (`cerrarLotesCompletos()` en `syncService.ts`, retirada) y los
  campos quedan editables libremente mientras el lote siga abierto. Se agregó el botón manual
  **"Terminar proceso"** en Consolidado (con aviso si todavía faltan tiquetes por completar, dejando
  decidir a la persona) como único punto de cierre, y su contraparte **"Reabrir proceso"** (solo
  Administrador) para destrabar un lote que haya quedado cerrado por error — en particular, cualquiera
  cerrado por la regla vieja antes de este cambio. Ver el punto 2 de "Decisiones clave de diseño"
  arriba para el detalle completo.
- **Bug propio en el aviso de "Terminar proceso"**: la primera versión comparaba contra `EstadoTiquete`
  tal cual estaba en pantalla, que solo se actualiza con un refresco explícito contra SharePoint (no
  al guardar un campo) — Nathalia probó llenando TODO y el aviso igual decía "8 de 8 tiquetes faltan".
  Corregido: `terminarProceso()` ahora sincroniza y vuelve a traer los tiquetes primero, y revisa la
  copia fresca de Dexie (no la que ya tenía en el cierre del componente) antes de decidir si falta algo.
- Al probar el buscador de Recepciones en un computador distinto al que hizo la captura (desde el
  celular), Nathalia notó que dos Recepciones no aparecían en el selector de Consolidado. Causa:
  el selector solo lista lo que ya está en Dexie local, y la única descarga automática
  (`descargarRecepcionesEnProceso()`) trae solo Recepciones "En proceso" — una ya cerrada en otro
  dispositivo nunca llega sola. Se agregó un buscador manual por fecha (ver el punto 2 de
  "Decisiones clave de diseño" arriba) que trae cualquier Recepción sincronizada de una fecha exacta,
  esté completa o no. Ajuste de layout aparte: el botón "Buscar" de ese buscador quedaba montado
  encima del campo de fecha en celular (el `<input type="date">` nativo tiene un ancho mínimo propio
  que no cabía al lado del botón en pantallas angostas) — se apilan verticalmente en celular y solo
  quedan lado a lado desde tablet/computador.
- Nathalia preguntó por qué todavía se podía agregar Ubicación y Novedades en Corral a una Recepción
  ya cerrada — ninguna de las dos pantallas revisaba `EstadoLote` en absoluto. Corregido con el mismo
  criterio que Consolidado (ver el nuevo punto de "Decisiones clave de diseño" arriba).
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores ni advertencias nuevas en
  cada uno de los ajustes de esta sesión.
**Sesión del 2026-09-10 (ajustes de formato/tipo en campos de captura — por partes)**:
- Primera ronda, solo en Recepción (a pedido explícito de Nathalia: "por ahora vamos modificando por
  partes" — Novedades en Corral y Consolidado quedan para pedidos futuros separados):
  1. `GuiaSanitariaICA`: el campo ahora se autoformatea mientras se escribe para forzar siempre
     "3 cifras - resto" (ej. "026-445555552") — función `formatearGuiaICA()` en `Recepcion.tsx`, que
     se queda solo con los dígitos ya escritos y reconstruye el guion en la posición correcta (no
     importa si la persona pega el número completo o intenta borrar el guion a mano). Respaldo en
     `recepcionSchema.ts` con `.regex(/^\d{3}-\d+$/, ...)`. La columna en SharePoint sigue siendo
     Texto, sin cambios.
  2. `RemisionGranja`: pasó de `CampoTexto` (texto libre) a `CampoSelect` con opciones Sí/No —
     mismo patrón que ya usaba `SuciedadCerdos`. Se modeló como tipo `'Sí' | 'No'` (`models.ts`,
     `recepcionSchema.ts`) y NO como boolean, a propósito: la columna en SharePoint sigue siendo de
     tipo Texto (ver punto 6 de "Decisiones clave de diseño"), así que escribir los literales
     "Sí"/"No" no requiere ningún cambio de columna ni migración — se evita el mismo tipo de riesgo
     que causó el incidente de truncamiento a 32 caracteres (ver "Actualización 2026-09-09"). Se
     ajustó también `mapFieldsARecepcion` en `src/graph/lists.ts` (lectura desde Graph) para que
     cualquier valor que no sea exactamente "Sí" (vacío, o data vieja de cuando era texto libre) caiga
     a "No" en vez de fallar el tipo.
  3. `PesoPromedioGranja`: pasó de `<input type="number" step="0.1">` a `type="text"
     inputMode="decimal"`, con una función `formatearDecimal()` que normaliza lo escrito (cambia coma
     por punto, descarta cualquier otro caracter, y se queda con un solo separador si hay más de uno)
     antes de que react-hook-form guarde el valor — corrige que algunos celulares con teclado numérico
     en español no dejaban escribir ni coma ni punto en el `<input type="number">` nativo. No hizo
     falta tocar el schema: `z.coerce.number()` ya convierte el texto normalizado (con punto) a número
     al guardar.
  - Los 4 archivos de esta ronda deben subirse JUNTOS en el mismo commit: `src/types/models.ts`,
    `src/features/recepcion/recepcionSchema.ts`, `src/features/recepcion/Recepcion.tsx`,
    `src/graph/lists.ts`.
- Segunda ronda, mismo día: Nathalia pidió el mismo arreglo de decimales para `PesoPromedioPlanta`
  en Ubicación. Se aplicó exactamente el mismo patrón que `PesoPromedioGranja` (función
  `formatearDecimal()` propia, duplicada en `src/features/ubicacion/Ubicacion.tsx` — mismo texto que
  en `Recepcion.tsx`, sin extraerla a un módulo compartido porque cada formulario ya es independiente
  por diseño en esta app), cambiando el campo a `type="text" inputMode="decimal"`. No requirió ningún
  cambio en `ubicacionSchema.ts` (mismo `z.coerce.number()` de siempre) ni en SharePoint (la columna
  ya aceptaba decimales; el bloqueo estaba solo en el input del navegador). Archivo entregado:
  `src/features/ubicacion/Ubicacion.tsx` (no depende de los 4 de la primera ronda).
- **Tercera ronda, mismo día: "Novedad en corral" (Lesionado/Caído/Agitado) en Novedades en
  Corral** — ver el punto 2 de "Decisiones clave de diseño" arriba para el diseño completo (el nuevo
  valor de `GrupoNovedad`, el bug de conteo evitado, y las 12 columnas nuevas requeridas en
  SharePoint). Archivos que deben subirse JUNTOS en el mismo commit (independientes de las 2 rondas
  anteriores del mismo día):
  - `src/types/models.ts` (12 campos nuevos en `NovedadCorral`, nuevo valor en `GrupoNovedad`)
  - `src/features/novedades-corral/novedadCorralSchema.ts` (validación de las 3 parejas nuevas,
    mismo patrón que `recepcionSchema.ts`)
  - `src/features/novedades-corral/NovedadesCorral.tsx` (nueva sección "Novedad en corral" en el
    formulario, igual a "Novedad de llegada" en Recepción)
  - `src/graph/lists.ts` (lectura de los 12 campos nuevos en `obtenerNovedadCorralDeRecepcion()`,
    y `generarTiqueteMuertoReposo()` renombrada y ampliada a `generarTiquetesNovedadCorral()`)
  - `src/offline/syncService.ts` (usa la función renombrada)
  - `src/features/consolidado/Consolidado.tsx` (usa la función renombrada en el botón "Volver a
    generar tiquetes"; la tabla de tiquetes en sí no necesitó cambios — ya mostraba `GrupoNovedad`
    tal cual viene del dato)
  - **IMPORTANTE — paso manual en SharePoint antes de probar**: crear las 12 columnas nuevas en la
    lista `NovedadesCorral` (nombres y tipos exactos arriba, en "Decisiones clave de diseño") — sin
    esto, Graph rechaza la sincronización de cualquier Novedad en Corral que use estos campos, igual
    que en el incidente del 2026-09-09.
- **Cuarta ronda, mismo día: incluir "Novedad en corral" en los reportes** (a pedido de Nathalia,
  siguiendo directo de la tercera ronda) — hasta este punto `ReporteDiarioLote.tsx` y
  `ReporteSemanalAsociado.tsx` solo sumaban las novedades de LLEGADA de `Recepcion`, no las de
  "Novedad en corral" capturadas en la ronda anterior. Diseño elegido: **combinar los dos orígenes en
  la MISMA celda/columna que ya existía** (Lesión/Agitados/Caídos), en vez de agregar columnas o
  secciones nuevas — ambos reportes están documentados como réplicas fieles de un formato externo de
  referencia (la plantilla en papel del reporte diario, y el PDF "Informe Semana N" que Cercafe ya le
  envía a los asociados en el semanal), así que restructurarlos con columnas nuevas hubiera sido más
  riesgoso que sumar los totales. Se usa el total CRUDO de "Novedad en corral"
  (`CorralCantLesionados`/`CorralCantCaidos`/`CorralCantAgitados`, no el de Benef.Emergencia), igual
  que ya se hacía con el total crudo de "Novedad de llegada" — el mismo criterio que ya se usaba para
  sumar "Fortuito en reposo" a partir de los tiquetes generados.
  - `src/features/reportes/ReporteDiarioLote.tsx`: nueva prop opcional `novedadCorral?:
    NovedadCorral`; las 3 celdas de Lesión/Agitados/Caídos ahora muestran
    `NovLlegadaCant... + CorralCant...` en vez de solo `NovLlegadaCant...`.
  - `src/features/reportes/ReporteSemanalAsociado.tsx`: `sumarStats()` ahora recibe un 4° parámetro
    `novedadCorral: NovedadCorral | undefined` y lo suma a agitados/caidos/lesionados; nueva prop
    `novedadCorralPorRecepcion: Record<string, NovedadCorral>`; el resumen semanal, "Novedades por
    granja", "Vehículos con novedades" y el detalle por lote quedan todos combinando ambos orígenes.
  - `src/features/reportes/Reporte.tsx`: tanto la pestaña "Diario" como la "Semanal" ahora traen
    también, en paralelo a los tiquetes, la `NovedadCorral` de cada Recepción
    (`obtenerNovedadCorralDeRecepcion()`, ya existía, se reutiliza) y se la pasan a los componentes
    de reporte de arriba.
  - `src/features/consolidado/Consolidado.tsx`: el "reporte inmediato" (botón "Ver reporte del lote")
    ahora también trae la `NovedadCorral` de la Recepción elegida (mismo patrón que el `useEffect` ya
    existente que trae los tiquetes) y se la pasa a `ReporteDiarioLote`.
  - Los 4 archivos de esta cuarta ronda deben subirse JUNTOS en el mismo commit (independientes de
    las 3 rondas anteriores del mismo día): `src/features/reportes/ReporteDiarioLote.tsx`,
    `src/features/reportes/ReporteSemanalAsociado.tsx`, `src/features/reportes/Reporte.tsx`,
    `src/features/consolidado/Consolidado.tsx`.
- **Quinta ronda, mismo día: bug real en `obtenerNovedadCorralDeRecepcion()` — el reporte diario
  seguía sin mostrar la Novedad en Corral incluso después de la cuarta ronda**. Nathalia probó con un
  lote real (66666): capturó "Muerto en reposo" en un envío del formulario de Novedades en Corral, y
  más tarde, en un envío SEPARADO, capturó "Caído" para el mismo lote — algo que la app permite sin
  avisar (ver la nota ya existente en el punto 2 de "Decisiones clave de diseño" sobre que nada
  impide un segundo registro de Novedades en Corral por Recepción). El tiquete de "Caído" sí aparecía
  bien en la tabla de Consolidado (esa parte nunca dependió de esta función: cada NovedadCorral genera
  sus propios tiquetes en el momento de SU PROPIA sincronización, con los datos que trae en memoria),
  pero el reporte diario seguía mostrando "—" en Caídos.
  - **Causa raíz**: `obtenerNovedadCorralDeRecepcion()` (usada por la cuarta ronda para traer la
    Novedad en Corral a los reportes, y ya existía antes para el botón "Volver a generar tiquetes")
    consultaba SharePoint con `$top=1` — como para este lote había DOS registros de NovedadCorral
    (uno con Muerto en reposo, otro con Caído), Graph devolvía solo uno de los dos, y el reporte leía
    las cantidades de ESE registro nada más. Esta función nunca se había puesto a prueba antes con un
    lote que tuviera más de un registro de NovedadCorral real (el botón "Volver a generar tiquetes"
    casi no se usa, y la ruta automática de sincronización nunca pasa por aquí — usa el objeto en
    memoria directamente, por eso los tiquetes sí quedaban bien).
  - **Corrección**: `obtenerNovedadCorralDeRecepcion()` ahora trae TODOS los registros de
    NovedadCorral de esa Recepción (quitó el `$top=1`) y los combina: las cantidades
    (`CantMuertoReposo`, `CorralCantLesionados`, `CorralCantCaidos`, `CorralCantAgitados` y sus
    Benef.Emergencia) se SUMAN entre registros, y los indicadores Sí/No (`MuertoReposo`,
    `CorralLesionados`, `CorralCaidos`, `CorralAgitados`, `ComportamientoSexual`, y sus
    Benef.Emergencia) quedan en Sí si CUALQUIER registro lo marcó — así el resultado es correcto sin
    importar en cuántos envíos separados se haya capturado la Novedad en Corral de un lote.
    `DisponibilidadAgua` se combina al revés (queda en "No" si algún registro dijo que no había agua),
    por ser un indicador de bienestar y no una cantidad que sumar. Archivo entregado (uno solo, no
    depende de los 4 de la cuarta ronda): `src/graph/lists.ts`.
  - Este bug queda como evidencia concreta de por qué vale la pena cerrar de raíz el hueco de
    "segundo registro" apuntado en "Pendiente" (impedir crear una segunda Novedad en Corral para la
    misma Recepción en vez de solo tolerar y combinar varias) — no se hizo en esta ronda porque no
    era lo que se pidió, pero el riesgo ya se materializó una vez.
  - Diagnóstico previo, para que quede registrado: antes de encontrar este bug se descartaron dos
    causas más probables a primera vista — que los 4 archivos de la cuarta ronda no se hubieran
    desplegado (Nathalia confirmó GitHub Actions en verde) y que el PWA siguiera sirviendo la versión
    vieja en caché (Nathalia confirmó haber visto y tocado "Actualizar ahora" en la barra de
    navegación, y el problema seguía). Ambas quedan documentadas como los primeros pasos a revisar
    en cualquier futuro "ya desplegué pero no veo el cambio".
- **Sexta ronda, mismo día: nueva opción de Destino en Consolidado — "Decomisado en canal"** (a
  pedido de Nathalia). Se agregó como una tercera opción junto a Procesado/Decomisado, mismo patrón
  que las otras dos (sin lógica especial ni cambio de columna en SharePoint más allá del valor en sí):
  - `src/types/models.ts`: `Destino` pasó de `'Procesado' | 'Decomisado'` a
    `'Procesado' | 'Decomisado' | 'Decomisado en canal'`.
  - `src/features/consolidado/Consolidado.tsx`: nueva `<option>` en el `<select>` de Destino de
    `FilaTiquete`, y se actualizó el texto de ayuda de la pantalla para mencionar la tercera opción.
  - Los reportes (`ReporteDiarioLote.tsx`/`ReporteSemanalAsociado.tsx`) no necesitaron cambios: solo
    agrupan los tiquetes Fortuito por el valor de `Destino` que traigan (función `agruparPorDestino()`),
    cualquier texto nuevo se muestra tal cual sin lógica especial por valor.
  - **IMPORTANTE — paso manual en SharePoint antes de probar**: la columna `Destino` de
    `ConsolidadoTiquetes` es de tipo Elección (Procesado/Decomisado) — si esa columna solo permite
    elegir de la lista de opciones (no admite "rellenar valores" libres), hay que agregar
    "Decomisado en canal" como una tercera opción de esa columna en SharePoint antes de usarla, o
    Graph puede rechazar el guardado igual que en los incidentes de columnas nuevas anteriores.
  - Los 2 archivos de esta sexta ronda deben subirse JUNTOS en el mismo commit (independientes de
    las 5 rondas anteriores del mismo día): `src/types/models.ts`,
    `src/features/consolidado/Consolidado.tsx`.
- **Séptima ronda, mismo día: el PDF del informe semanal quedaba cortado al pasar a la página 2** (a
  pedido de Nathalia, que envió una captura del PDF de "Cerdos del Otún" semana 36 mostrando la
  sección "📋 Definiciones" partida entre la página 1 y la 2). Causa original:
  `generarArchivoPDF()` / `crearPDFDesdeImagen()` en `src/utils/descargarImagen.ts` arma el PDF
  capturando el informe entero como UNA sola imagen larga y repartiéndola en páginas de alto fijo
  (`altoPagina`), sin ninguna noción de qué hay dibujado justo en cada punto de corte — así que
  cualquier tarjeta, fila de tabla o ítem del glosario que cayera a caballo entre dos páginas quedaba
  partido a la mitad, con su encabezado al final de una página y el resto del contenido recién al
  principio de la siguiente.
  - **Primer intento (entregado, pero con un error de diseño — Nathalia probó y seguía saliendo
    cortado)**: se agregó el concepto de "bloque protegido" (cualquier elemento marcado con
    `data-pdf-bloque` nunca debería quedar partido entre dos páginas) y una función
    `calcularCortesDePagina()` que, si el corte natural caía adentro de uno de esos bloques, adelantaba
    el corte hasta el borde de arriba del bloque. El error: la función que arma el PDF seguía
    dibujando la imagen COMPLETA en cada página (solo corriéndola hacia arriba con un offset), y en
    ese esquema el alto VISIBLE de una página es siempre exactamente `altoPagina`, sin importar dónde
    arranque la página siguiente — adelantar el inicio de la página 2 no hacía que la página 1
    "terminara antes", así que las dos terminaban mostrando el mismo pedazo de imagen una encima de
    la otra. Por eso el encabezado "Definiciones" seguía apareciendo completo al final de una página
    Y OTRA VEZ completo al principio de la siguiente, exactamente igual que antes del cambio.
    Nathalia confirmó primero que sí había desplegado los 2 archivos y generado el PDF desde cero (no
    uno reusado del botón "Generar PDF", que arma el PDF una sola vez y lo deja en memoria) antes de
    que se investigara más a fondo y se encontrara este error de diseño.
  - **Corrección real**: en vez de reusar la imagen completa en cada página, `crearPDFDesdeImagen()`
    ahora RECORTA un JPEG DISTINTO por cada página (`recortarComoJPEG()`, nueva), del alto exacto que
    le toca según `calcularCortesDePagina()` — así cada página muestra un pedazo AJENO al de las
    demás (sin superposición posible) y una página que termina antes de su alto normal (para no
    partir un bloque protegido) simplemente muestra menos contenido, con el resto en blanco, en vez
    de seguir mostrando lo mismo que la página siguiente. `calcularCortesDePagina()` en sí no
    cambió de lógica (sigue igual de bien probada), solo dejó de operar en puntos de PDF para operar
    en píxeles CSS del clon (la misma unidad en la que ya vienen medidos los bloques protegidos),
    convirtiendo a puntos de PDF recién al final para calcular el tamaño de cada recorte.
  - **Dónde se marcó `data-pdf-bloque` en `ReporteSemanalAsociado.tsx`** (el informe donde Nathalia
    vio el problema — es el único de los dos informes que puede crecer a varias páginas; el diario es
    de un solo lote y siempre cabe en una página, así que no se tocó): cada tarjeta de "Novedades por
    granja", cada tarjeta de "Vehículos con novedades", cada fila de "Detalle por lote" (para que
    nunca se parta un ítem individual de una lista que varía en longitud según cuántas granjas/
    vehículos/lotes tenga la semana), y las 3 tarjetas de contenido FIJO que no cambian de una semana
    a otra y siempre caben de sobra en una sola página — "Buenas prácticas", "Metodología del
    semáforo" (incluyendo el título de arriba, para que no quede huérfano) y "📋 Definiciones" (la
    sección exacta que se vio cortada) — se marcaron completas (encabezado + contenido) para que
    nunca quede el título de un lado y el contenido del otro.
  - Archivo entregado con la corrección real (uno solo, no depende de `ReporteSemanalAsociado.tsx` —
    el `data-pdf-bloque` de ese archivo, del primer intento, sigue vigente sin cambios):
    `src/utils/descargarImagen.ts`.
  - Verificado con un pequeño script de node aparte (no forma parte del repositorio), tanto para el
    primer intento como para la corrección real: que `calcularCortesDePagina()` nunca entra en bucle
    infinito y adelanta el corte correctamente en varios escenarios (sin bloques, un bloque a caballo
    del corte, varios bloques seguidos, un bloque más alto que una página, y un bloque que empieza
    justo al principio de una página); para la corrección real se verificó además que los segmentos
    resultantes (los pedazos que le tocan a cada página) nunca se superponen entre sí ni dejan un
    bloque protegido partido entre dos segmentos.
  - **Lección para futuros ajustes de paginación de este PDF**: cualquier cambio a
    `crearPDFDesdeImagen()` debe recordar que cada página ahora dibuja un RECORTE propio de la imagen
    (no la imagen completa desplazada) — volver al esquema de "misma imagen, offset distinto"
    reintroduciría este mismo bug en cuanto una página necesite terminar antes de su alto normal.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores ni advertencias nuevas en
  cada una de las siete rondas (incluida la corrección de la séptima).
**Sesión del 2026-09-11 ("Cierre diario" — nueva pestaña en Reporte.tsx)**:
- Nathalia pidió digitalizar una práctica que ya hacían en Excel: al final del día, revisan un cuadro
  con TODAS las recepciones recibidas ese día y pintan de azul la celda de cantidad de las que ya se
  beneficiaron (procesaron) el MISMO día — algo que hoy no tiene ningún registro en la app.
- **Decisiones de diseño, confirmadas con Nathalia antes de programar** (se preguntó explícitamente
  en vez de asumir, porque ella misma pidió una propuesta primero):
  1. Dónde vive el check: pantalla NUEVA y dedicada ("Reporte diario"/"Cierre diario"), no dentro del
     flujo normal de captura de Recepción ni mezclado con Consolidado — porque, como explicó
     Nathalia, "solo afecta este reporte que se envía al momento".
  2. Qué recepciones mostrar: TODAS las del día, con una forma de marcar cuáles ya se beneficiaron —
     no un filtro que solo muestre las marcadas.
  3. Dónde vive esa pantalla nueva: como una TERCERA pestaña dentro de la pantalla `Reporte.tsx` ya
     existente (junto a "Diario" y "Semanal"), no como una entrada nueva en el menú principal.
  4. Cómo se marca: NO se agregó una columna de check aparte — a pedido explícito de Nathalia
     ("el check se podría poner ahí mismo en ese reporte"), se toca directamente la celda de
     "N.° animales" de cada fila para alternar el marcado, replicando la mecánica de pintar de azul
     que ya usaban en Excel (la celda se resalta en azul y antepone "✓" al número).
  - El cuadro replica exactamente las columnas del que Nathalia ya usa en Excel (columnas
    confirmadas con capturas de pantalla legibles del cuadro real, después de pedir explícitamente
    una imagen completa cuando las primeras capturas venían recortadas): Fecha, Hora llegada, Inicio
    desembarque, Termina desembarque, Asociado, Granja, Consecutivo, Orden, N.° animales, #ICA —
    mapeadas a `FechaRecepcion`, `HoraLlegadaVehiculo`, `HoraInicioDesembarque`,
    `HoraFinalDesembarque`, `AsociadoId`→nombre, `GranjaId`→nombre, `Consecutivo`, `NumeroOrden`,
    `NumeroTotalCerdos`, `GuiaSanitariaICA` respectivamente. Las filas se ordenan por
    `HoraLlegadaVehiculo` (no por `Consecutivo`, como sí hace la pestaña "Diario") para que el orden
    coincida con el orden cronológico de llegada del cuadro de referencia.
- **Campo nuevo**: `Recepcion.BeneficiadoMismoDia: boolean` (`src/types/models.ts`) — deliberadamente
  SEPARADO de `EstadoLote` (que es sobre si Consolidado ya terminó de asignar Tiquete/Destino a cada
  animal del lote; un lote puede estar "Completo" en Consolidado varios días después de recibido).
  Se guarda como columna "Sí/No" en SharePoint (mismo patrón que `QRLote`/
  `CertificadoInmunocastracion`/`CoincideGuiaICAvsQR`), por defecto en `false` al crear una Recepción
  nueva (`Recepcion.tsx`, `onSubmit`) — se marca a mano, nunca solo.
- **`src/graph/lists.ts`**: se lee el campo en `mapFieldsARecepcion()` y se agregó
  `marcarBeneficiadoMismoDia(recepcionSpId, valor)`, que escribe directo contra Graph
  (`updateItem('Recepciones', ...)`, mismo patrón que `marcarLoteCompleto()`/`reabrirLote()`) — la
  pestaña "Cierre diario" llama a esta función DIRECTO, sin pasar por Dexie ni la cola de
  sincronización (igual que "Diario" y "Semanal", por diseño: consultan SharePoint solo al generar,
  sin ir acumulando historial local).
- **`src/features/reportes/ReporteCierreDiario.tsx`** (nuevo): arma la tabla, el botón/celda para
  marcar/desmarcar (actualización optimista: se refleja de una vez en pantalla y se revierte si Graph
  falla), y reutiliza el mismo patrón de "Descargar imagen"/"Generar PDF" que ya tienen
  `ReporteDiarioLote.tsx`/`ReporteSemanalAsociado.tsx` (incluido `data-pdf-bloque` en cada fila, por
  si el cuadro llega a crecer a más de una página).
- **`src/features/reportes/Reporte.tsx`**: nueva pestaña "Cierre diario" (tercer valor `'cierre'` del
  estado `tab`) con su propio sub-componente `ReporteCierre`, que trae las recepciones del día
  elegido (`listarRecepcionesPorRangoFecha(fecha, fecha)`, ordenadas por `HoraLlegadaVehiculo`),
  resuelve nombre de Asociado/Granja, y mantiene el estado local que `ReporteCierreDiario` actualiza
  al marcar/desmarcar una celda.
  - Los 4 archivos de esta sesión deben subirse JUNTOS en el mismo commit:
    `src/types/models.ts`, `src/graph/lists.ts`, `src/features/recepcion/Recepcion.tsx`,
    `src/features/reportes/ReporteCierreDiario.tsx`, `src/features/reportes/Reporte.tsx` (5 en total).
  - **IMPORTANTE — paso manual en SharePoint antes de probar**: crear la columna nueva
    `BeneficiadoMismoDia` (tipo "Sí/No") en la lista `Recepciones` — sin esto, Graph rechaza
    cualquier intento de marcar/desmarcar desde "Cierre diario", igual que en los incidentes de
    columnas nuevas anteriores (2026-09-09 y 2026-09-10).
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-11 (segunda ronda, rediseñada) — camiones que llegan y quedan esperando sin
desembarcar el mismo día**:
- Nathalia planteó un caso que "Cierre diario" (recién entregado) ya dejaba a la vista pero sin
  resolver: no todo camión desembarca el mismo día en que llega — a veces queda esperando en el
  patio — y al corte del día hay que poder mandar tres cosas: lo que llegó, de lo que llegó lo que ya
  se benefició, y lo que llegó y quedó recibido SIN desembarcar. Pidió una propuesta antes de tocar
  código.
- **Primer intento — entregado y luego REVERTIDO, sin llegar a usarse en producción**: se probó hacer
  `HoraInicioDesembarque`/`HoraFinalDesembarque` opcionales en `Recepcion`, con un botón en "Cierre
  diario" para completarlas después (`registrarDesembarque()`). Nathalia lo rechazó explícitamente:
  *"No voy a hacer este último cambio porque tengo vacíos en el proceso, ya que los otros campos que
  estan en recepción se llenan una vez el lote es desembarcado"* — el problema real no eran solo esas
  2 horas: el formulario de Recepción se llena COMPLETO en una sola vez (cantidad de animales, peso,
  novedades, etc. incluidos), y todo eso también se conoce recién cuando el desembarque termina.
  Relajar solo 2 campos hubiera dejado la Recepción con un hueco distinto (y peor) al que se quería
  cerrar. Este intento se revirtió por completo (`models.ts`, `recepcionSchema.ts`, `Recepcion.tsx`,
  `lists.ts` volvieron a su forma de antes de esta ronda) antes de que Nathalia llegara a usarlo.
- **Preguntas que llevaron al diseño final, en orden** (mismo patrón de "preguntar antes de programar"
  que ya se usó para "Cierre diario"):
  1. *"De todo lo que pide el formulario de Recepción hoy, ¿qué tanto se conoce YA cuando el camión
     apenas llega, antes de desembarcar?"* → Nathalia: hora de llegada, más Asociado/Granja y el
     Consecutivo.
  2. *"¿Cómo preferirías anotar que un camión llegó y sigue esperando, sin crear vacíos en
     Recepción?"* → Nathalia: un registro rapidito aparte, solo con lo que ya se sabe.
  3. *"¿Dónde debería vivir el botón para registrar que un camión llegó y quedó esperando?"* →
     Nathalia: dentro de "Cierre diario". (Esta decisión se REVIRTIÓ en la cuarta ronda, ver más
     abajo — el botón se movió a Recepción.)
  4. *"Cuando por fin se llena la Recepción completa de un lote que había quedado 'en espera', ¿cómo
     se relaciona con ese registro rápido de llegada?"* → Nathalia: se resuelve solo, por
     Consecutivo.
- **Diseño final implementado** — ver el punto 9 de "Decisiones clave de diseño" arriba para el
  resumen del modelo:
  - **`src/types/models.ts`**: `Recepcion` NO cambió (`HoraInicioDesembarque`/`HoraFinalDesembarque`
    siguen obligatorias, como siempre fueron antes de esta ronda). Se agregó la interfaz
    `LlegadaPendiente` — `id`, `Title`, `FechaLlegada`, `HoraLlegadaVehiculo`, `AsociadoId`,
    `GranjaId`, `Consecutivo`, `NumeroOrden?`, `PlacaVehiculoId?`, `CapturadoPor`, `CreadoEn` — sin
    extender `CapturaOffline` (no tiene `EstadoSync` ni distingue `CapturadaEn`/`RecibidaEn`, ver el
    punto 9 sobre por qué).
  - **`src/graph/lists.ts`**: `listarLlegadasPendientesPorFecha(fecha)` (trae las de un día exacto,
    mismo patrón de rango `$filter` que `listarRecepcionesPorRangoFecha()`) y
    `crearLlegadaPendiente(datos)` (escribe DIRECTO contra Graph con `createItem('LlegadasPendientes',
    ...)`, sin Dexie ni cola de sincronización — mismo criterio que `marcarBeneficiadoMismoDia()`).
  - **`src/graph/client.ts`**: se agregó `'LlegadasPendientes'` al tipo `ListName`.
  - **`src/features/reportes/Reporte.tsx`**: `Reporte()` ahora recibe `usuario: Usuario` (para
    `CapturadoPor`) — `App.tsx` se ajustó para pasarlo (`<Reporte usuario={usuario} />`).
    `ReporteCierre` trae ahora, además de las Recepciones del día, las `LlegadasPendientes` de ese
    mismo día (`Promise.all` en `generar()`), calcula con `useMemo` cuáles siguen SIN resolver
    (`llegadasSinResolver`: cualquiera cuyo Consecutivo YA aparezca entre las Recepciones del día se
    excluye — así es como se resuelve sola, sin ninguna acción manual) y las pasa junto con las
    listas crudas de asociados/granjas/vehículos (para los `<select>` del formulario nuevo) a
    `ReporteCierreDiario`. `registrarLlegada()` arma `HoraLlegadaVehiculo` combinando la fecha del
    cierre con la hora del formulario (mismo offset fijo -05:00 que usa `Recepcion.tsx`, duplicado
    aquí a propósito), llama a `crearLlegadaPendiente()` y vuelve a traer la lista completa del día
    (no arma el objeto local a mano: `crearLlegadaPendiente()` no devuelve el id real de SharePoint,
    y esta pestaña ya trabaja solo en línea de todas formas).
  - **`src/features/reportes/ReporteCierreDiario.tsx`**: las Recepciones y las `LlegadasPendientes`
    sin resolver se mezclan en una sola lista (`filas`) ordenada por hora de llegada, para que las
    filas de espera salgan intercaladas cronológicamente y no todas al final. Una fila de
    `LlegadaPendiente` sale resaltada en ámbar con "Pendiente" en Inicio/Termina desembarque, N.°
    animales y #ICA, y SIN botón de beneficiado (no hay Recepción real que marcar todavía). Se agregó
    el botón "+ Registrar llegada en espera", que despliega un formulario inline (Hora de llegada,
    Asociado, Granja —filtrada por Asociado, mismo patrón `granjasDelAsociado` que `Recepcion.tsx`—,
    Consecutivo, Número de orden opcional, Placa opcional) y llama a `onRegistrarLlegada()` recibido
    de `Reporte.tsx`. **(Este botón/formulario se RETIRÓ de aquí en la cuarta ronda — ver más abajo;
    la descripción queda como registro histórico de cómo funcionó entre la segunda y la cuarta
    ronda.)**
  - **`src/App.tsx`**: única línea de ajuste, pasar `usuario` a `<Reporte usuario={usuario} />`.
    **(También revertido en la cuarta ronda.)**
  - **IMPORTANTE — paso manual NUEVO en SharePoint antes de probar (reemplaza la afirmación de la
    primera versión revertida de que esta ronda no necesitaba pasos manuales)**: crear la lista
    `LlegadasPendientes` con estas columnas: `Title` (Texto, la que trae por defecto toda lista
    nueva), `FechaLlegada` (Fecha y hora), `HoraLlegadaVehiculo` (Fecha y hora), `AsociadoId` (Lookup
    a `Asociados`), `GranjaId` (Lookup a `Granjas`), `Consecutivo` (Texto), `NumeroOrden` (Texto,
    opcional), `PlacaVehiculoId` (Lookup a `Vehiculos`, opcional), `CapturadoPor` (Texto), `CreadoEn`
    (Fecha y hora). Sin esto, Graph rechaza cualquier intento de registrar una llegada en espera, con
    el mismo tipo de error 400 de los incidentes de columnas/listas nuevas anteriores.
  - Los 9 archivos de esta ronda (rediseñada) deben subirse JUNTOS en el mismo commit:
    `src/types/models.ts`, `src/features/recepcion/recepcionSchema.ts`,
    `src/features/recepcion/Recepcion.tsx`, `src/components/CamposFormulario.tsx`,
    `src/graph/lists.ts`, `src/graph/client.ts`, `src/App.tsx`, `src/features/reportes/Reporte.tsx`,
    `src/features/reportes/ReporteCierreDiario.tsx`. (Los primeros 4 vuelven a su forma previa a esta
    ronda — solo se reenvían para que el commit quede completo y consistente; `CamposFormulario.tsx`
    en particular no tiene ningún cambio funcional respecto de antes de esta ronda, solo se incluye
    por consistencia del set.)
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-11 (tercera ronda) — autocompletar Recepción desde una LlegadaPendiente por
Consecutivo, para no repetir el ingreso de datos**:
- Apenas entregada la segunda ronda, Nathalia notó que ya no se estaba pidiendo hacer el cambio
  anterior, pero señaló el punto real: los datos de encabezado que ya se digitan al registrar una
  llegada en espera (Asociado, Granja, Consecutivo, y si se sabe, N. Orden/Placa) le van a servir
  otra vez para la Recepción completa cuando el camión por fin desembarque — y propuso que esos datos
  se trajeran solos al formulario de Recepción a través del Consecutivo.
- **Decisiones confirmadas con Nathalia antes de programar** (3 preguntas, mismo patrón de
  "preguntar antes de programar" que las rondas anteriores; las 3 recomendaciones fueron las
  elegidas):
  1. Cuándo buscar: con un botón aparte ("Cargar datos de llegada en espera"), no automático al
     escribir el Consecutivo — así no dispara búsquedas de más mientras se escribe.
  2. Sin conexión: por ahora, esta búsqueda solo funciona con señal (igual que "Cierre diario" ya
     trabaja) — no se bajó `LlegadasPendientes` a Dexie; sin señal, simplemente no se autocompleta
     nada y se sigue llenando a mano como siempre (sin cambio de comportamiento respecto a hoy).
  3. Qué pasa después: el registro de `LlegadaPendiente` usado NO se borra ni se toca — sigue
     resolviéndose solo en "Cierre diario", como ya hacía desde la ronda anterior.
- **`src/graph/lists.ts`**: nueva función `buscarLlegadaPendientePorConsecutivo(consecutivo)` — a
  diferencia de `listarLlegadasPendientesPorFecha()` (que solo trae las de UN día), esta busca por
  Consecutivo sin importar la fecha (`$filter=fields/Consecutivo eq '...'`), y si hay más de un
  registro con el mismo Consecutivo (no debería pasar, ver "Pendiente"), devuelve el más reciente por
  `CreadoEn`.
- **`src/features/recepcion/Recepcion.tsx`**: nuevo botón "Cargar datos de llegada en espera" justo
  debajo de Consecutivo/N. de orden, deshabilitado sin conexión (mismo criterio que "Generar reporte"
  en las demás pantallas). Al tocarlo, busca la `LlegadaPendiente` con el Consecutivo ya escrito y, si
  la encuentra, llena con `setValue()` (react-hook-form): `FechaRecepcion` y `HoraLlegadaVehiculo` (de
  `FechaLlegada`/`HoraLlegadaVehiculo` de la llegada, recortando a "YYYY-MM-DD"/"HH:MM"),
  `AsociadoId`, `GranjaId`, y si vienen, `NumeroOrden`/`PlacaVehiculoId`. Muestra un mensaje si no
  encuentra ninguna (no es un error — la mayoría de las Recepciones no van a tener una llegada previa
  registrada) o si falla la búsqueda. El resto del formulario (cantidad de animales, peso, novedades,
  horas de desembarque, etc.) se sigue llenando a mano exactamente igual que siempre — esto solo
  ahorra volver a escribir el encabezado.
  - **Por qué se sobrescribe `FechaRecepcion` (no solo la hora)**: si el camión llegó un día y
    desembarcó al siguiente, la Recepción debe quedar fechada el día en que de verdad llegó — si no,
    "Cierre diario" de ESE día de llegada nunca encontraría esta Recepción para resolver sola la fila
    "Pendiente" que sigue mostrando (la reconciliación por Consecutivo en `ReporteCierre` compara
    contra las Recepciones de la fecha exacta que se está viendo, ver el punto 9 de "Decisiones clave
    de diseño").
  - Los 2 archivos de esta ronda deben subirse JUNTOS en el mismo commit: `src/graph/lists.ts`,
    `src/features/recepcion/Recepcion.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-11 (cuarta ronda) — mover la creación de "Llegada en espera" a Recepción, y
agregar Guía sanitaria ICA / Número total de cerdos opcionales**:
- Nathalia pidió dos ajustes juntos, y pidió también una propuesta de cómo estructurarlos: (1) mover
  el botón "+ Registrar llegada en espera" de la pestaña "Cierre diario" a la pantalla de Recepción —
  no a "Cierre diario"; y (2) agregar los campos "Guía sanitaria ICA" y "Número total de cerdos" al
  formulario de llegada pendiente.
- **Decisiones confirmadas con Nathalia antes de programar** (2 preguntas, mismo patrón que las
  rondas anteriores; ambas recomendaciones fueron las elegidas):
  1. Cómo se ve el "pre-registro" dentro de Recepción: dos pestañas arriba de Recepción ("Recepción
     completa" / "Llegada en espera"), con el mismo estilo de pestañas que ya usa `Reporte.tsx` —no
     un botón suelto dentro del formulario completo.
  2. Si Guía sanitaria ICA y Número total de cerdos deben ser obligatorios en este pre-registro:
     opcionales — igual que Número de orden y Placa ya lo eran, por si se saben desde que el camión
     llega.
- **`src/types/models.ts`**: `LlegadaPendiente` gana 2 campos opcionales — `GuiaSanitariaICA?: string`
  (mismo formato forzado "3 cifras - resto" que en `Recepcion`) y `NumeroTotalCerdos?: number`.
- **`src/graph/lists.ts`**: `mapFieldsALlegadaPendiente()` ahora también lee `GuiaSanitariaICA` y
  `NumeroTotalCerdos` desde Graph; `crearLlegadaPendiente()` no necesitó cambios en su cuerpo — los 2
  campos nuevos viajan solos a través del spread `...resto` que ya tenía, ahora que el tipo los
  incluye.
- **`src/features/recepcion/Recepcion.tsx`** (restructurado en 3 componentes dentro del mismo
  archivo):
  - `Recepcion({ usuario })`: ahora es solo el envoltorio con las 2 pestañas ("Recepción completa" /
    "Llegada en espera"), mismo patrón visual (`clsx`, `bg-brand-navy text-white` para la activa) que
    ya usa `Reporte.tsx` para Diario/Semanal/Cierre diario.
  - `RecepcionCompleta({ usuario })`: el formulario de siempre, sin ningún cambio de comportamiento —
    incluido el botón "Cargar datos de llegada en espera" (de la tercera ronda), que sigue viviendo
    aquí porque es una acción distinta (TRAER datos ya capturados hacia la Recepción completa) de la
    nueva pestaña (CREAR el pre-registro).
  - `LlegadaEnEspera({ usuario })` (nuevo): el registro rápido, ahora aquí en vez de en "Cierre
    diario". Sigue siendo SOLO EN LÍNEA (deshabilitado sin conexión, mismo criterio que el resto de la
    app). A diferencia de "Cierre diario", no pide la fecha — siempre usa la fecha de HOY
    (`FechaLlegada`), porque este registro es para el camión que está llegando en ese momento, nunca
    para capturar algo atrasado. Campos: Hora de llegada, Consecutivo, Asociado, Granja (requeridos,
    igual que antes) y Número de orden, Placa, Guía sanitaria ICA, Número total de cerdos (los 4
    opcionales). Llama a `crearLlegadaPendiente()` directo (ya no a través de `Reporte.tsx`).
- **`src/features/reportes/Reporte.tsx`**: `Reporte()` deja de recibir `usuario` (ya no lo necesita —
  la creación se movió a Recepción). `ReporteCierre` deja de recibir/pasar `asociados`/`granjas`/
  `vehiculos` (eran solo para los `<select>` del formulario que se quitó) — sigue trayendo y
  reconciliando las `LlegadasPendientes` del día exactamente igual que antes, para MOSTRARLAS.
- **`src/features/reportes/ReporteCierreDiario.tsx`**: se quitó por completo el botón/formulario
  "+ Registrar llegada en espera" y su estado asociado — el mensaje de arriba de la tabla ahora dice
  "usa la pestaña 'Llegada en espera' en Recepción" para registrar un camión nuevo. Las celdas
  "N.° animales" y "#ICA" de una fila `LlegadaPendiente` ahora muestran el dato real
  (`NumeroTotalCerdos`/`GuiaSanitariaICA`) cuando ya se conoce, y siguen mostrando "Pendiente" solo
  cuando de verdad no se capturó — antes de esta ronda siempre decían "Pendiente" porque el modelo no
  tenía estos 2 campos (esta mejora se implementó como consecuencia directa de agregarlos, sin que
  Nathalia lo pidiera explícitamente, por ser el comportamiento correcto una vez existe el dato).
- **`src/App.tsx`**: se revirtió `<Reporte usuario={usuario} />` a `<Reporte />` — `Reporte.tsx` ya no
  necesita `usuario`.
- **IMPORTANTE — paso manual en SharePoint antes de probar**: agregar 2 columnas nuevas, opcionales,
  a la lista `LlegadasPendientes` (creada en la segunda ronda): `GuiaSanitariaICA` (Texto) y
  `NumeroTotalCerdos` (Número). Si esa lista ya se había creado con solo las columnas de la segunda
  ronda, hay que agregarle estas 2 ahora — sin esto, Graph rechaza cualquier llegada en espera que
  incluya alguno de estos 2 datos, igual que en los incidentes de columnas nuevas anteriores.
  - Los 6 archivos de esta ronda deben subirse JUNTOS en el mismo commit: `src/types/models.ts`,
    `src/graph/lists.ts`, `src/features/recepcion/Recepcion.tsx`, `src/features/reportes/Reporte.tsx`,
    `src/features/reportes/ReporteCierreDiario.tsx`, `src/App.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-11 (quinta ronda) — buscador de Consolidado por Consecutivo/hoy, y candado por
tiquete para Auditor y Supervisor**:
- Nathalia trajo dos pedidos juntos: (1) que el desplegable de "Recepción" en Consolidado muestre
  por defecto los lotes recibidos HOY, pero que se pueda buscar cualquier lote escribiendo su
  Consecutivo sin importar la fecha; y (2) revisó lo que se había hablado en la sesión anterior sobre
  el candado de un lote cerrado, y señaló el problema real: el perfil Auditor podía editar datos que
  YA estaban cargados en la Recepción (no solo en lotes cerrados) — debería poder ingresar solo lo
  nuevo (tiquetes vacíos); lo que ya tiene datos, solo Administrador lo edita.
- **Decisiones confirmadas con Nathalia antes de programar** (3 preguntas, las 3 recomendaciones
  fueron las elegidas):
  1. Alcance de la búsqueda por Consecutivo: contra SharePoint directo (como ya hace "Cargar datos
     de llegada en espera" en Recepción), no solo entre lo ya descargado a este dispositivo — para
     que encuentre cualquier lote aunque nunca se haya traído aquí antes.
  2. Criterio del candado para Auditor: por tiquete YA CARGADO (tiene Tiquete+Destino), no por si el
     tiquete existía antes de la captura nueva — así puede completar cualquier vacío, viejo o nuevo,
     y queda bloqueado apenas alguien le pone Tiquete+Destino.
  3. Si el mismo candado aplica a Supervisor: sí, igual que Auditor — antes Supervisor tenía edición
     completa de cualquier tiquete mientras el lote siguiera abierto.
- **Buscador por Consecutivo / desplegable filtrado a hoy** (`src/features/consolidado/Consolidado.tsx`,
  `src/graph/lists.ts`):
  - `buscarRecepcionesPorConsecutivo(consecutivo)` (nueva en `lists.ts`): busca por Consecutivo
    EXACTO sin filtrar por fecha (`$filter=fields/Consecutivo eq '...'`), mismo criterio que
    `buscarLlegadaPendientePorConsecutivo()` de la tercera ronda, pero devolviendo TODAS las
    coincidencias en vez de solo la más reciente — es Consolidado quien decide qué hacer si hay más
    de una.
  - El desplegable de "Recepción" ahora filtra `recepciones` (todo lo que este dispositivo tiene en
    Dexie) a `recepcionesVisibles`: por defecto solo `FechaRecepcion === hoy`, más cualquier id que
    alguno de los 2 buscadores haya encontrado en esta sesión (`idsFueraDeHoy`) — así el desplegable
    no vuelve a mostrar todo el historial acumulado, pero tampoco esconde lo que se acaba de buscar.
  - Nuevo campo "Buscar por Consecutivo" (arriba del ya existente "Buscar por fecha"): busca en
    SharePoint, trae a Dexie lo que encuentre (sin pisar nada si ya existía localmente, igual que
    "Buscar por fecha"), y si encuentra EXACTAMENTE una Recepción la selecciona de una vez; si
    encuentra más de una (no debería pasar, ver `existeConsecutivo()`, pero nada lo impide del
    todo), dejar las dos visibles en el desplegable y pide elegir cuál es.
  - `buscarPorFecha()` (ya existente) también se ajustó para agregar lo que encuentre a
    `idsFueraDeHoy` cuando la fecha buscada no es hoy — si no, esos resultados hubieran seguido sin
    verse en el desplegable filtrado apenas terminara la búsqueda.
- **Candado por tiquete para Auditor/Supervisor** (`src/features/consolidado/Consolidado.tsx`):
  nueva función `filaSoloLectura(t)` que reemplaza el `soloLectura` uniforme que antes se le pasaba a
  CADA fila de la tabla: sigue devolviendo `true` siempre para Consultor y para cualquier no-Admin en
  un lote ya "Completo" (candado de LOTE, sin cambios — Nathalia confirmó explícitamente dejarlo
  así), `false` siempre para Administrador, y para Auditor/Supervisor en un lote todavía "En
  proceso", `true` solo si `t.EstadoTiquete === 'Completo'` (ya tiene Tiquete+Destino). Se usa
  `EstadoTiquete` (no `tiqueteYaCompletado()`, que además exige Factura en los Fortuitos) a
  propósito: ese segundo requisito es solo para la etiqueta "Falta factura" y el aviso de
  `terminarProceso()`, no aplica a este candado. Como `EstadoTiquete` en Dexie solo se pone al día
  con un refresco explícito contra SharePoint (ver el comentario de `terminarProceso()`), quien
  acaba de escribir un Tiquete/Destino todavía puede corregirlo hasta que se refresque — recién ahí
  queda bloqueado para su propio perfil.
- Los 2 archivos de esta ronda deben subirse JUNTOS en el mismo commit: `src/graph/lists.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- No requiere ningún paso manual nuevo en SharePoint — ambos cambios usan columnas y consultas que ya
  existían.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-11 (sexta ronda) — mismo criterio "hoy + buscar por Consecutivo/fecha" extendido
a Ubicación y Novedades en Corral**:
- Apenas confirmado que el buscador nuevo de Consolidado (quinta ronda) quedó bien, Nathalia pidió
  replicar exactamente el mismo comportamiento en el selector de "Recepción" de Ubicación y de
  Novedades en Corral: que por defecto aparezca la de hoy, y que se pueda buscar cualquier día tanto
  por Consecutivo como por fecha — mismo pedido, sin preguntas nuevas que confirmar (las 3 decisiones
  de diseño de la quinta ronda ya aplicaban igual de bien aquí).
- **`src/features/ubicacion/Ubicacion.tsx` y `src/features/novedades-corral/NovedadesCorral.tsx`**
  (mismo patrón implementado por separado en cada archivo — cada formulario sigue siendo
  independiente por diseño en esta app, ver la segunda ronda de "Sesión del 2026-09-10"):
  - Mismo `hoyISO()`, mismo estado `idsFueraDeHoy`, y el mismo par de buscadores ("Buscar por
    Consecutivo" arriba, "¿No sabes el Consecutivo? Buscar por fecha" debajo) que ya tenía
    Consolidado, usando las mismas funciones de `src/graph/lists.ts`
    (`buscarRecepcionesPorConsecutivo()` y `listarRecepcionesPorRangoFecha()`, ninguna de las dos
    tuvo que cambiar). Al encontrar exactamente una Recepción por Consecutivo, se selecciona de una
    vez en el desplegable — aquí con `setValue('RecepcionId', ...)` de react-hook-form, en vez del
    `setRecepcionId()` de estado simple que usa Consolidado (estas 2 pantallas manejan el selector
    con `register()`, no con un `value`/`onChange` manual).
  - **Diferencia importante frente a Consolidado, resuelta sin necesidad de preguntar**: el selector
    de estas 2 pantallas parte de `db.recepciones.orderBy('CapturadaEn')` (TODO lo que haya en Dexie,
    incluidas las capturadas en este mismo dispositivo que siguen `EstadoSync: 'Pendiente'` — sin
    `spId` todavía), a diferencia del de Consolidado (que solo lista `EstadoSync: 'Sincronizada'`).
    Filtrar solo por "hoy" hubiera podido esconder una captura reciente que aún no sincroniza si por
    algún motivo su reloj/fecha no coincidiera con hoy, y un buscador remoto contra SharePoint NUNCA
    puede encontrar algo que todavía no tiene `spId` — así que el filtro nuevo (`recepcionesVisibles`)
    deja SIEMPRE visible cualquier Recepción con `EstadoSync !== 'Sincronizada'`, sin importar su
    fecha, además de la de hoy y de lo que traigan los buscadores.
  - El filtro nuevo se aplica DESPUÉS del filtro ya existente por `EstadoLote` (que oculta a los
    no-Administradores los lotes ya cerrados) — así que si un no-Administrador busca por Consecutivo
    o por fecha un lote que ya está cerrado, la búsqueda sí lo trae a Dexie de este dispositivo (para
    que quede disponible si alguna vez un Administrador lo necesita ahí), pero sigue sin aparecer en
    su propio desplegable, exactamente igual que ya pasaba antes de esta ronda con cualquier lote
    cerrado que ya estuviera en Dexie.
  - Como los campos de búsqueda quedan DENTRO del `<form>` de captura (a diferencia de Consolidado,
    que no tiene formulario envolvente), se agregó `e.preventDefault()` en el `onKeyDown` de Enter de
    ambos campos de búsqueda — sin esto, presionar Enter ahí hubiera disparado el envío del
    formulario completo en vez de solo buscar.
  - Nuevo mensaje de error propio (`errorBusqueda`, independiente del de validación de
    react-hook-form) para los resultados de los 2 buscadores, mismo texto que ya usa Consolidado.
  - Los 2 archivos son independientes entre sí y de los 2 archivos de la quinta ronda
    (`src/graph/lists.ts` no cambió en esta ronda) — se pueden subir juntos o por separado.
- No requiere ningún paso manual nuevo en SharePoint — usa las mismas columnas y consultas que ya
  existían desde la quinta ronda.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-11 (séptima ronda) — "Mantenimiento": botón para borrar la copia local de este
dispositivo (Dexie), sin tocar SharePoint**:
- Nathalia borró a mano todos los registros de las listas transaccionales en SharePoint para
  empezar pruebas nuevas, pero el desplegable de "Recepción" en Ubicación le seguía mostrando un
  lote ("111111111 · 2026-09-11") que ya no existía en SharePoint.
- **Causa (no es un bug de las rondas anteriores)**: el desplegable de "hoy + buscar por
  Consecutivo/fecha" (quinta y sexta ronda) sigue leyendo de la copia local en Dexie, y un registro
  transaccional NUNCA se borra solo de ahí — el diseño de toda la app, desde el principio (ver
  `db.ts`), es que se actualiza en su sitio al sincronizar, nunca se elimina, precisamente para
  conservar el historial de captura de ese dispositivo aunque no haya internet. Eso funciona bien
  mientras SharePoint solo cambia a través de la propia app; si alguien borra datos DIRECTO en
  SharePoint (como una prueba nueva), nada le avisa a los demás dispositivos — el registro se queda
  huérfano en su Dexie local hasta que alguien lo limpie a mano. Antes de este botón, la única forma
  era entrar a la configuración del navegador y borrar los datos del sitio completo, lo que de paso
  se llevaba también los catálogos de Asociados/Granjas/Vehículos (maestros) — dejando la app sin
  poder capturar hasta la próxima descarga con conexión.
- **`src/features/catalogos/MantenimientoAdmin.tsx`** (nuevo, solo Administrador): nueva pestaña
  "Mantenimiento" en `CatalogosAdmin.tsx` (`/admin/asociados`). Muestra cuántos registros hay
  guardados en este dispositivo en las 4 tablas transaccionales de Dexie (Recepciones, Ubicaciones,
  Novedades en Corral, Consolidado) y cuántos de esos siguen `EstadoSync: 'Pendiente'` (capturados
  aquí y todavía sin subir a SharePoint), y un botón "Borrar datos locales de este dispositivo" que
  las vacía (`db.recepciones.clear()` + las otras 3, en una sola transacción de Dexie).
  - **A propósito, quirúrgico y no un borrado total**: NO toca Asociados/Granjas/Vehículos/Usuarios/
    GruposAsociados (esos catálogos siguen haciendo falta para poder seguir capturando — borrarlos
    hubiera dejado los combos vacíos hasta la próxima descarga con conexión) y NUNCA borra nada en
    SharePoint — es exactamente el mismo efecto que "Borrar datos del sitio" del navegador, pero sin
    perder los maestros ni tener que salir de la app.
  - **Blindaje explícito contra perder captura real por accidente**: si hay registros `Pendiente`
    (capturados en este dispositivo pero que TODAVÍA no llegaron a SharePoint), tanto el resumen en
    pantalla como el diálogo de confirmación (`window.confirm()`, mismo patrón que
    `terminarProceso()` en Consolidado) lo advierten explícitamente — esos SÍ se perderían para
    siempre, no solo de este dispositivo, porque nunca alcanzaron a subir. El botón queda
    deshabilitado si no hay nada que borrar.
- **`src/features/catalogos/CatalogosAdmin.tsx`**: nueva pestaña `'mantenimiento'` agregada al
  arreglo `PESTANAS`, junto a las 5 que ya existían.
- Los 2 archivos deben subirse JUNTOS en el mismo commit: `src/features/catalogos/
  MantenimientoAdmin.tsx` (nuevo), `src/features/catalogos/CatalogosAdmin.tsx`.
- No requiere ningún paso manual en SharePoint — es una utilidad puramente local a este dispositivo.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-11 (octava ronda) — deshacer por completo "Llegada en espera"/`LlegadaPendiente`;
`HoraInicioDesembarque`/`HoraFinalDesembarque` vuelven a ser opcionales**:
- Nathalia pidió: *"Necesito quitar la pestaña que creamos en recepción de llegada en espera, ya que
  el proceso no es así, deje estos campos opcionales: Hora de inicio de desembarque, Hora final de
  desembarque, ya que despues de la jornada pueden llegar lotes y esos dos datos ya no los vamos a
  tener, entonces quite ese boton"*. A diferencia del intento revertido del punto 8 de "Decisiones
  clave de diseño" (que Nathalia rechazó porque el resto del formulario también dependía del
  desembarque), aquí el pedido es distinto y sí se acepta: el resto del formulario sigue llenándose
  igual que siempre, completo, cuando el desembarque termina — la diferencia es que si NUNCA hubo
  desembarque que registrar para ese lote, esas 2 horas simplemente no se van a conocer, no es un
  dato pendiente de completar después con un registro aparte.
- **Alcance de la limpieza**: no se trató como "ocultar la pestaña" — se retiró el subsistema
  `LlegadaPendiente` completo, de punta a punta (tipo, funciones de Graph, lista en `ListName`,
  lógica de reconciliación en los reportes), en vez de dejar código muerto sin usar. La única pieza
  que NO se tocó es la lista `LlegadasPendientes` en SharePoint — queda vacía y sin uso, no hacía
  falta borrarla para que la app funcione, y borrar listas de SharePoint es decisión de Nathalia, no
  algo que la app deba hacer sola.
- **`src/types/models.ts`**: `HoraInicioDesembarque`/`HoraFinalDesembarque` en `Recepcion` vuelven a
  ser opcionales (`?: string`, antes obligatorias — habían quedado así desde antes del intento
  revertido del punto 8). Se retiró por completo la interfaz `LlegadaPendiente`, dejando una nota
  histórica en su lugar apuntando a este mismo punto.
- **`src/features/recepcion/recepcionSchema.ts`**: `HoraInicioDesembarque`/`HoraFinalDesembarque`
  pasan de `z.string().min(1, 'Obligatorio')` a `z.string().optional()`.
- **`src/features/recepcion/Recepcion.tsx`** (vuelve a ser una sola pantalla, sin pestañas):
  - Se quitó el envoltorio con las 2 pestañas ("Recepción completa" / "Llegada en espera") que se
    había agregado en la cuarta ronda — `Recepcion({ usuario })` es de nuevo directamente el
    formulario completo, sin ningún estado `modo`.
  - Se retiró el componente `LlegadaEnEspera` completo (el registro rápido) y el botón "Cargar datos
    de llegada en espera" (con su función `cargarLlegadaPendiente()` y sus 3 estados de
    mensaje/error) dentro del formulario de Recepción completa — ya no hay ningún registro previo del
    que traer esos datos.
  - Las 2 horas ya no llevan `requerido` en su `<CampoTexto>` y ahora muestran un texto de ayuda
    ("Opcional — algunos lotes llegan después de la jornada y no se alcanza a registrar esta hora").
  - `onSubmit()`: `combinarFechaHora()` para estas 2 horas ahora es CONDICIONAL — solo arma la
    fecha-hora completa si la persona escribió algo en el campo; si quedó vacío, guarda `undefined`
    en vez de un valor malformado (`combinarFechaHora()` concatena literalmente `hora + ':00-05:00'`,
    así que una hora vacía hubiera producido un valor sin sentido en vez de simplemente no guardar
    nada).
- **`src/graph/lists.ts`**:
  - `mapFieldsARecepcion()` (lectura desde Graph): estas 2 horas ahora devuelven `undefined` cuando
    SharePoint no tiene valor, en vez de forzarlas a cadena vacía — para que, si algún día se
    reescribe esa Recepción, `mapRecepcionAFields()` no vuelva a mandarle una cadena vacía a Graph.
    `mapRecepcionAFields()` (escritura hacia Graph) no necesitó ningún cambio: ya esparce `resto`
    directamente, y un valor `undefined` en el objeto simplemente no se serializa — Graph recibe el
    campo tal cual, sin valor.
  - Se retiró por completo el bloque de `LlegadasPendientes`: `mapFieldsALlegadaPendiente()`,
    `listarLlegadasPendientesPorFecha()`, `crearLlegadaPendiente()` y
    `buscarLlegadaPendientePorConsecutivo()`.
- **`src/graph/client.ts`**: se retiró `'LlegadasPendientes'` del tipo `ListName`.
- **`src/features/reportes/Reporte.tsx`**: `ReporteCierre` deja de traer y reconciliar las
  `LlegadasPendientes` del día (se quitó el `Promise.all` con `listarLlegadasPendientesPorFecha()`,
  el estado `llegadasPendientes` y el cálculo `llegadasSinResolver`) — vuelve a traer y pasar solo las
  Recepciones del día a `ReporteCierreDiario`.
- **`src/features/reportes/ReporteCierreDiario.tsx`**: se quitó la fila ámbar "Pendiente" y todo lo
  que la sostenía (`llegadasPendientes` como prop, el tipo `Fila` en unión con `LlegadaPendiente`, el
  texto "en espera de desembarcar" y la instrucción de usar la pestaña "Llegada en espera" que ya no
  existe) — la tabla vuelve a ser una lista simple de Recepciones del día, ordenada por
  `HoraLlegadaVehiculo`. Las columnas "Inicio desembarque"/"Termina desembarque" siguen mostrando
  "—" cuando el dato no está — eso ya lo hacía `horaCorta()` desde que existe este reporte (no
  necesitó ningún cambio), simplemente ahora ese "—" puede significar "nunca se va a saber" en vez de
  "Pendiente de completar".
- **No requiere ningún paso manual nuevo en SharePoint** — la lista `LlegadasPendientes` se deja tal
  cual (vacía, sin uso); las columnas `HoraInicioDesembarque`/`HoraFinalDesembarque` de `Recepciones`
  ya existían y ya aceptaban SharePoint las deja vacías sin problema al ser de tipo "Fecha y hora" —
  no son obligatorias a nivel de columna en SharePoint (la obligatoriedad vivía solo en el formulario
  de la app).
  - Los 7 archivos de esta ronda deben subirse JUNTOS en el mismo commit: `src/types/models.ts`,
    `src/features/recepcion/recepcionSchema.ts`, `src/features/recepcion/Recepcion.tsx`,
    `src/graph/lists.ts`, `src/graph/client.ts`, `src/features/reportes/Reporte.tsx`,
    `src/features/reportes/ReporteCierreDiario.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-21 — diagnóstico de doble captura en Novedades en Corral (Consecutivo 12558) y aviso preventivo**:

- **El caso**: el reporte diario del 14/09/2026 mostraba "10 Caídos" para el Consecutivo 12558
  (Asociado AGRO JABAR SAS, Granja LA CECILIA), pero en `ConsolidadoTiquetes` solo existían 5
  tiquetes de tipo "Caído" (los 5 esperados, todos ya "Procesado" — se confirmó con Nathalia
  filtrando esa lista por `RecepcionId=13`). Se diagnosticó junto con ella, cruzando en SharePoint
  (usando el panel "Detalles" de cada lista, que muestra el ID real en "Ruta de acceso: Documentos ›
  `<ID>`_.000" — la forma más confiable encontrada para ver el ID de un elemento sin tener que
  agregar columnas a la vista) la lista `NovedadesCorral` filtrada por ese mismo `RecepcionId=13`:
  había **2 registros idénticos** (Caídos: 5, Beneficiados de emergencia: 5 en ambos), creados por
  la misma persona ("Auxiliar Corrales") con solo 1 minuto de diferencia (14/9/2026 09:55 y 09:56,
  según `CapturadaEn`/`RecibidaEn` en `NovedadesCorral`) —
  un reenvío accidental del mismo formulario, no un problema de datos distintos.
- **Por qué el reporte duplicó el número pero `ConsolidadoTiquetes` no duplicó tiquetes**: son dos
  mecanismos distintos y ambos funcionaron exactamente como están diseñados. El reporte usa
  `obtenerNovedadCorralDeRecepcion()` (`src/graph/lists.ts`), que a propósito SUMA las cantidades de
  **todos** los registros de NovedadesCorral que compartan un `RecepcionId` — diseño de la quinta
  ronda de "Sesión del 2026-09-10" para poder capturar novedades genuinamente distintas del mismo
  lote en envíos separados (ej. "Muerto en reposo" hoy, "Caído" más tarde) sin perder ninguna. Con 2
  envíos idénticos, esa suma dobló 5 → 10. `generarTiquetesNovedadCorral()`, en cambio, compara cada
  envío individual contra los tiquetes que YA existen para ese `RecepcionId`+Grupo+Tipo y solo crea
  el faltante — como el segundo envío traía el mismo "Caídos: 5" que el primero, no encontró nada
  pendiente por crear y no generó tiquetes de más. Es decir: el bug no estaba en el código, sino en
  que nada impedía (ni avisaba) que la misma Novedad en Corral se guardara dos veces.
- **Arreglo manual dado a Nathalia (dato, no código)**: borrar en SharePoint el registro duplicado de
  `NovedadesCorral` (el de las 09:56, ID 19) — el reporte vuelve a mostrar 5 apenas se borre. No hace
  falta tocar `ConsolidadoTiquetes`.
- **Aviso preventivo agregado en código, a pedido explícito de Nathalia ("¿quieres que le agregue una
  validación que avise o bloquee si se intenta enviar una segunda Novedad en Corral para la misma
  Recepción el mismo día?" → "Si porfa")**:
  - `src/features/novedades-corral/NovedadesCorral.tsx`: `onSubmit()` ahora, justo antes de guardar,
    consulta `existeNovedadCorralDeRecepcion(recepcion.spId)` (función que ya existía en
    `src/graph/lists.ts` pero estaba sin usar — ver el comentario actualizado ahí) y, si ya hay una
    Novedad en Corral guardada para ese lote, muestra un `window.confirm()` explicando la situación y
    dejando que la persona decida: "Continuar" (si es una novedad distinta a la ya guardada) o
    "Cancelar" (si es la misma información y se iba a duplicar por error). **Es un aviso, no un
    bloqueo** — a propósito, para no romper el caso legítimo de capturar novedades distintas del
    mismo lote en envíos separados.
  - El chequeo consulta Graph directamente (no Dexie), porque Ubicación/Novedades en Corral se
    capturan por dispositivo y pueden no existir todavía en el Dexie local de un dispositivo distinto
    al que hizo el primer envío. Por eso solo se hace cuando la Recepción ya tiene `spId` (está
    sincronizada) y hay conexión (`navigator.onLine`) — si falta cualquiera de las dos cosas, o si la
    consulta a Graph falla por cualquier motivo, se guarda igual sin aviso: nunca se bloquea la
    captura offline por un chequeo que no se pudo completar.
  - **Alcance**: el pedido de Nathalia fue específicamente para Novedades en Corral, así que
    `src/features/ubicacion/Ubicacion.tsx` no recibió el mismo aviso — la misma brecha (nada impide
    un segundo registro de Ubicación para la misma Recepción) sigue abierta, ver "Pendiente" abajo.
  - `src/graph/lists.ts`: solo se actualizó el comentario que documenta `existeUbicacionDeRecepcion()`
    y `existeNovedadCorralDeRecepcion()` — ambas habían quedado sin usar tras retirarse
    `cerrarLotesCompletos()` (ver "Sesión del 2026-09-09"); `existeNovedadCorralDeRecepcion()` volvió
    a tener uso real con este cambio. Ningún cuerpo de función cambió.
  - Los 2 archivos deben subirse JUNTOS en el mismo commit:
    `src/features/novedades-corral/NovedadesCorral.tsx`, `src/graph/lists.ts`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-23 — diagnóstico de "No se pudo confirmar la sesión con Microsoft en segundo plano" (Edge, sin cambio de código)**:

- Nathalia reportó el banner rojo de error de sincronización con el texto "No se pudieron traer las
  Recepciones en proceso de otros dispositivos: No se pudo confirmar la sesión con Microsoft en
  segundo plano. Cierra sesión (botón 'Salir') y vuelve a iniciar sesión" — y que cerrar sesión y
  volver a entrar (el remedio que el propio mensaje sugiere, ver `getAccessToken()` en
  `src/graph/client.ts`) no lo arreglaba.
- **Causa (no es un bug de la app ni de sus datos)**: ese mensaje sale cuando `acquireTokenSilent` de
  MSAL falla dos veces seguidas con un `BrowserAuthError` (no con `InteractionRequiredAuthError`, que
  es el caso de sesión realmente vencida — ver el comentario de `getAccessToken()`). La renovación
  silenciosa depende de un iframe oculto contra `login.microsoftonline.com`; cuando el navegador
  bloquea las cookies de terceros hacia ese dominio (Edge con "Prevención de seguimiento" en modo
  Equilibrado o Estricto, cada vez más su valor por defecto), ese iframe nunca logra confirmar la
  sesión — de ahí que cerrar sesión y volver a entrar en la app no sirva: la cuenta está bien, es el
  navegador el que bloquea la técnica.
- **Arreglo (configuración del navegador, no código)**: en Edge, `edge://settings/privacy/trackingPrevention`
  → bajar a "Básica", o dejarlo en el nivel que se use pero agregar el sitio de la app como
  excepción ("Excepciones" → "Permitir todos los rastreadores en los sitios que elija"), y luego
  cerrar Edge por completo (todas las ventanas, no solo la pestaña) y volver a abrir la app.
  Nathalia confirmó que esto resolvió el problema.
- No se tocó ningún archivo de código — queda documentado aquí por si otra persona del equipo usa
  Edge con esta misma configuración y le aparece el mismo aviso.

**Sesión del 2026-09-24 — el mismo error de sesión salía seguido en varios dispositivos del equipo (no solo el de Nathalia); botón "Confirmar sesión" como arreglo de código**:

- Nathalia reportó capturas de 2 cuentas distintas ("Auxiliar corrales", rol Auxiliar; y una cuenta
  con rol Auditor) mostrando el mismo banner rojo de "Recepción no se pudo confirmar la sesión con
  Microsoft en segundo plano" en fechas distintas (15/09, 17/09) — a diferencia de la "Sesión del
  2026-09-23" (un solo computador, arreglado cambiando la configuración de Edge), acá el patrón es
  que pasa seguido en VARIOS dispositivos del equipo, algunos probablemente compartidos en planta y
  fuera del control de una sola persona para andar cambiando configuración de privacidad del
  navegador — pedirle a cada uno que entre a `edge://settings/...` no es una solución que escale, y
  un error frecuente sin arreglo le resta confianza a la app.
- **Investigación de fondo (revisando el propio código fuente de `@azure/msal-browser` instalado, no
  solo su documentación)**: `acquireTokenSilent()` de MSAL en realidad intenta 3 cosas en orden antes
  de rendirse — (1) leer un token todavía válido de la caché local, sin red; (2) si venció, pedir uno
  nuevo usando el *refresh token* guardado, con una petición de red directa al servidor de Microsoft
  (esto NO usa el iframe oculto ni depende de sus cookies — es la ruta normal y silenciosa la mayoría
  de las veces); y solo si ESA petición también falla, (3) cae al iframe oculto de SSO, que es el que
  sí depende de que el navegador deje pasar sus cookies de terceros (la causa de la "Sesión del
  2026-09-23"). Que el error salga tan seguido en dispositivos de planta sugiere que el paso 2
  también está fallando ahí — el sospechoso más probable es que esos computadores no conserven el
  *refresh token* entre sesiones (por ejemplo, si el navegador borra los datos del sitio al cerrarse,
  algo común en equipos compartidos) — así que cada vez que se abre la app le toca ir directo al paso
  3, el que sí depende de la configuración de cada navegador.
- **Arreglo de código — botón "Confirmar sesión" en el banner rojo** (`src/components/Navbar.tsx`):
  cuando el mensaje de error es uno de los 2 que arma `getAccessToken()` para una sesión que no se
  pudo confirmar (los que terminan en 'Cierra sesión (botón "Salir")...' — sesión vencida, o
  renovación en segundo plano bloqueada), ahora aparece un botón adicional **"Confirmar sesión"** al
  lado de "Descartar". Al tocarlo, se llama a `acquireTokenPopup()` de MSAL — una ventana emergente
  que navega DIRECTO al dominio real de Microsoft (no es un iframe metido en la página, así que no lo
  alcanza el bloqueo de cookies de terceros del paso 3 de arriba). Como se dispara desde el clic
  mismo (sin ningún `await` antes), el navegador no la bloquea como haría con un popup automático —
  es justo lo que se evitó a propósito la primera vez que se corrigió este problema (ver el
  comentario grande de `getAccessToken()` sobre la "ventanita en blanco" de antes, que sí era
  automática, en cada carga de la app). Si la sesión de Microsoft en el navegador sigue viva, el
  popup suele bastar con un parpadeo (abre y cierra solo, sin pedir contraseña); si de verdad hace
  falta autenticarse de nuevo, el propio popup lo pide ahí mismo, sin salir de la pantalla en la que
  se estaba. Si se confirma, se descarta el aviso y se dispara `sincronizar()` de una vez para subir
  lo pendiente; si el popup falla (por ejemplo, un navegador que sí bloquea popups en ese sitio),
  aparece un mensaje aparte sugiriendo revisar el bloqueo o usar "Salir" como respaldo — "Salir" +
  volver a entrar sigue funcionando igual que siempre, este botón es una alternativa más rápida, no
  un reemplazo.
- `src/graph/client.ts`: solo se amplió el comentario de `getAccessToken()` explicando por qué este
  nuevo popup SÍ es seguro (disparado por un clic real, nunca solo) a diferencia del que se quitó en
  la sesión del 2026-09-02 — no cambió ningún comportamiento de la función en sí.
- **No hay manera de eliminar el problema de raíz completamente desde el código**: si un dispositivo
  de verdad no conserva ningún dato de sesión entre usos (refresh token incluido) Y además ese mismo
  navegador bloquea por completo tanto el iframe como los popups hacia Microsoft, no queda otra que
  autenticarse de nuevo — es una limitación real de cómo funciona el inicio de sesión de Microsoft
  para una aplicación sin servidor propio (SPA), no algo que dependa de este código. El botón cubre
  el caso intermedio (más común): sesión vencida pero el navegador todavía deja pasar un popup real.
- Los 2 archivos deben subirse JUNTOS en el mismo commit: `src/components/Navbar.tsx`,
  `src/graph/client.ts` (aunque el cambio en este último es solo un comentario, sin riesgo funcional,
  conviene que quede junto para que la documentación en el código coincida con el comportamiento real).
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-25 — "Peso promedio en granja (kg)" ahora acepta 0**:

- A pedido de Nathalia: algunas granjas no pesan los cerdos al momento del despacho, así que el valor
  real que hay que capturar en esos casos es 0 — pero el campo lo rechazaba con "Debe ser mayor a 0".
- `src/features/recepcion/recepcionSchema.ts`: `PesoPromedioGranja` pasó de `.positive('Debe ser
  mayor a 0')` a `.nonnegative('Debe ser un número mayor o igual a 0')` — sigue siendo obligatorio
  (vacío o negativo no pasa), solo deja de exigir que sea mayor a cero. `NumeroTotalCerdos` (el
  número de cerdos) no se tocó — sigue exigiendo mayor a 0, porque ahí sí no tendría sentido un lote
  de 0 animales.
- No afecta nada más: `PesoPromedioGranja` solo se muestra tal cual en el resumen de Recepción
  (`ResumenRecepcion.tsx`) y se guarda en SharePoint sin ningún cálculo que dependa de que sea mayor
  a cero (no hay ninguna división ni promedio ponderado que lo use como denominador).
- Un solo archivo: `src/features/recepcion/recepcionSchema.ts`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-26 — botón "Editar Consecutivo / Número de orden" en Consolidado**:

- A pedido de Nathalia: permitir corregir el Consecutivo y el Número de orden de una Recepción ya
  sincronizada, para cuando alguien se equivoca al digitarlos y el error solo se nota después. Antes
  no había forma de corregirlos desde la app una vez guardada la Recepción — solo a mano en
  SharePoint.
- **Es la única edición de este tipo que existe**: sigue sin poder tocarse ningún otro campo de una
  Recepción ya capturada (Asociado, Granja, cantidades, horas, etc.) — el candado sigue firme para
  todo lo demás, esto abre una excepción puntual solo para estos 2 campos identificadores.
- `src/graph/lists.ts`: nueva función `actualizarConsecutivoYOrden(recepcionSpId, { Consecutivo,
  NumeroOrden })`, mismo patrón que `marcarLoteCompleto()`/`reabrirLote()` de arriba (un
  `updateItem('Recepciones', ...)` directo). No repite ninguna validación — es responsabilidad de
  quien la llama revisar antes que el Consecutivo nuevo no choque con otra Recepción.
- `src/features/consolidado/Consolidado.tsx`: nuevo botón **"Editar Consecutivo / Número de orden"**
  junto a la tarjeta de datos del lote (Fecha/Granja/Consecutivo/Número de orden), que convierte esos
  2 campos en cuadros de texto editables con "Guardar"/"Cancelar". Al guardar: si el Consecutivo
  cambió, primero se busca con `buscarRecepcionesPorConsecutivo()` si YA le pertenece a otra
  Recepción (excluyendo la misma, para no bloquearse a sí misma al no cambiar nada) — si hay choque,
  se avisa y no se guarda, igual que la validación que ya existía al crear una Recepción nueva
  (`existeConsecutivo()`). Si no hay choque (o el Consecutivo no cambió), se actualiza en SharePoint
  y en la copia local de Dexie a la vez, para que el desplegable de arriba y cualquier búsqueda
  posterior en este mismo dispositivo ya reflejen el valor corregido de inmediato.
  - **Restringido a Administrador (en el momento de esta sesión — ver la "Sesión del 2026-10-01" más
    abajo, donde este candado cambió a `soloLectura`)** y **solo en línea** — hace falta Graph tanto
    para revisar el choque de Consecutivo como para guardar.
  - No hace falta tocar `NovedadesCorral`, `Ubicaciones` ni `ConsolidadoTiquetes`: ninguna de esas 3
    listas guarda el Consecutivo — todas enlazan a su Recepción por `RecepcionId` (el ID real de
    SharePoint, que esto NUNCA toca), así que corregir el Consecutivo no les afecta en nada.
- Los 2 archivos deben subirse JUNTOS en el mismo commit: `src/graph/lists.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-24 (segunda ronda) — el botón "Confirmar sesión" solo cubría el banner global; el mismo error también sale en los buscadores propios de cada pantalla**:

- Nathalia reportó el mismo error de sesión ("No se pudo confirmar la sesión con Microsoft en
  segundo plano...") probando el buscador "¿No sabes el Consecutivo? Buscar por fecha" en
  Consolidado — pero sin el botón "Confirmar sesión" que se agregó unas horas antes (ver la primera
  "Sesión del 2026-09-24" arriba), porque ese arreglo solo vivía en el banner GLOBAL de
  sincronización de `Navbar.tsx`. Este buscador (y otros iguales) llama a Graph directo y muestra su
  propio error LOCAL en la misma pantalla — un camino que el arreglo anterior no cubría.
- Revisando el resto del código se encontraron otros 2 pares de buscadores con el mismo problema:
  "Buscar por Consecutivo"/"Buscar por fecha" en `NovedadesCorral.tsx` y en `Ubicacion.tsx` — los 3
  archivos (Consolidado, NovedadesCorral, Ubicacion) comparten este mismo patrón de buscador.
- En vez de copiar el botón 3 veces más, se sacó la lógica que ya tenía `Navbar.tsx` a 2 piezas
  reutilizables:
  - `esErrorDeSesion(mensaje: string)` — antes vivía duplicada como una función privada de
    `Navbar.tsx`, ahora exportada desde `src/graph/client.ts` (junto a los 2 mensajes que detecta,
    el lugar natural para que quede junto a su propia fuente).
  - `useConfirmarSesion()` (nuevo, `src/auth/useConfirmarSesion.ts`) — el `acquireTokenPopup()` y su
    estado de carga/error, que antes vivían escritos a mano dentro de `Navbar.tsx`.
  - `<BotonConfirmarSesion alConfirmar={...} />` (nuevo, `src/components/BotonConfirmarSesion.tsx`)
    — el botón en sí, listo para poner junto a cualquier mensaje de error; cada pantalla decide en
    `alConfirmar` qué hacer si se logra confirmar la sesión.
  - `Navbar.tsx` se simplificó para usar estas 2 piezas en vez de su código propio — mismo
    comportamiento de antes (descarta el error y dispara `sincronizar()` de una vez).
  - `Consolidado.tsx`, `NovedadesCorral.tsx` y `Ubicacion.tsx`: el banner de error de sus buscadores
    ahora también muestra `<BotonConfirmarSesion>` cuando el mensaje es de este tipo. Al confirmar,
    estas 3 pantallas simplemente BORRAN el mensaje de error (no reintentan la búsqueda solas, para
    no tener que adivinar cuál de los 2 buscadores —por fecha o por Consecutivo— era el que se
    estaba usando) — la persona vuelve a tocar "Buscar" una vez confirmada la sesión.
- 7 archivos en este cambio (2 nuevos, 5 modificados) — deben subirse JUNTOS en el mismo commit:
  `src/auth/useConfirmarSesion.ts` (nuevo), `src/components/BotonConfirmarSesion.tsx` (nuevo),
  `src/graph/client.ts`, `src/components/Navbar.tsx`, `src/features/consolidado/Consolidado.tsx`,
  `src/features/novedades-corral/NovedadesCorral.tsx`, `src/features/ubicacion/Ubicacion.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-24 (tercera ronda) — "Confirmar sesión" abría una ventana que se quedaba en blanco y nunca cerraba (regresión de una actualización de MSAL, no del código propio)**:

- Nathalia probó el botón "Confirmar sesión" ya desplegado (segunda ronda arriba): se abrió la
  ventana emergente, llegó hasta la URL de respuesta de Microsoft (`#code=1.AT...`, es decir el
  login SÍ se completó del lado de Microsoft), pero la ventana se quedó en blanco para siempre y el
  botón de atrás se quedó trabado en "Confirmando…".
- Causa encontrada leyendo el código fuente real de `node_modules/@azure/msal-browser` (no
  adivinada): `package.json` fija esta librería como `"^5.17.3"`, pero ese rango con caret permite
  que `npm install`/`npm ci` instale cualquier versión menor más nueva — y en algún momento (se
  confirmó que `package-lock.json`, con el que despliega GitHub Actions vía `npm ci`, ya trae
  **5.20.0** instalada) esa versión cambió por completo cómo funciona la ventana emergente:
  - Hasta la 5.17, la ventana ORIGINAL vigilaba sola la URL de la ventana emergente y la cerraba
    apenas veía la respuesta — el código de adentro de la ventana emergente no tenía que hacer nada
    (por eso `main.tsx` simplemente evitaba montar la app ahí, y funcionaba).
  - Desde la 5.20, ese vigilado se reemplazó por un mecanismo de "puente" (`BroadcastChannel`): la
    ventana original ahora ESPERA un mensaje por ese canal, y es la ventana EMERGENTE la que tiene
    que leer el código de la URL, mandarlo por el canal y cerrarse sola — usando una función nueva
    de la librería (`broadcastResponseToMainFrame`) que `main.tsx` nunca llegó a llamar, porque no
    existía cuando se escribió ese archivo. Sin esa llamada, la ventana emergente se queda en blanco
    para siempre (nunca se cierra) y la ventana original nunca recibe el mensaje (se queda
    "Confirmando…" hasta que, a los 60 segundos, MSAL lo da por fallido).
  - Esto es justo lo que reportó Nathalia — confirma la causa, no es una hipótesis.
- Arreglo: `main.tsx` ahora, cuando detecta que es la ventana emergente de login
  (`window.opener !== null`), llama a `broadcastResponseToMainFrame()` (import
  `@azure/msal-browser/redirect-bridge`) en vez de simplemente no montar nada — esa función lee la
  respuesta de la URL, se la pasa a la ventana original por el canal nuevo, y cierra la ventana
  emergente sola. Si por algo raro no hay una respuesta válida en la URL, igual se cierra la ventana
  (no la deja en blanco).
- No se tocó `loginRedirect()` (pantalla de login normal en `PantallaLogin.tsx`) — ese flujo es de
  página completa, no usa ventana emergente ni pasa por este puente, y sigue funcionando igual que
  siempre; tampoco hubo que subir ni bajar la versión de la librería (`package-lock.json` ya trae la
  5.20.0 con la que se probó este arreglo, y así seguirá desplegando `npm ci` en GitHub Actions).
- **1 solo archivo en este cambio**: `src/main.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
**Sesión del 2026-09-24 (cuarta ronda) — con el arreglo de la tercera ronda ya desplegado, la ventana emergente en vez de quedarse en blanco abría la app completa pidiendo iniciar sesión otra vez**:

- Nathalia probó de nuevo tras subir el `main.tsx` de la tercera ronda: esta vez la ventana
  emergente ya NO se quedó en blanco — pero en vez de cerrarse sola, abrió la app COMPLETA
  adentro (Navbar, "Hola, Nathalia", su propio aviso de sincronización con su propio botón
  "Confirmar sesión"), como si pidiera iniciar sesión otra vez dentro de la ventana emergente.
- Causa: el arreglo de la tercera ronda decidía "¿soy la ventana emergente?" mirando
  `window.opener !== null`. Pero login.microsoftonline.com manda cabeceras
  Cross-Origin-Opener-Policy que hacen que el navegador BORRE ese enlace hacia la ventana
  original apenas la emergente navega hacia allá — así que cuando la emergente vuelve a
  nuestro propio dominio con la respuesta, `window.opener` YA está en null, y `main.tsx`
  entendía (mal) que ya no era la ventana emergente, montando la app normal por error.
- Arreglo: además de `window.opener`, ahora también se revisa `window.name` — ese aislamiento
  de Microsoft NO lo borra, y MSAL siempre le pone a sus ventanas emergentes un nombre que
  empieza en `"msal."` (confirmado leyendo `generatePopupName()`/`generateLogoutPopupName()`
  en el código fuente de la librería instalada). Con cualquiera de las 2 señales en verdadero
  ya se trata como ventana emergente y se llama `broadcastResponseToMainFrame()` en vez de
  montar la app.
- No se tocó nada del login normal (`loginRedirect()` en `PantallaLogin.tsx`) — sigue exactamente
  igual que antes.
- **1 solo archivo en este cambio** (reemplaza el de la tercera ronda, mismo archivo):
  `src/main.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.
- Pendiente de que Nathalia confirme que ahora sí la ventana se cierra sola sin abrir la app
  adentro.
- **Confirmado por Nathalia**: con este archivo desplegado, la ventana emergente ya se cierra sola.
  El botón "Confirmar sesión" (Navbar y los 3 buscadores locales) queda funcionando de punta a
  punta.

**Sesión del 2026-09-24 (quinta ronda) — botón "Eliminar" por novedad en Consolidado**:

- Pedido de Nathalia: poder quitar una fila de "novedad" (un animal) de la tabla de Consolidado
  cuando se equivocaron al capturarla (contado de más, tipo equivocado, etc.) — antes no había forma
  de borrar, solo de dejar Tiquete/Destino vacíos. Mismo candado que ya rige "Terminar proceso":
  antes de terminar el proceso puede eliminar cualquier perfil que no sea Consultor; una vez el lote
  queda "Completo", solo un Administrador puede seguir eliminando (igual que ya pasa con editar). A
  propósito NO se usó el candado más fino por-tiquete (`filaSoloLectura`, que bloquea editar un
  tiquete individual ya completado si quien mira no es Administrador) — se puede querer eliminar una
  novedad completa aunque ya tenga Tiquete/Destino cargados, mientras el lote siga "En proceso".
- Nuevo `eliminarTiquete(id)` en `graph/lists.ts` (borra definitivamente el registro en
  `ConsolidadoTiquetes` vía Graph, mismo patrón que `eliminarAsociado`/`eliminarGranja`/etc.) y
  `eliminarFila()` en `Consolidado.tsx` (confirma con la persona, llama a `eliminarTiquete()` y
  borra la fila de Dexie). Solo en línea, igual que "Volver a generar tiquetes" y "Editar
  Consecutivo" — hace falta Graph para borrar de verdad.
- **Advertencia dejada documentada en el código** (importante para el equipo, no solo para el
  código): eliminar una fila aquí NO corrige el conteo de origen en Recepción o en Novedades en
  Corral que hizo que `generarTiquetesFaltantes()`/`generarTiquetesNovedadCorral()` la crearan en
  primer lugar (ej. `NovLlegadaCantCaidosBeneficioEmergencia`). Si ese conteo no se corrige también
  ahí, un futuro "Volver a generar tiquetes" sobre el mismo lote puede volver a crear una fila igual
  — para esa función, el conteo real sigue pidiendo esa cantidad de tiquetes. En la práctica esto
  solo importa si alguien vuelve a tocar "Volver a generar tiquetes" sobre un lote donde ya se
  eliminó una novedad sin corregir el conteo de origen (ese botón es de uso poco frecuente, pensado
  para reparar lotes que quedaron sin tiquetes por un bug de sincronización ya corregido) — vale la
  pena que Nathalia lo tenga presente y, si el motivo real de eliminar era un conteo mal digitado,
  corrija también el conteo en Recepción/Novedades en Corral cuando pueda.
- 2 archivos en este cambio — deben subirse juntos: `src/graph/lists.ts`, 
  `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-24 (sexta ronda) — "Eliminar" en Consolidado ahora también corrige el conteo de origen**:

- Nathalia notó, apenas se le explicó la advertencia de la quinta ronda, el problema de fondo: si
  Consolidado se alimenta de los conteos de Recepción/Novedades en Corral, eliminar una novedad ahí
  debería corregir también esos conteos — no dejarlo como una advertencia para hacer a mano. Tenía
  razón: hoy la app NO deja editar esos campos desde la pantalla una vez sincronizados (Recepción
  solo permite tocar Consecutivo/Número de orden; Novedades en Corral solo permite crear, nunca
  editar), así que no había ni siquiera dónde ir a corregirlo.
- Se le preguntó cómo resolver el único caso ambiguo: Novedad en corral y Fortuito "Muerto en
  Reposo" viven en NovedadesCorral, donde un mismo lote puede tener MÁS de un registro (se puede
  capturar en más de un envío) — si 2 registros reportan la misma novedad, no hay forma automática
  de saber de cuál hay que restar. Nathalia eligió: restar del más reciente.
- Arreglo, en `graph/lists.ts`:
  - `origenConteoDeTiquete()` (nueva, privada): mapeo GrupoNovedad+TipoNovedad → qué campo de
    conteo lo generó — el mismo mapeo de generarTiquetesFaltantes()/generarTiquetesNovedadCorral(),
    a la inversa.
  - `decrementarConteoOrigenTiquete()` (nueva, exportada): resta 1 de ese conteo.
    - Novedad de llegada (Lesionado/Caído/Agitado) y Fortuito Muerto en Transporte/Desembarque:
      viven en un ÚNICO registro de Recepción — se lee con `getItem()` (nueva en `client.ts`, trae
      UN elemento por id) + `mapFieldsARecepcion()` y se resta sin ambigüedad. 3 de estos 5 campos
      están en `NOMBRE_SP_BENEFICIO_EMERGENCIA` (nombre truncado a 32 caracteres en SharePoint) —
      se usa ese mapeo con respaldo al nombre tal cual para los otros 2.
    - Fortuito Muerto en Reposo y Novedad en corral (Lesionado/Caído/Agitado): viven en
      NovedadesCorral — se traen TODOS los registros de ese lote, se filtran los que tengan ese
      campo en más de 0, se ordenan por `CapturadaEn` y se resta del más reciente (decisión de
      Nathalia arriba). Si ninguno tiene ese campo en más de 0 (o el de Recepción ya está en 0), no
      hace nada — no lanza error, para no bloquear el borrado de la fila por esto.
  - `eliminarFila()` en `Consolidado.tsx` ahora llama a `decrementarConteoOrigenTiquete()` ANTES de
    `eliminarTiquete()` — a propósito: si restar el conteo falla, la fila NO se borra (evita que el
    conteo quede alto y la fila desaparecida a la vez). El aviso de confirmación ahora también dice
    que esto resta 1 del conteo de esa novedad en Recepción/Novedades en Corral.
- 3 archivos en este cambio — deben subirse juntos: `src/graph/client.ts`, `src/graph/lists.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-24 (séptima ronda) — una Recepción capturada en OTRO dispositivo no aparecía en el desplegable de "hoy"**:

- Nathalia reportó: capturó una Recepción en el computador, y en el celular (misma fecha, lote NO
  cerrado con "Terminar proceso") no le salía sola en el campo "Recepción" de Consolidado — antes sí
  aparecían solas las de hoy sin importar el dispositivo. Confirmó 2 datos clave: "Buscar por
  Consecutivo" SÍ la encontraba desde el celular, y el lote seguía "En proceso" (no cerrado).
- Causa real (no era un problema de sincronización, aunque lo parecía): el dispositivo que CAPTURA
  una Recepción guarda `FechaRecepcion` como fecha simple ("2026-09-24", tal como sale de
  `<input type="date">`) y nunca la vuelve a tocar — pero SharePoint la devuelve por Graph con hora
  incluida ("2026-09-24T05:00:00Z", columna de tipo Fecha y hora). El desplegable de "hoy" en
  Consolidado, Ubicación Y Novedades en Corral (los 3 tienen el mismo patrón) compara la fecha
  guardada contra la de hoy LETRA POR LETRA — nunca son iguales, así que en cualquier dispositivo
  que NO haya sido el que la capturó (la trae por Graph, sea por la descarga automática de
  "recepciones en proceso" o por los buscadores) la Recepción queda invisible para ese filtro,
  aunque sí llegó bien a Dexie — por eso "Buscar por Consecutivo" sí la encontraba (ese buscador no
  depende de esa comparación, agrega el id encontrado a una lista aparte que el desplegable también
  revisa). Mismo bug de fondo explica por qué antes se vio la fecha cruda "2026-09-15T07:00:00Z" en
  vez de una fecha limpia en el dato "Fecha" de Consolidado (ver más arriba, sesión anterior).
- Arreglo: `mapFieldsARecepcion()` en `graph/lists.ts` (el único lugar que traduce lo que llega de
  SharePoint al `Recepcion` de la app) ahora corta `FechaRecepcion` a los primeros 10 caracteres —
  normaliza siempre a "2026-09-24" sin importar el dispositivo. Mismo criterio que ya usan a la
  defensiva `formatearFecha()`/`fechaCorta()` en los reportes (`iso.slice(0, 10)`), así que no hay
  riesgo de romper esas pantallas — de hecho confirma que el bug era real, no solo en Consolidado.
- **Aviso para hoy únicamente**: una Recepción que un dispositivo ya haya descargado ANTES de subir
  este archivo se queda con la fecha "cruda" guardada en Dexie de ese dispositivo (la descarga
  automática nunca pisa un registro que ya existe, para no perder ediciones) — no se autocorrige
  sola. En la práctica no debería notarse: para el resto de HOY, en el celular de Nathalia esa
  Recepción concreta ya quedó visible por haberla buscado por Consecutivo (queda en la lista aparte
  de la sesión), y cualquier Recepción nueva que se descargue desde ahora en adelante, en cualquier
  dispositivo, ya sale corregida desde el primer momento.
- 1 solo archivo en este cambio: `src/graph/lists.ts`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-24 (octava ronda) — el aviso de la ronda anterior se cumplió: el celular de Nathalia ya había descargado esa Recepción ANTES del arreglo, así que seguía sin verse**:

- Nathalia probó la corrección de la séptima ronda y reportó que en el celular seguía sin
  aparecer la Recepción de hoy en el desplegable. Como se había advertido en el aviso de esa
  misma ronda: `descargarRecepcionesEnProceso()` (en `offline/syncService.ts`) se salta
  cualquier Recepción cuyo `spId` ya exista en Dexie de ese dispositivo — su celular ya la había
  descargado antes de subir el archivo corregido, así que se quedó para siempre con la
  `FechaRecepcion` "cruda" (con hora) guardada, y ninguna sincronización posterior la
  autocorregía.
- Arreglo: en `descargarRecepcionesEnProceso()`, cuando la Recepción remota ya existe localmente,
  ahora se compara su `FechaRecepcion` (ya normalizada por `mapFieldsARecepcion()`, ver ronda
  anterior) contra la guardada en Dexie; si no coinciden, se corrige SOLO ese campo con
  `db.recepciones.update()` — nunca se pisa el resto del registro local (a propósito, para no
  perder nada que dependiera de no sobreescribir Recepciones ya guardadas). Esto corre en cada
  sincronización normal (botón "Actualizar desde SharePoint" o automática al reconectar), así que
  cualquier dispositivo con una Recepción "atascada" en formato viejo se autocorrige la próxima
  vez que sincronice — no hace falta borrar caché ni reinstalar nada.
- 1 solo archivo en este cambio: `src/offline/syncService.ts`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-24 (novena ronda) — una novedad eliminada en Consolidado desde un dispositivo seguía apareciendo en los demás**:

- Nathalia probó el botón "Eliminar" (sexta ronda) desde el celular y reportó que, aunque en el
  celular la novedad desapareció, en el computador ese mismo tiquete seguía en la tabla.
- Causa real: `cachearTiquetesDeRecepcion()` (en `offline/syncService.ts`) —la función que trae de
  Graph los tiquetes de una Recepción y los guarda en Dexie, usada por el `useEffect` al elegir una
  Recepción, por el botón "Actualizar desde SharePoint", por "Volver a generar tiquetes" y por
  "Terminar proceso"— solo AGREGABA/ACTUALIZABA (`bulkPut`) lo que Graph todavía devolvía, pero
  nunca sacaba de Dexie un tiquete que Graph ya NO devolvía porque se había eliminado. El "Eliminar"
  sí borra el tiquete real en SharePoint (`eliminarTiquete()`), pero cualquier dispositivo que ya lo
  tuviera cacheado antes de ese borrado se quedaba con una copia local huérfana para siempre, sin
  importar cuántas veces le diera a "Actualizar desde SharePoint".
- Arreglo: `cachearTiquetesDeRecepcion()` ahora, después de guardar lo que trae Graph, borra de
  Dexie cualquier tiquete de esa Recepción cuyo id no esté en esa respuesta fresca. Es seguro
  comparar por `id` porque un `ConsolidadoTiquete` SIEMPRE se crea directo contra Graph (nunca sin
  conexión, ver el comentario en `listarTiquetesDeRecepcion()`) — no existe un tiquete "pendiente de
  subir" con id solo local que este borrado pudiera confundir con uno eliminado de verdad.
- 1 solo archivo en este cambio: `src/offline/syncService.ts` (mismo archivo de la octava ronda,
  pero es un reemplazo independiente — no hace falta volver a aplicar la octava a mano, este
  archivo ya incluye las dos correcciones).
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-24 (décima ronda) — botón "Editar Granja" en Consolidado**:

- Nathalia pidió poder corregir la Granja de una Recepción (por si se seleccionó mal al capturar)
  desde la misma tarjeta donde ya se podía corregir Consecutivo/Número de orden — pero con un
  candado distinto: mientras el lote siga "En proceso" lo puede corregir cualquier perfil que no
  sea Consultor, y una vez que quede "Completo" (con "Terminar proceso") solo un Administrador
  puede seguir corrigiéndola.
- `actualizarGranjaDeRecepcion()` (nueva, en `graph/lists.ts`) — NO confundir con
  `actualizarGranja()` (ya existente, para editar la ficha maestra de una Granja en Administrar →
  Granjas): esta otra solo cambia cuál Granja apunta una Recepción puntual, escribiendo
  `GranjaIdLookupId` (columna Lookup, igual que al crear la Recepción).
- En Consolidado.tsx el botón "Editar Granja" usa el candado `soloLectura` que ya usa el resto de
  la pantalla para los tiquetes (Consultor siempre bloqueado; lote "Completo" bloquea a todos menos
  Administrador) — en el momento de esta sesión, a propósito DISTINTO del candado de "Editar
  Consecutivo / Número de orden" (ese seguía siendo solo-Administrador en cualquier momento; ver la
  "Sesión del 2026-10-01", donde pasó a usar este mismo candado `soloLectura`). El combo de Granjas
  se filtra por el mismo Asociado que ya tiene la Recepción (igual que en la captura de Recepción) —
  el Asociado en sí sigue sin poder corregirse desde aquí.
- 2 archivos en este cambio — deben subirse juntos: `src/graph/lists.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-28 — botón "Editar horas" en Consolidado**:

- Nathalia pidió que, igual que Consecutivo/Número de orden, un Administrador pueda corregir las 4
  horas de una Recepción desde Consolidado: Hora programada, Hora de llegada del vehículo, Hora de
  inicio de desembarque y Hora final de desembarque.
- `actualizarHorasDeRecepcion()` (nueva, en `graph/lists.ts`): escribe las 4 columnas directo
  (no son Lookup, a diferencia de Granja). Espera los valores ya combinados con la fecha de la
  Recepción y el offset fijo -05:00 (mismo formato que `combinarFechaHora()` en Recepcion.tsx) — no
  hace ninguna conversión de zona horaria, solo escribe lo que le llega. Para las 2 horas
  opcionales, `null` las borra de verdad en SharePoint (`undefined` las deja sin tocar).
- En Consolidado.tsx: mismo candado que "Editar Consecutivo / Número de orden" en el momento de esta
  sesión — solo Administrador, en cualquier momento (no usa `soloLectura` como Granja, que si se
  bloquea cuando el lote queda "Completo" para todos menos el Admin). Las 4 horas ahora también se
  MUESTRAN siempre en la tarjeta (antes no aparecían ahí en absoluto), formateadas como "HH:MM" con
  `horaCorta()` — misma función que ya usan los reportes (`iso.slice(11, 16)`) — y al guardar se
  recombinan con `combinarFechaHora()`, igual que en la captura original. **Nota: "Editar horas"
  sigue siendo solo-Administrador sin cambios — ver la "Sesión del 2026-10-01", donde el candado que
  SÍ cambió fue el de "Editar Consecutivo / Número de orden", que pasó a `soloLectura`.**
- 2 archivos en este cambio — deben subirse juntos: `src/graph/lists.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-28 (segunda ronda) — el reporte mostraba la hora de la tarde en vez de la de la mañana**:

- Nathalia corrigió con "Editar horas" (arriba) las horas de la Recepción 12645 — quedaron bien en
  la lista de SharePoint (06:49/07:36/07:50) — pero el reporte de esa misma Recepción (pestaña
  Reporte > Diario) seguía mostrando 13:49/14:36/14:50. Se descartó que fuera solo un retraso del
  índice de búsqueda de SharePoint en columnas no indexadas (ya conocido en esta app): Nathalia
  volvió a generar el reporte y el desfase seguía igual.
- Causa real: a diferencia de Consolidado (que lee estas 4 horas de Dexie, con el valor tal cual se
  escribió), la pestaña Reporte > Diario/Semanal trae los datos DIRECTO de Graph en cada generación
  (nunca pasa por Dexie, ver el comentario grande al inicio de Reporte.tsx) — y `mapFieldsARecepcion()`
  en `graph/lists.ts` no le hacía ninguna corrección a estas 4 horas, a diferencia de FechaRecepcion
  (ya corregida antes). Comparando el valor correcto (SharePoint) contra el que llegaba de Graph, la
  diferencia fue de exactamente 7 horas, consistente en los 3 campos — no las 5 horas que uno
  esperaría solo por el huso horario de Bogotá, así que probablemente la configuración regional del
  sitio de SharePoint no es la que se había asumido (ver el comentario de FechaRecepcion) sino otra
  que le agrega esas 2 horas de más en esta consulta puntual — **pendiente confirmar/corregir esa
  configuración regional en SharePoint** (ver "Pendiente" más abajo); mientras tanto, la app
  compensa esas 7 horas en el único lugar que traduce lo que llega de Graph a Recepcion.
- Arreglo: nueva función `horaDeGraphAHoraLocal()` en `graph/lists.ts`, aplicada a las 4 horas
  dentro de `mapFieldsARecepcion()` — resta esas 7 horas y devuelve el mismo formato "-05:00" que ya
  usa el resto de la app, para que cualquier pantalla que traiga estas 4 horas directo de Graph (no
  solo Reporte.tsx: también `listarRecepcionesEnProceso`/`buscarRecepcionesPorConsecutivo`, que
  comparten este mismo mapeo) las muestre en la hora correcta. Verificado con un cálculo aparte
  (Node) usando los valores reales de la Recepción 12645: con esta corrección, esas horas quedan
  exactamente en 06:49/07:36/07:50.
- Además, en `offline/syncService.ts`, `descargarRecepcionesEnProceso()` ahora también autocorrige
  estas 4 horas (no solo FechaRecepcion, que ya se corregía desde antes) si un dispositivo ya las
  había descargado con el desfase viejo antes de este cambio — mismo patrón que la corrección de
  FechaRecepcion de esa función.
- 2 archivos en este cambio — deben subirse juntos: `src/graph/lists.ts`,
  `src/offline/syncService.ts`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-28 (tercera ronda) — causa raíz confirmada: la zona horaria del sitio de
SharePoint estaba mal configurada; el desfase real es de 5 horas, no 7**:

- Antes de aplicar el parche de la segunda ronda, Nathalia decidió primero validar la configuración
  regional del sitio en SharePoint (Configuración del sitio → Configuración regional) — buen
  criterio: encontró que la Zona horaria estaba puesta en "(UTC-08:00) Hora del Pacífico (EE.UU. y
  Canadá)" en vez de "(UTC-05:00) Bogotá, Lima, Quito, Rio Branco".
- Eso explica el número exacto que se había medido: Pacífico observa horario de verano (DST), y a
  finales de septiembre ese huso está efectivamente en -07:00, no en -08:00 — de ahí el desfase de 7
  horas encontrado en la segunda ronda, y no las 5 horas que corresponden a Bogotá. El mecanismo de
  fondo: Microsoft Graph siempre devuelve estas columnas "Fecha y hora" como instantes UTC absolutos
  (con "Z"), sin importar la zona configurada en el sitio — es la interfaz propia de SharePoint la
  que convierte esos instantes a la zona del sitio solo para MOSTRARlos en sus propias vistas.
- Nathalia corrigió la Zona horaria del sitio a Bogotá. **Hallazgo importante**: ese cambio NO
  reinterpreta los datos ya guardados con la configuración anterior — confirmado viendo que, tras el
  cambio, la propia lista de SharePoint pasó de mostrar "06:49" a mostrar "08:..." para el mismo
  valor guardado de HoraLlegadaVehiculo de la Recepción 12645 (un salto de +2h, consistente con la
  diferencia entre -07:00 y -05:00). Es decir: el ajuste de zona horaria del sitio solo aplica hacia
  adelante (a lo que se escriba de ahora en más); lo que ya estaba guardado quedó, con la zona nueva,
  mostrándose distinto pero sin haber cambiado su valor real.
- **Corrección en el código**: `CORRECCION_HORAS_GRAPH_MS` en `graph/lists.ts` pasó de 7 a 5 horas —
  el valor de 7 horas estaba calibrado sobre la configuración incorrecta (Pacífico en DST) y hubiera
  quedado inestable con el tiempo (por el propio cambio de horario de EE.UU.); 5 horas es el offset
  real y fijo de Bogotá (sin DST), y esta corrección sigue siendo necesaria pase lo que pase con la
  configuración del sitio, porque Graph nunca aplica esa zona horaria por su cuenta — este sigue
  siendo el único lugar donde se deshace. Se reescribió también el comentario grande de esa función
  para dejar registrada la causa raíz completa.
- **Pendiente para Nathalia — paso manual, no de código**: como el ajuste de zona horaria del sitio
  no corrige lo ya guardado, hay que volver a guardar (con "Editar horas" en Consolidado) los mismos
  3 valores correctos (06:49/07:36/07:50) de la Recepción 12645 — y de cualquier otra Recepción cuyas
  horas se hayan escrito mientras el sitio todavía tenía mal la zona horaria — para que Graph las
  reciba y las guarde ya bajo la interpretación correcta de Bogotá. Después de eso, generar el
  reporte una vez más para confirmar que por fin coincide en las 3 pantallas (SharePoint, Consolidado
  y Reporte).
- 1 archivo en este cambio: `src/graph/lists.ts` (no depende de los archivos de la segunda ronda,
  aunque toca el mismo bloque de código).
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-29 — panel "Consecutivos repetidos" en Consolidado (resuelve conflictos de
Consecutivo desde la interfaz, antes no existía)**:

- Nathalia reportó que unos lotes capturados el día anterior en otro computador no aparecían ni en su
  computador, ni en SharePoint, ni en el reporte — como si nunca se hubieran sincronizado. Antes de
  llegar a esa causa, notó por separado un badge "2 consecutivos repetidos" en la barra superior y
  preguntó si ese era el motivo — **no lo era**: confirmó explícitamente que esos consecutivos
  repetidos (uno de ellos el 12561) no tenían relación con lo de ayer; quedaron como dos asuntos
  separados (el de ayer, de sincronización entre dispositivos, sigue sin diagnosticar — ver
  "Pendiente").
- Al revisar el badge de conflictos (`useEstadoSync.ts`/`Navbar.tsx`), se encontró que la app SÍ
  detecta y cuenta los choques de Consecutivo (dos dispositivos capturando el mismo número sin
  conexión — `sincronizarRecepciones()` en `syncService.ts` marca `EstadoSync: 'ConflictoConsecutivo'`
  y nunca sube ese registro a SharePoint), pero **no existía ninguna pantalla para resolverlos** — el
  diseño original decía "para que el Administrador lo resuelva a mano" (ver "Pendiente", ahora
  resuelto) pero esa parte nunca se construyó. Nathalia confirmó que el Consecutivo 12561 no importa
  si se pierde, y pidió construir la pantalla de resolución de todas formas.
- **`corregirConsecutivoConflicto()` y `descartarRecepcionConflicto()`** (nuevas, en
  `syncService.ts`):
  - La primera corrige Consecutivo/Número de orden de la Recepción atascada y la vuelve a poner en
    `'Pendiente'` — la próxima sincronización la reintenta y vuelve a validar sola con
    `existeConsecutivo()` (si el número nuevo también choca, vuelve a quedar en conflicto, sin lógica
    duplicada).
  - La segunda la borra por completo de este dispositivo (no se sube a SharePoint, no se puede
    deshacer) — pensada para el caso real de Nathalia, donde el duplicado no hacía falta recuperar.
    También borra en cascada cualquier Ubicación/Novedad en Corral local que ya se hubiera capturado
    para esa misma Recepción — sin esto se hubieran quedado reintentando subir para siempre, sin
    ningún aviso, porque `sincronizarUbicaciones()`/`sincronizarNovedadesCorral()` esperan a que el
    padre tenga `spId` (`if (!padre?.spId) continue`) y una Recepción descartada nunca lo va a tener.
- **Nuevo panel en `Consolidado.tsx`** (solo Administrador, mismo candado que Consecutivo/Número de
  orden normal en el momento de esta sesión), visible arriba de todo cuando hay conflictos pendientes:
  lista cada Recepción atascada (fecha, Consecutivo, Número de orden, cantidad de animales, para
  poder identificarla) con 2 acciones — "Corregir Consecutivo" (campos para el nuevo Consecutivo/
  Número de orden, guarda y reintenta sincronizar si hay conexión) y "Descartar" (con confirmación).
  Estas Recepciones no aparecían antes en ningún lado de la interfaz: el selector normal de
  Consolidado solo lista `EstadoSync: 'Sincronizada'`, y como nunca llegaron a SharePoint tampoco
  aparecen en ningún reporte ni buscador — este panel es hoy el único lugar donde se ven. **Este
  candado se abrió a cualquiera que no sea Consultor en la segunda ronda, el mismo día — ver abajo.**
- 2 archivos en este cambio — deben subirse juntos: `src/offline/syncService.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-09-29 (segunda ronda) — el panel de conflictos se abre a cualquiera que no sea
Consultor, no solo a Administrador; y primer caso real documentado del choque falso-positivo**:

- Ya en uso el panel de la ronda anterior, salió un caso real: el Consecutivo 12634, capturado por un
  perfil Auditor, quedó en conflicto — y Nathalia confirmó que ese Consecutivo NO existía en
  SharePoint en absoluto (ni él ni ningún duplicado). Esto confirma que "Consecutivo repetido" no
  siempre significa que haya 2 copias reales compitiendo: la Recepción nunca llega a crearse porque,
  en el momento de sincronizar, `existeConsecutivo()` le preguntó a SharePoint si ya existía y
  recibió que sí — una respuesta que puede ser un falso positivo por el mismo retraso del índice de
  búsqueda ya documentado (ver la causa del 12561 en la "Sesión del 2026-09-28 (tercera ronda)" de
  horas, y la explicación completa en el chat de esa fecha). La solución práctica es la misma:
  confirmar que el Consecutivo de verdad no existe (buscándolo) y reintentar con el mismo número
  desde "Corregir Consecutivo".
- Nathalia pidió que el Auditor (quien más se topa con este conflicto, al ser quien más captura) no
  tenga que depender de un Administrador para resolverlo cada vez. Se cambió el candado del panel de
  `esAdmin` a `usuario.Rol !== 'Consultor'` (nueva variable `puedeResolverConflictos` en
  `Consolidado.tsx`) — Administrador, Supervisor y Auditor pueden ahora ver el panel y usar tanto
  "Corregir Consecutivo" como "Descartar"; solo Consultor (de solo lectura) sigue sin verlo. En el
  momento de esta sesión esto se contrastaba con "Editar Consecutivo/Número de orden" (que seguía
  siendo exclusivo de Administrador, porque esa función edita una Recepción YA sincronizada —
  información que ya salió a producción) — ver la "Sesión del 2026-10-01" más abajo, donde ese otro
  candado también se abrió, aunque con el criterio `soloLectura` (no el mismo que este panel) por
  tratarse de una Recepción que sí ya está en producción.
- 1 archivo en este cambio: `src/features/consolidado/Consolidado.tsx` (no depende de
  `syncService.ts` de la ronda anterior, que no cambió).
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-10-01 — "Editar Consecutivo / Número de orden" ahora usa el mismo candado que
Granja (`soloLectura`), no solo Administrador**:

- Nathalia reportó un caso real: un perfil Auxiliar corrales/Auditor, viendo una Recepción normal ya
  sincronizada (Consecutivo 72636) con el lote todavía "En proceso", no tenía forma de corregir el
  Consecutivo — el botón "Editar Consecutivo / Número de orden" (agregado en la "Sesión del
  2026-09-26") seguía restringido a Administrador, a diferencia de "Editar Granja" (que ya usa el
  candado `soloLectura` desde la "Sesión del 2026-09-24, décima ronda"). Pidió explícitamente:
  *"podemos poner que el consecutivo y la orden sea editable para ese perfil, asi como granja, pero
  cuando el proceso se termine no deje editar solo el admin puede despues de terminar el proceso"*.
- **Cambio, en `src/features/consolidado/Consolidado.tsx`**: el gate del botón "Editar Consecutivo /
  Número de orden" pasó de `{esAdmin && (...)}` a `{!soloLectura && (...)}` — exactamente el mismo
  candado que ya usa "Editar Granja", justo debajo en la misma pantalla: cualquiera que no sea
  Consultor puede corregir Consecutivo/Número de orden mientras el lote siga "En proceso", y una vez
  que quede "Completo" (con "Terminar proceso"), solo un Administrador puede seguir editándolo.
- **No se tocó nada más**: `actualizarConsecutivoYOrden()` y `guardarConsecutivo()` (que ya hacía su
  propia revisión de choque de Consecutivo vía `buscarRecepcionesPorConsecutivo()`, sin ninguna
  lógica específica de rol) no necesitaron ningún cambio — el único ajuste fue de a quién se le
  muestra el botón. "Editar horas" (misma pantalla, candado siempre-Administrador-en-cualquier-
  momento, sin `soloLectura`) tampoco se tocó — sigue aparte, a propósito, porque Nathalia no pidió
  cambiarlo esta vez.
- Se aprovechó para corregir varios comentarios del archivo que habían quedado desactualizados tras
  este cambio (mencionaban "Editar Consecutivo/Número de orden: siempre Administrador" como
  contraste al explicar otros candados — Editar Granja, el panel de "Consecutivos repetidos", Editar
  horas) para que todos apunten al estado real y vigente de cada candado.
- 1 solo archivo en este cambio: `src/features/consolidado/Consolidado.tsx`.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-10-01 (segunda ronda) — la Fecha de recepción no deja capturar una fecha futura**:

- Nathalia pidió: *"en la fecha de recepción no deje poner fechas mayores a hoy, si son menores o
  iguales a hoy si debe dejar pero si son mayores a hoy le debe decir que no esta permitido"*.
- **`src/features/recepcion/recepcionSchema.ts`**: `FechaRecepcion` ahora tiene un `.refine()` que
  compara la fecha escrita contra la de hoy — `fecha <= new Date().toISOString().slice(0, 10)` — y
  si es posterior, muestra el mensaje "No está permitido registrar una fecha posterior a hoy" debajo
  del campo, exactamente igual que cualquier otro error de este formulario. La comparación es por
  texto ("YYYY-MM-DD" contra "YYYY-MM-DD"), válida porque ambas cadenas tienen siempre el mismo
  formato de ancho fijo — el mismo truco de comparación que ya usa `hoyISO()` en
  Consolidado.tsx/Ubicacion.tsx/NovedadesCorral.tsx/Reporte.tsx, en vez de comparar objetos `Date`.
  Hoy y cualquier fecha anterior siguen aceptándose sin cambios — a propósito, para no bloquear el
  registro de un lote con algunos días de atraso.
- **`src/features/recepcion/Recepcion.tsx`** (mejora de UX, no el candado real — ese vive en el
  schema): se agregó un `hoyISO()` local (mismo patrón ya usado en otras pantallas) y se lo pasa como
  `max={hoyISO()}` al `<input type="date">` de "Fecha de recepción" — así el propio selector nativo
  de fecha del navegador ya bloquea elegir un día futuro en la mayoría de los casos, antes incluso de
  llegar a guardar. El valor inicial del formulario (`VALORES_INICIALES.FechaRecepcion`), que ya
  usaba `new Date().toISOString().slice(0, 10)`, ahora llama a este mismo `hoyISO()` en vez de
  repetir la expresión.
- No se tocó ninguna otra pantalla: Consolidado no permite editar `FechaRecepcion` de una Recepción
  ya capturada (solo Consecutivo/Número de orden, Granja y las 4 horas — ver las sesiones
  anteriores), así que este es el único punto de entrada de este campo.
- 2 archivos en este cambio — deben subirse juntos: `src/features/recepcion/recepcionSchema.ts`,
  `src/features/recepcion/Recepcion.tsx`.
- No requiere ningún paso manual en SharePoint — es una validación puramente del lado de la app.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-10-01 (tercera ronda) — botón "Limpiar filtros" en Consolidado**:

- Nathalia mandó dos capturas de la pantalla de Consolidado desplegada (desplegable "Recepción",
  "Buscar por Consecutivo", "¿No sabes el Consecutivo? Buscar por fecha" y el aviso rojo "Las
  Recepciones de esa fecha ya estaban en este dispositivo…") y pidió: *"aca en consolidado, poner un
  boton que limpie todos los filtros y que su función sea borrar todos los filtros"*.
- **`src/features/consolidado/Consolidado.tsx`**: se agregó `limpiarFiltros()` y un botón de texto
  "Limpiar filtros" justo debajo de los dos buscadores (encima de la lista de tiquetes). Al hacer
  clic, borra de una vez:
  - `consecutivoBusqueda` y `fechaBusqueda` (el texto escrito en los dos campos de búsqueda).
  - `error` — el mensaje de aviso/error que haya quedado de cualquiera de los dos buscadores (o de
    cualquier otra acción de la pantalla, porque `error` es un solo estado compartido por todo
    Consolidado — ver más arriba).
  - `idsFueraDeHoy` — la lista de ids que los buscadores fueron agregando para que el desplegable de
    "Recepción" los siga mostrando aunque no sean de hoy (ver el comentario grande de esa lista). Al
    vaciarla, el desplegable vuelve a mostrar solo los lotes de hoy, su comportamiento por defecto.
  - Si la Recepción que estaba seleccionada en el desplegable NO es de hoy (la trajo alguno de los
    buscadores), también se deselecciona (`setRecepcionId('')`) — si no, quedaría elegida una opción
    que el desplegable ya no está mostrando.
  - El botón se deshabilita cuando no hay nada que limpiar (los dos campos vacíos, sin ids fuera de
    hoy y sin ningún error visible), para que no parezca una acción disponible cuando no haría nada.
- No se tocó ningún otro archivo ni se requiere ningún paso manual en SharePoint — es un cambio
  puramente de UI sobre estado que ya existía en esta pantalla.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-10-01 (cuarta ronda) — "Actualizar desde SharePoint" no traía de vuelta una
corrección hecha directamente en SharePoint**:

- Nathalia reportó (con capturas): corrigió en SharePoint, a mano, la `FechaRecepcion` de un lote
  (Consecutivo 12671) que ya estaba capturado y sincronizado — pero el desplegable de "Recepción" en
  Consolidado le seguía mostrando la fecha vieja.
- **Causa raíz**: una vez que una Recepción ya existe en Dexie (en cualquier dispositivo), nada
  vuelve a traer sus propios campos desde SharePoint, salvo una única excepción puntual y angosta:
  `descargarRecepcionesEnProceso()` en `syncService.ts` (corre sola cada
  `INTERVALO_AUTO_SYNC_MS` — 2 minutos — mientras la pestaña esté abierta y haya conexión) compara,
  SOLO para lotes que sigan "En proceso" en SharePoint, 5 campos puntuales (`FechaRecepcion` y las 4
  horas) contra lo que ya hay guardado localmente, y corrige si hay diferencia — un parche que se
  agregó para una migración vieja (ver la sesión del 2026-09-24 sobre el formato de
  `FechaRecepcion`), no pensado como mecanismo general de refresco. Ni ese parche ni los buscadores
  de Consolidado (`buscarPorFecha()`/`buscarPorConsecutivo()`, que solo escriben en Dexie si el
  `spId` TODAVÍA no existe localmente — `if (!local) { ... }`) tocan ningún otro campo, ni corrigen
  nada una vez que el lote queda "Completo" (`listarRecepcionesEnProceso()` deja de traerlo). El
  botón "Actualizar desde SharePoint" de Consolidado, pese al nombre, solo traía de nuevo los
  tiquetes (`cachearTiquetesDeRecepcion`) — nunca la Recepción misma. Resultado: cualquier edición
  hecha directamente en SharePoint (fuera de los botones "Editar…" de la propia app) a un campo
  distinto de esos 5, o a un lote ya "Completo", se queda invisible para siempre en cualquier
  dispositivo que ya tuviera esa Recepción descargada.
- **`src/graph/lists.ts`**: nueva `obtenerRecepcionActual(recepcionSpId)` — `getItem()` (ya existía,
  la usaba `decrementarConteoOrigenTiquete()`) más `mapFieldsARecepcion()` (la misma función de
  mapeo que usan todos los demás caminos de lectura), para traer el estado más fresco de UNA
  Recepción puntual por su `spId`.
- **`src/features/consolidado/Consolidado.tsx`**: `actualizar()` (el handler del botón "Actualizar
  desde SharePoint") ahora, además de `cachearTiquetesDeRecepcion()`, llama a
  `obtenerRecepcionActual()` y sobrescribe el registro local completo (`db.recepciones.update`) con
  lo que haya en SharePoint en ese momento — sin importar si el lote sigue "En proceso" o ya quedó
  "Completo". Se excluye `id` del `update`: es la llave primaria local (un UUID si este dispositivo
  capturó la Recepción, no necesariamente igual a su `spId`) y no debe tocarse. El tooltip del botón
  se actualizó para reflejar que ahora también trae de vuelta los datos propios de la Recepción
  (fecha, horas, Consecutivo, Granja, etc.), no solo los tiquetes.
- A Nathalia se le indicó, para su caso puntual: seleccionar esa Recepción en el desplegable y
  presionar "Actualizar desde SharePoint" (una vez actualizada la app con este cambio) para traer de
  vuelta la fecha corregida.
- 2 archivos en este cambio — deben subirse juntos: `src/graph/lists.ts`,
  `src/features/consolidado/Consolidado.tsx`.
- No requiere ningún paso manual en SharePoint.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-10-02 — la imagen del "Cierre diario" salía con las barras de scroll dibujadas
encima de la tabla**:

- Nathalia mandó capturas: al descargar la imagen del Cierre diario, aparecía una barra de scroll
  vertical (a la derecha, tapando parte de la columna #ICA) y una horizontal (abajo), como si
  fueran parte de la imagen misma.
- **Causa raíz**: las 3 tablas anchas de los reportes que se descargan como imagen/PDF (Horas en
  `ReporteDiarioLote.tsx`, Detalle por lote en `ReporteSemanalAsociado.tsx`, la tabla completa de
  `ReporteCierreDiario.tsx`) envuelven la tabla en un `<div>` con `overflow-x-auto` — a propósito,
  para poder deslizarla en un celular angosto — pero ninguna fijaba `overflow-y`. Por spec de CSS,
  si un eje queda en algo distinto de "visible" y el otro se deja en su valor inicial ("visible"),
  el navegador cambia SOLO por eso el otro eje a "auto" — así nadie haya pedido scroll vertical. Y
  como `dom-to-image-more` (ver `descargarImagen.ts`) pinta tal cual lo que el navegador renderiza
  (serializa el DOM real dentro de un SVG), si el contenido de ese contenedor terminaba midiendo
  aunque fuera un pixel más alto que su caja (fácil con los cálculos de nitidez/pixelRatio de
  `capturarComoPNG()`), el navegador dibujaba una barra de scroll REAL como parte de los píxeles
  del PNG/PDF final.
- **Arreglo en 2 capas (INCOMPLETO — ver la corrección más abajo, misma fecha)**:
  - `overflow-y-visible` explícito al lado de `overflow-x-auto` en los 3 componentes de reporte
    mencionados arriba — corta la conversión automática en la fuente.
  - Red de seguridad general en `src/utils/descargarImagen.ts`: nueva
    `neutralizarScrollVerticalImplicito()`, llamada desde `crearClonAnchoFijo()` justo después de
    montar el clon en el documento (hace falta estar montado para que `getComputedStyle` calcule
    algo) — recorre todos los elementos del clon y fuerza `overflow-y: visible` en cualquiera donde
    el navegador la haya cambiado sola, sin tocar el `overflow-x` que sigue haciendo falta. Así,
    aunque un reporte futuro agregue otro `overflow-x-auto` y se olvide la clase explícita, la
    captura sigue protegida.
- 4 archivos en este cambio — deben subirse juntos: `src/utils/descargarImagen.ts`,
  `src/features/reportes/ReporteCierreDiario.tsx`, `src/features/reportes/ReporteDiarioLote.tsx`,
  `src/features/reportes/ReporteSemanalAsociado.tsx`.
- No requiere ningún paso manual en SharePoint — es un cambio puramente visual sobre cómo se
  captura la imagen/PDF.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores.

**Sesión del 2026-10-02 (segunda ronda) — CORRECCIÓN del arreglo de arriba: `overflow-y-visible` no
cortaba nada, el navegador lo volvía a convertir en "auto" igual**:

- Nathalia confirmó con capturas (tras forzar la actualización de la app con "Actualizar ahora")
  que la imagen seguía saliendo con las barras de scroll encima de la tabla — el arreglo de la
  primera ronda de este mismo día no sirvió.
- **Por qué no sirvió**: la regla de la spec de CSS que fuerza la conversión a "auto" no distingue
  entre un "visible" que quedó por default y uno puesto a propósito — CUALQUIER elemento con un eje
  en "auto" y el otro en "visible" (sea cual sea la razón de que esté en "visible") hace que el
  navegador convierta el valor USADO de ese eje a "auto" de todas formas. Así que el
  `overflow-y-visible` explícito de la primera ronda nunca alcanzaba a aplicarse de verdad mientras
  siguiera al lado de un `overflow-x-auto` en el mismo elemento.
- **Arreglo real**: la única forma de que un elemento no tenga NINGÚN scroll es que los dos ejes
  queden en "visible" a la vez. `neutralizarScrollVerticalImplicito()` en `descargarImagen.ts` se
  renombró a `neutralizarScrollImplicito()` y ahora fuerza `overflow-x: visible` Y `overflow-y:
  visible` juntos (antes solo tocaba el eje Y) en cualquier elemento del clon donde el navegador
  haya dejado activo cualquiera de los dos. Esto es seguro específicamente para el clon que se va a
  CAPTURAR (nunca para el reporte en pantalla): el único motivo por el que esas 3 tablas piden
  scroll horizontal es para un celular angosto, y el clon siempre se arma con `ANCHO_CAPTURA` (ancho
  fijo, generoso) elegido justamente para que las 3 quepan enteras sin necesitar ese scroll —
  apagarlo ahí no recorta ninguna columna. Se quitaron las clases `overflow-y-visible` (ya inútiles)
  y sus comentarios de los 3 componentes de reporte, apuntando en su lugar al comentario grande de
  `neutralizarScrollImplicito()`.
- 4 archivos en este cambio — deben subirse juntos: `src/utils/descargarImagen.ts`,
  `src/features/reportes/ReporteCierreDiario.tsx`, `src/features/reportes/ReporteDiarioLote.tsx`,
  `src/features/reportes/ReporteSemanalAsociado.tsx`.
- No requiere ningún paso manual en SharePoint.
- Verificado con `tsc -b --noEmit`, `oxlint` y `npm run build` sin errores. **Confirmado por
  Nathalia en el dispositivo real (2026-10-02): la imagen del Cierre diario ya descarga sin las
  barras de scroll.**

## Pendiente / a definir con el equipo
- **Sin diagnosticar todavía**: lotes capturados el 2026-09-28 en un computador distinto al de
  Nathalia no llegaron a aparecer ni en SharePoint ni en los reportes — descartado que fuera por los
  "consecutivos repetidos" del panel nuevo (ver "Sesión del 2026-09-29"), esas 2 cosas resultaron no
  tener relación. Falta el Consecutivo exacto del/de los lote(s) de ayer y confirmar en el computador
  donde se capturó: si mostraba "En línea"/"Sin conexión" en ese momento, si salió algún banner de
  error, y si la persona alcanzó a completar el guardado.
- Crear en SharePoint las listas que aún falten con las columnas documentadas (incluida la nueva
  `GruposAsociados` y el Lookup `GrupoAsociadoId` en `Asociados`), y los 4 grupos de seguridad.
- **Crear las 12 columnas nuevas de "Novedad en corral" en la lista `NovedadesCorral`** (nombres y
  tipos exactos en el punto 2 de "Decisiones clave de diseño" y en "Sesión del 2026-09-10") — sin
  esto, esa función nueva no puede sincronizar.
- **Agregar "Decomisado en canal" como opción de la columna `Destino` en `ConsolidadoTiquetes`** si
  esa columna de Elección en SharePoint no admite valores libres (ver la sexta ronda de "Sesión del
  2026-09-10") — sin esto, Graph puede rechazar el guardado de esa opción nueva.
- **Crear la columna nueva `BeneficiadoMismoDia` (Sí/No) en la lista `Recepciones`** (ver "Sesión del
  2026-09-11") — sin esto, la pestaña "Cierre diario" no puede guardar el marcado.
- Registrar (o confirmar reutilización de) la app en Entra ID con `Sites.ReadWrite.All`.
- Asignar `GrupoAsociadoId` a los Asociados existentes (quedan sin grupo hasta que se haga a mano).
- Volumen esperado de lotes/día, para vigilar el límite de vista de 5.000 elementos de SharePoint.
- ~~Revisar la configuración regional (zona horaria) del sitio de SharePoint~~ — **resuelto en la
  "Sesión del 2026-09-28 (tercera ronda)"**: la Zona horaria del sitio estaba mal puesta en Pacífico
  (EE.UU./Canadá) y Nathalia ya la corrigió a Bogotá. Importante: esto NO hace innecesaria la
  compensación del código (`horaDeGraphAHoraLocal()` en `graph/lists.ts`, ahora en 5 horas) — Graph
  siempre devuelve estas columnas en UTC puro sin importar la zona del sitio, así que la corrección
  en código sigue siendo necesaria de forma permanente. **Sigue pendiente** volver a guardar (con
  "Editar horas" en Consolidado) las Recepciones cuyas horas se hayan escrito mientras el sitio tenía
  mal la zona horaria — empezando por la Recepción 12645 — porque el cambio de configuración no
  reinterpreta retroactivamente lo ya guardado.
- ~~Validar con el equipo qué pasa si dos usuarios capturan el mismo lote en paralelo desde
  dispositivos distintos estando ambos offline (mismo Consecutivo por error humano) — hoy queda en
  conflicto para que un Administrador lo resuelva a mano~~ — **primer caso real y panel de resolución
  construido en la "Sesión del 2026-09-29"** (ver abajo): ya existe una pantalla para resolverlo, no
  solo el aviso de cuántos hay.
- Confirmar con Nathalia si el enlace `blob:...` de más al compartir PDF por WhatsApp en iPhone es
  aceptable de todos modos (ya se confirmó que no tiene arreglo posible desde el código de la app,
  ver "Sesión del 2026-09-08/09" arriba) o si prefiere pasar directo a la alternativa manual (guardar
  en Archivos + adjuntar como documento desde WhatsApp) y simplificar el botón a un solo paso.
- Ubicación y Novedades en Corral no impiden crear un SEGUNDO registro para la misma Recepción (el
  modelo espera "1 por lote" pero nada lo hace cumplir) — ya causó un bug real en los reportes (ver
  la quinta ronda de "Sesión del 2026-09-10"), corregido ahí combinando los registros en la lectura,
  y causó un caso real más (Consecutivo 12558, doble envío accidental, ver "Sesión del 2026-09-21").
  **Para Novedades en Corral** ya hay un aviso no bloqueante desde "Sesión del 2026-09-21" (avisa
  antes de guardar si ya existe una Novedad en Corral para el lote, pero deja decidir a la persona).
  **Para Ubicación la brecha sigue abierta sin aviso ni bloqueo** — no se ha pedido todavía; la raíz
  (impedir el segundo registro desde la UI, en vez de solo avisar) tampoco se ha pedido resolver.
- Consolidado ya quedó modificado (2026-09-10) — el pendiente que quedaba anotado aquí sobre
  Novedades en Corral y Consolidado ya se resolvió para Novedades en Corral (ver "Sesión del
  2026-09-10" arriba); si Nathalia pide algo similar para Consolidado, será un pedido nuevo aparte.
- ~~Nada impide crear más de una `LlegadaPendiente` con el mismo Consecutivo~~ / ~~el botón "Cargar
  datos de llegada en espera" solo funciona con conexión~~ — ambos puntos quedaron sin objeto: todo
  el subsistema `LlegadaPendiente`/"Llegada en espera" se retiró por completo en la octava ronda de
  "Sesión del 2026-09-11" (ver el punto 11 de "Decisiones clave de diseño").
