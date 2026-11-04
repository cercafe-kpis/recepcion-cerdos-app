import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import clsx from 'clsx'

/**
 * Lista desplegable CON buscador (2026-11-04, a pedido de Nathalia, para Asociado, Granja y Placa
 * del vehículo en Recepción): reemplaza al <select> nativo, que con decenas de placas o granjas
 * obligaba a recorrer toda la lista. Se ve igual que los demás campos (CampoSelect/CampoTexto) y:
 *
 * - Al tocar el campo (o la flecha) se despliega la lista completa, como un <select> normal.
 * - Al escribir, la lista se filtra por cualquier parte del texto, sin importar tildes ni
 *   mayúsculas ("nunez" encuentra "Núñez", "gtu" encuentra "GTU344").
 * - ↑/↓ para moverse, Enter para elegir, Esc para cerrar sin cambiar nada.
 * - Solo acepta valores de la lista: si al salir del campo lo escrito no corresponde a ninguna
 *   opción, vuelve a mostrar la opción que ya estaba elegida (o queda vacío si no había ninguna).
 *   Borrar todo el texto y salir deja el campo sin elegir.
 *
 * Es un componente "controlado" (value/onChange con el id de la opción): en los formularios con
 * react-hook-form se conecta con <Controller>, ver Recepcion.tsx. El valor que se guarda es el
 * MISMO id que guardaba el <select> antes — no cambia nada en Dexie ni en SharePoint.
 */

export type OpcionBuscable = { value: string; label: string }

/** Minúsculas y sin tildes, para comparar sin importar cómo se escribió. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const claseInput =
  'block w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy'

type Props = {
  etiqueta: string
  requerido?: boolean
  error?: string
  opciones: OpcionBuscable[]
  value: string
  onChange: (valor: string) => void
  onBlur?: () => void
  name?: string
  placeholder?: string
  /** Texto cuando el filtro no encuentra nada. */
  textoSinResultados?: string
}

