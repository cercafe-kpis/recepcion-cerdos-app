import { createItem, deleteItem, listItems, updateItem } from './client'
import type {
  Asociado,
  ConsolidadoTiquete,
  Granja,
  GrupoAsociado,
  NovedadCorral,
  Recepcion,
  RecepcionLogEntry,
  Rol,
  Usuario,
  Vehiculo,
} from '../types/models'

// ---------------------------------------------------------------------------
// Usuarios — la pantalla de administración (rol Administrador, ver
// UsuariosAdmin.tsx) puede crear el registro y cambiar Rol/Activo, pero eso
// SOLO controla qué botones ve esa persona dentro de la app. El permiso real
// de leer/escribir en SharePoint lo da el grupo del sitio al que pertenece
// su cuenta (Miembros/Visitantes) — crearUsuario() NO agrega a nadie a ese
// grupo porque Graph no expone esa operación con los permisos de esta app;
// sigue siendo un paso manual en SharePoint. Ver Arquitectura sección 6.
// ---------------------------------------------------------------------------

function mapUsuario(item: { id: string; fields: Record<string, unknown> }): Usuario {
  return {
    id: item.id,
    Title: String(item.fields.Title ?? ''),
    Correo: String(item.fields.Correo ?? ''),
    Rol: item.fields.Rol as Usuario['Rol'],
    Activo: Boolean(item.fields.Activo),
    AsociadosAsignados: (item.fields.AsociadosAsignadosLookupId as string[] | undefined) ?? [],
    GranjasAsignadas: (item.fields.GranjasAsignadasLookupId as string[] | undefined) ?? [],
  }
}

export async function buscarUsuarioPorCorreo(correo: string): Promise<Usuario | undefined> {
  const items = await listItems<Record<string, unknown>>(
    'Usuarios',
    `$expand=fields&$filter=fields/Correo eq '${correo.replace(/'/g, "''")}'`,
  )
  const item = items[0]
  return item ? mapUsuario(item) : undefined
}

/**
 * Solo para la pantalla de administración de usuarios (rol Administrador).
 * El resto de la app nunca necesita la lista completa, solo
 * buscarUsuarioPorCorreo() del usuario que inició sesión — ver
 * src/auth/useCurrentUser.ts.
 */
export async function listarUsuarios(): Promise<Usuario[]> {
  const items = await listItems<Record<string, unknown>>('Usuarios')
  return items.map(mapUsuario)
}

export async function crearUsuario(input: { Title: string; Correo: string; Rol: Rol }): Promise<Usuario> {
  const item = await createItem('Usuarios', {
    Title: input.Title,
    Correo: input.Correo,
    Rol: input.Rol,
    Activo: true,
  })
  return {
    id: item.id,
    Title: input.Title,
    Correo: input.Correo,
    Rol: input.Rol,
    Activo: true,
    AsociadosAsignados: [],
    GranjasAsignadas: [],
  }
}

export async function actualizarUsuario(
  id: string,
  cambios: Partial<Pick<Usuario, 'Title' | 'Correo' | 'Rol' | 'Activo' | 'AsociadosAsignados' | 'GranjasAsignadas'>>,
): Promise<void> {
  // AsociadosAsignados/GranjasAsignadas son Lookup de VALORES MÚLTIPLES — igual que en
  // mapRecepcionAFields, Graph solo las acepta como `<Columna>LookupId` con ids numéricos
  // (aquí un arreglo de ids), nunca bajo el nombre de la columna tal cual.
  const { AsociadosAsignados, GranjasAsignadas, ...resto } = cambios
  await updateItem('Usuarios', id, {
    ...resto,
    ...(AsociadosAsignados ? { AsociadosAsignadosLookupId: AsociadosAsignados.map(Number) } : {}),
    ...(GranjasAsignadas ? { GranjasAsignadasLookupId: GranjasAsignadas.map(Number) } : {}),
  })
}

