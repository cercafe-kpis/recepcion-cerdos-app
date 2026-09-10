/**
 * Tipos que reflejan uno a uno las columnas de las Listas de SharePoint
 * descritas en Arquitectura-App-Recepcion-Cerdos.md (sección 4).
 *
 * `id` siempre es un string: mientras un registro no se ha sincronizado es un
 * UUID generado en el dispositivo (ver src/offline/db.ts); después de
 * sincronizar pasa a ser el Id real que asigna SharePoint. El resto del código
 * nunca necesita saber en cuál de los dos estados está.
 */

export type Rol = 'Administrador' | 'Supervisor' | 'Auditor' | 'Consultor'

export interface Usuario {
  id: string
  Title: string
  Correo: string
  Rol: Rol
  AsociadosAsignados?: string[]
  GranjasAsignadas?: string[]
  Activo: boolean
}

export interface GrupoAsociado {
  id: string
  Title: string
  Activo: boolean
}

export interface Asociado {
  id: string
  Title: string
  NIT?: string
  /** Lookup opcional a GrupoAsociado — ver GruposAsociadosAdmin.tsx. */
  GrupoAsociadoId?: string
  Activo: boolean
}

export interface Granja {
  id: string
  Title: string
  AsociadoId: string
  Municipio?: string
  /** Id numérico de esta granja en el sistema DHC — obligatorio desde GranjasAdmin.tsx. */
  id_dhc: number
  /** Nombre corto que se usa para mostrar la granja en otras vistas/reportes — obligatorio desde GranjasAdmin.tsx. */
  nombre_vista: string
  Activa: boolean
}

export interface Vehiculo {
  id: string
  Title: string
  AsociadoId?: string
  Activo: boolean
}

/** Común a las 4 listas transaccionales: cómo y cuándo se capturó. */
export type EstadoSync = 'Pendiente' | 'Sincronizada' | 'ConflictoConsecutivo'

export interface CapturaOffline {
  EstadoSync: EstadoSync
  /** Hora del dispositivo en el momento de guardar — puede ser sin conexión. */
  CapturadaEn: string
  /** Hora en que SharePoint recibió el registro (la pone el flujo de sync). */
  RecibidaEn?: string
  /**
   * Id real del elemento en SharePoint, una vez sincronizado. `id` (la clave
   * primaria local, un UUID) NUNCA cambia — así los registros hijos pueden
   * referenciar a su padre por `id` desde el primer momento, esté o no
   * sincronizado. `spId` es lo único que hace falta para mandar el lookup
   * correcto a Graph al sincronizar un hijo. Ver src/offline/syncService.ts.
   */
  spId?: string
}

export type EstadoLote = 'En proceso' | 'Completo'
export type SuciedadCerdos = 'Alta' | 'Baja'
/**
 * A pedido de Nathalia (2026-09-10): antes era texto libre. Se guarda como
 * string 'Sí'/'No' (no boolean) a propósito — la columna en SharePoint sigue
 * siendo de tipo Texto (ver arquitectura-datos-recepcion-cerdos.md), así que
 * escribir estos dos literales no requiere ningún cambio de columna ni
 * migración de datos existentes.
 */
export type RemisionGranja = 'Sí' | 'No'

export interface Recepcion extends CapturaOffline {
  id: string
  Title: string
  /** Se digita manualmente — es el consecutivo que ya manejan en planta. */
  Consecutivo: string
  NumeroOrden: string
  FechaRecepcion: string
  /**
   * Estas 4 son columnas "Fecha y hora" en SharePoint (no existe un tipo "solo hora" ahí), así que
   * se guardan como fecha-hora ISO completa con offset fijo -05:00 (Colombia) — ej.
   * "2026-09-01T14:30:00-05:00" — armada a partir de FechaRecepcion + la hora que digita la persona.
   * Ver combinarFechaHora() en src/features/recepcion/Recepcion.tsx. HoraProgramada se agregó para
   * el reporte diario por lote (src/features/reportes/ReporteDiarioLote.tsx) — Tiempo de espera y
   * Tiempo de desembarque de ese reporte se calculan solos a partir de estas 4, no se capturan aparte.
   */
  HoraProgramada: string
  HoraLlegadaVehiculo: string
  HoraInicioDesembarque: string
  HoraFinalDesembarque: string
  AsociadoId: string
  GranjaId: string
  NumeroTotalCerdos: number
  PesoPromedioGranja: number
  PlacaVehiculoId: string
  /** Formato forzado en el formulario: 3 cifras + guion + el resto (ej. "026-445555552") — ver formatearGuiaICA() en Recepcion.tsx. */
  GuiaSanitariaICA: string
  RemisionGranja: RemisionGranja
  QRLote: boolean
  CertificadoInmunocastracion: boolean
  CoincideGuiaICAvsQR: boolean
  NovLlegadaLesionados: boolean
  NovLlegadaCantLesionados?: number
  /**
   * De los lesionados/caídos/agitados de arriba, cuántos NO se recuperaron y
   * tocó beneficiar de emergencia — solo esos generan tiquete en Consolidado
   * (ver generarTiquetesFaltantes() en src/graph/lists.ts). Los que sí se
   * recuperan quedan solo como la novedad de llegada, sin tiquete, y salen
   * con el resto del lote.
   */
  NovLlegadaLesionadosBeneficioEmergencia: boolean
  NovLlegadaCantLesionadosBeneficioEmergencia?: number
  NovLlegadaCaidos: boolean
  NovLlegadaCantCaidos?: number
  NovLlegadaCaidosBeneficioEmergencia: boolean
  NovLlegadaCantCaidosBeneficioEmergencia?: number
  NovLlegadaAgitados: boolean
  NovLlegadaCantAgitados?: number
  NovLlegadaAgitadosBeneficioEmergencia: boolean
  NovLlegadaCantAgitadosBeneficioEmergencia?: number
  FortuitoMuertoTransporte: boolean
  FortuitoCantMuertoTransporte?: number
  FortuitoMuertoDesembarque: boolean
  FortuitoCantMuertoDesembarque?: number
  SuciedadCerdos: SuciedadCerdos
  Observaciones?: string
  EstadoLote: EstadoLote
  /**
   * Nombre (Title) de quien registró esta Recepción — se guarda solo, sin
   * pedirlo en el formulario (ver Recepcion.tsx). Es el "Encargado" que
   * aparece en el reporte diario por lote.
   */
  CapturadoPor: string
}

