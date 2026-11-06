import './resultados.css'
import { estado } from '../../state'
import { calcularAlcance, cargarDatos, codigosDeFiltro, type Alcance, type Catalogo, type Fila } from './datos'
import {
  calcularControl, columnasGranjas, graficaIndicadorLotes, MIN_CERDOS, esc, graficaControl, lecturaControl, REGLAS, explicacionCategorias, fmt, graficaCategorias, graficaLotes, mapaPulmonar, pill, spark,
  type FilaComp, type PuntoLote,
} from './graficas'
import { analisis, INDICADORES, META_CONSOL, nivelIdn, NIVEL_TXT, stats, type Stats } from './indicadores'

/**
 * Pestaña "Resultados" (antes: dashboard Score Pulmonar aparte).
 * Vistas: Resumen · Granja y consecutivos · Comparativo. Exporta a Excel y a PDF con el logo de Cercafe (ver exportar.ts).
 * Qué granjas ve cada cuenta lo decide calcularAlcance() con la lista Usuarios.
 */

type Tab = 'res' | 'gra' | 'com'
interface Filtros { asoc: string; periodo: string; desde: string; hasta: string; tab: Tab; granja: string; lote: string; ind: string; nivelTabla: 'granja' | 'lote'; orden: 'asc' | 'desc'; secciones: Seccion[] }

/**
 * Secciones del informe de "Granja y consecutivos". La persona elige cuáles ver y exportar; se muestran
 * (y salen en el PDF) en el orden en que las fue marcando: cada una nueva se agrega abajo.
 */
const SECCIONES_FIJAS = [
  { key: 'ficha', lbl: 'Datos de la granja' },
  { key: 'analisis', lbl: 'Análisis y recomendación' },
  { key: 'spc', lbl: 'Gráfico de control (SPC)' },
  { key: 'spcAyuda', lbl: 'Cómo leer el gráfico de control' },
  { key: 'mapa', lbl: 'Mapa pulmonar' },
  { key: 'categorias', lbl: 'Cerdos por categoría Madec' },
  { key: 'tabla', lbl: 'Tabla de consecutivos' },
  { key: 'cierre', lbl: 'Mensaje final (Hub de Servicios)' },
] as const
/** Cada uno de los 15 indicadores (los mismos del Comparativo) agrega su gráfica "por consecutivo": clave "ind:<indicador>". */
type Seccion = (typeof SECCIONES_FIJAS)[number]['key'] | `ind:${string}`
const SECCIONES: { key: Seccion; lbl: string; grupo: string }[] = [
  ...SECCIONES_FIJAS.map((x) => ({ ...x, grupo: 'Secciones' })),
  ...INDICADORES.map((i) => ({ key: `ind:${i.key}` as Seccion, lbl: i.lbl, grupo: 'Indicadores por consecutivo' })),
]
const SECCIONES_DEFECTO: Seccion[] = ['ficha', 'analisis', 'ind:idn', 'spc', 'mapa', 'categorias', 'tabla', 'cierre']
/** "Todas": las secciones fijas con los 15 indicadores después del análisis. */
const SECCIONES_TODAS: Seccion[] = ['ficha', 'analisis', ...INDICADORES.map((i) => `ind:${i.key}` as Seccion), 'spc', 'spcAyuda', 'mapa', 'categorias', 'tabla', 'cierre']
let seccionesAbierto = false

const KEY_FILTROS = 'insp_pulmones_resultados_filtros'
let f: Filtros = { asoc: '', periodo: '12', desde: '', hasta: '', tab: 'res', granja: '', lote: '', ind: 'idn', nivelTabla: 'granja', orden: 'asc', secciones: [...SECCIONES_DEFECTO] }
try { f = { ...f, ...JSON.parse(localStorage.getItem(KEY_FILTROS) || '{}') } } catch { /* sin filtros guardados */ }
{
  const validas = new Set<string>(SECCIONES.map((x) => x.key))
  // 'idnLotes' (versión 2026-11-06-a) ahora es el indicador IDN.
  f.secciones = Array.isArray(f.secciones) ? [...new Set(f.secciones.map((k) => (k === ('idnLotes' as Seccion) ? 'ind:idn' : k)).filter((k) => validas.has(k)))] : [...SECCIONES_DEFECTO]
}
const guardarFiltros = () => { try { localStorage.setItem(KEY_FILTROS, JSON.stringify(f)) } catch { /* nada */ } }

let datos: { filas: Fila[]; cat: Catalogo } | null = null
let cargando: Promise<void> | null = null
let alcance: Alcance = { codigos: null, principal: null, tuHub: null, vistaPrevia: false }
let actualizadoEn: Date | null = null

const root = () => document.getElementById('rs-root')!
const siteParam = () => (new URLSearchParams(location.search).get('site') || '').toUpperCase()
const hoyISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const aFecha = (iso: string) => new Date(iso + 'T12:00:00')

/* ══ Entrada ══ */

export async function abrirResultados(forzar = false) {
  iniciarTooltip()
  if (!navigator.onLine && !datos) {
    root().innerHTML = '<div class="rs"><div class="rs-panel rs-empty">Resultados necesita conexión a internet. La captura sigue funcionando sin señal.</div></div>'
    return
  }
  if (!datos || forzar) {
    if (!cargando) {
      root().innerHTML = '<div class="rs"><div class="rs-panel rs-empty"><span class="spin rs-spin"></span> Cargando resultados…</div></div>'
      cargando = cargarDatos()
        .then((d) => { datos = d; actualizadoEn = new Date() })
        .catch((e) => {
          root().innerHTML = `<div class="rs"><div class="rs-panel rs-empty">No se pudieron cargar los resultados: ${esc((e as Error).message)}<br><button class="rs-btn" id="rs-reintentar">Reintentar</button></div></div>`
          document.getElementById('rs-reintentar')?.addEventListener('click', () => abrirResultados(true))
        })
        .finally(() => { cargando = null })
    }
    await cargando
    if (!datos) return
  }
  alcance = calcularAlcance(estado.usuario, datos.cat, siteParam())
  if (alcance.codigos) f.asoc = ''
  render()
}

