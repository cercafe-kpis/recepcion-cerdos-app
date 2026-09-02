import { z } from 'zod'

export const ubicacionSchema = z.object({
  RecepcionId: z.string().min(1, 'Selecciona a qué recepción pertenece'),
  PesoPromedioPlanta: z.coerce.number().positive('Debe ser mayor a 0'),
  CorralesDesignados: z.string().trim().min(1, 'Obligatorio'),
  CoincidenciaNumAnimales: z.boolean(),
  Observaciones: z.string().trim().optional(),
})

// Ver el comentario en src/features/recepcion/recepcionSchema.ts sobre por qué z.coerce.number()
// obliga a distinguir el tipo de Input (lo que trae el <input>) del de Output (ya coaccionado).
export type UbicacionFormInput = z.input<typeof ubicacionSchema>
export type UbicacionFormValues = z.output<typeof ubicacionSchema>
