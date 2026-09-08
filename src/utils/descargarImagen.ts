import { jsPDF } from 'jspdf'

/**
 * Descarga (o comparte, en el celular) un elemento del DOM como imagen PNG o como PDF — usado por
 * los botones "Descargar imagen" y "Descargar / Compartir PDF" de ReporteDiarioLote.tsx y
 * ReporteSemanalAsociado.tsx.
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

/**
 * Límite de tiempo total para generar la imagen (esperar fuentes/imágenes + dibujarla). Sin esto,
 * si algo interno de dom-to-image-more se queda esperando (por ejemplo una fuente o un recurso que
 * nunca termina de resolverse en ese navegador/red en particular) el botón se quedaba en
 * "Generando imagen…" PARA SIEMPRE, sin ningún error — porque nada dentro de la librería garantiza
 * que la promesa que devuelve toBlob() se resuelva o falle en un tiempo razonable. Mismo patrón que
 * ya usa src/graph/client.ts para no quedarse esperando indefinidamente a Microsoft.
 */
const LIMITE_TIEMPO_MS = 25000

function conLimiteDeTiempo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(mensaje)), ms)
    promesa.then(
      (valor) => {
        clearTimeout(temporizador)
        resolve(valor)
      },
      (error) => {
        clearTimeout(temporizador)
        reject(error)
      },
    )
  })
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

/**
 * dom-to-image-more (~25 KB) se carga aparte del resto de la app (import() dinámico) para no
 * hacer más pesada la carga inicial — pero eso significa que la PRIMERA vez que se usa en toda la
 * sesión, el navegador tiene que ir a buscar ese archivo y ejecutarlo antes de poder hacer nada
 * más, lo que le agrega uno o dos segundos de más justo a ese primer intento. Ese segundo de más
 * puede ser la diferencia entre que el clic en "Descargar imagen" todavía cuente como una acción
 * directa de la persona (lo que el navegador exige para dejar descargar un archivo sin pedir
 * permiso) o no — y si no cuenta, el navegador puede simplemente IGNORAR la descarga sin avisar
 * nada, en vez de mostrar un error. Por eso precargarLibreriaDeImagen() se llama apenas se
 * muestra el reporte en pantalla (ver el useEffect en ReporteDiarioLote.tsx /
 * ReporteSemanalAsociado.tsx) — así, para cuando la persona alcanza a tocar "Descargar imagen",
 * ese archivo ya está descargado y lista para usarse, y todo el proceso corre de una sola vez,
 * rápido, sin ese primer tropiezo. import() con el mismo nombre de módulo siempre devuelve la
 * misma promesa ya resuelta la segunda vez que se pide, así que llamarlo de más acá no repite la
 * descarga ni hace nada de más.
 */
function importarLibreria() {
  return import('dom-to-image-more')
}

let cargaLibreria: ReturnType<typeof importarLibreria> | undefined

function cargarLibreria() {
  cargaLibreria ??= importarLibreria()
  return cargaLibreria
}

export function precargarLibreriaDeImagen() {
  void cargarLibreria()
}

/** true solo en celular/tablet de verdad — no alcanza con que el navegador tenga la Web Share
 * API con soporte de archivos, porque Windows también la tiene y ahí no es lo que se necesita
 * (ver el comentario donde se usa, más abajo). */
function esMovilDeVerdad(): boolean {
  return /Android|iPhone|iPad|iPod|Mobi/i.test(navigator.userAgent)
}

/**
 * Todo lo que hace falta para llegar a un PNG del elemento: cargar la librería, armar el clon de
 * ancho fijo, esperar a que esté listo y dibujarlo — usado tanto por descargarElementoComoImagen
 * (que entrega ese PNG tal cual) como por descargarElementoComoPDF (que lo mete dentro de un PDF).
 * Devuelve también el ancho/alto CSS del clon (NO el tamaño en píxeles reales de la imagen, que
 * depende del pixelRatio) — descargarElementoComoPDF los necesita para que el informe quede con
 * las proporciones correctas dentro de la página del PDF.
 *
 * alProgresar (opcional): se llama en cada paso del proceso con un texto corto describiéndolo —
 * ReporteDiarioLote.tsx / ReporteSemanalAsociado.tsx lo usan para mostrar, en el propio botón, en
 * cuál paso va en vez de un genérico "Generando…" fijo. Esto no arregla nada por sí solo, pero si
 * alguna vez el proceso se vuelve a quedar pegado, el último paso que alcanzó a mostrarse dice
 * exactamente EN CUÁL de los pasos se atoró (cargando la librería, esperando fuentes/imágenes,
 * dibujando, o guardando) — información que antes no había forma de ver sin abrir las
 * herramientas de desarrollador del navegador.
 */
