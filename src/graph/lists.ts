import { createItem, deleteItem, listItems, updateItem } from './client'
import type {
  Asociado,
  ConsolidadoTiquete,
  Granja,
  GrupoAsociado,
  LlegadaPendiente,
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
// Granjas — mismo patrón que Asociados, con AsociadoId (lookup) y Municipio.
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
 * SharePoint limita a 32 caracteres el nombre INTERNO de una columna (el que
 * de verdad usa Graph al leer/escribir) — cuando el nombre que se le da al
 * crearla en la interfaz pasa de eso, SharePoint lo corta a los primeros 32
 * caracteres por dentro, aunque en pantalla (Configuración de lista, o el
 * propio formulario) la columna se siga viendo con el nombre completo que se
 * escribió. Estas 6 columnas (de los lesionados/caídos/agitados de llegada,
 * cuáles NO se recuperaron y tocó "beneficiar de emergencia", y su Cantidad)
 * tienen nombres de 35 a 44 caracteres — todas más largas que ese límite —
 * así que su nombre real en SharePoint NO es el mismo que su nombre en este
 * modelo. Esto pasó inadvertido hasta que Nathalia reportó que NINGUNA
 * Recepción nueva sincronizaba, con Graph devolviendo 400 "Field
 * 'NovLlegadaLesionadosBeneficioEmergencia' is not recognized" — confirmado
 * uno por uno con ella revisando, en SharePoint, la URL de "Editar columna"
 * (Configuración de lista → clic en el nombre de la columna), que sí trae el
 * nombre real en `Field=...`, a diferencia de la lista de columnas, que solo
 * muestra el nombre para MOSTRAR. Mapeo entre el nombre de este modelo (a la
 * izquierda) y el nombre real en SharePoint (a la derecha — los primeros 32
 * caracteres del de la izquierda; 3 de los 6 se confirmaron así con
 * Nathalia, los otros 3 se calcularon con la misma regla):
 */
const NOMBRE_SP_BENEFICIO_EMERGENCIA = {
  NovLlegadaLesionadosBeneficioEmergencia: 'NovLlegadaLesionadosBeneficioEme',
  NovLlegadaCantLesionadosBeneficioEmergencia: 'NovLlegadaCantLesionadosBenefici',
  NovLlegadaCaidosBeneficioEmergencia: 'NovLlegadaCaidosBeneficioEmergen',
  NovLlegadaCantCaidosBeneficioEmergencia: 'NovLlegadaCantCaidosBeneficioEme',
  NovLlegadaAgitadosBeneficioEmergencia: 'NovLlegadaAgitadosBeneficioEmerg',
  NovLlegadaCantAgitadosBeneficioEmergencia: 'NovLlegadaCantAgitadosBeneficioE',
} as const

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
 * Reconstruye un Recepcion completo a partir de lo que devuelve Graph —
 * exactamente lo contrario de mapRecepcionAFields() de aquí abajo. Se usa
 * SOLO para traer a un dispositivo Recepciones que otro dispositivo ya
 * sincronizó (ver listarRecepcionesEnProceso/descargarRecepcionesEnProceso
 * en syncService.ts); el dispositivo que la capturó nunca pasa por aquí, ya
 * tiene su propio registro local con su `id` (UUID) desde el inicio.
 */
function mapFieldsARecepcion(item: { id: string; fields: Record<string, unknown> }): Recepcion {
  const f = item.fields
  const numeroOpcional = (valor: unknown) => (valor === undefined || valor === null ? undefined : Number(valor))
  return {
    // Esta Recepción no se capturó en este dispositivo — no hay un `id`
    // local (UUID) que reutilizar, así que se usa el id real de SharePoint
    // también como llave primaria en Dexie. Ver el chequeo por `spId` en
    // descargarRecepcionesEnProceso() para no duplicarla si ya existiera.
    id: item.id,
    spId: item.id,
    Title: String(f.Title ?? ''),
    Consecutivo: String(f.Consecutivo ?? ''),
    NumeroOrden: String(f.NumeroOrden ?? ''),
    FechaRecepcion: String(f.FechaRecepcion ?? ''),
    HoraProgramada: String(f.HoraProgramada ?? ''),
    HoraLlegadaVehiculo: String(f.HoraLlegadaVehiculo ?? ''),
    HoraInicioDesembarque: String(f.HoraInicioDesembarque ?? ''),
    HoraFinalDesembarque: String(f.HoraFinalDesembarque ?? ''),
    AsociadoId: String(f.AsociadoIdLookupId ?? ''),
    GranjaId: String(f.GranjaIdLookupId ?? ''),
    NumeroTotalCerdos: Number(f.NumeroTotalCerdos ?? 0),
    PesoPromedioGranja: Number(f.PesoPromedioGranja ?? 0),
    PlacaVehiculoId: String(f.PlacaVehiculoIdLookupId ?? ''),
    GuiaSanitariaICA: String(f.GuiaSanitariaICA ?? ''),
    // Columna de Texto en SharePoint (ver models.ts) — se valida contra el único literal
    // esperado y cualquier otra cosa (vacío, o data vieja de cuando era texto libre) cae a 'No'.
    RemisionGranja: f.RemisionGranja === 'Sí' ? 'Sí' : 'No',
    QRLote: Boolean(f.QRLote),
    CertificadoInmunocastracion: Boolean(f.CertificadoInmunocastracion),
    CoincideGuiaICAvsQR: Boolean(f.CoincideGuiaICAvsQR),
    NovLlegadaLesionados: Boolean(f.NovLlegadaLesionados),
    NovLlegadaCantLesionados: numeroOpcional(f.NovLlegadaCantLesionados),
    NovLlegadaLesionadosBeneficioEmergencia: Boolean(
      f[NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaLesionadosBeneficioEmergencia],
    ),
    NovLlegadaCantLesionadosBeneficioEmergencia: numeroOpcional(
      f[NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCantLesionadosBeneficioEmergencia],
    ),
    NovLlegadaCaidos: Boolean(f.NovLlegadaCaidos),
    NovLlegadaCantCaidos: numeroOpcional(f.NovLlegadaCantCaidos),
    NovLlegadaCaidosBeneficioEmergencia: Boolean(f[NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCaidosBeneficioEmergencia]),
    NovLlegadaCantCaidosBeneficioEmergencia: numeroOpcional(
      f[NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCantCaidosBeneficioEmergencia],
    ),
    NovLlegadaAgitados: Boolean(f.NovLlegadaAgitados),
    NovLlegadaCantAgitados: numeroOpcional(f.NovLlegadaCantAgitados),
    NovLlegadaAgitadosBeneficioEmergencia: Boolean(
      f[NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaAgitadosBeneficioEmergencia],
    ),
    NovLlegadaCantAgitadosBeneficioEmergencia: numeroOpcional(
      f[NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCantAgitadosBeneficioEmergencia],
    ),
    FortuitoMuertoTransporte: Boolean(f.FortuitoMuertoTransporte),
    FortuitoCantMuertoTransporte: numeroOpcional(f.FortuitoCantMuertoTransporte),
    FortuitoMuertoDesembarque: Boolean(f.FortuitoMuertoDesembarque),
    FortuitoCantMuertoDesembarque: numeroOpcional(f.FortuitoCantMuertoDesembarque),
    SuciedadCerdos: (f.SuciedadCerdos as Recepcion['SuciedadCerdos']) ?? 'Baja',
    Observaciones: f.Observaciones ? String(f.Observaciones) : undefined,
    EstadoLote: (f.EstadoLote as Recepcion['EstadoLote']) ?? 'En proceso',
    CapturadoPor: String(f.CapturadoPor ?? ''),
    BeneficiadoMismoDia: Boolean(f.BeneficiadoMismoDia),
    EstadoSync: 'Sincronizada',
    CapturadaEn: f.CapturadaEn ? String(f.CapturadaEn) : '',
    RecibidaEn: f.RecibidaEn ? String(f.RecibidaEn) : undefined,
  }
}

/**
 * Trae de SharePoint las Recepciones que TODAVÍA están "En proceso" (no
 * `Completo`) — a propósito no trae el historial completo, para no
 * descargar cada vez más datos con los meses. Ver descargarRecepcionesEnProceso()
 * en syncService.ts, que es quien la usa para que Ubicación/Novedades en
 * Corral/Consolidado puedan continuar en un dispositivo distinto al que
 * capturó la Recepción.
 */
export async function listarRecepcionesEnProceso(): Promise<Recepcion[]> {
  const items = await listItems<Record<string, unknown>>(
    'Recepciones',
    `$expand=fields&$filter=fields/EstadoLote eq 'En proceso'&$top=500`,
  )
  return items.map(mapFieldsARecepcion)
}

/**
 * Trae TODAS las Recepciones (En proceso o Completo) cuya FechaRecepcion cae
 * en el rango [desde, hasta] (fechas 'YYYY-MM-DD', ambas inclusive) —
 * a diferencia de listarRecepcionesEnProceso(), esta SÍ trae recepciones ya
 * completas. La usa la pantalla Reporte (src/features/reportes/Reporte.tsx)
 * bajo demanda (nunca se descarga sola en segundo plano ni se guarda en
 * Dexie), así que no reintroduce el problema de que cada dispositivo vaya
 * acumulando cada vez más historial — eso sigue reservado exclusivamente
 * para las recepciones "En proceso" (ver comentario arriba).
 */
export async function listarRecepcionesPorRangoFecha(desde: string, hasta: string): Promise<Recepcion[]> {
  const desdeISO = `${desde}T00:00:00Z`
  const hastaFecha = new Date(`${hasta}T00:00:00Z`)
  hastaFecha.setUTCDate(hastaFecha.getUTCDate() + 1)
  const hastaISO = hastaFecha.toISOString()
  const items = await listItems<Record<string, unknown>>(
    'Recepciones',
    `$expand=fields&$filter=fields/FechaRecepcion ge '${desdeISO}' and fields/FechaRecepcion lt '${hastaISO}'&$top=999`,
  )
  return items.map(mapFieldsARecepcion)
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
  const {
    AsociadoId,
    GranjaId,
    PlacaVehiculoId,
    // Estas 6 tampoco se pueden esparcir tal cual (ver NOMBRE_SP_BENEFICIO_EMERGENCIA arriba) —
    // su nombre de columna real en SharePoint no es el mismo que su nombre en este modelo.
    NovLlegadaLesionadosBeneficioEmergencia,
    NovLlegadaCantLesionadosBeneficioEmergencia,
    NovLlegadaCaidosBeneficioEmergencia,
    NovLlegadaCantCaidosBeneficioEmergencia,
    NovLlegadaAgitadosBeneficioEmergencia,
    NovLlegadaCantAgitadosBeneficioEmergencia,
    ...resto
  } = recepcion
  return {
    ...resto,
    AsociadoIdLookupId: Number(AsociadoId),
    GranjaIdLookupId: Number(GranjaId),
    PlacaVehiculoIdLookupId: Number(PlacaVehiculoId),
    [NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaLesionadosBeneficioEmergencia]: NovLlegadaLesionadosBeneficioEmergencia,
    [NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCantLesionadosBeneficioEmergencia]:
      NovLlegadaCantLesionadosBeneficioEmergencia,
    [NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCaidosBeneficioEmergencia]: NovLlegadaCaidosBeneficioEmergencia,
    [NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCantCaidosBeneficioEmergencia]: NovLlegadaCantCaidosBeneficioEmergencia,
    [NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaAgitadosBeneficioEmergencia]: NovLlegadaAgitadosBeneficioEmergencia,
    [NOMBRE_SP_BENEFICIO_EMERGENCIA.NovLlegadaCantAgitadosBeneficioEmergencia]:
      NovLlegadaCantAgitadosBeneficioEmergencia,
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
 * Marca una Recepción como cerrada — la llama terminarProceso() en
 * Consolidado.tsx cuando la persona hace clic en "Terminar proceso" (acción
 * 100% manual, ver el comentario grande ahí: antes se decidía sola dentro de
 * cerrarLotesCompletos() en syncService.ts, ya retirada). Solo cambia el
 * estado en SharePoint; quien la llama también debe actualizar la copia
 * local en Dexie para que el filtro "En proceso" deje de traerla en la
 * próxima descargarRecepcionesEnProceso().
 */
export async function marcarLoteCompleto(recepcionSpId: string): Promise<void> {
  await updateItem('Recepciones', recepcionSpId, { EstadoLote: 'Completo' })
}

/**
 * Contraparte de marcarLoteCompleto(): reabre un lote que se cerró por
 * error (por ejemplo, uno que ya había quedado "Completo" bajo la regla
 * automática vieja, antes de que existiera "Terminar proceso" en
 * Consolidado.tsx, sin que todos los Fortuitos tuvieran su Factura). Un
 * Administrador siempre puede editar un lote completo de todas formas — esto
 * es solo para devolverlo a "En proceso" y que vuelva a aparecer como
 * pendiente para el resto del equipo.
 */
export async function reabrirLote(recepcionSpId: string): Promise<void> {
  await updateItem('Recepciones', recepcionSpId, { EstadoLote: 'En proceso' })
}

/**
 * Marca (o desmarca) si una Recepción se benefició el mismo día en que se recibió — ver el
 * comentario de `BeneficiadoMismoDia` en models.ts. Usada solo desde la pestaña "Cierre diario" de
 * Reporte.tsx, que llama a esta función DIRECTO contra Graph (esa pestaña ya trabaja solo en línea,
 * igual que "Diario" y "Semanal" — no pasa por Dexie ni por la cola de sincronización).
 */
export async function marcarBeneficiadoMismoDia(recepcionSpId: string, valor: boolean): Promise<void> {
  await updateItem('Recepciones', recepcionSpId, { BeneficiadoMismoDia: valor })
}

// ---------------------------------------------------------------------------
// LlegadasPendientes — ver el comentario grande de LlegadaPendiente en models.ts (agregada
// 2026-09-11, segunda ronda): registro APARTE y mínimo para el camión que llega y queda esperando
// sin desembarcar el mismo día, con solo lo que ya se sabe en ese momento. Recepcion.tsx no cambió
// en nada — sigue exigiendo las 4 horas y llenándose una sola vez, completa, cuando el desembarque
// ya terminó.
// ---------------------------------------------------------------------------

function mapFieldsALlegadaPendiente(item: { id: string; fields: Record<string, unknown> }): LlegadaPendiente {
  const f = item.fields
  return {
    id: item.id,
    Title: String(f.Title ?? ''),
    FechaLlegada: String(f.FechaLlegada ?? ''),
    HoraLlegadaVehiculo: String(f.HoraLlegadaVehiculo ?? ''),
    AsociadoId: String(f.AsociadoIdLookupId ?? ''),
    GranjaId: String(f.GranjaIdLookupId ?? ''),
    Consecutivo: String(f.Consecutivo ?? ''),
    NumeroOrden: f.NumeroOrden ? String(f.NumeroOrden) : undefined,
    PlacaVehiculoId: f.PlacaVehiculoIdLookupId ? String(f.PlacaVehiculoIdLookupId) : undefined,
    GuiaSanitariaICA: f.GuiaSanitariaICA ? String(f.GuiaSanitariaICA) : undefined,
    NumeroTotalCerdos: f.NumeroTotalCerdos !== undefined && f.NumeroTotalCerdos !== null ? Number(f.NumeroTotalCerdos) : undefined,
    CapturadoPor: String(f.CapturadoPor ?? ''),
    CreadoEn: String(f.CreadoEn ?? ''),
  }
}

/**
 * Trae las LlegadasPendientes cuya FechaLlegada cae en la fecha dada ('YYYY-MM-DD') — la usa
 * SOLO "Cierre diario" en Reporte.tsx, junto con listarRecepcionesPorRangoFecha(), para armar la
 * tabla del día: cualquiera de estos registros cuyo Consecutivo YA aparezca entre las Recepciones
 * de esa misma fecha se descarta ahí (no aquí) — significa que esa llegada ya se resolvió con una
 * Recepción completa. Ver el comentario de LlegadaPendiente en models.ts.
 */
export async function listarLlegadasPendientesPorFecha(fecha: string): Promise<LlegadaPendiente[]> {
  const desdeISO = `${fecha}T00:00:00Z`
  const hastaFecha = new Date(`${fecha}T00:00:00Z`)
  hastaFecha.setUTCDate(hastaFecha.getUTCDate() + 1)
  const hastaISO = hastaFecha.toISOString()
  const items = await listItems<Record<string, unknown>>(
    'LlegadasPendientes',
    `$expand=fields&$filter=fields/FechaLlegada ge '${desdeISO}' and fields/FechaLlegada lt '${hastaISO}'&$top=200`,
  )
  return items.map(mapFieldsALlegadaPendiente)
}

/**
 * Registra que un camión llegó y quedó esperando sin desembarcar — pestaña "Llegada en espera" de
 * Recepcion.tsx (movida ahí 2026-09-11, cuarta ronda; antes vivía como botón en "Cierre diario" de
 * Reporte.tsx). Escribe DIRECTO contra Graph, sin Dexie ni cola de sincronización — igual que
 * marcarBeneficiadoMismoDia() arriba —, así que esta acción necesita conexión en el momento de usarla.
 */
export async function crearLlegadaPendiente(
  datos: Omit<LlegadaPendiente, 'id' | 'Title' | 'CreadoEn'>,
): Promise<void> {
  const { AsociadoId, GranjaId, PlacaVehiculoId, ...resto } = datos
  await createItem('LlegadasPendientes', {
    ...resto,
    Title: `${datos.Consecutivo} · ${datos.FechaLlegada}`,
    AsociadoIdLookupId: Number(AsociadoId),
    GranjaIdLookupId: Number(GranjaId),
    ...(PlacaVehiculoId ? { PlacaVehiculoIdLookupId: Number(PlacaVehiculoId) } : {}),
    CreadoEn: new Date().toISOString(),
  })
}

/**
 * Busca una LlegadaPendiente por su Consecutivo, sin importar la fecha — a diferencia de
 * listarLlegadasPendientesPorFecha() (que solo trae las de UN día, para "Cierre diario"), esta se usa
 * desde Recepcion.tsx (botón "Cargar datos de llegada en espera") para poder traer los datos de
 * encabezado (Asociado/Granja/Consecutivo/Orden/Placa/Hora de llegada) que ya se registraron cuando
 * el camión llegó, sin tener que volver a digitarlos al llenar la Recepción completa — pedido de
 * Nathalia (2026-09-11, tercera ronda) para no repetir el ingreso de datos entre el registro rápido
 * de llegada y la Recepción. Si hubiera más de un registro con el mismo Consecutivo (no debería
 * pasar, pero nada lo impide — ver "Pendiente" en el documento de arquitectura), devuelve el más
 * reciente por `CreadoEn`.
 */
export async function buscarLlegadaPendientePorConsecutivo(consecutivo: string): Promise<LlegadaPendiente | undefined> {
  const items = await listItems<Record<string, unknown>>(
    'LlegadasPendientes',
    `$expand=fields&$filter=fields/Consecutivo eq '${consecutivo.replace(/'/g, "''")}'&$top=50`,
  )
  if (items.length === 0) return undefined
  const llegadas = items.map(mapFieldsALlegadaPendiente)
  llegadas.sort((a, b) => b.CreadoEn.localeCompare(a.CreadoEn))
  return llegadas[0]
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

/**
 * Estas dos se usan SOLO desde cerrarLotesCompletos() en syncService.ts, para
 * decidir si una Recepción ya se puede marcar "Completo". Consultan Graph
 * directamente (nunca Dexie): Ubicación y Novedades en Corral se capturan
 * offline y pueden vivir todavía sin sincronizar en OTRO dispositivo distinto
 * al que está corriendo este chequeo, así que el único lugar donde de verdad
 * ya existen ambas es SharePoint.
 */
export async function existeUbicacionDeRecepcion(recepcionSpId: string): Promise<boolean> {
  const items = await listItems<Record<string, unknown>>(
    'Ubicaciones',
    `$filter=fields/RecepcionId eq '${recepcionSpId.replace(/'/g, "''")}'&$top=1`,
  )
  return items.length > 0
}

export async function existeNovedadCorralDeRecepcion(recepcionSpId: string): Promise<boolean> {
  const items = await listItems<Record<string, unknown>>(
    'NovedadesCorral',
    `$filter=fields/RecepcionId eq '${recepcionSpId.replace(/'/g, "''")}'&$top=1`,
  )
  return items.length > 0
}

/**
 * A diferencia de existeNovedadCorralDeRecepcion() (que solo confirma que
 * existe), esta trae el registro completo — la usa Consolidado.tsx en su
 * botón "Volver a generar tiquetes" para poder calcular el tiquete de
 * "Muerto en Reposo", cuya cantidad vive en NovedadCorral, y (desde
 * 2026-09-10) los reportes para sumar "Novedad en corral" a Lesión/Agitados/
 * Caídos. Antes ese botón buscaba la NovedadCorral en Dexie local, pero
 * Novedades en Corral se captura por dispositivo — si se capturó en el
 * celular y el botón se usa desde el computador, Dexie del computador nunca
 * tiene ese registro. Aquí se consulta Graph directamente, igual que con
 * Ubicación/NovedadCorral en cerrarLotesCompletos().
 *
 * IMPORTANTE (bug corregido 2026-09-10): nada impide capturar Novedades en
 * Corral más de una vez para la misma Recepción (ver "Pendiente" en el
 * documento de arquitectura) — cada "Guardar novedad" crea un registro
 * NUEVO en SharePoint, nunca edita uno existente. Nathalia lo hizo así con
 * un lote real (Muerto en reposo en un envío, Caído en otro envío
 * posterior) y el reporte diario no mostraba el Caído: esta función traía
 * antes solo UN registro (`$top=1`, sin ningún orden) y se quedaba con el
 * que no tenía el Caído. Ahora trae TODOS los registros de esa Recepción y
 * los combina: las cantidades se SUMAN entre registros y los indicadores
 * Sí/No quedan en Sí si algún registro lo marcó — así el resultado es
 * correcto sin importar en cuántos envíos separados se haya capturado.
 */
export async function obtenerNovedadCorralDeRecepcion(recepcionSpId: string): Promise<NovedadCorral | undefined> {
  const items = await listItems<Record<string, unknown>>(
    'NovedadesCorral',
    `$expand=fields&$filter=fields/RecepcionId eq '${recepcionSpId.replace(/'/g, "''")}'`,
  )
  if (items.length === 0) return undefined

  const numeroOpcional = (valor: unknown) => (valor === undefined || valor === null ? undefined : Number(valor))
  const sumarOpcional = (a: number | undefined, b: unknown) => {
    const bNum = numeroOpcional(b)
    if (a === undefined && bNum === undefined) return undefined
    return (a ?? 0) + (bNum ?? 0)
  }

  return items.reduce<NovedadCorral>(
    (combinada, item) => {
      const f = item.fields
      return {
        ...combinada,
        MuertoReposo: combinada.MuertoReposo || Boolean(f.MuertoReposo),
        CantMuertoReposo: sumarOpcional(combinada.CantMuertoReposo, f.CantMuertoReposo),
        ComportamientoSexual: combinada.ComportamientoSexual || Boolean(f.ComportamientoSexual),
        // "Hay disponibilidad de agua" es un indicador de bienestar, no una novedad que se sume —
        // si CUALQUIER envío reportó que no había agua, vale la pena que quede así de "No".
        DisponibilidadAgua: combinada.DisponibilidadAgua && Boolean(f.DisponibilidadAgua),
        CorralLesionados: combinada.CorralLesionados || Boolean(f.CorralLesionados),
        CorralCantLesionados: sumarOpcional(combinada.CorralCantLesionados, f.CorralCantLesionados),
        CorralLesionadosBenefEmerg: combinada.CorralLesionadosBenefEmerg || Boolean(f.CorralLesionadosBenefEmerg),
        CorralCantLesionadosBenefEmerg: sumarOpcional(combinada.CorralCantLesionadosBenefEmerg, f.CorralCantLesionadosBenefEmerg),
        CorralCaidos: combinada.CorralCaidos || Boolean(f.CorralCaidos),
        CorralCantCaidos: sumarOpcional(combinada.CorralCantCaidos, f.CorralCantCaidos),
        CorralCaidosBenefEmerg: combinada.CorralCaidosBenefEmerg || Boolean(f.CorralCaidosBenefEmerg),
        CorralCantCaidosBenefEmerg: sumarOpcional(combinada.CorralCantCaidosBenefEmerg, f.CorralCantCaidosBenefEmerg),
        CorralAgitados: combinada.CorralAgitados || Boolean(f.CorralAgitados),
        CorralCantAgitados: sumarOpcional(combinada.CorralCantAgitados, f.CorralCantAgitados),
        CorralAgitadosBenefEmerg: combinada.CorralAgitadosBenefEmerg || Boolean(f.CorralAgitadosBenefEmerg),
        CorralCantAgitadosBenefEmerg: sumarOpcional(combinada.CorralCantAgitadosBenefEmerg, f.CorralCantAgitadosBenefEmerg),
        // Más reciente de los envíos combinados, solo informativo (ningún llamador lo usa para
        // calcular nada) — RecibidaEn igual.
        CapturadaEn: f.CapturadaEn && String(f.CapturadaEn) > combinada.CapturadaEn ? String(f.CapturadaEn) : combinada.CapturadaEn,
        RecibidaEn: f.RecibidaEn && (!combinada.RecibidaEn || String(f.RecibidaEn) > combinada.RecibidaEn) ? String(f.RecibidaEn) : combinada.RecibidaEn,
      }
    },
    {
      // id/spId: el del primer registro encontrado — ninguno de los llamadores actuales usa este
      // id para nada (solo leen las cantidades e indicadores), así que es puramente informativo
      // aunque en realidad representen 2+ registros combinados.
      id: items[0].id,
      spId: items[0].id,
      RecepcionId: recepcionSpId,
      MuertoReposo: false,
      CantMuertoReposo: undefined,
      ComportamientoSexual: false,
      DisponibilidadAgua: true,
      CorralLesionados: false,
      CorralCantLesionados: undefined,
      CorralLesionadosBenefEmerg: false,
      CorralCantLesionadosBenefEmerg: undefined,
      CorralCaidos: false,
      CorralCantCaidos: undefined,
      CorralCaidosBenefEmerg: false,
      CorralCantCaidosBenefEmerg: undefined,
      CorralAgitados: false,
      CorralCantAgitados: undefined,
      CorralAgitadosBenefEmerg: false,
      CorralCantAgitadosBenefEmerg: undefined,
      EstadoSync: 'Sincronizada',
      CapturadaEn: '',
      RecibidaEn: undefined,
    },
  )
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
  // (generarTiquetesFaltantes / generarTiquetesNovedadCorral), así que `id` y
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
 *
 * Para "Novedad de llegada" (Lesionado/Caído/Agitado) la Cantidad que cuenta
 * acá es la de BENEFICIO DE EMERGENCIA, no el total reportado al llegar: un
 * animal lesionado/caído/agitado que se recupera sigue con el resto del lote
 * y no necesita tiquete — solo lleva tiquete el que no se recupera y toca
 * beneficiar de emergencia (ver el checkbox correspondiente en Recepcion.tsx
 * y el comentario en models.ts). El total reportado solo se usa para
 * mostrarlo en el reporte diario por lote (ReporteDiarioLote.tsx).
 *
 * Muerto en Reposo y la Novedad en Corral (Lesionado/Caído/Agitado ocurridos DESPUÉS de la llegada,
 * agregada 2026-09-10) vienen de NovedadCorral, no de Recepcion — se generan con
 * generarTiquetesNovedadCorral(), más abajo, desde el mismo tipo de llamada cuando esa lista
 * sincroniza (ver src/offline/syncService.ts). Nótese que "Lesionado"/"Caído"/"Agitado" como
 * TipoNovedad puede entonces existir dos veces para el mismo lote, una vez con GrupoNovedad
 * "Novedad de llegada" (aquí) y otra con "Novedad en corral" (allá) — por eso el conteo de abajo
 * filtra por grupo Y tipo, nunca solo por tipo, para no mezclar la numeración de las dos series.
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
    { grupo: 'Novedad de llegada', tipo: 'Lesionado', cantidad: recepcion.NovLlegadaCantLesionadosBeneficioEmergencia },
    { grupo: 'Novedad de llegada', tipo: 'Caído', cantidad: recepcion.NovLlegadaCantCaidosBeneficioEmergencia },
    { grupo: 'Novedad de llegada', tipo: 'Agitado', cantidad: recepcion.NovLlegadaCantAgitadosBeneficioEmergencia },
    { grupo: 'Fortuito', tipo: 'Muerto en Transporte', cantidad: recepcion.FortuitoCantMuertoTransporte },
    { grupo: 'Fortuito', tipo: 'Muerto en Desembarque', cantidad: recepcion.FortuitoCantMuertoDesembarque },
  ]

  for (const origen of origenes) {
    const cantidad = origen.cantidad ?? 0
    const yaCreados = existentes.filter((t) => t.TipoNovedad === origen.tipo && t.GrupoNovedad === origen.grupo).length
    for (let n = yaCreados + 1; n <= cantidad; n++) {
      await createItem('ConsolidadoTiquetes', {
        // SharePoint trae por defecto la columna Title como obligatoria en
        // toda lista nueva — sin ella, este createItem fallaba en silencio
        // (el error quedaba atrapado en sincronizarRecepciones() sin avisar
        // en pantalla) y la Recepción quedaba marcada Sincronizada con 0
        // tiquetes generados. Se pone un Title legible aunque la columna ya
        // se haya vuelto opcional en SharePoint, para no depender de esa
        // configuración.
        Title: `${recepcion.Consecutivo} · ${origen.tipo} #${n}`,
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
 * Contraparte de generarTiquetesFaltantes() para las novedades que vienen de NovedadCorral en vez
 * de Recepcion: "Muerto en Reposo" (de siempre) y, desde 2026-09-10, "Novedad en corral"
 * (Lesionado/Caído/Agitado que ocurren DESPUÉS de la llegada, capturados en NovedadesCorral.tsx —
 * ver el comentario grande junto a esos campos en models.ts). Se llama justo después de sincronizar
 * una NovedadCorral, con la Recepción padre ya sincronizada.
 *
 * Igual que con las novedades de llegada, para Lesionado/Caído/Agitado en corral la Cantidad que
 * cuenta es la de BENEFICIO DE EMERGENCIA, no el total reportado — un animal que se recupera no
 * necesita tiquete. Se llamaba generarTiqueteMuertoReposo() antes de agregar estas 3; se renombró
 * al ampliarla en vez de agregar una función aparte, porque los 4 orígenes se generan siempre desde
 * el mismo NovedadCorral y en los mismos 2 puntos de llamada (syncService.ts y el botón "Volver a
 * generar tiquetes" en Consolidado.tsx).
 */
export async function generarTiquetesNovedadCorral(
  novedad: NovedadCorral,
  recepcion: Pick<Recepcion, 'spId' | 'Consecutivo'>,
): Promise<void> {
  if (!recepcion.spId) {
    throw new Error('generarTiquetesNovedadCorral requiere una Recepción ya sincronizada (con spId)')
  }
  const existentes = await listarTiquetesDeRecepcion(recepcion.spId)

  const origenes: Array<{
    grupo: ConsolidadoTiquete['GrupoNovedad']
    tipo: ConsolidadoTiquete['TipoNovedad']
    cantidad: number | undefined
  }> = [
    { grupo: 'Fortuito', tipo: 'Muerto en Reposo', cantidad: novedad.CantMuertoReposo },
    { grupo: 'Novedad en corral', tipo: 'Lesionado', cantidad: novedad.CorralCantLesionadosBenefEmerg },
    { grupo: 'Novedad en corral', tipo: 'Caído', cantidad: novedad.CorralCantCaidosBenefEmerg },
    { grupo: 'Novedad en corral', tipo: 'Agitado', cantidad: novedad.CorralCantAgitadosBenefEmerg },
  ]

  for (const origen of origenes) {
    const cantidad = origen.cantidad ?? 0
    // Filtra por grupo Y tipo (no solo tipo) — ver el comentario en generarTiquetesFaltantes()
    // sobre por qué "Lesionado"/"Caído"/"Agitado" puede existir con dos GrupoNovedad distintos.
    const yaCreados = existentes.filter((t) => t.TipoNovedad === origen.tipo && t.GrupoNovedad === origen.grupo).length
    for (let n = yaCreados + 1; n <= cantidad; n++) {
      await createItem('ConsolidadoTiquetes', {
        Title: `${recepcion.Consecutivo} · ${origen.tipo} #${n}`,
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
