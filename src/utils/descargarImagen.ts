/**
 * Descarga (o comparte, en el celular) un elemento del DOM como imagen PNG — usado por el botón
 * "Descargar imagen" de ReporteDiarioLote.tsx y ReporteSemanalAsociado.tsx.
 *
 * Usa dom-to-image-more en vez de html2canvas-pro (que se usaba antes): html2canvas-pro vuelve a
 * DIBUJAR a mano cada texto/borde/imagen sobre un <canvas> reinterpretando el CSS él mismo, y esa
 * reinterpretación es la que se veía "un poco borrosa" sin importar cuánta resolución se le
 * subiera — es una limitación de cómo dibuja el texto, no de la resolución. dom-to-image-more en
 * cambio empaqueta el HTML/CSS real dentro de un SVG y deja que el propio motor del navegador lo
 * pinte (con su mismo renderizador de texto de siempre, el mismo que se ve nítido en pantalla), y
 * ahí sí se puede pedir además una resolución más alta (pixelRatio) sin ese límite de nitidez.
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
 * Ancho "de escritorio" con el que se arma el clon oculto que se captura, sin importar el ancho
 * real de la pantalla del celular. Sin esto, la captura usa el ancho real del dispositivo (unos
 * 360-390px en un celular angosto) — como las secciones de los reportes tienen `overflow-hidden`
 * (para que se vean las esquinas redondeadas) y las tablas anchas (Horas en el reporte diario,
 * Detalle por lote en el semanal) no se achican más allá de cierto punto, el resultado era una
 * imagen con columnas recortadas a la mitad. El propio ancho máximo del reporte (max-w-3xl /
 * max-w-4xl de Tailwind) hace el resto: 1100 es solo un ancho de sobra para que ese máximo se
 * alcance siempre, sin importar desde qué celular se descargue.
 */
const ANCHO_CAPTURA = 1100

/**
 * Nitidez de la imagen: cuántos píxeles reales se dibujan por cada píxel del diseño. Más alto =
 * más nítido, pero el PNG final también pesa más. 3 es el techo deseado — se usa siempre que el
 * informe no sea demasiado largo.
 *
 * El techo de abajo (AREA_MAXIMA_PX) es la razón por la que esto no es simplemente "3" fijo: los
 * navegadores (sobre todo Safari en iPhone) tienen un límite de tamaño para un <canvas> — un
 * informe semanal de un grupo con varias granjas y vehículos con novedades puede salir bastante
 * largo, y multiplicar TODO ese largo por 3 podía pasarse de ese límite y devolver una imagen en
 * blanco o rota. calcularNitidez() por eso calcula, para cada informe, la nitidez más alta posible
 * que sigue siendo segura para su tamaño real — nunca más de 3.
 */
const NITIDEZ_DESEADA = 3
const AREA_MAXIMA_PX = 16_000_000

function calcularNitidez(ancho: number, alto: number): number {
  const segura = Math.sqrt(AREA_MAXIMA_PX / (ancho * alto))
  return Math.min(NITIDEZ_DESEADA, Math.max(1, segura))
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
 * Se asegura de que el elemento esté realmente listo para capturarse: espera las fuentes
 * (document.fonts.ready), espera que todas las imágenes de adentro (el logo de Cercafe) hayan
 * terminado de cargar, y espera dos frames de pintado. Sin esto, la captura podía salir con el
 * logo o el texto a medio cargar — una carrera entre la librería y el navegador terminando de
 * acomodar la página.
 */
async function esperarListoParaCapturar(elemento: HTMLElement): Promise<void> {
  if (typeof document.fonts !== 'undefined') {
    await document.fonts.ready.catch(() => undefined)
  }
  const imagenes = Array.from(elemento.querySelectorAll('img'))
  await Promise.all(imagenes.map(esperarImagen))
  await esperarProximoFrame()
}

/**
 * Arma un clon del reporte fuera de la pantalla (con `position: fixed` y muy a la izquierda, no
 * con `display: none` — eso sí impediría medirlo) metido en un contenedor de ancho fijo. Como el
 * reporte ya trae su propio ancho máximo (max-w-3xl / max-w-4xl de Tailwind) y se centra con
 * mx-auto, basta con darle al contenedor un ancho de sobra para que el reporte alcance ese máximo
 * — el mismo ancho que ya se ve bien en computador — en vez de quedarse con el ancho angosto real
 * de la pantalla del celular. Se captura este clon en vez del elemento visible en pantalla para
 * que nadie vea el "salto" de ancho mientras se genera la imagen.
 */
function crearClonAnchoFijo(elemento: HTMLElement): { clon: HTMLElement; contenedor: HTMLElement } {
  const contenedor = document.createElement('div')
  contenedor.setAttribute('aria-hidden', 'true')
  Object.assign(contenedor.style, {
    position: 'fixed',
    top: '0',
    left: '-100000px',
    width: `${ANCHO_CAPTURA}px`,
    pointerEvents: 'none',
  })

  const clon = elemento.cloneNode(true) as HTMLElement
  contenedor.appendChild(clon)
  document.body.appendChild(contenedor)

  return { clon, contenedor }
}

export async function descargarElementoComoImagen(elemento: HTMLElement, nombreArchivo: string): Promise<void> {
  const { default: domtoimage } = await import('dom-to-image-more')

  const { clon, contenedor } = crearClonAnchoFijo(elemento)

  let blob: Blob
  try {
    await esperarListoParaCapturar(clon)

    const ancho = clon.getBoundingClientRect().width || ANCHO_CAPTURA
    const alto = clon.scrollHeight || clon.getBoundingClientRect().height || 800

    blob = await domtoimage.toBlob(clon, {
      bgcolor: '#ffffff',
      pixelRatio: calcularNitidez(ancho, alto),
      cacheBust: true,
    })
  } finally {
    document.body.removeChild(contenedor)
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