/**
 * Borra el registro de Usuarios en SharePoint — NO quita a la persona del
 * grupo del sitio (Miembros/Visitantes), eso sigue siendo un paso manual
 * aparte. Ver el aviso de UsuariosAdmin.tsx.
 */
export async function eliminarUsuario(id: string): Promise<void> {
  await deleteItem('Usuarios', id)
}

// ---------------------------------------------------------------------------
// GruposAsociados — tabla maestra simple (solo Title + Activo) que agrupa
// Asociados; se creó para el campo "Grupo asociado" que se ve en
// AsociadosAdmin.tsx. Sigue el mismo patrón de listar/crear/editar que el
// resto de tablas maestras.
// ---------------------------------------------------------------------------

export async function listarGruposAsociados(): Promise<GrupoAsociado[]> {
  const items = await listItems<Record<string, unknown>>('GruposAsociados')
  return items.map((item) => ({
    id: item.id,
    Title: String(item.fields.Title ?? ''),
    Activo: Boolean(item.fields.Activo ?? true),
  }))
}

export async function crearGrupoAsociado(input: { Title: string }): Promise<GrupoAsociado> {
  const item = await createItem('GruposAsociados', { Title: input.Title, Activo: true })
  return { id: item.id, Title: input.Title, Activo: true }
}

export async function actualizarGrupoAsociado(
  id: string,
  cambios: Partial<Pick<GrupoAsociado, 'Title' | 'Activo'>>,
): Promise<void> {
  await updateItem('GruposAsociados', id, cambios)
}

/**
 * Borra el grupo en SharePoint. Los Asociados que lo tuvieran asignado NO se
 * borran ni se les avisa aquí — su GrupoAsociadoId simplemente deja de
 * resolver a nada (SharePoint no bloquea borrar el destino de un Lookup).
 */
export async function eliminarGrupoAsociado(id: string): Promise<void> {
  await deleteItem('GruposAsociados', id)
}

// ---------------------------------------------------------------------------
// Asociados — PATRÓN DE REFERENCIA COMPLETO (listar + crear + editar).
// Granjas y Vehiculos son casi idénticas (misma forma, una columna de lookup
// a Asociados de más) — para implementarlas, copiar estas tres funciones y:
//   1. cambiar 'Asociados' por 'Granjas' / 'Vehiculos' en cada llamada a
//      listItems/createItem/updateItem,
//      2. ajustar los campos de `fields` según la tabla de la sección 4 del
//      documento de arquitectura (Granjas agrega AsociadoId + Municipio;
//      Vehiculos agrega AsociadoId opcional).
// La pantalla que las usa sigue el mismo patrón: ver
// src/features/catalogos/AsociadosAdmin.tsx.
//
// GrupoAsociadoId es un Lookup de UN SOLO VALOR (a diferencia de
// AsociadosAsignados/GranjasAsignadas en Usuarios, que son de varios
// valores) — Graph igual solo lo acepta como `GrupoAsociadoIdLookupId`, pero
// aquí con un único id numérico, nunca un arreglo.
// ---------------------------------------------------------------------------

export async function listarAsociados(): Promise<Asociado[]> {
  const items = await listItems<Record<string, unknown>>('Asociados')
  return items.map((item) => ({
    id: item.id,
    Title: String(item.fields.Title ?? ''),
    NIT: item.fields.NIT ? String(item.fields.NIT) : undefined,
    GrupoAsociadoId: item.fields.GrupoAsociadoIdLookupId
      ? String(item.fields.GrupoAsociadoIdLookupId)
      : undefined,
    Activo: Boolean(item.fields.Activo ?? true),
  }))
}

export async function crearAsociado(input: { Title: string; NIT?: string; GrupoAsociadoId?: string }): Promise<Asociado> {
  const item = await createItem('Asociados', {
    Title: input.Title,
    NIT: input.NIT ?? '',
    ...(input.GrupoAsociadoId ? { GrupoAsociadoIdLookupId: input.GrupoAsociadoId } : {}),
    Activo: true,
  })
  return {
    id: item.id,
    Title: input.Title,
    NIT: input.NIT,
    GrupoAsociadoId: input.GrupoAsociadoId,
    Activo: true,
  }
}

