import { z } from 'zod'

/**
 * Igual que recepcionSchema.ts para las novedades de llegada (ver el comentario grande ahí): las
 * parejas booleano+cantidad de Lesionado/Caído/Agitado en corral usan superRefine porque la
 * cantidad solo es obligatoria cuando su checkbox está marcado, y la cantidad de "beneficio de
 * emergencia" nunca puede superar la cantidad total reportada de esa misma novedad.
 */
export const novedadCorralSchema = z
  .object({
    RecepcionId: z.string().min(1, 'Selecciona a qué recepción pertenece'),
    MuertoReposo: z.boolean(),
    CantMuertoReposo: z.coerce.number().int().min(0).optional(),
    ComportamientoSexual: z.boolean(),
    DisponibilidadAgua: z.boolean(),

    CorralLesionados: z.boolean(),
    CorralCantLesionados: z.coerce.number().int().min(0).optional(),
    CorralLesionadosBenefEmerg: z.boolean(),
    CorralCantLesionadosBenefEmerg: z.coerce.number().int().min(0).optional(),
    CorralCaidos: z.boolean(),
    CorralCantCaidos: z.coerce.number().int().min(0).optional(),
    CorralCaidosBenefEmerg: z.boolean(),
    CorralCantCaidosBenefEmerg: z.coerce.number().int().min(0).optional(),
    CorralAgitados: z.boolean(),
    CorralCantAgitados: z.coerce.number().int().min(0).optional(),
    CorralAgitadosBenefEmerg: z.boolean(),
    CorralCantAgitadosBenefEmerg: z.coerce.number().int().min(0).optional(),
  })
  .superRefine((datos, ctx) => {
    if (datos.MuertoReposo && !(Number(datos.CantMuertoReposo) > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CantMuertoReposo'],
        message: 'Indica cuántos animales — es lo que genera el tiquete en Consolidado',
      })
    }

    const parejas = [
      ['CorralLesionados', 'CorralCantLesionados'],
      ['CorralLesionadosBenefEmerg', 'CorralCantLesionadosBenefEmerg'],
      ['CorralCaidos', 'CorralCantCaidos'],
      ['CorralCaidosBenefEmerg', 'CorralCantCaidosBenefEmerg'],
      ['CorralAgitados', 'CorralCantAgitados'],
      ['CorralAgitadosBenefEmerg', 'CorralCantAgitadosBenefEmerg'],
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

    // Igual que en recepcionSchema.ts: la cantidad beneficiada de emergencia nunca puede superar
    // la cantidad total reportada de esa misma novedad.
    const topesEmergencia = [
      ['CorralCantLesionadosBenefEmerg', 'CorralCantLesionados'],
      ['CorralCantCaidosBenefEmerg', 'CorralCantCaidos'],
      ['CorralCantAgitadosBenefEmerg', 'CorralCantAgitados'],
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

// Ver el comentario en src/features/recepcion/recepcionSchema.ts sobre por qué z.coerce.number()
// obliga a distinguir el tipo de Input (lo que trae el <input>) del de Output (ya coaccionado).
export type NovedadCorralFormInput = z.input<typeof novedadCorralSchema>
export type NovedadCorralFormValues = z.output<typeof novedadCorralSchema>