async function capturarComoPNG(
  elemento: HTMLElement,
  alProgresar?: (mensaje: string) => void,
): Promise<{ blob: Blob; ancho: number; alto: number }> {
  alProgresar?.('Cargando…')
  const { default: domtoimage } = await cargarLibreria()

  alProgresar?.('Preparando…')
  const { clon, contenedor } = crearClonAnchoFijo(elemento)

  try {
    return await conLimiteDeTiempo(
      (async () => {
        alProgresar?.('Esperando fuentes e imágenes…')
        await esperarListoParaCapturar(clon)

        const ancho = clon.getBoundingClientRect().width || ANCHO_CAPTURA
        const alto = clon.scrollHeight || clon.getBoundingClientRect().height || 800

        alProgresar?.('Dibujando imagen…')
        const blob = await domtoimage.toBlob(clon, {
          bgcolor: '#ffffff',
          pixelRatio: calcularNitidez(ancho, alto),
          cacheBust: true,
          // Esta app no usa ninguna fuente web propia (@font-face) — solo la fuente del sistema
          // que ya trae Tailwind por defecto (ver src/index.css) — así que no hay nada que
          // "incrustar" aquí. Dejarlo activado (el valor por defecto) hace que la librería igual
          // revise TODAS las hojas de estilo de la app buscando fuentes que nunca va a encontrar,
          // un paso de más que no cambia el resultado en nada y es un lugar más donde algo se
          // podría quedar pegado. httpTimeout más corto (por defecto son 30s) por la misma razón:
          // todo lo que la imagen necesita (el logo de Cercafe) ya viene incluido en la misma app,
          // no hay ningún motivo para que tarde tanto en confirmar que sí se puede cargar.
          disableEmbedFonts: true,
          httpTimeout: 8000,
        })
        return { blob, ancho, alto }
      })(),
      LIMITE_TIEMPO_MS,
      'La generación tardó demasiado y se canceló. Vuelve a intentarlo.',
    )
  } finally {
    document.body.removeChild(contenedor)
  }
}

/**
 * Qué método se usó al final para entregar el archivo, y por qué — ReporteDiarioLote.tsx /
 * ReporteSemanalAsociado.tsx lo muestran como un aviso chiquito solo cuando NO se pudo compartir
 * directo, temporalmente, mientras se termina de diagnosticar por qué en algunos celulares
 * (reportado primero en un iPhone) el PDF no se comparte directo a WhatsApp sino que cae al
 * método de descarga — que es justo el que hace que WhatsApp reciba también un enlace "blob:..."
 * de más (ver el comentario grande más abajo, donde se usa). Con este aviso visible, la próxima
 * vez que pase se puede ver ahí mismo el motivo exacto en vez de tener que adivinar.
 */
export type ResultadoCompartir = { metodo: 'compartir' | 'descarga'; razonRespaldo?: string }

/**
 * Comparte (en el celular) o descarga (en computador) un archivo ya generado — el mismo paso
 * final que necesitan tanto la imagen PNG como el PDF, así que vive en un solo lugar en vez de
 * repetirse en las dos funciones de abajo.
 */