/* ══ Filtrado ══ */

function rango(): { desde: string; hasta: string } {
  const hasta = f.periodo === 'rango' && f.hasta ? f.hasta : hoyISO()
  if (f.periodo === 'todo') return { desde: '0000-00-00', hasta }
  if (f.periodo === 'rango') return { desde: f.desde || '0000-00-00', hasta }
  const d = aFecha(hasta); d.setMonth(d.getMonth() - parseInt(f.periodo))
  return { desde: d.toISOString().slice(0, 10), hasta }
}
function rangoAnterior(): { desde: string; hasta: string } | null {
  if (f.periodo === 'todo') return null
  const r = rango()
  if (r.desde === '0000-00-00') return null
  const a = aFecha(r.desde), b = aFecha(r.hasta), dur = b.getTime() - a.getTime()
  const h = new Date(a.getTime() - 864e5), d = new Date(h.getTime() - dur)
  return { desde: d.toISOString().slice(0, 10), hasta: h.toISOString().slice(0, 10) }
}
const enRango = (x: Fila, r: { desde: string; hasta: string }) => x.fecha >= r.desde && x.fecha <= r.hasta

/** Filas que esta cuenta puede ver, con el filtro de asociado aplicado (sin filtro de fechas). */
function filasVisibles(): Fila[] {
  if (!datos) return []
  let fs = datos.filas
  if (alcance.codigos) fs = fs.filter((x) => alcance.codigos!.has(x.asociado))
  else if (f.asoc) { const c = codigosDeFiltro(datos.cat, f.asoc); fs = fs.filter((x) => c.has(x.asociado)) }
  return fs
}
const vista = (g: string) => datos?.cat.vista[g.toUpperCase()] || g
const nombreAsoc = (c: string) => datos?.cat.asociados.find((a) => a.Title === c)?.Nombre || c

/* ══ Render principal ══ */

