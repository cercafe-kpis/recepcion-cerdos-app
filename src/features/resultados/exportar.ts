import { enIframe } from '../../auth/msal'
import { showToast } from '../../ui/avisos'

/**
 * Reportes de Resultados (PDF y Excel) con el logo de Cercafe.
 *
 * Antes el PDF usaba la impresión del navegador (window.print), que en el celular —sobre todo en la app
 * instalada en iPhone y dentro de SharePoint— no hace nada. Ahora el archivo se arma en el propio
 * navegador (html2canvas + jsPDF) y se entrega como archivo: en el celular con el menú Compartir
 * (Guardar en Archivos, WhatsApp, correo…), en el computador como descarga.
 * Las librerías se cargan solo cuando alguien exporta (no pesan en la app de captura).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Win = Window & { html2canvas?: any; jspdf?: any; ExcelJS?: any }
const W = window as Win

const VERDE = '#2d5a3d'
const cargas = new Map<string, Promise<void>>()
function cargarScript(url: string, listo: () => boolean): Promise<void> {
  if (listo()) return Promise.resolve()
  let p = cargas.get(url)
  if (!p) {
    p = new Promise<void>((res, rej) => {
      const s = document.createElement('script')
      s.src = url
      s.onload = () => res()
      s.onerror = () => { cargas.delete(url); s.remove(); rej(new Error('No se pudo cargar el generador de reportes (¿sin conexión?)')) }
      document.head.append(s)
    })
    cargas.set(url, p)
  }
  return p
}

/** Logo blanco de Cercafe (el mismo del encabezado de la app). Se usa sobre la franja verde. */
function logoCercafe(): string | null {
  const img = document.querySelector<HTMLImageElement>('.hdr img[alt="Cercafe"]')
  return img?.src?.startsWith('data:image/png') ? img.src : null
}

const fechaHora = () => new Date().toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/* ══ Entrega del archivo ══ */

const esCelular = () => matchMedia('(pointer:coarse)').matches

function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  if (enIframe()) {
    // Dentro de SharePoint las descargas pueden estar bloqueadas: se abre en una pestaña nueva.
    window.open(url, '_blank')
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = nombre
    document.body.append(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

async function compartir(blob: Blob, nombre: string) {
  const archivo = new File([blob], nombre, { type: blob.type })
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo], title: nombre })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return // la persona cerró el menú
    }
  }
  descargar(blob, nombre)
}

/** Panel inferior: progreso mientras se arma el archivo y botón para guardarlo cuando está listo. */
function panel() {
  let el = document.getElementById('rs-listo')
  if (!el) {
    el = document.createElement('div')
    el.id = 'rs-listo'
    document.body.append(el)
  }
  return el
}
function mostrarProgreso(texto: string) {
  const el = panel()
  el.innerHTML = `<div class="rs-listo-box" style="justify-content:center"><span class="spin rs-spin"></span>${texto}</div>`
  el.hidden = false
}
function cerrarPanel() { const el = document.getElementById('rs-listo'); if (el) { el.hidden = true; el.innerHTML = '' } }

/**
 * Entrega el archivo. En el computador (fuera de SharePoint) se descarga de una vez; en el celular o dentro
 * de SharePoint se muestra un botón, porque el navegador solo deja compartir/abrir con un toque de la persona.
 */
function entregar(blob: Blob, nombre: string, tipo: string) {
  if (!esCelular() && !enIframe()) { cerrarPanel(); descargar(blob, nombre); return }
  const el = panel()
  el.innerHTML = `<div class="rs-listo-box"><div><b>${tipo} listo</b><div class="rs-muted">${nombre.replace(/[&<>"]/g, '')}</div></div>
    <div class="rs-listo-btns"><button class="rs-btn rs-btn-g" id="rs-listo-ok">${esCelular() ? 'Guardar o compartir' : 'Abrir'}</button><button class="rs-btn" id="rs-listo-x">Cerrar</button></div></div>`
  el.hidden = false
  document.getElementById('rs-listo-ok')!.onclick = () => { esCelular() ? compartir(blob, nombre) : descargar(blob, nombre) }
  document.getElementById('rs-listo-x')!.onclick = cerrarPanel
}

/* ══ PDF ══ */

/** Las gráficas usan colores de la app (variables CSS); se fijan en cada figura para que salgan en el PDF. */
function fijarColoresSVG(raiz: HTMLElement) {
  raiz.querySelectorAll<SVGSVGElement>('svg').forEach((svg) => {
    const r = svg.getBoundingClientRect()
    svg.setAttribute('width', String(Math.round(r.width)))
    svg.setAttribute('height', String(Math.round(r.height)))
    svg.querySelectorAll<SVGElement>('*').forEach((el) => {
      const cs = getComputedStyle(el)
      if (el.hasAttribute('fill') || el.tagName === 'text') el.setAttribute('fill', cs.fill)
      if (el.hasAttribute('stroke')) el.setAttribute('stroke', cs.stroke)
      if (el.tagName === 'text') { el.setAttribute('font-family', cs.fontFamily); el.setAttribute('font-size', cs.fontSize) }
    })
  })
}