async function compartirOGuardarArchivo(
  archivo: File,
  alProgresar?: (mensaje: string) => void,
): Promise<ResultadoCompartir> {
  alProgresar?.('Guardando…')

  // esMovilDeVerdad(): Windows (Edge/Chrome) también sabe responder navigator.canShare() con
  // archivos que sí — no es solo cosa de celular como se pensaba al escribir esto la primera vez.
  // Sin este chequeo, en computador se abría el panel nativo de "Compartir" de Windows (pensado
  // para enviar a otro dispositivo o app) en vez de simplemente guardar el archivo — algo que no
  // se parece en nada al botón que la persona espera, y que si no se completa (o se completa
  // eligiendo algo que no guarda nada localmente) se sentía exactamente como "hace el intento
  // pero no descarga nada". En computador YA funciona bien el <a download> de abajo (funcionaba
  // desde antes de agregar esto), así que la Web Share API se reserva para cuando de verdad hace
  // falta: un celular, donde <a download> sí se ignora.
  //
  // Antes esto se llamaba solo si navigator.canShare({ files: [archivo] }) primero decía que sí
  // se podía — pero con el PDF (a diferencia de la imagen PNG, que sí funcionaba bien así) eso
  // hacía que en iPhone canShare() devolviera que NO para el PDF, cayera al método de "descarga"
  // de abajo, y como Safari no respeta el download de un blob: para un PDF (en vez de descargarlo
  // lo ABRE en su propio visor), la persona terminaba compartiéndolo desde el botón de "Compartir"
  // DEL VISOR de Safari en vez del de esta app — y ese visor sí manda, de su cosecha, un enlace
  // "blob:..." de más junto con el archivo (un enlace que además no le sirve a quien lo reciba:
  // solo es válido dentro de ese celular en ese momento). La solución es no confiar en la
  // respuesta de canShare() e intentar directo compartir con navigator.share() — si de verdad no
  // se puede, share() por sí solo ya avisa con un error, que se atrapa aquí abajo igual.
  let razonRespaldo: string | undefined
  if (esMovilDeVerdad() && typeof navigator.share === 'function') {
    try {
      await navigator.share({ files: [archivo] })
      return { metodo: 'compartir' }
    } catch (err) {
      // El usuario cerró la hoja de "Compartir" sin elegir nada — no es un error real, no hay
      // nada más que hacer (a diferencia de cualquier otro problema, que sí cae al método de
      // descarga directa de abajo como respaldo).
      if (err instanceof Error && err.name === 'AbortError') return { metodo: 'compartir' }
      razonRespaldo = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    }
  }

  const url = URL.createObjectURL(archivo)
  const enlace = document.createElement('a')
  enlace.download = archivo.name
  enlace.href = url
  // El <a> se agrega al documento (aunque sea invisible) antes del clic, y se quita apenas
  // después: en varios navegadores, un clic hecho por código sobre un <a> que nunca estuvo metido
  // en la página no dispara la descarga de forma confiable — necesita estar "montado" para que
  // cuente igual que un clic real.
  document.body.appendChild(enlace)
  enlace.click()
  document.body.removeChild(enlace)
  // revokeObjectURL() se demora a propósito en vez de llamarse ya mismo: el navegador lee el
  // contenido del blob: URL en segundo plano, DESPUÉS de que el clic ya retornó — revocarlo de
  // inmediato (como se hacía antes, en un finally justo después del clic) podía ganarle esa
  // carrera y dejar al navegador leyendo un blob: URL que ya no apunta a nada, y ahí la descarga
  // se cae en silencio. Con este margen le da tiempo de sobra a que ya haya alcanzado a leerlo.
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  return { metodo: 'descarga', razonRespaldo }
}

export async function descargarElementoComoImagen(
  elemento: HTMLElement,
  nombreArchivo: string,
  alProgresar?: (mensaje: string) => void,
): Promise<ResultadoCompartir> {
  const { blob } = await capturarComoPNG(elemento, alProgresar)
  const archivo = new File([blob], nombreArchivo, { type: 'image/png' })
  return compartirOGuardarArchivo(archivo, alProgresar)
}

/** Cuántos puntos (1/72 de pulgada) de margen se dejan libres alrededor del contenido en cada
 * página del PDF — para que no quede pegado al borde. */
const MARGEN_PDF_PT = 24

/** Cuántas páginas como máximo puede tener el PDF generado — un tope de seguridad para nunca
 * generar un PDF descontrolado si algo saliera mal calculando el alto del informe (mismo espíritu
 * que AREA_MAXIMA_PX más arriba). Un informe semanal normal no debería pasar de unas pocas
 * páginas. */
const MAXIMO_PAGINAS_PDF = 40