function render() {
  if (!datos) return
  guardarFiltros()
  const vis = filasVisibles()
  const r = rango()
  const cur = vis.filter((x) => enRango(x, r))
  const red = stats(datos.filas.filter((x) => enRango(x, r)))
  const granjas = [...new Set(vis.map((x) => x.granja))].sort((a, b) => vista(a).localeCompare(vista(b), 'es'))
  if (!granjas.includes(f.granja)) { f.granja = granjas[0] || ''; f.lote = '' }

  const asocs = [...new Set(datos.filas.map((x) => x.asociado).filter(Boolean))].sort()
  const titulo = alcance.codigos
    ? `${esc(nombreAsoc(alcance.principal || ''))}${alcance.vistaPrevia ? ' <span class="rs-tag">vista previa de administrador</span>' : ''}`
    : f.asoc ? esc(nombreAsoc(f.asoc)) : 'Todos los asociados'
  const lotesGranja = [...new Set(vis.filter((x) => x.granja === f.granja && enRango(x, r)).map((x) => x.consec))].sort().reverse()
  if (f.lote && !lotesGranja.includes(f.lote)) f.lote = ''

  root().innerHTML = `<div class="rs">
    <div class="rs-top">
      <div><div class="rs-eyebrow">Score Pulmonar · Método Madec</div><h2>${titulo}</h2>
        <div class="rs-muted">${actualizadoEn ? 'Actualizado ' + actualizadoEn.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : ''} · ${vis.length.toLocaleString('es-CO')} cerdos en total</div></div>
      <div class="rs-actions">
        ${alcance.tuHub ? `<a class="rs-btn rs-btn-g" href="${esc(alcance.tuHub)}" target="_blank" rel="noopener">🏠 Abrir Tu.HUB</a>` : ''}
        <button class="rs-btn" id="rs-act">⟳ Actualizar</button>
        <button class="rs-btn" id="rs-xls">Excel</button>
        <button class="rs-btn" id="rs-pdf">PDF</button>
      </div>
    </div>
    <div class="rs-filtros">
      ${alcance.codigos ? '' : `<label>Asociado<select id="rs-asoc"><option value="">Todos</option>${asocs.map((a) => `<option value="${esc(a)}" ${a === f.asoc ? 'selected' : ''}>${esc(nombreAsoc(a))}</option>`).join('')}</select></label>`}
      <label>Periodo<select id="rs-per">${[['3', 'Últimos 3 meses'], ['6', 'Últimos 6 meses'], ['12', 'Últimos 12 meses'], ['todo', 'Todo el historial'], ['rango', 'Rango de fechas']].map(([v, t]) => `<option value="${v}" ${v === f.periodo ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${f.periodo === 'rango' ? `<label>Desde<input type="date" id="rs-desde" value="${esc(f.desde)}"></label><label>Hasta<input type="date" id="rs-hasta" value="${esc(f.hasta)}"></label>` : ''}
      ${f.tab === 'gra' ? `<label>Granja<select id="rs-granja">${granjas.map((g) => `<option value="${esc(g)}" ${g === f.granja ? 'selected' : ''}>${esc(vista(g))}</option>`).join('')}</select></label>
        <label>Consecutivo<select id="rs-lote"><option value="">Todos los consecutivos</option>${lotesGranja.map((c) => `<option ${c === f.lote ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        ${filtroSecciones()}` : ''}
      ${f.tab === 'com' ? `<label>Indicador<select id="rs-ind">${INDICADORES.map((i) => `<option value="${i.key}" ${i.key === f.ind ? 'selected' : ''}>${i.lbl}</option>`).join('')}</select></label>` : ''}
    </div>
    <div class="rs-tabs" role="tablist">
      ${([['res', 'Resumen'], ['gra', 'Granja y consecutivos'], ['com', 'Comparativo']] as const).map(([k, t]) => `<button role="tab" data-tab="${k}" aria-selected="${f.tab === k}">${t}</button>`).join('')}
    </div>
    <div class="rs-impreso">${esc(textoFiltros(r))}</div>
    <div id="rs-vista"></div>
  </div>`

  const cont = document.getElementById('rs-vista')!
  if (f.tab === 'res') cont.innerHTML = vistaResumen(vis, cur, red)
  else if (f.tab === 'gra') cont.innerHTML = vistaGranja(vis, r, red)
  else cont.innerHTML = vistaComparativo(cur, red)
  enlazar()
}

/** Lista desplegable con casillas: qué secciones mostrar y exportar, y en qué orden (el número). */
function filtroSecciones() {
  const n = f.secciones.length
  const filas = SECCIONES.map((x, j) => {
    const i = f.secciones.indexOf(x.key)
    return `${j === 0 || SECCIONES[j - 1].grupo !== x.grupo ? `<div class="rs-multi-grupo">${x.grupo}</div>` : ''}<label><input type="checkbox" data-sec="${x.key}" ${i >= 0 ? 'checked' : ''}><span class="nm">${x.lbl}</span><span class="rs-orden">${i >= 0 ? i + 1 : ''}</span></label>`
  }).join('')
  return `<div class="rs-fx rs-fx-sec"><span>Secciones e indicadores</span>
    <details class="rs-multi" id="rs-secciones"${seccionesAbierto ? ' open' : ''}><summary>${n === SECCIONES.length ? 'Todo' : n ? `${n} elegido${n === 1 ? '' : 's'}` : 'Nada elegido'}</summary>
      <div class="rs-multi-pop"><div class="rs-multi-ayuda">Se muestran y salen en el PDF en el orden en que los marque (el número). Cada uno nuevo se agrega abajo.</div>
        ${filas}
        <div class="rs-multi-btns"><button type="button" class="rs-btn" id="rs-sec-defecto">Informe recomendado</button><button type="button" class="rs-btn" id="rs-sec-todas">Todo</button><button type="button" class="rs-btn" id="rs-sec-ninguna">Quitar todo</button></div></div>
    </details></div>`
}

function textoFiltros(r: { desde: string; hasta: string }) {
  const per = f.periodo === 'todo' ? 'Todo el historial' : `${r.desde} a ${r.hasta}`
  const g = f.tab === 'gra' ? ` · Granja: ${vista(f.granja)}${f.lote ? ' · Consecutivo ' + f.lote : ''}` : ''
  return `Periodo: ${per}${g}`
}

function enlazar() {
  const on = (id: string, ev: string, fn: (e: Event) => void) => document.getElementById(id)?.addEventListener(ev, fn)
  const val = (e: Event) => (e.target as HTMLInputElement).value
  on('rs-asoc', 'change', (e) => { f.asoc = val(e); render() })
  on('rs-per', 'change', (e) => { f.periodo = val(e); if (f.periodo === 'rango' && !f.hasta) { const r = rango(); f.desde = r.desde; f.hasta = hoyISO() } render() })
  on('rs-desde', 'change', (e) => { f.desde = val(e); render() })
  on('rs-hasta', 'change', (e) => { f.hasta = val(e); render() })
  on('rs-granja', 'change', (e) => { f.granja = val(e); f.lote = ''; render() })
  on('rs-lote', 'change', (e) => { f.lote = val(e); render() })
  on('rs-ind', 'change', (e) => { f.ind = val(e); render() })
  on('rs-secciones', 'toggle', (e) => { seccionesAbierto = (e.target as HTMLDetailsElement).open })
  document.querySelectorAll<HTMLInputElement>('[data-sec]').forEach((c) => c.addEventListener('change', () => {
    const k = c.dataset.sec as Seccion
    f.secciones = f.secciones.filter((x) => x !== k)
    if (c.checked) f.secciones.push(k)
    render()
  }))
  on('rs-sec-defecto', 'click', () => { f.secciones = [...SECCIONES_DEFECTO]; render() })
  on('rs-sec-todas', 'click', () => { f.secciones = [...SECCIONES_TODAS]; render() })
  on('rs-sec-ninguna', 'click', () => { f.secciones = []; render() })
  on('rs-act', 'click', () => abrirResultados(true))
  on('rs-xls', 'click', exportarExcel)
  on('rs-pdf', 'click', exportarPDF)
  document.querySelectorAll<HTMLButtonElement>('.rs-tabs button').forEach((b) => b.addEventListener('click', () => { f.tab = b.dataset.tab as Tab; render(); window.scrollTo({ top: 0 }) }))
  document.querySelectorAll<HTMLElement>('[data-go]').forEach((el) => {
    const go = () => { f.granja = el.dataset.go!; f.lote = el.dataset.lote || ''; f.tab = 'gra'; render(); window.scrollTo({ top: 0 }) }
    el.addEventListener('click', go)
    el.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go() })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-orden]').forEach((b) => b.addEventListener('click', () => { f.orden = b.dataset.orden as 'asc' | 'desc'; render() }))
  document.querySelectorAll<HTMLButtonElement>('[data-nivel]').forEach((b) => b.addEventListener('click', () => { f.nivelTabla = b.dataset.nivel as 'granja' | 'lote'; render() }))
}

/* ══ Vista: Resumen ══ */

function kpi(lbl: string, valor: string, ref: string, extra = '', hero = false) {
  return `<div class="rs-kpi${hero ? ' hero' : ''}"><div class="l">${lbl}</div><div class="v">${valor}</div>${extra}<div class="ref">${ref}</div></div>`
}

function vistaResumen(vis: Fila[], cur: Fila[], red: Stats) {
  const s = stats(cur)
  if (!s.n) return '<div class="rs-panel rs-empty">No hay inspecciones en este periodo. Pruebe con un periodo más largo.</div>'
  const ra = rangoAnterior()
  let delta = ''
  if (ra) {
    const sp = stats(vis.filter((x) => enRango(x, ra)))
    if (sp.n) {
      const d = s.idn - sp.idn
      const cls = Math.abs(d) < 0.02 ? 'flat' : d < 0 ? 'good' : 'bad'
      delta = `<div class="rs-delta ${cls}">${d < 0 ? '▼' : d > 0 ? '▲' : '■'} ${fmt(Math.abs(d))} vs periodo anterior</div>`
    }
  }
  const granjasN = new Set(cur.map((x) => x.granja)).size
  const kpis = [
    kpi('IDN del periodo', fmt(s.idn), `Red Cercafe: ${fmt(red.idn)}`, `<div>${pill(s.idn)}</div>${delta}`, true),
    kpi('Cerdos inspeccionados', s.n.toLocaleString('es-CO'), `${s.lotes} consecutivos · ${granjasN} granja${granjasN === 1 ? '' : 's'}`),
    kpi('Consolidación', fmt(s.consol) + ' %', `Red Cercafe: ${fmt(red.consol)} % · Meta &lt; ${META_CONSOL} %`, s.consol >= META_CONSOL ? '<div class="rs-delta bad">Por encima de la meta</div>' : '<div class="rs-delta good">Dentro de la meta</div>'),
    kpi('Neumonía', fmt(s.neum, 1) + ' %', `Red Cercafe: ${fmt(red.neum, 1)} %`),
    kpi('Pleuritis', fmt(s.pleur, 1) + ' %', `Red Cercafe: ${fmt(red.pleur, 1)} %`),
    kpi('Poliserositis', fmt(s.poliser, 1) + ' %', `Red Cercafe: ${fmt(red.poliser, 1)} %`),
    kpi('Pérdidas GDP', fmt(s.gdp, 1) + ' kg', 'Suma estimada del periodo'),
  ].join('')

  const mini = (lbl: string, k: keyof Stats) => `<div class="rs-mini"><div class="l">${lbl}</div><b>${fmt(s[k] as number, 1)} %</b><span>Red ${fmt(red[k] as number, 1)} %</span></div>`
  const otras = `<div class="rs-panel"><h3>Otras lesiones y artefactos</h3><p class="rs-sub">Artefactos medidos sobre cerdos sin ninguna lesión.</p>
    <div class="rs-minis">${mini('Neumonía intersticial', 'nint')}${mini('Absceso', 'absc')}${mini('Nódulo', 'nodu')}${mini('Pericarditis', 'peri')}${mini('Manchas de leche', 'manc')}${mini('Artefacto agua', 'agua')}${mini('Artefacto sangre', 'sang')}${mini('Petequias', 'pete')}${mini('Ambos artefactos', 'ambos')}</div></div>`

  // Tabla de granjas
  const verAsoc = !alcance.codigos && !f.asoc
  const hoy = new Date()
  const filasG = [...new Set(cur.map((x) => x.granja))].map((g) => {
    const fg = cur.filter((x) => x.granja === g)
    const sg = stats(fg)
    const ult = fg.reduce((m, x) => (x.fecha > m ? x.fecha : m), '')
    const serie: (number | null)[] = []
    for (let i = 11; i >= 0; i--) {
      const a = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1), b = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 1)
      const ai = a.toISOString().slice(0, 10), bi = b.toISOString().slice(0, 10)
      const fm = vis.filter((x) => x.granja === g && x.fecha >= ai && x.fecha < bi)
      serie.push(fm.length ? stats(fm).idn : null)
    }
    return { g, sg, ult, serie, asoc: fg[0]?.asociado || '' }
  }).sort((a, b) => b.sg.idn - a.sg.idn)
  const tabla = `<div class="rs-panel"><h3>Granjas</h3><p class="rs-sub">De mayor a menor IDN en el periodo. Toque una granja para ver sus consecutivos.</p>
    <div class="rs-scroll"><table class="rs-table"><thead><tr><th>Granja</th><th>IDN</th><th>Tendencia 12 m</th><th class="n">Consecutivos</th><th class="n">Cerdos</th><th class="n">Pleuritis</th><th>Último consecutivo</th></tr></thead><tbody>
    ${filasG.map((r) => `<tr tabindex="0" data-go="${esc(r.g)}"><td><div class="nm">${esc(vista(r.g))}</div>${verAsoc ? `<div class="rs-muted">${esc(nombreAsoc(r.asoc))}</div>` : ''}</td><td>${pill(r.sg.idn)}</td><td>${spark(r.serie)}</td><td class="n">${r.sg.lotes}</td><td class="n">${r.sg.n}</td><td class="n">${fmt(r.sg.pleur, 1)} %</td><td>${esc(r.ult)}</td></tr>`).join('')}
    </tbody></table></div></div>`

  // Lotes para revisar (últimos 60 días, moderado o severo)
  const lim = new Date(); lim.setDate(lim.getDate() - 60)
  const limI = lim.toISOString().slice(0, 10)
  const porLote = new Map<string, Fila[]>()
  vis.filter((x) => x.fecha >= limI).forEach((x) => { const k = x.granja + '|' + x.consec; porLote.set(k, [...(porLote.get(k) || []), x]) })
  const alertas = [...porLote.values()].map((fs) => ({ fs, s: stats(fs) })).filter((a) => a.s.idn >= 0.56).sort((a, b) => b.s.idn - a.s.idn).slice(0, 8)
  const alertasHtml = `<div class="rs-panel"><h3>Consecutivos para revisar</h3><p class="rs-sub">Últimos 60 días con IDN moderado o severo.</p><div class="rs-alerts">
    ${alertas.length ? alertas.map((a) => { const k = nivelIdn(a.s.idn), x = a.fs[0]; return `<button type="button" class="rs-alert" data-go="${esc(x.granja)}" data-lote="${esc(x.consec)}"><span class="rs-pill rs-${k}"><i></i>${NIVEL_TXT[k]}</span><span><b>${esc(vista(x.granja))} · consecutivo ${esc(x.consec)}</b><br><span class="rs-muted">${esc(x.fecha)} · ${a.s.n} cerdos · pleuritis ${fmt(a.s.pleur, 0)} %</span></span><b class="val">${fmt(a.s.idn)}</b></button>` }).join('')
      : '<div class="rs-empty">Ningún consecutivo moderado o severo en los últimos 60 días.</div>'}</div></div>`

  return `<div class="rs-kpis">${kpis}</div><div class="rs-grid2">${tabla}<div class="rs-col">${alertasHtml}</div></div>${otras}`
}

