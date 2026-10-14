import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import { descargarBasculas, descargarOperarios, sincronizar } from '../../offline/syncService'
import { buscarCalibracionDelDia } from '../../graph/lists'
import { CampoSelect, CampoTexto, SeccionFormulario } from '../../components/CamposFormulario'
import { CampoBuscable } from '../../components/CampoBuscable'
import { calcularCalibracion, diaDeLaSemana, formatoErrorKg, formatoKg } from '../../utils/calibracion'
import type { CalibracionBascula as CalibracionModelo, Usuario } from '../../types/models'

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

/** Igual que formatearDecimal() en Recepcion.tsx/Ubicacion.tsx: acepta coma o punto. */
function formatearDecimal(valor: string): string {
  const conPunto = valor.replace(/,/g, '.').replace(/[^\d.]/g, '')
  const [entero, ...resto] = conPunto.split('.')
  return resto.length > 0 ? `${entero}.${resto.join('')}` : entero
}

function aNumero(texto: string): number | undefined {
  if (!texto.trim()) return undefined
  const n = Number(texto)
  return Number.isFinite(n) ? n : undefined
}

/**
 * "Calibración báscula" (2026-10-13, a pedido de Nathalia) — reemplaza el "Formato de verificación
 * básculas" en papel. Cada día se pesa la pesa patrón 3 veces; la app calcula el promedio, el error
 * (pesa patrón − promedio) y si queda dentro del EMP. Quien tiene la sesión iniciada es quien
 * VERIFICA (queda con su usuario, automático) y anota en el formulario quién REALIZÓ la medición.
 *
 * Funciona sin conexión, igual que Recepción: se guarda en Dexie y sincronizar() la sube después
 * (ver sincronizarCalibraciones() en syncService.ts). Regla: una verificación por báscula por día —
 * se revisa contra lo de este dispositivo siempre, y contra SharePoint cuando hay conexión. Si hay
 * que corregir una ya guardada, el Administrador la elimina desde Reporte → Calibración báscula y
 * se vuelve a registrar.
 */