export function CampoBuscable({
  etiqueta,
  requerido,
  error,
  opciones,
  value,
  onChange,
  onBlur,
  name,
  placeholder = 'Selecciona o escribe para buscar…',
  textoSinResultados = 'No hay coincidencias',
}: Props) {
  const idBase = useId()
  const idLista = `${idBase}-lista`
  const contenedorRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listaRef = useRef<HTMLUListElement>(null)

  const seleccionada = opciones.find((o) => o.value === value)
  const [texto, setTexto] = useState(seleccionada?.label ?? '')
  const [abierta, setAbierta] = useState(false)
  // true cuando la persona escribió algo desde que abrió la lista: solo entonces se filtra. Si
  // apenas abre la lista (con algo ya elegido) se muestran todas, como un <select> normal.
  const [filtrando, setFiltrando] = useState(false)
  const [resaltada, setResaltada] = useState(0)

  // Con la lista cerrada se muestra siempre el nombre de la opción elegida (así se pone al día solo
  // si el valor cambia desde fuera: reset del formulario, la Granja que se borra al cambiar de
  // Asociado, etc.). Lo que la persona escribe solo se usa mientras la lista está abierta.
  const textoVisible = abierta ? texto : (seleccionada?.label ?? '')

  const filtradas = useMemo(() => {
    if (!filtrando) return opciones
    const buscado = normalizar(texto)
    if (!buscado) return opciones
    return opciones.filter((o) => normalizar(o.label).includes(buscado))
  }, [opciones, texto, filtrando])

  // Mantiene visible la opción resaltada al moverse con el teclado.
  useEffect(() => {
    if (!abierta) return
    const item = listaRef.current?.children[resaltada] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [resaltada, abierta])

  function abrir() {
    if (abierta) return
    setTexto(seleccionada?.label ?? '')
    setAbierta(true)
    setFiltrando(false)
    const indice = opciones.findIndex((o) => o.value === value)
    setResaltada(indice >= 0 ? indice : 0)
  }

  function cerrar() {
    setAbierta(false)
    setFiltrando(false)
  }

  function elegir(opcion: OpcionBuscable) {
    onChange(opcion.value)
    setTexto(opcion.label)
    cerrar()
  }

  /** Al salir del campo: solo se aceptan valores de la lista. */
  function confirmarAlSalir() {
    if (!abierta) return
    const escrito = normalizar(texto)
    if (!escrito) {
      if (value) onChange('')
      setTexto('')
    } else {
      // Si lo escrito es exactamente una opción (ej. pegó la placa completa), se toma esa.
      const exacta = opciones.find((o) => normalizar(o.label) === escrito)
      if (exacta) {
        if (exacta.value !== value) onChange(exacta.value)
        setTexto(exacta.label)
      } else {
        setTexto(seleccionada?.label ?? '')
      }
    }
    cerrar()
    onBlur?.()
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!abierta) abrir()
        else setResaltada((i) => Math.min(i + 1, filtradas.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!abierta) abrir()
        else setResaltada((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        // Nunca envía el formulario desde aquí: Enter solo elige la opción resaltada.
        e.preventDefault()
        if (abierta && filtradas[resaltada]) elegir(filtradas[resaltada])
        else abrir()
        break
      case 'Escape':
        if (abierta) {
          e.preventDefault()
          setTexto(seleccionada?.label ?? '')
          cerrar()
        }
        break
      case 'Tab':
        confirmarAlSalir()
        break
    }
  }

  return (
    <div
      ref={contenedorRef}
      onBlur={(e) => {
        // Se ignora el blur si el foco se queda dentro del mismo campo (ej. tocar la flecha).
        if (!contenedorRef.current?.contains(e.relatedTarget as Node | null)) confirmarAlSalir()
      }}
    >
      <label htmlFor={`${idBase}-input`} className="mb-1 block text-sm font-medium text-slate-700">
        {etiqueta}
        {requerido && <span className="text-brand-red"> *</span>}
      </label>
      <div className="relative">
        <input
          ref={inputRef}
          id={`${idBase}-input`}
          name={name}
          type="text"
          role="combobox"
          aria-expanded={abierta}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={abierta && filtradas[resaltada] ? `${idBase}-op-${resaltada}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={textoVisible}
          onFocus={abrir}
          onClick={abrir}
          onChange={(e) => {
            setTexto(e.target.value)
            setFiltrando(true)
            setResaltada(0)
            setAbierta(true)
          }}
          onKeyDown={onKeyDown}
          className={clsx(claseInput, error && 'border-brand-red')}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={abierta ? 'Cerrar lista' : 'Abrir lista'}
          onMouseDown={(e) => {
            // mousedown + preventDefault: no le quita el foco al input.
            e.preventDefault()
            if (abierta) {
              setTexto(seleccionada?.label ?? '')
              cerrar()
            } else {
              inputRef.current?.focus()
              abrir()
            }
          }}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className={clsx('h-4 w-4 transition-transform', abierta && 'rotate-180')} aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {abierta && (
          <ul
            ref={listaRef}
            id={idLista}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
          >
            {filtradas.length === 0 ? (
              <li className="px-3 py-2 text-slate-400">{opciones.length === 0 ? 'No hay opciones disponibles' : textoSinResultados}</li>
            ) : (
              filtradas.map((op, i) => (
                <li
                  key={op.value}
                  id={`${idBase}-op-${i}`}
                  role="option"
                  aria-selected={op.value === value}
                  // mousedown (no click) para elegir ANTES del blur del input.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    elegir(op)
                  }}
                  onMouseEnter={() => setResaltada(i)}
                  className={clsx(
                    'cursor-pointer px-3 py-2',
                    i === resaltada ? 'bg-brand-navy text-white' : 'text-slate-700',
                    op.value === value && i !== resaltada && 'font-semibold text-brand-navy',
                  )}
                >
                  {op.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-brand-red">{error}</p>}
    </div>
  )
}