export async function actualizarAsociado(
  id: string,
  cambios: Partial<Pick<Asociado, 'Title' | 'NIT' | 'GrupoAsociadoId' | 'Activo'>>,
): Promise<void> {
  const { GrupoAsociadoId, ...resto } = cambios
  await updateItem('Asociados', id, {
    ...resto,
    ...(GrupoAsociadoId !== undefined ? { GrupoAsociadoIdLookupId: GrupoAsociadoId || null } : {}),
  })
}

/**
 * Borra el Asociado en SharePoint. Igual que con GruposAsociados: las
 * Granjas/Vehiculos/Recepciones que lo referencien por Lookup no se borran,
 * solo dejan de poder resolver el nombre — por eso conviene Desactivar en
 * vez de Eliminar cuando el Asociado ya tiene historial capturado.
 */
export async function eliminarAsociado(id: string): Promise<void> {
  await deleteItem('Asociados', id)
}

// ---------------------------------------------------------------------------
// Granjas — mismo patrón que Asociados, con AsociadoId (lookup), Municipio,
// y id_dhc/nombre_vista (obligatorios desde GranjasAdmin.tsx).
// ---------------------------------------------------------------------------

export async function listarGranjas(): Promise<Granja[]> {
  const items = await listItems<Record<string, unknown>>('Granjas')
  return items.map((item) => ({
    id: item.id,
    Title: String(item.fields.Title ?? ''),
    AsociadoId: String(item.fields.AsociadoIdLookupId ?? item.fields.AsociadoId ?? ''),
    Municipio: item.fields.Municipio ? String(item.fields.Municipio) : undefined,
    // Granjas creadas antes de agregar estas 2 columnas no las tienen todavía
    // en SharePoint — por eso el 0 / cadena vacía de respaldo, en vez de
    // fallar. GranjasAdmin.tsx las trata como obligatorias de aquí en
    // adelante (crear/editar), pero registros viejos pueden llegar vacíos
    // hasta que alguien los complete.
    id_dhc: Number(item.fields.id_dhc ?? 0),
    nombre_vista: String(item.fields.nombre_vista ?? ''),
    Activa: Boolean(item.fields.Activa ?? true),
  }))
}

export async function crearGranja(input: {
  Title: string
  AsociadoId: string
  Municipio?: string
  id_dhc: number
  nombre_vista: string
}): Promise<Granja> {
  const item = await createItem('Granjas', {
    Title: input.Title,
    AsociadoIdLookupId: input.AsociadoId,
    Municipio: input.Municipio ?? '',
    id_dhc: input.id_dhc,
    nombre_vista: input.nombre_vista,
    Activa: true,
  })
  return {
    id: item.id,
    Title: input.Title,
    AsociadoId: input.AsociadoId,
    Municipio: input.Municipio,
    id_dhc: input.id_dhc,
    nombre_vista: input.nombre_vista,
    Activa: true,
  }
}

export async function actualizarGranja(
  id: string,
  cambios: Partial<Pick<Granja, 'Title' | 'AsociadoId' | 'Municipio' | 'id_dhc' | 'nombre_vista' | 'Activa'>>,
): Promise<void> {
  const { AsociadoId, ...resto } = cambios
  await updateItem('Granjas', id, {
    ...resto,
    ...(AsociadoId !== undefined ? { AsociadoIdLookupId: AsociadoId } : {}),
  })
}

export async function eliminarGranja(id: string): Promise<void> {
  await deleteItem('Granjas', id)
}

// ---------------------------------------------------------------------------
// Vehiculos (Placas) — mismo patrón, AsociadoId es opcional (un vehículo
// puede transportar para varios asociados).
// ---------------------------------------------------------------------------