export function CalibracionBascula({ usuario }: { usuario: Usuario }) {
  const basculas = useLiveQuery(() => db.basculas.toArray(), [])
  const basculasActivas = useMemo(() => (basculas ?? []).filter((b) => b.Activa), [basculas])
  const operarios = useLiveQuery(() => db.operarios.toArray(), [])
  const operariosActivos = useMemo(() => (operarios ?? []).filter((o) => o.Activo), [operarios])
  const recientes =
    useLiveQuery(() => db.calibracionesBascula.orderBy('FechaCalibracion').reverse().limit(10).toArray(), []) ?? []

  const [basculaId, setBasculaId] = useState('')
  const [fecha, setFecha] = useState(hoyISO())
  const [mediciones, setMediciones] = useState<[string, string, string]>(['', '', ''])
  /** id del operario elegido en "Realizó" (de la maestra Operarios). */
  const [realizoId, setRealizoId] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [mensaje, setMensaje] = useState<string>()
  const [errorGeneral, setErrorGeneral] = useState<string>()
  const [guardando, setGuardando] = useState(false)

  // Si la maestra todavía no está en este dispositivo (primera vez), se intenta traer una vez.
  useEffect(() => {
    if (basculas && basculas.length === 0 && navigator.onLine) void descargarBasculas()
  }, [basculas])
  useEffect(() => {
    if (operarios && operarios.length === 0 && navigator.onLine) void descargarOperarios()
  }, [operarios])

  const operarioElegido = operariosActivos.find((o) => o.id === realizoId)

  // Con una sola báscula activa (el caso de hoy: Frigotun) queda elegida de una vez.
  const basculaElegida = basculaId || (basculasActivas.length === 1 ? basculasActivas[0].id : '')
  const bascula = basculasActivas.find((b) => b.id === basculaElegida)
  const numeros = mediciones.map(aNumero)
  const completas = numeros.every((n): n is number => n !== undefined && n > 0)
  const calculo =
    bascula && completas ? calcularCalibracion(numeros as [number, number, number], bascula.PesaPatronKg, bascula.EMPKg) : undefined

  function cambiarMedicion(i: 0 | 1 | 2, valor: string) {
    const nuevas = [...mediciones] as [string, string, string]
    nuevas[i] = formatearDecimal(valor)
    setMediciones(nuevas)
  }

  function validar(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!bascula) e.bascula = 'Selecciona la báscula'
    if (!fecha) e.fecha = 'Obligatorio'
    else if (fecha > hoyISO()) e.fecha = 'No está permitido registrar una fecha posterior a hoy'
    numeros.forEach((n, i) => {
      if (n === undefined || n <= 0) e[`m${i}`] = 'Escribe un peso mayor a 0'
    })
    if (!operarioElegido) e.realizo = 'Elige de la lista el operario que realizó la medición'
    if (calculo?.resultado === 'No conforme' && !observaciones.trim()) {
      e.observaciones = 'El resultado es No conforme: explica qué pasó y qué acción se tomó'
    }
    return e
  }

  async function guardar() {
    setMensaje(undefined)
    setErrorGeneral(undefined)
    const e = validar()
    setErrores(e)
    if (Object.keys(e).length > 0 || !bascula || !calculo || !operarioElegido) return

    setGuardando(true)
    try {
      // Una por báscula por día: primero lo de este dispositivo (incluye lo aún sin subir)…
      const local = await db.calibracionesBascula
        .where('FechaCalibracion')
        .equals(fecha)
        .filter((c) => c.BasculaId === bascula.id)
        .first()
      // …y si hay conexión, también lo que otro dispositivo ya haya subido.
      let remota: CalibracionModelo | undefined
      if (!local && navigator.onLine) {
        try {
          remota = await buscarCalibracionDelDia(bascula.id, fecha)
        } catch {
          // Si SharePoint no responde no se bloquea la captura (igual que el resto de la app).
        }
      }
      const existente = local ?? remota
      if (existente) {
        setErrorGeneral(
          `Ya hay una verificación de "${bascula.Title}" para el ${fecha} (verificó ${existente.Verifico}). ` +
            'Solo se permite una por día. Si hay que corregirla, un Administrador puede eliminarla desde ' +
            'Reporte → Calibración báscula y luego se vuelve a registrar.',
        )
        return
      }

      const registro: CalibracionModelo = {
        id: crypto.randomUUID(),
        Title: `${bascula.Title} · ${fecha}`,
        FechaCalibracion: fecha,
        BasculaId: bascula.id,
        BasculaNombre: bascula.Title,
        PesaPatronKg: bascula.PesaPatronKg,
        EMPKg: bascula.EMPKg,
        Medicion1: numeros[0] as number,
        Medicion2: numeros[1] as number,
        Medicion3: numeros[2] as number,
        PromedioKg: calculo.promedioKg,
        ErrorKg: calculo.errorKg,
        Resultado: calculo.resultado,
        Realizo: operarioElegido.Title,
        Verifico: usuario.Title,
        VerificoCorreo: usuario.Correo,
        Observaciones: observaciones.trim() || undefined,
        EstadoSync: 'Pendiente',
        CapturadaEn: new Date().toISOString(),
      }
      await db.calibracionesBascula.put(registro)

      setMediciones(['', '', ''])
      setRealizoId('')
      setObservaciones('')
      setFecha(hoyISO())
      setErrores({})
      setMensaje(
        `Verificación guardada en este dispositivo — ${calculo.resultado} (error ${formatoErrorKg(calculo.errorKg)} kg).`,
      )
      if (navigator.onLine) void sincronizar(usuario.Correo)
    } catch (err) {
      setErrorGeneral(`No se pudo guardar: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Calibración báscula</h1>
      <p className="mt-1 text-sm text-slate-500">
        Verificación diaria con la pesa patrón: registra las 3 mediciones y la app calcula el error y si está dentro de la
        tolerancia (EMP).
      </p>

      {mensaje && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</p>}
      {errorGeneral && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{errorGeneral}</p>}

      {basculas !== undefined && basculasActivas.length === 0 && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No hay básculas registradas en este dispositivo.{' '}
          {usuario.Rol === 'Administrador'
            ? 'Agrégala en Asociados → Básculas (con conexión).'
            : 'Pídele a un Administrador que la agregue, y abre esta pantalla con conexión para descargarla.'}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void guardar()
        }}
        className="mt-4 space-y-5"
      >
        <SeccionFormulario titulo="Equipo">
          <CampoSelect
            etiqueta="Báscula"
            requerido
            value={basculaElegida}
            onChange={(e) => setBasculaId(e.target.value)}
            opciones={basculasActivas.map((b) => ({ value: b.id, label: b.Title }))}
            error={errores.bascula}
          />
          <CampoTexto
            etiqueta="Fecha"
            requerido
            type="date"
            max={hoyISO()}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            ayuda={fecha ? diaDeLaSemana(fecha) : undefined}
            error={errores.fecha}
          />
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="block text-xs text-slate-400">Pesa patrón</span>
            <span className="font-semibold text-slate-800">{bascula ? `${formatoKg(bascula.PesaPatronKg, 2)} kg` : '—'}</span>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="block text-xs text-slate-400">EMP (error máximo permitido)</span>
            <span className="font-semibold text-slate-800">{bascula ? `± ${formatoKg(bascula.EMPKg, 2)} kg` : '—'}</span>
          </div>
        </SeccionFormulario>

        <fieldset className="rounded-lg border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-brand-navy">Mediciones (kg)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            {([0, 1, 2] as const).map((i) => (
              <CampoTexto
                key={i}
                etiqueta={`Medición ${i + 1}`}
                requerido
                type="text"
                inputMode="decimal"
                placeholder="Ej: 50,02"
                value={mediciones[i]}
                onChange={(e) => cambiarMedicion(i, e.target.value)}
                error={errores[`m${i}`]}
              />
            ))}
          </div>

          <div
            className={clsx(
              'mt-4 grid gap-3 rounded-md px-4 py-3 text-sm sm:grid-cols-3',
              !calculo
                ? 'bg-slate-50 text-slate-500'
                : calculo.resultado === 'Conforme'
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'bg-red-50 text-brand-red',
            )}
          >
            <div>
              <span className="block text-xs opacity-70">Promedio</span>
              <span className="text-base font-semibold">{calculo ? `${formatoKg(calculo.promedioKg)} kg` : '—'}</span>
            </div>
            <div>
              <span className="block text-xs opacity-70">Error (pesa patrón − promedio)</span>
              <span className="text-base font-semibold">{calculo ? `${formatoErrorKg(calculo.errorKg)} kg` : '—'}</span>
            </div>
            <div>
              <span className="block text-xs opacity-70">Resultado</span>
              <span className="text-base font-semibold">
                {calculo ? (calculo.resultado === 'Conforme' ? '✓ Conforme' : '✕ No conforme') : 'Completa las 3 mediciones'}
              </span>
            </div>
          </div>
        </fieldset>

        <SeccionFormulario titulo="Responsables">
          <div>
            <CampoBuscable
              etiqueta="Realizó"
              requerido
              placeholder="Escribe para buscar el operario…"
              textoSinOpciones="No hay operarios registrados"
              opciones={operariosActivos.map((o) => ({ value: o.id, label: o.Title }))}
              value={realizoId}
              onChange={setRealizoId}
              error={errores.realizo}
            />
            {operarios !== undefined && operariosActivos.length === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                {usuario.Rol === 'Administrador'
                  ? 'Agrega los operarios en Asociados → Operarios (con conexión).'
                  : 'Pídele a un Administrador que registre los operarios, y abre esta pantalla con conexión.'}
              </p>
            )}
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="block text-xs text-slate-400">Verificó (tu usuario)</span>
            <span className="font-semibold text-slate-800">{usuario.Title}</span>
          </div>
        </SeccionFormulario>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Observaciones
            {calculo?.resultado === 'No conforme' && <span className="text-brand-red"> *</span>}
          </label>
          <textarea
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={3}
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy"
          />
          {errores.observaciones && <p className="mt-1 text-xs text-brand-red">{errores.observaciones}</p>}
        </div>

        <button
          type="submit"
          disabled={guardando || basculasActivas.length === 0}
          className="rounded-md bg-brand-navy px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          {guardando ? 'Guardando…' : 'Guardar verificación'}
        </button>
      </form>

      {recientes.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700">Últimas verificaciones en este dispositivo</h2>
          <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Báscula</th>
                  <th className="px-3 py-2 text-right">Error (kg)</th>
                  <th className="px-3 py-2">Resultado</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recientes.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{c.FechaCalibracion}</td>
                    <td className="px-3 py-2">{c.BasculaNombre}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatoErrorKg(c.ErrorKg)}</td>
                    <td className={clsx('px-3 py-2 font-medium', c.Resultado === 'Conforme' ? 'text-emerald-700' : 'text-brand-red')}>
                      {c.Resultado === 'Conforme' ? '✓ Conforme' : '✕ No conforme'}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">
                      {c.EstadoSync === 'Sincronizada' ? 'Enviada' : 'Pendiente de enviar'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
