/**
 * Generador mínimo de archivos Excel (.xlsx) — agregado 2026-10-09 para "Descargar Excel" del
 * "Resumen por lote" (src/features/reportes/ResumenPorLote.tsx), a pedido de Nathalia (antes
 * descargaba un CSV).
 *
 * Se escribió a mano, sin librería, A PROPÓSITO: el proyecto se edita solo desde la web de GitHub,
 * y sumar una dependencia (exceljs, xlsx…) obliga a regenerar package.json y package-lock.json a la
 * vez, con riesgo de que `npm ci` falle en el despliegue. Un .xlsx es un ZIP con unos cuantos XML;
 * aquí se arma el ZIP sin comprimir ("stored", válido para Excel) y los XML mínimos. Soporta lo que
 * hace falta: varias hojas, encabezado con color, columnas con ancho, panel inmovilizado, filtro,
 * fechas reales, texto, números y una fila de totales con fórmulas SUM (con su valor ya calculado,
 * para que también se vea bien en visores que no recalculan).
 */

export type Celda = string | number | { fecha: string } | null | undefined

export type HojaExcel = {
  /** Máximo 31 caracteres, sin : \ / ? * [ ] (se limpian solos). */
  nombre: string
  columnas: Array<{ titulo: string; ancho: number }>
  filas: Celda[][]
  /** Índices (desde 0) de columnas numéricas que llevan una fila final "Total" con fórmula SUM. */
  sumar?: number[]
}

const ENCODER = new TextEncoder()

function escaparXml(texto: string): string {
  return (
    texto
      // Caracteres de control que XML no admite.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  )
}

function letraColumna(indice: number): string {
  let n = indice
  let letra = ''
  while (n >= 0) {
    letra = String.fromCharCode(65 + (n % 26)) + letra
    n = Math.floor(n / 26) - 1
  }
  return letra
}

/** Días desde 1899-12-30 (el "cero" de Excel) para una fecha "YYYY-MM-DD". */
function numeroDeSerieExcel(fechaISO: string): number | undefined {
  const [anio, mes, dia] = fechaISO.slice(0, 10).split('-').map(Number)
  if (!anio || !mes || !dia) return undefined
  return Math.round((Date.UTC(anio, mes - 1, dia) - Date.UTC(1899, 11, 30)) / 86400000)
}

// Estilos (índices de cellXfs en styles.xml): 0 normal · 1 encabezado · 2 fecha · 3 fila de totales.
const ESTILO_ENCABEZADO = 1
const ESTILO_FECHA = 2
const ESTILO_TOTAL = 3

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F3864"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function celdaXml(referencia: string, celda: Celda): string {
  if (celda === null || celda === undefined || celda === '') return ''
  if (typeof celda === 'number') return `<c r="${referencia}"><v>${Number.isFinite(celda) ? celda : 0}</v></c>`
  if (typeof celda === 'object') {
    const serie = numeroDeSerieExcel(celda.fecha)
    return serie === undefined
      ? `<c r="${referencia}" t="inlineStr"><is><t>${escaparXml(celda.fecha)}</t></is></c>`
      : `<c r="${referencia}" s="${ESTILO_FECHA}"><v>${serie}</v></c>`
  }
  return `<c r="${referencia}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(celda)}</t></is></c>`
}