/** Puntos (en px, desde arriba del bloque) donde se puede partir un bloque alto sin cortar una fila. */
function puntosDeCorte(bloque: HTMLElement): number[] {
  const top = bloque.getBoundingClientRect().top
  const ys = new Set<number>()
  bloque.querySelectorAll('tr, .rs-alert, .rs-panel, .rs-kpi, .rs-legend').forEach((el) => ys.add(Math.round(el.getBoundingClientRect().bottom - top)))
  return [...ys].sort((a, b) => a - b)
}

/** Enlaces (por ejemplo "Hub de Servicios") de un bloque, en px desde su esquina; en el PDF quedan con clic. */
function enlaces(bloque: HTMLElement) {
  const r0 = bloque.getBoundingClientRect()
  return [...bloque.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')].map((a) => {
    const r = a.getBoundingClientRect()
    return { url: a.href, x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height }
  })
}

export async function generarPDF(opts: { contenido: HTMLElement; titulo: string; subtitulo: string; archivo: string; orientacion?: 'horizontal' | 'vertical' }) {
  const vertical = opts.orientacion === 'vertical'
  mostrarProgreso('Generando PDF…')
  const host = document.createElement('div')
  try {
    await Promise.all([
      cargarScript('https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js', () => !!W.html2canvas),
      cargarScript('https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js', () => !!W.jspdf?.jsPDF),
    ])
    // Copia de la vista con ancho de computador (así el PDF sale igual desde el celular).
    host.className = 'rs rs-pdf' + (vertical ? ' rs-pdf-v' : '')
    host.innerHTML = opts.contenido.innerHTML
    // Explicaciones plegadas y textos de "toque aquí" no van en el papel.
    host.querySelectorAll('details:not([open]), .rs-solo-pantalla').forEach((el) => el.remove())
    document.body.append(host)
    // Si alguna tabla no cabe a lo ancho, se agranda la copia (en el PDF todo se ajusta al ancho de la hoja).
    const disponible = host.clientWidth - 32
    const ancho = Math.max(...[...host.querySelectorAll<HTMLElement>('.rs-scroll > table')].map((t) => t.scrollWidth + 34), 0)
    if (ancho > disponible) host.style.width = Math.min(ancho + 32, 2200) + 'px'
    fijarColoresSVG(host)
    const bloques = [...host.children] as HTMLElement[]
    const anchoPx = host.clientWidth - 32 // .rs tiene 16 px de margen a cada lado

    const { jsPDF } = W.jspdf
    const doc = new jsPDF({ orientation: vertical ? 'portrait' : 'landscape', unit: 'mm', format: 'a4', compress: true })
    const PW = vertical ? 210 : 297, PH = vertical ? 297 : 210, M = 10, Y0 = 27, Y1 = PH - 12
    const k = (PW - 2 * M) / anchoPx // mm por px
    const logo = logoCercafe()

    const encabezado = () => {
      doc.setFillColor(VERDE)
      doc.rect(0, 0, PW, 21, 'F')
      if (logo) doc.addImage(logo, 'PNG', M, 3, 37, 15)
      const x = logo ? M + 44 : M
      doc.setTextColor('#ffffff')
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
      doc.text('SCORE PULMONAR · MÉTODO MADEC', x, 7)
      doc.setFontSize(14); doc.text(opts.titulo, x, 13.5)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5)
      doc.text(opts.subtitulo, x, 18.3)
    }
    encabezado()
    let y = Y0
    let pag = 1

    for (let i = 0; i < bloques.length; i++) {
      mostrarProgreso(`Generando PDF… ${Math.round((i / bloques.length) * 100)} %`)
      const b = bloques[i]
      const wpx = b.offsetWidth, hpx = b.offsetHeight
      if (!wpx || !hpx) continue
      const escala = Math.min(2, Math.sqrt(12e6 / (wpx * hpx)))
      const canvas: HTMLCanvasElement = await W.html2canvas(b, { scale: escala, backgroundColor: '#ffffff', windowWidth: 1280, logging: false })
      const cortes = puntosDeCorte(b)
      const links = enlaces(b)
      // Los bloques más angostos que la hoja (mapa pulmonar, categorías) quedan centrados, igual que en pantalla.
      const x0 = M + Math.max(0, b.getBoundingClientRect().left - host.getBoundingClientRect().left - 16) * k
      let desde = 0
      while (desde < hpx - 1) {
        let dispPx = (Y1 - y) / k
        if (hpx - desde > dispPx && y > Y0 + 0.1) {
          // No cabe completo en lo que queda de la hoja: si cabe en una hoja nueva, o si en lo que queda no
          // entra ni una fila, se pasa a la siguiente.
          const primerCorte = cortes.find((c) => c > desde + 20) ?? hpx
          if (hpx - desde <= (Y1 - Y0) / k || primerCorte - desde > dispPx) {
            doc.addPage(); pag++; encabezado(); y = Y0; dispPx = (Y1 - Y0) / k
          }
        }
        let hasta = hpx
        if (hpx - desde > dispPx) {
          const c = cortes.filter((c) => c > desde + 20 && c <= desde + dispPx)
          hasta = c.length ? c[c.length - 1] : desde + dispPx
        }
        const trozo = document.createElement('canvas')
        trozo.width = canvas.width
        trozo.height = Math.max(1, Math.round((hasta - desde) * (canvas.height / hpx)))
        trozo.getContext('2d')!.drawImage(canvas, 0, -Math.round(desde * (canvas.height / hpx)))
        const hmm = (hasta - desde) * k
        doc.addImage(trozo.toDataURL('image/jpeg', 0.9), 'JPEG', x0, y, wpx * k, hmm)
        links.filter((l) => l.y >= desde && l.y + l.h <= hasta).forEach((l) => doc.link(x0 + l.x * k, y + (l.y - desde) * k, l.w * k, l.h * k, { url: l.url }))
        y += hmm + 4
        desde = hasta
        if (desde < hpx - 1) { doc.addPage(); pag++; encabezado(); y = Y0 }
      }
    }

    // Pie de página en todas las hojas.
    const total = doc.getNumberOfPages()
    for (let p = 1; p <= total; p++) {
      doc.setPage(p)
      doc.setTextColor('#8a8478'); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
      doc.text(`Cercafe · Inspección pulmonar · Generado ${fechaHora()}`, M, PH - 5)
      doc.text(`Página ${p} de ${total}`, PW - M, PH - 5, { align: 'right' })
    }
    void pag
    entregar(doc.output('blob'), opts.archivo, 'PDF')
  } catch (e) {
    cerrarPanel()
    showToast('No se pudo generar el PDF: ' + (e as Error).message, 'err', 7000)
  } finally {
    host.remove()
  }
}

