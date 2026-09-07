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

/**
 * Ancho "de escritorio" que se le fuerza a html2canvas-pro para capturar, sin importar el ancho
 * real de la pantalla del celular. Sin esto, la captura usa el ancho real del dispositivo (unos
 * 360-390px en un celular angosto) — como las secciones de los reportes tienen `overflow-hidden`
 * (para que se vean las esquinas redondeadas) y las tablas anchas (Horas en el reporte diario,
 * Detalle por lote en el semanal) no se achican más allá de cierto punto, el resultado era una
 * imagen con columnas recortadas a la mitad. Con un ancho de ventana fijo, la captura siempre usa
 * el mismo layout ancho ya probado en computador, sin importar desde qué celular se descargue.
 */
const ANCHO_CAPTURA = 1100

/**
 * Nitidez de la imagen: cuántos píxeles reales se dibujan por cada píxel del diseño. Más alto =
 * más nítido (sobre todo el texto y el logo, que es lo que se veía "un poco borroso"), pero el
 * PNG final también pesa más. 3 es el techo deseado — se usa siempre que el informe no sea
 * demasiado largo.
 *
 * El techo de abajo (AREA_MAXIMA_PX) es la razón por la que esto no es simplemente "3" fijo: los
 * navegadores (sobre todo Safari en iPhone) tienen un límite de tamaño para un <canvas> — un
 * informe semanal de un grupo con varias granjas y vehículos con novedades puede salir bastante
 * largo, y multiplicar TODO ese largo por 3 podía pasarse de ese límite y devolver una imagen en
 * blanco o rota. calcularEscala() por eso calcula, para cada informe, la escala más nítida posible
 * que sigue siendo segura para su tamaño real — nunca más de 3.
 */
const ESCALA_DESEADA = 3
const AREA_MAXIMA_PX = 16_000_000

/**
 * Calcula qué tan nítida puede salir la captura sin arriesgarse a pasar el límite de tamaño de
 * <canvas> del navegador. El ancho que de verdad va a usar la imagen es el max-width que ya trae
 * la sección del informe (768px o 896px, según ReporteDiarioLote.tsx / ReporteSemanalAsociado.tsx)
 * — se lee del propio elemento en vez de suponerlo, para que esto sirva para los dos sin
 * distinción. El alto real no se puede saber de antemano (depende del contenido), así que se usa
 * el alto actual del elemento como estimado — en un celular angosto ese alto suele ser IGUAL o
 * MAYOR al que tendría ya ensanchado (el texto se acomoda en menos líneas al haber más espacio),
 * así que quedarse corto en la estimación es del lado seguro: en el peor caso la imagen sale un
 * poco menos nítida de lo posible, nunca rota.
 */
function calcularEscala(elemento: HTMLElement): number {
  const anchoMaximo = parseFloat(getComputedStyle(elemento).maxWidth)
  const ancho = Number.isFinite(anchoMaximo) && anchoMaximo > 0 ? anchoMaximo : elemento.getBoundingClientRect().width || 800
  const alto = elemento.scrollHeight || elemento.getBoundingClientRect().height || 800
  const escalaSegura = Math.sqrt(AREA_MAXIMA_PX / (ancho * alto))
  return Math.min(ESCALA_DESEADA, Math.max(1, escalaSegura))
}

/** Espera a que el navegador termine de pintar dos cuadros — dos requestAnimationFrame
 * encadenados (no uno solo) porque el primero solo garantiza que el navegador YA VA a pintar el
 * frame actual, no que terminó de aplicar los estilos/layout más recientes; el segundo sí se
 * dispara después de que ese pintado ya ocurrió. */
function esperarProximoFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** Espera a que una <img> termine de cargar (o falle) — si ya estaba cargada (`complete`), resuelve de inmediato. */
function esperarImagen(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve()
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
  })
}

/**
 * Se asegura de que el elemento esté realmente listo para capturarse antes de llamar a
 * html2canvas-pro: espera las fuentes (document.fonts.ready), espera que todas las imágenes de
 * adentro (el logo de Cercafe) hayan terminado de cargar, y espera dos frames de pintado. Sin
 * esto, la primera vez que se usa "Descargar imagen" después de abrir la app (cuando el logo
 * puede no estar completamente decodificado todavía) la captura podía salir con el logo enorme,
 * borroso y sin los estilos aplicados — una carrera entre html2canvas-pro y el navegador
 * terminando de acomodar la página.
 */
async function esperarListoParaCapturar(elemento: HTMLElement): Promise<void> {
  if (typeof document.fonts !== 'undefined') {
    await document.fonts.ready.catch(() => undefined)
  }
  const imagenes = Array.from(elemento.querySelectorAll('img'))
  await Promise.all(imagenes.map(esperarImagen))
  await esperarProximoFrame()
}

export async function descargarElementoComoImagen(elemento: HTMLElement, nombreArchivo: string): Promise<void> {
  // Variante "pro" de html2canvas: la normal no interpreta los colores oklch() de Tailwind 4 y
  // produciría una imagen en blanco o rota. Se carga solo cuando hace falta (es una librería
  // pesada), no en el paquete principal de la app.
  const { default: html2canvas } = await import('html2canvas-pro')

  await esperarListoParaCapturar(elemento)

  const canvas = await html2canvas(elemento, {
    backgroundColor: '#ffffff',
    scale: calcularEscala(elemento),
    windowWidth: ANCHO_CAPTURA,
    windowHeight: Math.max(elemento.scrollHeight, window.innerHeight),
  })

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
