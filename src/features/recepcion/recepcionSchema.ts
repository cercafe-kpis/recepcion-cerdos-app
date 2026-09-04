import { z } from 'zod'

/**
 * Valida el formulario de Recepción antes de guardarlo localmente (ver
 * Recepcion.tsx). Las parejas booleano+cantidad (novedades de llegada,
 * beneficio de emergencia de esas mismas novedades, y fortuitos) usan
 * superRefine porque la cantidad solo es obligatoria cuando su checkbox está
 * marcado — son las mismas que después explota generarTiquetesFaltantes()
 * en src/graph/lists.ts, una fila de ConsolidadoTiquetes por unidad de
 * cantidad (para "Novedad de llegada" esa cantidad es la de beneficio de
 * emergencia, no el total reportado — ver el comentario en ese archivo).
 */
export const recepcionSchema = z
  .object({
    Consecutivo: z.string().trim().min(1, 'Obligatorio — es el consecutivo que ya manejan en planta'),
    NumeroOrden: z.string().trim().min(1, 'Obligatorio'),
    FechaRecepcion: z.string().min(1, 'Obligatorio'),
    HoraProgramada: z.string().min(1, 'Obligatorio'),
    HoraLlegadaVehiculo: z.string().min(1, 'Obligatorio'),
    HoraInicioDesembarque: z.string().min(1, 'Obligatorio'),
    HoraFinalDesembarque: z.string().min(1, 'Obligatorio'),
    AsociadoId: z.string().min(1, 'Selecciona un asociado'),
    GranjaId: z.string().min(1, 'Selecciona una granja'),
    NumeroTotalCerdos: z.coerce.number().int('Debe ser un número entero').positive('Debe ser mayor a 0'),
    PesoPromedioGranja: z.coerce.number().positive('Debe ser mayor a 0'),
    PlacaVehiculoId: z.string().min(1, 'Selecciona un vehículo'),
    GuiaSanitariaICA: z.string().trim().min(1, 'Obligatorio'),
    RemisionGranja: z.string().trim().min(1, 'Obligatorio'),
    QRLote: z.boolean(),
    CertificadoInmunocastracion: z.boolean(),
    CoincideGuiaICAvsQR: z.boolean(),

    NovLlegadaLesionados: z.boolean(),
    NovLlegadaCantLesionados: z.coerce.number().int().min(0).optional(),
    NovLlegadaLesionadosBeneficioEmergencia: z.boolean(),
    NovLlegadaCantLesionadosBeneficioEmergencia: z.coerce.number().int().min(0).optional(),
    NovLlegadaCaidos: z.boolean(),
    NovLlegadaCantCaidos: z.coerce.number().int().min(0).optional(),
    NovLlegadaCaidosBeneficioEmergencia: z.boolean(),
    NovLlegadaCantCaidosBeneficioEmergencia: z.coerce.number().int().min(0).optional(),
    NovLlegadaAgitados: z.boolean(),
    NovLlegadaCantAgitados: z.coerce.number().int().min(0).optional(),
    NovLlegadaAgitadosBeneficioEmergencia: z.boolean(),
    NovLlegadaCantAgitadosBeneficioEmergencia: z.coerce.number().int().min(0).optional(),

    FortuitoMuertoTransporte: z.boolean(),
    FortuitoCantMuertoTransporte: z.coerce.number().int().min(0).optional(),
    FortuitoMuertoDesembarque: z.boolean(),
    FortuitoCantMuertoDesembarque: z.coerce.number().int().min(0).optional(),

    SuciedadCerdos: z.enum(['Alta', 'Baja']),
    Observaciones: z.string().trim().optional(),
  })
  .superRefine((datos, ctx) => {
    const parejas = [
      ['NovLlegadaLesionados', 'NovLlegadaCantLesionados'],
      ['NovLlegadaLesionadosBeneficioEmergencia', 'NovLlegadaCantLesionadosBeneficioEmergencia'],
      ['NovLlegadaCaidos', 'NovLlegadaCantCaidos'],
      ['NovLlegadaCaidosBeneficioEmergencia', 'NovLlegadaCantCaidosBeneficioEmergencia'],
      ['NovLlegadaAgitados', 'NovLlegadaCantAgitados'],
      ['NovLlegadaAgitadosBeneficioEmergencia', 'NovLlegadaCantAgitadosBeneficioEmergencia'],
      ['FortuitoMuertoTransporte', 'FortuitoCantMuertoTransporte'],
      ['FortuitoMuertoDesembarque', 'FortuitoCantMuertoDesembarque'],
    ] as const

    for (const [marcado, cantidad] of parejas) {
      if (datos[marcado] && !(Number(datos[cantidad]) > 0)) {
        ctx.addIssue({
          code: 'custom',
          path: [cantidad],
          message: 'Indica cuántos animales — es lo que genera los tiquetes en Consolidado',
        })
      }
    }

    // La cantidad beneficiada de emergencia nunca puede superar el total reportado de esa
    // misma novedad de llegada (ej. no puede haber 3 lesionados beneficiados de emergencia
    // si solo se reportaron 2 lesionados en total).
    const topesEmergencia = [
      ['NovLlegadaCantLesionadosBeneficioEmergencia', 'NovLlegadaCantLesionados'],
      ['NovLlegadaCantCaidosBeneficioEmergencia', 'NovLlegadaCantCaidos'],
      ['NovLlegadaCantAgitadosBeneficioEmergencia', 'NovLlegadaCantAgitados'],
    ] as const

    for (const [cantidadEmergencia, cantidadTotal] of topesEmergencia) {
      const emergencia = Number(datos[cantidadEmergencia])
      const total = Number(datos[cantidadTotal])
      if (emergencia > 0 && emergencia > total) {
        ctx.addIssue({
          code: 'custom',
          path: [cantidadEmergencia],
          message: 'No puede ser mayor a la cantidad total reportada arriba',
        })
      }
    }
  })

// zod con z.coerce.number() tiene un tipo de ENTRADA (lo que llega de los <input>, `unknown`
// antes de coaccionar) distinto del de SALIDA (`number`, después de que zodResolver corre el
// schema) — por eso useForm() en Recepcion.tsx usa los dos tipos por separado (ver el comentario
// junto a su llamada a useForm). Los otros dos formularios (Ubicación, Novedades en Corral)
// tienen el mismo par Input/Output por la misma razón.
export type RecepcionFormInput = z.input<typeof recepcionSchema>
export type RecepcionFormValues = z.output<typeof recepcionSchema>