/* ══ Excel ══ */

export async function generarExcel(opts: {
  hoja: string; titulo: string; subtitulo: string; archivo: string
  filas: Record<string, string | number>[]
}) {
  mostrarProgreso('Generando Excel…')
  try {
    await cargarScript('https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js', () => !!W.ExcelJS)
    const wb = new W.ExcelJS.Workbook()
    wb.creator = 'Cercafe · Inspección pulmonar'
    const ws = wb.addWorksheet(opts.hoja, { views: [{ state: 'frozen', ySplit: 6, showGridLines: false }] })
    const cols = Object.keys(opts.filas[0] || { Granja: '' })
    const nCols = Math.max(cols.length, 8)
    const verde = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D5A3D' } }

    // Franja verde con el logo y el título (filas 1 a 4).
    for (let r = 1; r <= 4; r++) {
      ws.getRow(r).height = 17
      for (let c = 1; c <= nCols; c++) ws.getCell(r, c).fill = verde
    }
    const logo = logoCercafe()
    if (logo) ws.addImage(wb.addImage({ base64: logo, extension: 'png' }), { tl: { col: 0.15, row: 0.25 }, ext: { width: 148, height: 60 } })
    const blanco = (size: number, bold = false) => ({ color: { argb: 'FFFFFFFF' }, size, bold, name: 'Calibri' })
    ws.getCell(1, 3).value = 'SCORE PULMONAR · MÉTODO MADEC'; ws.getCell(1, 3).font = blanco(8, true)
    ws.getCell(2, 3).value = opts.titulo; ws.getCell(2, 3).font = blanco(15, true)
    ws.getCell(3, 3).value = opts.subtitulo; ws.getCell(3, 3).font = blanco(9)
    ws.getCell(4, 3).value = 'Generado ' + fechaHora(); ws.getCell(4, 3).font = blanco(8)

    // Tabla
    const enc = ws.getRow(6)
    cols.forEach((c, i) => {
      const cell = enc.getCell(i + 1)
      cell.value = c
      cell.font = { bold: true, color: { argb: 'FF1A1814' }, size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EFE8' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF2D5A3D' } } }
    })
    enc.height = 30
    opts.filas.forEach((f, j) => {
      const row = ws.getRow(7 + j)
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1)
        cell.value = f[c]
        if (typeof f[c] === 'number') cell.numFmt = c === 'Cerdos' ? '#,##0' : '#,##0.00'
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFD4CFC4' } } }
      })
    })
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c === 'Granja' ? 26 : c === 'Asociado' ? 24 : Math.max(11, Math.min(18, c.length + 3)) })
    if (cols.length < 3) { ws.getColumn(1).width = Math.max(ws.getColumn(1).width || 10, 12); ws.getColumn(2).width = 12 }
    if (opts.filas.length) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: cols.length } }

    const buf = await wb.xlsx.writeBuffer()
    entregar(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), opts.archivo, 'Excel')
  } catch (e) {
    cerrarPanel()
    showToast('No se pudo generar el Excel: ' + (e as Error).message, 'err', 7000)
  }
}