export async function listarVehiculos(): Promise<Vehiculo[]> {
  const items = await listItems<Record<string, unknown>>('Vehiculos')
  return items.map((item) => ({
    id: item.id,
    Title: String(item.fields.Title ?? ''),
    AsociadoId: item.fields.AsociadoIdLookupId ? String(item.fields.AsociadoIdLookupId) : undefined,
    Activo: Boolean(item.fields.Activo ?? true),
  }))
}

export async function crearVehiculo(input: { Title: string; AsociadoId?: string }): Promise<Vehiculo> {
  const item = await createItem('Vehiculos', {
    Title: input.Title,
    ...(input.AsociadoId ? { AsociadoIdLookupId: input.AsociadoId } : {}),
    Activo: true,
  })
  return { id: item.id, Title: input.Title, AsociadoId: input.AsociadoId, Activo: true }
}

export async function actualizarVehiculo(
  id: string,
  cambios: Partial<Pick<Vehiculo, 'Title' | 'AsociadoId' | 'Activo'>>,
): Promise<void> {
  const { AsociadoId, ...resto } = cambios
  await updateItem('Vehiculos', id, {
    ...resto,
    ...(AsociadoId !== undefined ? { AsociadoIdLookupId: AsociadoId || null } : {}),
  })
}

export async function eliminarVehiculo(id: string): Promise<void> {
  await deleteItem('Vehiculos', id)
}

// ---------------------------------------------------------------------------
// Recepciones
// ---------------------------------------------------------------------------

/**
 * Antes de crear una Recepción en SharePoint, revisa si ya existe una con el
 * mismo Consecutivo. El Consecutivo se digita a mano (no lo genera la app,
 * ver Arquitectura sección 4.2), así que dos dispositivos sin conexión pueden
 * haber digitado el mismo número por error — este chequeo solo puede correr
 * al sincronizar, con conexión, nunca en el momento de la captura offline.
 */
export async function existeConsecutivo(consecutivo: string): Promise<boolean> {
  const items = await listItems<Record<string, unknown>>(
    'Recepciones',
    `$filter=fields/Consecutivo eq '${consecutivo.replace(/'/g, "''")}'&$top=1`,
  )
  return items.length > 0
}

/**
 * AsociadoId, GranjaId y PlacaVehiculoId son columnas de tipo Lookup en
 * SharePoint (ver Arquitectura-App-Recepcion-Cerdos.md sección 4): Graph solo
 * las acepta bajo el nombre `<Columna>LookupId` y con el id NUMÉRICO del
 * elemento relacionado, nunca bajo el nombre de la columna tal cual. Por eso
 * esta función arma el objeto de campos a mano en vez de esparcir
 * `recepcion` directamente — el resto de los campos sí coinciden 1 a 1 con
 * el nombre interno de su columna (Texto/Número/Elección/Sí-No), así que
 * esos si se pueden esparcir.
 */
function mapRecepcionAFields(recepcion: Omit<Recepcion, 'id' | 'spId' | 'RecibidaEn'>) {
  const { AsociadoId, GranjaId, PlacaVehiculoId, ...resto } = recepcion
  return {
    ...resto,
    AsociadoIdLookupId: Number(AsociadoId),
    GranjaIdLookupId: Number(GranjaId),
    PlacaVehiculoIdLookupId: Number(PlacaVehiculoId),
  }
}

export async function crearRecepcionEnSharePoint(
  recepcion: Omit<Recepcion, 'id' | 'spId' | 'RecibidaEn'>,
): Promise<{ spId: string; RecibidaEn: string }> {
  const RecibidaEn = new Date().toISOString()
  const item = await createItem('Recepciones', { ...mapRecepcionAFields(recepcion), RecibidaEn })
  return { spId: item.id, RecibidaEn }
}

/**
 * Ubicaciones y NovedadesCorral se sincronizan con la misma forma que
 * Recepciones, una vez que se conoce el `spId` real de su Recepción padre
 * (por eso el sync siempre hace Recepciones primero — ver syncService.ts).
 * Se deja una función por lista, aunque el cuerpo sea igual, para que cada
 * una pueda evolucionar por separado sin tocar las otras.
 */