/* ══ Vista: Granja y consecutivos ══ */

/** Gráfico de control. Con `ayudaAparte` la explicación no va adentro (se muestra como sección propia). */
function panelControl(lotes: PuntoLote[], ayudaAparte: boolean) {
  const c = calcularControl(lotes)
  const ayuda = `<details class="rs-ayuda"><summary>¿Cómo leer y cómo se calcula?</summary>${ayudaControl()}</details>`
  if (!c) return `<div class="rs-panel"><h3>Gráfico de control (SPC)</h3><p class="rs-sub">Se necesitan al menos 5 consecutivos con ${MIN_CERDOS} o más cerdos en el periodo para calcular los límites. Pruebe con un periodo más largo.</p></div>`
  return `<div class="rs-panel"><h3>Gráfico de control (SPC)</h3><p class="rs-sub">IDN de cada consecutivo, en orden, frente a las zonas de variación normal de la granja. Toque un punto para ver el detalle.</p>
    ${graficaControl(c, f.lote)}
    <div class="rs-leyenda-spc">
      <div><b>Color de la franja = qué tan alto salió el consecutivo</b>
        <span><i style="background:#e7f1ea"></i>Verde: normal para esta granja</span>
        <span><i style="background:#fbf3d9"></i>Amarilla: un poco alto (atención)</span>
        <span><i style="background:#fbe6d2"></i>Naranja: muy alto (alerta)</span>
        <span><i style="background:var(--rs-sev);height:3px"></i>Línea roja: límite. Pasarla casi nunca es por azar</span>
        <span><i style="background:#fff;border:2px dashed #7d776b;border-radius:50%"></i>Círculo vacío: menos de ${MIN_CERDOS} cerdos, no se evalúa</span></div>
      <div><b>Aro alrededor del punto = se encendió una alerta (la letra encima dice cuál)</b>
        ${([1, 4, 2, 3] as const).map((r) => `<span><i style="background:none;border:2px solid ${REGLAS[r].color};border-radius:50%"></i><b style="color:${REGLAS[r].color}">${REGLAS[r].letra}) ${REGLAS[r].nombre}:</b> ${REGLAS[r].criterio}</span>`).join('')}
        <span class="rs-muted">Si no hay aros, no hay alertas.</span></div>
    </div>
    <div class="rs-callout"><b>Lectura:</b><br>${lecturaControl(c)}</div>${ayudaAparte ? '' : ayuda}</div>`
}