/** Calidad del JPEG (0 a 1) con el que se mete el informe dentro del PDF — ver el comentario de
 * convertirAJPEG() sobre por qué es imprescindible convertir a JPEG antes, y no meter el PNG tal
 * cual. 0.85 es un punto medio de sobra para texto y tablas: se nota MUCHO menos que la
 * diferencia de peso del archivo. */
const CALIDAD_JPEG_PDF = 0.85

/**
 * Convierte el PNG ya capturado a JPEG antes de meterlo en el PDF. Esto no es una optimización
 * menor: se probó primero metiendo el PNG directo (con jsPDF addImage(..., 'PNG', ...)) y el PDF
 * de un informe semanal normal salía pesando DECENAS DE MEGABYTES — jsPDF, con imágenes PNG, las
 * guarda adentro del PDF como mapa de bits SIN comprimir (cada píxel tal cual, sin aprovechar que
 * la imagen es en su mayoría fondo blanco), así que el peso final termina siendo básicamente
 * ancho × alto × 3 bytes por píxel. Con JPEG en cambio jsPDF sí aprovecha la compresión que ya
 * trae el propio archivo JPEG y lo mete casi tal cual — un informe de prueba de varias páginas
 * pasó de más de 40 MB a apenas un poco más de 100 KB. Un PDF de decenas de MB, además de lento
 * de generar en un celular, se puede quedar pegado o fallar al intentar compartirlo por WhatsApp.
 * JPEG no admite fondos transparentes, pero el informe siempre se captura sobre fondo blanco
 * (bgcolor: '#ffffff' en capturarComoPNG), así que no hay nada que se pierda visualmente.
 */
async function convertirAJPEG(blobPNG: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blobPNG)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('El navegador no pudo preparar el PDF (canvas no disponible).')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0)
    return canvas.toDataURL('image/jpeg', CALIDAD_JPEG_PDF)
  } finally {
    bitmap.close()
  }
}

/**
 * Arma un PDF tamaño carta con la imagen ya capturada, repartida en tantas páginas como haga
 * falta — jsPDF no reparte solo una imagen alta en varias páginas, así que se dibuja la MISMA
 * imagen completa una vez por página, corriéndola hacia arriba cada vez (posicionY más negativo)
 * para que cada página muestre el siguiente pedazo; lo que queda fuera del alto de esa página
 * simplemente no se ve, igual que si se hubiera recortado. El alias ('informe') le permite a
 * jsPDF reconocer que es la MISMA imagen en cada página, en vez de tratarla como una distinta
 * cada vez.
 */
async function crearPDFDesdeImagen(blob: Blob, anchoCSS: number, altoCSS: number): Promise<Blob> {
  const dataUrlJPEG = await convertirAJPEG(blob)

  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const anchoPagina = pdf.internal.pageSize.getWidth() - MARGEN_PDF_PT * 2
  const altoPagina = pdf.internal.pageSize.getHeight() - MARGEN_PDF_PT * 2
  const altoImagen = (altoCSS / anchoCSS) * anchoPagina
  const ALIAS_IMAGEN = 'informe'

  let posicionY = MARGEN_PDF_PT
  let paginas = 1
  pdf.addImage(dataUrlJPEG, 'JPEG', MARGEN_PDF_PT, posicionY, anchoPagina, altoImagen, ALIAS_IMAGEN)

  let restante = altoImagen - altoPagina
  while (restante > 1 && paginas < MAXIMO_PAGINAS_PDF) {
    posicionY -= altoPagina
    pdf.addPage()
    pdf.addImage(dataUrlJPEG, 'JPEG', MARGEN_PDF_PT, posicionY, anchoPagina, altoImagen, ALIAS_IMAGEN)
    restante -= altoPagina
    paginas += 1
  }

  return pdf.output('blob')
}

export async function descargarElementoComoPDF(
  elemento: HTMLElement,
  nombreArchivo: string,
  alProgresar?: (mensaje: string) => void,
): Promise<ResultadoCompartir> {
  const { blob, ancho, alto } = await capturarComoPNG(elemento, alProgresar)
  alProgresar?.('Armando PDF…')
  const pdfBlob = await crearPDFDesdeImagen(blob, ancho, alto)
  const archivo = new File([pdfBlob], nombreArchivo, { type: 'application/pdf' })
  return compartirOGuardarArchivo(archivo, alProgresar)
}
