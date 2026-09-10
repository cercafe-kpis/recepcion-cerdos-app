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
 * Un "bloque protegido" es cualquier elemento del reporte marcado con el atributo
 * `data-pdf-bloque` (ver ReporteSemanalAsociado.tsx) — una tarjeta, una fila de tabla, un ítem del
 * glosario — que nunca debería quedar partido a la mitad entre dos páginas del PDF. Se mide DESPUÉS
 * de que el clon ya está listo para capturarse (mismo momento en que se miden ancho/alto), tomando
 * la posición de cada bloque relativa al borde superior del clon — así crearPDFDesdeImagen() puede
 * calcular en qué alturas cortar cada página sin partir ninguno de estos bloques (ver
 * calcularCortesDePagina()).
 */
function medirBloquesProtegidos(clon: HTMLElement): { top: number; bottom: number }[] {
  const topClon = clon.getBoundingClientRect().top
  return Array.from(clon.querySelectorAll<HTMLElement>('[data-pdf-bloque]')).map((el) => {
    const rect = el.getBoundingClientRect()
    return { top: rect.top - topClon, bottom: rect.bottom - topClon }
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
): Promise<{ blob: Blob; ancho: number; alto: number; bloquesProtegidos: { top: number; bottom: number }[] }> {
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
        const bloquesProtegidos = medirBloquesProtegidos(clon)

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
        return { blob, ancho, alto, bloquesProtegidos }
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
 *
 * Exportada (antes era una función interna nada más) porque ReporteDiarioLote.tsx /
 * ReporteSemanalAsociado.tsx ahora la llaman DIRECTO para el PDF, en su propio botón "Compartir
 * PDF" separado de "Generar PDF" — ver el comentario grande en generarArchivoPDF() más abajo sobre
 * por qué armar el PDF y compartirlo ya no pueden ir en el mismo clic.
 */
export async function compartirOGuardarArchivo(
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
      // *** Aviso TEMPORAL de diagnóstico — quitar este alert() cuando ya no haga falta ***
      // El cuadro amarillo (ver ResultadoCompartir) no servía para nada en la práctica: apenas
      // navigator.share() falla, las líneas de abajo abren el PDF en el visor de Safari (porque
      // Safari no respeta el download de un blob: para un PDF), y esa navegación se comía el aviso
      // antes de que se alcanzara a ver — pasara en la misma pestaña o en una nueva. alert() en
      // cambio DETIENE todo lo que sigue hasta que la persona toque "Aceptar" — como se llama
      // ANTES de esas líneas, el aviso se alcanza a leer siempre, sin importar qué pase después.
      window.alert(`[Diagnóstico temporal] No se pudo compartir directo.\n\n${razonRespaldo}`)
    }
  }

  const url = URL.createObjectURL(archivo)
  const enlace = document.createElement('a')
  enlace.download = archivo.name
  enlace.href = url
  // target="_blank" (con rel="noopener noreferrer" por seguridad, para que esa pestaña nueva no
  // pueda tocar esta): con las capturas que mandó Nathalia se pudo ver POR FIN qué pasa de verdad
  // en su iPhone cuando el PDF cae a este método de respaldo — Safari, como no respeta el
  // download de un blob: para un PDF, en vez de descargarlo NAVEGA la pestaña actual para
  // mostrarlo en su propio visor. Eso significa que la pestaña donde vive esta app (React y todo)
  // se reemplaza por el PDF antes de que alcance a pintarse el aviso de diagnóstico (ver
  // ResultadoCompartir) — por eso nunca se veía el cuadro amarillo, aunque sí se estaba
  // calculando bien. Con target="_blank" esa navegación ocurre en una pestaña NUEVA, dejando esta
  // pestaña (con la app y el aviso) intacta — así si esto se vuelve a activar, el diagnóstico por
  // fin se va a poder ver y copiar.
  enlace.target = '_blank'
  enlace.rel = 'noopener noreferrer'
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
 * recortarComoJPEG() sobre por qué es imprescindible convertir a JPEG antes, y no meter el PNG tal
 * cual. 0.85 es un punto medio de sobra para texto y tablas: se nota MUCHO menos que la
 * diferencia de peso del archivo. */
const CALIDAD_JPEG_PDF = 0.85

/**
 * Recorta del bitmap ya capturado solo la franja vertical [offsetPx, offsetPx + altoPx) — la
 * porción que le toca a UNA página del PDF — y la entrega como JPEG. Se recorta a JPEG (no PNG) por
 * la misma razón de siempre (ver el comentario que tenía convertirAJPEG(), la función que hacía
 * esto mismo pero para la imagen COMPLETA antes de la corrección del 2026-09-10 de más abajo): jsPDF
 * guarda un PNG sin comprimir dentro del PDF, y un informe de varias páginas se iba a decenas de MB
 * en vez de apenas unos KB.
 */
function recortarComoJPEG(bitmap: ImageBitmap, offsetPx: number, altoPx: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = altoPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no pudo preparar el PDF (canvas no disponible).')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // drawImage con un desplazamiento vertical negativo: dibuja el bitmap ENTERO pero corrido hacia
  // arriba offsetPx, así que dentro de este canvas (más bajo que el bitmap completo) solo queda
  // visible la franja que va de offsetPx a offsetPx+altoPx — el resto cae fuera del canvas y se
  // descarta, ni siquiera se dibuja.
  ctx.drawImage(bitmap, 0, -offsetPx)
  return canvas.toDataURL('image/jpeg', CALIDAD_JPEG_PDF)
}

/**
 * Calcula en qué alturas (dentro del alto total del informe, en la misma unidad que `altoPorPagina`
 * y que `bloques` — puede ser píxeles CSS, puntos de PDF, o cualquier otra, mientras las tres
 * vengan en la misma) debe empezar cada página — a pedido de Nathalia ("el reporte queda cortado al
 * pasar a la segunda hoja"): antes cada página empezaba siempre exactamente `altoPorPagina` después
 * de la anterior, sin importar QUÉ hubiera justo en ese punto de corte, así que una tarjeta o una
 * fila de tabla que cayera a caballo entre dos páginas quedaba partida a la mitad (una mitad al
 * final de una página, la otra mitad al principio de la siguiente).
 *
 * Ahora, si el corte "natural" (cursor + altoPorPagina) caería adentro de uno de los `bloques`
 * protegidos (medidos por medirBloquesProtegidos() a partir de los elementos con
 * data-pdf-bloque — ver ReporteSemanalAsociado.tsx), el corte se adelanta hasta el borde de
 * ARRIBA de ese bloque en vez de partirlo: la página anterior termina con un poco de espacio en
 * blanco de más, pero nada queda cortado a la mitad. `bloques` debe venir ordenado por `top`.
 *
 * Si un bloque protegido es más alto que una página entera completa (no debería pasar con el
 * contenido actual de los informes, pero por seguridad), no hay forma de evitar cortarlo sin dejar
 * páginas casi en blanco de por vida — en ese caso se usa el corte normal en vez de quedarse sin
 * avanzar nunca.
 */
function calcularCortesDePagina(
  altoTotal: number,
  altoPorPagina: number,
  bloques: { top: number; bottom: number }[],
): number[] {
  const cortes = [0]
  let cursor = 0
  while (altoTotal - cursor > altoPorPagina + 1 && cortes.length < MAXIMO_PAGINAS_PDF) {
    let corte = cursor + altoPorPagina
    const bloqueQueParte = bloques.find((b) => b.top > cursor + 0.5 && b.top < corte - 0.5 && b.bottom > corte + 0.5)
    if (bloqueQueParte && bloqueQueParte.bottom - bloqueQueParte.top < altoPorPagina) {
      corte = bloqueQueParte.top
    }
    cortes.push(corte)
    cursor = corte
  }
  return cortes
}

/**
 * Arma un PDF tamaño carta con la imagen ya capturada, repartida en tantas páginas como haga falta.
 *
 * **Corrección 2026-09-10 — por qué esto ya NO dibuja la misma imagen completa en cada página**:
 * la primera versión de esta función (la que Nathalia probó y seguía viendo cortada) dibujaba la
 * imagen COMPLETA en cada página, corriéndola hacia arriba cada vez — eso funciona bien cuando
 * todas las páginas miden exactamente lo mismo (`altoPorPagina` cada una, sin excepción), porque
 * entonces se acomodan en fila sin dejar huecos ni encimarse. Pero calcularCortesDePagina() a veces
 * necesita que UNA página termine ANTES de su alto normal (para no partir un bloque protegido) — y
 * como cada página seguía dibujando la imagen completa (siempre `altoPorPagina` de alto, sin
 * importar dónde empezara la SIGUIENTE), adelantar el inicio de la página siguiente no hacía que la
 * anterior "terminara antes": las dos terminaban mostrando el mismo pedazo de imagen, uno encima del
 * otro — por eso el encabezado "Definiciones" aparecía completo al final de una página Y OTRA VEZ
 * completo al principio de la siguiente, en vez de aparecer una sola vez.
 *
 * La corrección de fondo: en vez de reusar la imagen completa, se recorta un JPEG DISTINTO por cada
 * página (recortarComoJPEG()), del alto exacto que le toca a esa página según calcularCortesDePagina()
 * — así cada página muestra un pedazo AJENO al de las demás, sin superposición posible, y una página
 * que termina antes de tiempo simplemente muestra menos alto (el resto de la página queda en blanco)
 * en vez de seguir mostrando lo mismo que la siguiente.
 */
async function crearPDFDesdeImagen(
  blob: Blob,
  anchoCSS: number,
  altoCSS: number,
  bloquesProtegidosCSS: { top: number; bottom: number }[],
): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const anchoPagina = pdf.internal.pageSize.getWidth() - MARGEN_PDF_PT * 2
  const altoPaginaPt = pdf.internal.pageSize.getHeight() - MARGEN_PDF_PT * 2

  // factorPt: cuántos puntos de PDF equivale cada píxel CSS del clon capturado — se trabaja todo el
  // cálculo de cortes en píxeles CSS (la misma unidad en la que ya vienen medidos los bloques
  // protegidos) y solo se convierte a puntos de PDF al final, para dibujar.
  const factorPt = anchoPagina / anchoCSS
  const altoPaginaCSS = altoPaginaPt / factorPt
  const bloques = [...bloquesProtegidosCSS].sort((a, b) => a.top - b.top)
  const cortesCSS = calcularCortesDePagina(altoCSS, altoPaginaCSS, bloques)

  const bitmap = await createImageBitmap(blob)
  try {
    // píxeles reales de la imagen capturada por cada píxel CSS del clon — depende de la nitidez
    // (pixelRatio) con la que se dibujó en capturarComoPNG(), pero no hace falta conocer ese valor
    // aparte: se obtiene directo del propio bitmap ya capturado.
    const pixelesPorCSSpx = bitmap.height / altoCSS

    for (let indice = 0; indice < cortesCSS.length; indice++) {
      const inicioCSS = cortesCSS[indice]
      const esUltima = indice + 1 === cortesCSS.length
      const finCSS = esUltima ? altoCSS : cortesCSS[indice + 1]

      const inicioPx = Math.round(inicioCSS * pixelesPorCSSpx)
      const finPx = esUltima ? bitmap.height : Math.round(finCSS * pixelesPorCSSpx)
      const altoSlicePx = Math.max(1, finPx - inicioPx)
      const altoSlicePt = (finCSS - inicioCSS) * factorPt

      const dataUrlSlice = recortarComoJPEG(bitmap, inicioPx, altoSlicePx)

      if (indice > 0) pdf.addPage()
      pdf.addImage(dataUrlSlice, 'JPEG', MARGEN_PDF_PT, MARGEN_PDF_PT, anchoPagina, altoSlicePt)
    }
  } finally {
    bitmap.close()
  }

  return pdf.output('blob')
}

/**
 * Arma el PDF y devuelve el archivo YA LISTO — sin compartirlo ni descargarlo todavía (eso lo hace
 * compartirOGuardarArchivo, en un paso APARTE — ver el botón "Compartir / Descargar PDF" en
 * ReporteDiarioLote.tsx / ReporteSemanalAsociado.tsx, que solo aparece una vez este archivo ya está
 * listo). Antes las dos cosas iban juntas en una sola función (descargarElementoComoPDF) llamada
 * de un solo clic — y ESO, según lo que se pudo confirmar con las pruebas de Nathalia en su
 * iPhone, era la causa real de que el PDF (a diferencia de la imagen PNG) nunca se compartiera
 * directo: armar el PDF (capturar + convertir a JPEG + montar las páginas con jsPDF) tarda bastante
 * más que capturar la imagen sola, y Safari en iPhone exige que navigator.share() se llame MUY
 * cerca del toque de la persona en el botón — si pasa demasiado tiempo de por medio (así sea todo
 * async, sin que la persona haga nada más), Safari deja de reconocer que el toque original todavía
 * "cuenta", y share() falla en silencio (sin avisar nada raro, solo cae al método de respaldo, que
 * es el que termina soltando el enlace "blob:..." de más en WhatsApp). Separando "armar" (que sí
 * puede tardar) de "compartir" (que ahora se llama de INMEDIATO en el clic siguiente, sin ningún
 * await de por medio antes de navigator.share) cada toque de "Compartir / Descargar PDF" cuenta
 * como un gesto nuevo y directo, así el PDF ya esté armado desde antes.
 */
export async function generarArchivoPDF(
  elemento: HTMLElement,
  nombreArchivo: string,
  alProgresar?: (mensaje: string) => void,
): Promise<File> {
  const { blob, ancho, alto, bloquesProtegidos } = await capturarComoPNG(elemento, alProgresar)
  alProgresar?.('Armando PDF…')
  const pdfBlob = await crearPDFDesdeImagen(blob, ancho, alto, bloquesProtegidos)
  return new File([pdfBlob], nombreArchivo, { type: 'application/pdf' })
}