/** Explicación del gráfico de control (desplegable dentro del gráfico, o sección propia del informe). */
function ayudaControl() {
  const criterios = ([1, 4, 2, 3] as const).map((r) => `<tr><td><b style="color:${REGLAS[r].color}">${REGLAS[r].letra}) ${REGLAS[r].nombre}</b></td><td>${REGLAS[r].criterio}</td></tr>`).join('')
  return `
    <p><b>Para qué sirve:</b> separa la variación normal de la granja (las subidas y bajadas de siempre) de los cambios que de verdad indican un problema.</p>
    <p><b>Líneas:</b> la verde gruesa es el IDN normal (promedio) de la granja. Las otras marcan qué tan lejos está cada consecutivo de lo normal: azul = un poco (1σ), naranja = bastante (2σ), roja = límite (3σ). En estadística a estas distancias se les llama σ (sigma) y a las franjas Zona C (verde), B (amarilla) y A (naranja).</p>
    <p><b>Puntos:</b> el color indica la zona en la que cayó el consecutivo; el aro y la letra encima indican qué alerta disparó (si hay dos, salen las dos, por ejemplo A·B).</p>
    <table class="rs-table rs-cats"><thead><tr><th>Alerta</th><th>Criterio</th></tr></thead><tbody>${criterios}
      <tr><td><b style="color:var(--rs-leve)">Mejora sostenida</b></td><td>9 consecutivos seguidos por debajo de lo normal (buena noticia).</td></tr></tbody></table>
    <p><b>Cálculo:</b> σ es la variación típica entre consecutivos de esta granja, medida con la diferencia entre un consecutivo y el siguiente y calculada para el número de cerdos que normalmente se inspeccionan en la granja. Los consecutivos con menos de ${MIN_CERDOS} cerdos se muestran como círculo vacío pero no entran al cálculo ni a las alertas, porque con tan pocos animales el IDN depende demasiado del azar. Los consecutivos que pasan el límite tampoco entran al cálculo de lo normal, para que un caso raro no lo mueva.</p>
    <p><b>Por qué 3σ, 9 y 6:</b> si la granja está estable, cada criterio pasa por azar solo unas 3 veces de cada 1.000 (Shewhart, Western Electric, Nelson). Por eso, cuando aparece, casi seguro algo cambió. Las alertas C y D necesitan varios consecutivos: se ven mejor con "Últimos 12 meses" o "Todo el historial".</p>
    <p>Los límites salen de la historia de la propia granja, no de la red Cercafe: <b>estable no quiere decir bueno</b>. Para comparar con la red use la gráfica de IDN por consecutivo.</p>`
}