export async function crearUbicacionEnSharePoint(
  fields: Record<string, unknown> & { RecibidaEn?: string },
): Promise<{ spId: string; RecibidaEn: string }> {
  const RecibidaEn = new Date().toISOString()
  const item = await createItem('Ubicaciones', { ...fields, RecibidaEn })
  return { spId: item.id, RecibidaEn }
}

export async function crearNovedadCorralEnSharePoint(
  fields: Record<string, unknown> & { RecibidaEn?: string },
): Promise<{ spId: string; RecibidaEn: string }> {
  const RecibidaEn = new Date().toISOString()
  const item = await createItem('NovedadesCorral', { ...fields, RecibidaEn })
  return { spId: item.id, RecibidaEn }
}

export async function registrarLog(entrada: Omit<RecepcionLogEntry, 'id'>): Promise<void> {
  await createItem('RecepcionLog', entrada)
}

// ---------------------------------------------------------------------------
// ConsolidadoTiquetes
// ---------------------------------------------------------------------------

export async function listarTiquetesDeRecepcion(recepcionId: string): Promise<ConsolidadoTiquete[]> {
  const items = await listItems<Record<string, unknown>>(
    'ConsolidadoTiquetes',
    `$expand=fields&$filter=fields/RecepcionId eq '${recepcionId.replace(/'/g, "''")}'`,
  )
  // A diferencia de Recepcion/Ubicacion/NovedadCorral, estas filas nunca se
  // capturan sin conexión: las crea el propio proceso de sync
  // (generarTiquetesFaltantes / generarTiqueteMuertoReposo), así que `id` y
  // `spId` son el mismo id real de SharePoint desde el primer momento.
  return items.map((item) => ({
    id: item.id,
    spId: item.id,
    RecepcionId: String(item.fields.RecepcionId ?? ''),
    GrupoNovedad: item.fields.GrupoNovedad as ConsolidadoTiquete['GrupoNovedad'],
    TipoNovedad: item.fields.TipoNovedad as ConsolidadoTiquete['TipoNovedad'],
    NumeroAnimalEnLote: Number(item.fields.NumeroAnimalEnLote ?? 0),
    Tiquete: item.fields.Tiquete ? String(item.fields.Tiquete) : undefined,
    Destino: (item.fields.Destino as ConsolidadoTiquete['Destino'] | undefined) ?? undefined,
    Factura: item.fields.Factura ? String(item.fields.Factura) : undefined,
    FechaDespacho: item.fields.FechaDespacho ? String(item.fields.FechaDespacho) : undefined,
    FechaBeneficio: item.fields.FechaBeneficio ? String(item.fields.FechaBeneficio) : undefined,
    EstadoTiquete: (item.fields.EstadoTiquete as ConsolidadoTiquete['EstadoTiquete']) ?? 'Pendiente',
    EstadoSync: 'Sincronizada',
    CapturadaEn: item.fields.CapturadaEn ? String(item.fields.CapturadaEn) : '',
    RecibidaEn: item.fields.RecibidaEn ? String(item.fields.RecibidaEn) : undefined,
  }))
}

export async function actualizarTiquete(
  id: string,
  cambios: Partial<Pick<ConsolidadoTiquete, 'Tiquete' | 'Destino' | 'Factura' | 'FechaDespacho' | 'FechaBeneficio' | 'EstadoTiquete'>>,
): Promise<void> {
  const completo = Boolean(cambios.Tiquete && cambios.Destino)
  await updateItem('ConsolidadoTiquetes', id, {
    ...cambios,
    EstadoTiquete: completo ? 'Completo' : 'Pendiente',
  })
}

