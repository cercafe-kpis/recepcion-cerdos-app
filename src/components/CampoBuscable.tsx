import { useId, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'

/** Minúsculas y sin tildes, para que "jose" encuentre "José" y "nunez" encuentre "Núñez". */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

type Props = {
  etiqueta: string
  requerido?: boolean
  error?: string
  placeholder?: string
  opciones: Array<{ value: string; label: string }>
  /** `value` de la opción elegida ('' si ninguna). */
  value: string
  onChange: (value: string) => void
  /** Texto cuando no hay ninguna opción cargada. */
  textoSinOpciones?: string
}

/**
 * Lista desplegable con buscador (2026-10-14, campo "Realizó" de CalibracionBascula.tsx): se
 * escribe parte del nombre, se filtra la lista y SOLO se puede quedar con una opción de la lista —
 * si lo escrito no coincide con ninguna al salir del campo, se borra. Teclado: ↑/↓ para moverse,
 * Enter para elegir, Esc para cerrar.
 */
export function CampoBuscable({
  etiqueta,
  requerido,
  error,
  placeholder,
  opciones,
  value,
  onChange,
  textoSinOpciones = 'No hay opciones registradas',
}: Props) {
  const idLista = useId()
  const elegida = opciones.find((o) => o.value === value)
  const [texto, setTexto] = useState<string>()
  const [abierta, setAbierta] = useState(false)
  const [resaltada, setResaltada] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mientras no se esté escribiendo, el campo muestra el nombre de la opción elegida.
  const textoVisible = texto ?? elegida?.label ?? ''

  const filtradas = useMemo(() => {
    const q = normalizar(texto ?? '')
    const lista = q ? opciones.filter((o) => normalizar(o.label).includes(q)) : opciones
    return [...lista].sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }, [opciones, texto])

  function elegir(op: { value: string; label: string }) {
    onChange(op.value)
    setTexto(undefined)
    setAbierta(false)
  }

  function alSalir() {
    if (texto !== undefined) {
      const exacta = opciones.find((o) => normalizar(o.label) === normalizar(texto))
      // Solo se queda lo que coincide exactamente con un nombre de la lista; si no, se borra.
      onChange(exacta ? exacta.value : '')
    }
    setTexto(undefined)
    setAbierta(false)
  }

  return (
    <div className="relative">
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {etiqueta}
        {requerido && <span className="text-brand-red"> *</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={abierta}
          aria-controls={idLista}
          autoComplete="off"
          placeholder={opciones.length === 0 ? textoSinOpciones : placeholder}
          disabled={opciones.length === 0}
          value={textoVisible}
          onFocus={() => {
            setAbierta(true)
            setResaltada(0)
          }}
          onChange={(e) => {
            setTexto(e.target.value)
            setAbierta(true)
            setResaltada(0)
          }}
          onBlur={alSalir}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setAbierta(true)
              setResaltada((i) => Math.min(i + 1, filtradas.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setResaltada((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault() // no enviar el formulario desde aquí
              if (abierta && filtradas[resaltada]) elegir(filtradas[resaltada])
            } else if (e.key === 'Escape') {
              setTexto(undefined)
              setAbierta(false)
            }
          }}
          className="block w-full rounded-md border border-slate-300 px-3 py-2 pr-16 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
        />
        {value && (
          <button
            type="button"
            aria-label="Quitar selección"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange('')
              setTexto(undefined)
              inputRef.current?.focus()
            }}
            className="absolute inset-y-0 right-8 px-1 text-slate-400 hover:text-slate-600"
          >
            ✕
          </button>
        )}
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">▾</span>
      </div>

      {abierta && opciones.length > 0 && (
        <ul
          id={idLista}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {filtradas.length === 0 ? (
            <li className="px-3 py-2 text-slate-400">Ningún nombre coincide con “{texto}”</li>
          ) : (
            filtradas.map((op, i) => (
              <li
                key={op.value}
                role="option"
                aria-selected={op.value === value}
                onMouseDown={(e) => e.preventDefault()} // evita que el blur cierre antes del clic
                onClick={() => elegir(op)}
                onMouseEnter={() => setResaltada(i)}
                className={clsx(
                  'cursor-pointer px-3 py-2',
                  i === resaltada ? 'bg-brand-navy-tint text-brand-navy' : 'text-slate-700',
                  op.value === value && 'font-semibold',
                )}
              >
                {op.label}
              </li>
            ))
          )}
        </ul>
      )}

      {error && <p className="mt-1 text-xs text-brand-red">{error}</p>}
    </div>
  )
}