function vistaGranja(vis: Fila[], r: { desde: string; hasta: string }, red: Stats) {
  if (!f.granja) return '<div class="rs-panel rs-empty">No hay granjas con datos.</div>'
  const deGranja = vis.filter((x) => x.granja === f.granja && enRango(x, r))
  const sel = f.lote ? deGranja.filter((x) => x.consec === f.lote) : deGranja
  const s = stats(sel)
  const porLote = new Map<string, Fila[]>()
  deGranja.forEach((x) => porLote.set(x.consec, [...(porLote.get(x.consec) || []), x]))
  const lotes: PuntoLote[] = [...porLote.entries()].map(([consec, fs]) => {
    const fecha = fs.reduce((m, x) => (x.fecha && x.fecha < m ? x.fecha : m), fs[0].fecha || r.hasta)
    return { consec, fecha: aFecha(fecha || r.hasta), s: stats(fs) }
  })
  // La gráfica arranca un poco antes del primer consecutivo de la granja (no en el inicio del periodo), para no dejar meses vacíos.
  const primero = lotes.length ? Math.min(...lotes.map((l) => l.fecha.getTime())) : aFecha(r.hasta).getTime()
  const desde = new Date(Math.max(primero - 10 * 864e5, r.desde === '0000-00-00' ? 0 : aFecha(r.desde).getTime()))
  const an = analisis(s)
  const mp = mapaPulmonar(s)
  const asoc = deGranja[0]?.asociado || datos?.cat.asociadoDe[f.granja.toUpperCase()] || ''
  if (!s.n) return `<div class="rs-panel"><div class="rs-farm"><div><div class="rs-muted">${esc(nombreAsoc(asoc))}</div><h2>${esc(vista(f.granja))}</h2></div></div><div class="rs-empty">Sin inspecciones de esta granja en el periodo.</div></div>`
  const k = nivelIdn(s.idn)
  const hub = datos?.cat.asociados.find((a) => a.Title === asoc)?.SitioTuHub || alcance.tuHub || ''
  const indicador = (key: string) => {
    const ind = INDICADORES.find((i) => i.key === key)
    if (!ind) return ''
    if (ind.key === 'idn') return `<div class="rs-panel"><h3>IDN por consecutivo</h3><p class="rs-sub">Cada punto es un consecutivo. Líneas guía: 0,56 moderado y 0,90 severo; la punteada verde es la red Cercafe.</p>${graficaLotes(lotes, desde, aFecha(r.hasta), red.idn)}</div>`
    const esGdp = ind.key === 'gdp'
    const refRed = esGdp ? null : (red[ind.key] as number)
    const meta = ind.key === 'consol' ? META_CONSOL : null
    const nota = esGdp ? `Kilos estimados de pérdida en cada consecutivo. Total del periodo: ${ind.fmt(s.gdp)} kg.`
      : `Cada punto es un consecutivo. ${f.lote ? 'Consecutivo elegido' : 'Granja en el periodo'}: <b>${ind.fmt(s[ind.key] as number)}</b>${refRed != null ? ` · Red Cercafe: ${ind.fmt(refRed)} (línea punteada verde)` : ''}${meta != null ? ` · Meta: menor a ${META_CONSOL} % (línea roja)` : ''}.`
    return `<div class="rs-panel"><h3>${esc(ind.lbl.replace(/^% /, ''))} por consecutivo</h3><p class="rs-sub">${nota}</p>${graficaIndicadorLotes(lotes, desde, aFecha(r.hasta), ind.key, ind.fmt, refRed, meta)}</div>`
  }
  const html: Record<(typeof SECCIONES_FIJAS)[number]['key'], () => string> = {
    ficha: () => `<div class="rs-panel"><div class="rs-farm">
    <div><div class="rs-muted">${esc(nombreAsoc(asoc))}${f.lote ? ' · Consecutivo ' + esc(f.lote) : ''}</div><h2>${esc(vista(f.granja))}</h2></div>
    <div class="rs-farm-stats"><div>IDN<b>${fmt(s.idn)}</b></div><div>Estado<span>${pill(s.idn)}</span></div><div>Consecutivos<b>${s.lotes}</b></div><div>Cerdos<b>${s.n}</b></div><div>Neumonía<b>${fmt(s.neum, 1)} %</b></div><div>Pleuritis<b>${fmt(s.pleur, 1)} %</b></div><div>Red Cercafe<b>${fmt(red.idn)}</b></div></div>
  </div></div>`,
    analisis: () => `<div class="rs-panel"><h3>Análisis de resultados</h3>
    <div class="rs-grid2 rs-analisis">
      <table class="rs-table rs-kv"><tbody>
        <tr><td>IDN</td><td>${fmt(s.idn)} — <b class="rs-t-${k}">${NIVEL_TXT[k]}</b></td></tr>
        <tr><td>% Consolidación</td><td>${fmt(s.consol)} % — ${an.consol}</td></tr>
        <tr><td>Frec. neumonía</td><td>${an.neum}</td></tr>
        <tr><td>Pleuritis</td><td>${an.pleur}</td></tr>
        <tr><td>Poliserositis</td><td>${fmt(s.poliser, 1)} %</td></tr>
        <tr><td>Pérdidas GDP</td><td>${fmt(s.gdp, 1)} kg estimados en pérdida de ganancia diaria de peso</td></tr>
      </tbody></table>
      <div class="rs-reco rs-b-${k}"><div class="rs-eyebrow">Recomendación</div><p>${an.recomendacion}</p>
        <div class="rs-muted">Escala IDN: Sin lesión = 0 · Leve &lt; 0,56 · Moderado 0,56–0,89 · Severo &gt; 0,89</div></div>
    </div>
  </div>`,
    spc: () => panelControl(lotes, f.secciones.includes('spcAyuda')),
    spcAyuda: () => `<div class="rs-panel"><h3>Cómo leer el gráfico de control</h3><div class="rs-ayuda">${ayudaControl()}</div></div>`,
    mapa: () => `<div class="rs-panel rs-angosto"><h3>Mapa pulmonar</h3><p class="rs-sub">Consolidación promedio por lóbulo${f.lote ? ' del consecutivo' : ''}.</p>
      <div class="rs-lung"><div>${mp.svg}</div><div class="rs-lobes">${mp.lista}</div></div>
      <div class="rs-legend">${mp.leyenda}</div><div class="rs-callout"><b>Lectura:</b> ${mp.lectura}</div></div>`,
    categorias: () => `<div class="rs-panel rs-angosto"><h3>Cerdos por categoría Madec</h3><p class="rs-sub">Qué porcentaje de los cerdos quedó en cada categoría, según cuánto pulmón tiene dañado (consolidación).</p>${graficaCategorias(s)}
      ${explicacionCategorias()}</div>`,
    tabla: () => `<div class="rs-panel"><h3>Consecutivos</h3><div class="rs-scroll"><table class="rs-table"><thead><tr><th>Consecutivo</th><th>Fecha</th><th class="n">Cerdos</th><th>IDN</th><th class="n">Consolidación</th><th class="n">Neumonía</th><th class="n">Pleuritis</th><th class="n">GDP (kg)</th></tr></thead><tbody>
    ${[...lotes].sort((a, b) => b.fecha.getTime() - a.fecha.getTime()).map((l) => `<tr tabindex="0" class="${l.consec === f.lote ? 'sel' : ''}" data-go="${esc(f.granja)}" data-lote="${l.consec === f.lote ? '' : esc(l.consec)}"><td>${esc(l.consec)}</td><td>${l.fecha.toISOString().slice(0, 10)}</td><td class="n">${l.s.n}</td><td>${pill(l.s.idn)}</td><td class="n"${l.s.consol >= META_CONSOL ? ' style="color:var(--rs-sev);font-weight:600" title="Por encima de la meta"' : ''}>${fmt(l.s.consol)} %</td><td class="n">${fmt(l.s.neum, 1)} %</td><td class="n">${fmt(l.s.pleur, 1)} %</td><td class="n">${fmt(l.s.gdp, 1)}</td></tr>`).join('')}
  </tbody></table></div><p class="rs-sub rs-solo-pantalla" style="margin-top:8px">Toque un consecutivo para ver solo ese consecutivo; tóquelo de nuevo para volver a todos.</p></div>`,
    cierre: () => `<div class="rs-cierre"><p>Seguimos trabajando de la mano para fortalecer la sanidad y el desempeño productivo de la granja. El seguimiento periódico del score pulmonar nos permite identificar tendencias, evaluar la evolución sanitaria y orientar acciones oportunas.</p>
    <p>Los invitamos a consultar los resultados y el detalle de cada consecutivo en nuestro ${hub ? `<a href="${esc(hub)}" target="_blank" rel="noopener">Hub de Servicios</a>` : '<b>Hub de Servicios</b>'}, donde podrán conocer con mayor profundidad la evolución de los indicadores y contar con información valiosa para el seguimiento sanitario de su granja.</p></div>`,
  }
  if (!f.secciones.length) return '<div class="rs-panel rs-empty">No hay secciones elegidas. Márquelas en "Secciones del informe".</div>'
  return f.secciones.map((x) => (x.startsWith('ind:') ? indicador(x.slice(4)) : html[x as keyof typeof html]())).join('\n')
}


