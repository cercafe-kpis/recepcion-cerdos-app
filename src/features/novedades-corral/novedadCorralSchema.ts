import { z } from 'zod'

export const novedadCorralSchema = z
  .object({
    RecepcionId: z.string().min(1, 'Selecciona a qué recepción pertenece'),
    MuertoReposo: z.boolean(),
    CantMuertoReposo: z.coerce.number().int().min(0).optional(),
    ComportamientoSexual: z.boolean(),
    DisponibilidadAgua: z.boolean(),
  })
  .superRefine((datos, ctx) => {
    if (datos.MuertoReposo && !(Number(datos.CantMuertoReposo) > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['CantMuertoReposo'],
        message: 'Indica cuántos animales — es lo que genera el tiquete en Consolidado',
      })
    }
  })

// Ver el comentario en src/features/recepcion/recepcionSchema.ts sobre por qué z.coerce.number()
// obliga a distinguir el tipo de Input (lo que trae el <input>) del de Output (ya coaccionado).
export type NovedadCorralFormInput = z.input<typeof novedadCorralSchema>
export type NovedadCorralFormValues = z.output<typeof novedadCorralSchema>