/**
 * Implementa la Decisión 2 del documento de arquitectura: por cada campo de
 * Cantidad > 0 en una Recepción o NovedadCorral ya sincronizada, crea las
 * filas de ConsolidadoTiquetes que falten (una por animal) hasta igualar la
 * Cantidad. Nunca borra una fila que ya tenga Tiquete diligenciado.
 */
export async function generarTiquetesFaltantes(recepcion: Recepcion): Promise<void> {
  if (!recepcion.spId) {
    throw new Error('generarTiquetesFaltantes requiere una Recepción ya sincronizada (con spId)')
  }
  const existentes = await listarTiquetesDeRecepcion(recepcion.spId)

  const origenes: Array<{
    grupo: ConsolidadoTiquete['GrupoNovedad']
    tipo: ConsolidadoTiquete['TipoNovedad']
    cantidad: number | undefined
  }> = [
    { grupo: 'Novedad de llegada', tipo: 'Lesionado', cantidad: recepcion.NovLlegadaCantLesionados },
    { grupo: 'Novedad de llegada', tipo: 'Caído', cantidad: recepcion.NovLlegadaCantCaidos },
    { grupo: 'Novedad de llegada', tipo: 'Agitado', cantidad: recepcion.NovLlegadaCantAgitados },
    { grupo: 'Fortuito', tipo: 'Muerto en Transporte', cantidad: recepcion.FortuitoCantMuertoTransporte },
    { grupo: 'Fortuito', tipo: 'Muerto en Desembarque', cantidad: recepcion.FortuitoCantMuertoDesembarque },
    // Muerto en Reposo viene de NovedadCorral, no de Recepcion — se genera
    // desde el mismo tipo de llamada cuando esa lista sincroniza (ver
    // src/offline/syncService.ts).
  ]

  for (const origen of origenes) {
    const cantidad = origen.cantidad ?? 0
    const yaCreados = existentes.filter((t) => t.TipoNovedad === origen.tipo).length
    for (let n = yaCreados + 1; n <= cantidad; n++) {
      await createItem('ConsolidadoTiquetes', {
        // Se guarda el spId del padre (no el id local): es lo que
        // listarTiquetesDeRecepcion() usa para filtrar, y una vez
        // sincronizado el id local ya no vuelve a consultarse contra Graph.
        RecepcionId: recepcion.spId,
        GrupoNovedad: origen.grupo,
        TipoNovedad: origen.tipo,
        NumeroAnimalEnLote: n,
        EstadoTiquete: 'Pendiente',
        EstadoSync: 'Sincronizada',
        CapturadaEn: new Date().toISOString(),
      })
    }
  }
}

/**
 * Contraparte de generarTiquetesFaltantes() para la novedad "Muerto en
 * Reposo", cuya cantidad vive en NovedadCorral y no en Recepcion (ver el
 * comentario dentro de generarTiquetesFaltantes). Se llama justo después de
 * sincronizar una NovedadCorral, con la Recepción padre ya sincronizada.
 */
export async function generarTiqueteMuertoReposo(
  novedad: NovedadCorral,
  recepcion: Pick<Recepcion, 'spId'>,
): Promise<void> {
  if (!recepcion.spId) {
    throw new Error('generarTiqueteMuertoReposo requiere una Recepción ya sincronizada (con spId)')
  }
  const cantidad = novedad.CantMuertoReposo ?? 0
  if (cantidad <= 0) return

  const existentes = await listarTiquetesDeRecepcion(recepcion.spId)
  const yaCreados = existentes.filter((t) => t.TipoNovedad === 'Muerto en Reposo').length
  for (let n = yaCreados + 1; n <= cantidad; n++) {
    await createItem('ConsolidadoTiquetes', {
      RecepcionId: recepcion.spId,
      GrupoNovedad: 'Fortuito',
      TipoNovedad: 'Muerto en Reposo',
      NumeroAnimalEnLote: n,
      EstadoTiquete: 'Pendiente',
      EstadoSync: 'Sincronizada',
      CapturadaEn: new Date().toISOString(),
    })
  }
}