/* ══ Vista: Comparativo ══ */

function porGranja(cur: Fila[]) {
  const m = new Map<string, Fila[]>()
  cur.forEach((x) => m.set(x.granja, [...(m.get(x.granja) || []), x]))
  return [...m.entries()].map(([g, fs]) => ({ g, s: stats(fs) }))
}

function vistaComparativo(cur: Fila[], red: Stats) {
  const ind = INDICADORES.find((i) => i.key === f.ind) || INDICADORES[0]
  const pg = porGranja(cur)
  if (!pg.length) return '<div class="rs-panel rs-empty">No hay inspecciones en este periodo.</div>'
  const filas: FilaComp[] = pg.map((x) => ({ nombre: vista(x.g), valor: x.s[ind.key] as number, s: x.s })).sort((a, b) => (f.orden === 'asc' ? a.valor - b.valor : b.valor - a.valor))
  const esIdn = ind.key === 'idn'
  const ref = ind.key === 'gdp' ? null : (red[ind.key] as number)
  const leyIdn = esIdn ? `<div class="rs-legend">${(['sin', 'leve', 'mod', 'sev'] as const).map((k) => `<span class="rs-pill rs-${k}"><i></i>${NIVEL_TXT[k]}</span>`).join('')}${ref != null ? `<span>┆ Red Cercafe ${ind.fmt(ref)}</span>` : ''}</div>`
    : ref != null ? `<div class="rs-legend"><span>┆ Red Cercafe ${ind.fmt(ref)}</span></div>` : ''
  return `<div class="rs-panel rs-comp-g"><div class="rs-tabla-hdr" style="margin-bottom:0"><h3>${ind.lbl} por granja</h3>
    <div class="rs-seg"><button data-orden="asc" class="${f.orden === 'asc' ? 'on' : ''}">Menor a mayor</button><button data-orden="desc" class="${f.orden === 'desc' ? 'on' : ''}">Mayor a menor</button></div></div>
    <p class="rs-sub">${esIdn ? 'Color según la escala IDN.' : ''}${ind.key === 'consol' ? ` Línea roja: meta (menor a ${META_CONSOL} %); en rojo las granjas por encima.` : ''} Línea punteada: red Cercafe. Toque una columna para ver el detalle; en el celular deslice el gráfico de lado para ver todas las granjas.</p>${columnasGranjas(filas, esIdn, ind.fmt, ref, ind.key === 'consol' ? META_CONSOL : null)}${leyIdn}</div>
  <div class="rs-panel"><div class="rs-tabla-hdr"><h3>Resultados por tabla</h3>
    <div class="rs-seg"><button data-nivel="granja" class="${f.nivelTabla === 'granja' ? 'on' : ''}">Por granja</button><button data-nivel="lote" class="${f.nivelTabla === 'lote' ? 'on' : ''}">Por consecutivo</button></div></div>
    <div class="rs-scroll">${tablaIndicadores(cur)}</div>
    <p class="rs-sub" style="margin-top:8px">El botón Excel exporta esta tabla con los 15 indicadores.</p></div>`
}