function hojaXml(hoja: HojaExcel): string {
  const ultimaColumna = letraColumna(hoja.columnas.length - 1)
  const filasXml: string[] = []

  filasXml.push(
    `<row r="1" ht="32" customHeight="1">` +
      hoja.columnas
        .map(
          (c, i) =>
            `<c r="${letraColumna(i)}1" s="${ESTILO_ENCABEZADO}" t="inlineStr"><is><t>${escaparXml(c.titulo)}</t></is></c>`,
        )
        .join('') +
      `</row>`,
  )

  hoja.filas.forEach((fila, f) => {
    const numeroFila = f + 2
    filasXml.push(
      `<row r="${numeroFila}">${fila.map((celda, c) => celdaXml(`${letraColumna(c)}${numeroFila}`, celda)).join('')}</row>`,
    )
  })

  if (hoja.sumar && hoja.sumar.length > 0 && hoja.filas.length > 0) {
    const numeroFila = hoja.filas.length + 2
    const primera = 2
    const ultima = hoja.filas.length + 1
    const celdas = hoja.columnas.map((_, c) => {
      const ref = `${letraColumna(c)}${numeroFila}`
      if (c === 0) return `<c r="${ref}" s="${ESTILO_TOTAL}" t="inlineStr"><is><t>TOTAL</t></is></c>`
      if (hoja.sumar?.includes(c)) {
        const valor = hoja.filas.reduce((acc, fila) => {
          const v = fila[c]
          return acc + (typeof v === 'number' ? v : 0)
        }, 0)
        const col = letraColumna(c)
        return `<c r="${ref}" s="${ESTILO_TOTAL}"><f>SUM(${col}${primera}:${col}${ultima})</f><v>${valor}</v></c>`
      }
      return `<c r="${ref}" s="${ESTILO_TOTAL}"/>`
    })
    filasXml.push(`<row r="${numeroFila}">${celdas.join('')}</row>`)
  }

  const ultimaFilaDatos = Math.max(hoja.filas.length + 1, 1)
  const columnasXml = hoja.columnas
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"/>`)
    .join('')

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${columnasXml}</cols>` +
    `<sheetData>${filasXml.join('')}</sheetData>` +
    `<autoFilter ref="A1:${ultimaColumna}${ultimaFilaDatos}"/>` +
    `</worksheet>`
  )
}

// ---------------------------------------------------------------------------
// ZIP sin compresión ("stored")
// ---------------------------------------------------------------------------

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c >>> 0
  }
  return tabla
})()

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < datos.length; i++) c = (TABLA_CRC[(c ^ (datos[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function armarZip(archivos: Array<{ nombre: string; contenido: string }>): Uint8Array {
  const partes: Uint8Array[] = []
  const directorio: Uint8Array[] = []
  let desplazamiento = 0
  // Fecha/hora fija (1980-01-01 00:00): no importa para Excel y deja el archivo reproducible.
  const FECHA_DOS = 0x0021
  const HORA_DOS = 0

  for (const archivo of archivos) {
    const nombre = ENCODER.encode(archivo.nombre)
    const datos = ENCODER.encode(archivo.contenido)
    const crc = crc32(datos)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // versión mínima
    local.setUint16(6, 0x0800, true) // nombres en UTF-8
    local.setUint16(8, 0, true) // método 0 = sin comprimir
    local.setUint16(10, HORA_DOS, true)
    local.setUint16(12, FECHA_DOS, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, datos.length, true)
    local.setUint32(22, datos.length, true)
    local.setUint16(26, nombre.length, true)
    local.setUint16(28, 0, true)
    partes.push(new Uint8Array(local.buffer), nombre, datos)

    const central = new DataView(new ArrayBuffer(46))
    central.setUint32(0, 0x02014b50, true)
    central.setUint16(4, 20, true)
    central.setUint16(6, 20, true)
    central.setUint16(8, 0x0800, true)
    central.setUint16(10, 0, true)
    central.setUint16(12, HORA_DOS, true)
    central.setUint16(14, FECHA_DOS, true)
    central.setUint32(16, crc, true)
    central.setUint32(20, datos.length, true)
    central.setUint32(24, datos.length, true)
    central.setUint16(28, nombre.length, true)
    central.setUint32(42, desplazamiento, true)
    directorio.push(new Uint8Array(central.buffer), nombre)

    desplazamiento += 30 + nombre.length + datos.length
  }

  const tamanoDirectorio = directorio.reduce((suma, p) => suma + p.length, 0)
  const fin = new DataView(new ArrayBuffer(22))
  fin.setUint32(0, 0x06054b50, true)
  fin.setUint16(8, archivos.length, true)
  fin.setUint16(10, archivos.length, true)
  fin.setUint32(12, tamanoDirectorio, true)
  fin.setUint32(16, desplazamiento, true)

  const todas = [...partes, ...directorio, new Uint8Array(fin.buffer)]
  const salida = new Uint8Array(todas.reduce((suma, p) => suma + p.length, 0))
  let posicion = 0
  for (const p of todas) {
    salida.set(p, posicion)
    posicion += p.length
  }
  return salida
}

/** Arma el libro de Excel (.xlsx) con las hojas dadas y lo devuelve como Blob listo para descargar. */
export function crearExcel(hojas: HojaExcel[]): Blob {
  const nombres = hojas.map((h, i) => {
    const limpio = h.nombre.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31)
    return limpio || `Hoja${i + 1}`
  })

  const archivos: Array<{ nombre: string; contenido: string }> = [
    {
      nombre: '[Content_Types].xml',
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        hojas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        `</Types>`,
    },
    {
      nombre: '_rels/.rels',
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      nombre: 'xl/workbook.xml',
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets>${nombres.map((n, i) => `<sheet name="${escaparXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        `</workbook>`,
    },
    {
      nombre: 'xl/_rels/workbook.xml.rels',
      contenido:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        hojas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    { nombre: 'xl/styles.xml', contenido: STYLES_XML },
    ...hojas.map((h, i) => ({ nombre: `xl/worksheets/sheet${i + 1}.xml`, contenido: hojaXml(h) })),
  ]

  return new Blob([armarZip(archivos) as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}
