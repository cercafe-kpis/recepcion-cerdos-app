/**
 * Descarga (o comparte, en el celular) un elemento del DOM como imagen PNG — usado por el botón
 * "Descargar imagen" de ReporteDiarioLote.tsx y ReporteSemanalAsociado.tsx.
 *
 * En computador, un <a download> con un blob: funciona directo y descarga el archivo. En el
 * celular NO: los navegadores móviles (sobre todo Safari de iPhone, y más todavía los
 * "navegadores" internos de apps como WhatsApp o Instagram cuando se abre un enlace desde ahí)
 * en general ignoran el atributo download y solo abren o navegan a la imagen en vez de
 * guardarla — por eso el botón no descargaba nada en el celular aunque en computador sí
 * funcionaba. La solución estándar para esto es usar la Web Share API (navigator.share) cuando
 * está disponible: abre la hoja nativa de "Compartir" del celular, donde SÍ aparece la opción
 * "Guardar imagen" / "Guardar en Archivos". En computador esa API normalmente no está
 * disponible (o no soporta archivos), así que ahí se sigue usando el <a download> de siempre.
 */
export async function descargarElementoComoImagen(elemento: HTMLElement, nombreArchivo: string): Promise<void> {
  // Variante "pro" de html2canvas: la normal no interpreta los colores oklch() de Tailwind 4 y
  // produciría una imagen en blanco o rota. Se carga solo cuando hace falta (es una librería
  // pesada), no en el paquete principal de la app.
  const { default: html2canvas } = await import('html2canvas-pro')
  const canvas = await html2canvas(elemento, { backgroundColor: '#ffffff', scale: 2 })

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new Error('No se pudo generar la imagen.')
  }

  const archivo = new File([blob], nombreArchivo, { type: 'image/png' })

  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo] })
      return
    } catch (err) {
      // El usuario cerró la hoja de "Compartir" sin elegir nada — no es un error real, no hay
      // nada más que hacer (a diferencia de cualquier otro problema, que sí cae al método de
      // descarga directa de abajo como respaldo).
      if (err instanceof Error && err.name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const enlace = document.createElement('a')
    enlace.download = nombreArchivo
    enlace.href = url
    enlace.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}
