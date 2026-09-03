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

export interface Recepcion extends CapturaOffline {
  id: string
  Title: string
  /** Se digita manualmente — es el consecutivo que ya manejan en planta. */
  Consecutivo: string
  NumeroOrden: string
  FechaRecepcion: string
  /**
   * Estas 3 son columnas "Fecha y hora" en SharePoint (no existe un tipo "solo hora" ahí), así que
   * se guardan como fecha-hora ISO completa con offset fijo -05:00 (Colombia) — ej.
   * "2026-09-01T14:30:00-05:00" — armada a partir de FechaRecepcion + la hora que digita la persona.
   * Ver combinarFechaHora() en src/features/recepcion/Recepcion.tsx.
   */
  HoraLlegadaVehiculo: string
  HoraInicioDesembarque: string
  HoraFinalDesembarque: string
  AsociadoId: string
  GranjaId: string
  NumeroTotalCerdos: number
  PesoPromedioGranja: number
  PlacaVehiculoId: string
  GuiaSanitariaICA: string
  RemisionGranja: string
  QRLote: boolean
  CertificadoInmunocastracion: boolean
  CoincideGuiaICAvsQR: boolean
  NovLlegadaLesionados: boolean
  NovLlegadaCantLesionados?: number
  NovLlegadaCaidos: boolean
  NovLlegadaCantCaidos?: number
  NovLlegadaAgitados: boolean
  NovLlegadaCantAgitados?: number
  FortuitoMuertoTransporte: boolean
  FortuitoCantMuertoTransporte?: number
  FortuitoMuertoDesembarque: boolean
  FortuitoCantMuertoDesembarque?: number
  SuciedadCerdos: SuciedadCerdos
  Observaciones?: string
  EstadoLote: EstadoLote
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
}

export type GrupoNovedad = 'Fortuito' | 'Novedad de llegada'
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