function filasTabla(cur: Fila[]) {
  if (f.nivelTabla === 'granja') {
    return porGranja(cur).sort((a, b) => vista(a.g).localeCompare(vista(b.g), 'es'))
      .map((x) => ({ cols: { Granja: vista(x.g), Asociado: nombreAsoc(x.s.n ? cur.find((c) => c.granja === x.g)!.asociado : '') } as Record<string, string>, s: x.s }))
  }
  const m = new Map<string, Fila[]>()
  cur.forEach((x) => { const k = x.granja + '|' + x.consec; m.set(k, [...(m.get(k) || []), x]) })
  return [...m.values()].map((fs) => ({ cols: { Granja: vista(fs[0].granja), Consecutivo: fs[0].consec, Fecha: fs.reduce((a, x) => (x.fecha < a ? x.fecha : a), fs[0].fecha) } as Record<string, string>, s: stats(fs) }))
    .sort((a, b) => a.cols.Granja.localeCompare(b.cols.Granja, 'es') || b.cols.Fecha.localeCompare(a.cols.Fecha))
}

function tablaIndicadores(cur: Fila[]) {
  const filas = filasTabla(cur)
  if (!filas.length) return ''
  const claves = Object.keys(filas[0].cols)
  return `<table class="rs-table rs-wide"><thead><tr>${claves.map((c) => `<th>${c}</th>`).join('')}<th class="n">Cerdos</th>${INDICADORES.map((i) => `<th class="n">${i.lbl}</th>`).join('')}</tr></thead><tbody>
    ${filas.map((r) => `<tr>${claves.map((c) => `<td>${esc(r.cols[c])}</td>`).join('')}<td class="n">${r.s.n}</td>${INDICADORES.map((i) => `<td class="n">${i.key === 'idn' ? pill(r.s.idn) : i.fmt(r.s[i.key] as number)}</td>`).join('')}</tr>`).join('')}
  </tbody></table>`
}

/* ══ Exportar ══ */

/** Nombre del reporte: la granja (y consecutivo) en "Granja y consecutivos"; si no, el asociado o todos. */
function nombreReporte() {
  if (f.tab === 'gra') return vista(f.granja) + (f.lote ? ' · Consecutivo ' + f.lote : '')
  return alcance.principal ? nombreAsoc(alcance.principal) : f.asoc ? nombreAsoc(f.asoc) : 'Todos los asociados'
}
const nombreVista = () => (f.tab === 'res' ? 'Resumen' : f.tab === 'gra' ? 'Granja y consecutivos' : 'Comparativo')
const paraArchivo = (t: string) => t.replace(/[\\/:*?"<>|·]+/g, ' ').replace(/\s+/g, ' ').trim()

async function exportarExcel() {
  if (!datos) return
  const r = rango()
  const cur = filasVisibles().filter((x) => enRango(x, r))
  const filas = filasTabla(cur).map((x) => {
    const o: Record<string, string | number> = { ...x.cols, Cerdos: x.s.n }
    INDICADORES.forEach((i) => (o[i.lbl] = Math.round((x.s[i.key] as number) * 10000) / 10000))
    o['Nivel IDN'] = NIVEL_TXT[nivelIdn(x.s.idn)]
    return o
  })
  const porGranjaN = f.nivelTabla === 'granja'
  const { generarExcel } = await import('./exportar')
  await generarExcel({
    hoja: porGranjaN ? 'Por granja' : 'Por consecutivo',
    titulo: alcance.principal ? nombreAsoc(alcance.principal) : f.asoc ? nombreAsoc(f.asoc) : 'Todos los asociados',
    subtitulo: `Indicadores ${porGranjaN ? 'por granja' : 'por consecutivo'} · ${textoFiltros({ ...r }).replace(/ · Granja:.*$/, '')}`,
    archivo: `ScorePulmonar_${porGranjaN ? 'granjas' : 'consecutivos'}_${r.hasta}.xlsx`,
    filas,
  })
}

async function exportarPDF() {
  const cont = document.getElementById('rs-vista')
  if (!cont) return
  const nombre = nombreReporte()
  const asoc = f.tab === 'gra' ? datos?.filas.find((x) => x.granja === f.granja)?.asociado : ''
  const { generarPDF } = await import('./exportar')
  await generarPDF({
    contenido: cont,
    titulo: nombre,
    subtitulo: [nombreVista(), asoc ? nombreAsoc(asoc) : '', textoFiltros(rango()).replace(/ · Granja:.*$/, '')].filter(Boolean).join(' · '),
    archivo: `Score Pulmonar - ${paraArchivo(nombre)} - ${hoyISO()}.pdf`,
    // El informe de una granja sale en hoja vertical, una sección debajo de otra.
    orientacion: f.tab === 'gra' ? 'vertical' : 'horizontal',
  })
}

/* ══ Tooltip ══ */

let tipListo = false
function iniciarTooltip() {
  if (tipListo) return
  tipListo = true
  const tip = document.createElement('div')
  tip.id = 'rs-tip'
  // La lista de "Secciones del informe" se cierra al tocar fuera de ella.
  document.addEventListener('click', (e) => {
    const d = document.getElementById('rs-secciones') as HTMLDetailsElement | null
    if (d?.open && !d.contains(e.target as Node)) { d.open = false; seccionesAbierto = false }
  })
  tip.hidden = true
  document.body.append(tip)
  document.addEventListener('mousemove', (e) => {
    const t = (e.target as Element).closest?.('[data-tip]')
    if (!t) { tip.hidden = true; return }
    tip.innerHTML = t.getAttribute('data-tip') || ''
    tip.hidden = false
    const w = tip.offsetWidth, h = tip.offsetHeight
    let x = e.clientX + 14, y = e.clientY + 14
    if (x + w > innerWidth - 8) x = e.clientX - w - 14
    if (y + h > innerHeight - 8) y = e.clientY - h - 14
    tip.style.left = x + 'px'
    tip.style.top = y + 'px'
  })
}