export interface Ubicacion extends CapturaOffline {
  id: string
  RecepcionId: string
  PesoPromedioPlanta: number
  CorralesDesignados: string
  CoincidenciaNumAnimales: boolean
  Observaciones?: string
}

export interface NovedadCorral extends CapturaOffline {
  id: string
  RecepcionId: string
  MuertoReposo: boolean
  CantMuertoReposo?: number
  ComportamientoSexual: boolean
  DisponibilidadAgua: boolean
  /**
   * Novedad en corral (agregada 2026-09-10, a pedido de Nathalia): mismo patrón de
   * checkbox+cantidad, y "¿se benefició de emergencia?"+cantidad, que las novedades de LLEGADA en
   * Recepcion.tsx (NovLlegadaLesionados y compañía) — ver el comentario junto a esos campos y el
   * de generarTiquetesNovedadCorral() en src/graph/lists.ts para el porqué solo la cantidad de
   * beneficio de emergencia genera tiquete en Consolidado. Nombres cortos ("BenefEmerg" en vez de
   * "BeneficioEmergencia") A PROPÓSITO: los mismos campos en Recepcion tienen nombres tan largos
   * que SharePoint corta su nombre interno a 32 caracteres (ver NOMBRE_SP_BENEFICIO_EMERGENCIA en
   * lists.ts) — aquí, al ser columnas nuevas, se evitó ese problema desde el diseño en vez de
   * repetir el parche.
   */
  CorralLesionados: boolean
  CorralCantLesionados?: number
  CorralLesionadosBenefEmerg: boolean
  CorralCantLesionadosBenefEmerg?: number
  CorralCaidos: boolean
  CorralCantCaidos?: number
  CorralCaidosBenefEmerg: boolean
  CorralCantCaidosBenefEmerg?: number
  CorralAgitados: boolean
  CorralCantAgitados?: number
  CorralAgitadosBenefEmerg: boolean
  CorralCantAgitadosBenefEmerg?: number
}

export type GrupoNovedad = 'Fortuito' | 'Novedad de llegada' | 'Novedad en corral'
export type TipoNovedad =
  | 'Muerto en Transporte'
  | 'Muerto en Desembarque'
  | 'Muerto en Reposo'
  | 'Lesionado'
  | 'Caído'
  | 'Agitado'
export type Destino = 'Procesado' | 'Decomisado'
export type EstadoTiquete = 'Pendiente' | 'Completo'

export interface ConsolidadoTiquete extends CapturaOffline {
  id: string
  RecepcionId: string
  GrupoNovedad: GrupoNovedad
  TipoNovedad: TipoNovedad
  /** Ej. 2 de 3 — de cuántos animales con esta misma novedad en el lote. */
  NumeroAnimalEnLote: number
  Tiquete?: string
  Destino?: Destino
  /** Solo aplica a GrupoNovedad === 'Fortuito'. */
  Factura?: string
  FechaDespacho?: string
  FechaBeneficio?: string
  EstadoTiquete: EstadoTiquete
}

/** Bitácora de auditoría — quién hizo qué sobre una Recepción. Ver sección 4 del doc de arquitectura. */
export interface RecepcionLogEntry {
  id: string
  RecepcionId: string
  Usuario: string
  Accion: string
  DetalleJson: string
  CreadoEn: string
}
