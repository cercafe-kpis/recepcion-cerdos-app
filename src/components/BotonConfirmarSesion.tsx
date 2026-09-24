import { useConfirmarSesion } from '../auth/useConfirmarSesion'

/**
 * Botón "Confirmar sesión" para poner junto a cualquier banner de error que muestre uno de los 2
 * mensajes de sesión de Microsoft (ver esErrorDeSesion() en src/graph/client.ts) — cada pantalla
 * decide en `alConfirmar` qué hacer si se logra confirmar (limpiar su error, reintentar su última
 * búsqueda, resincronizar, etc.); si `alConfirmar()` es async, esta función no espera a que termine.
 */
export function BotonConfirmarSesion({ alConfirmar }: { alConfirmar: () => void | Promise<void> }) {
  const { confirmarSesion, confirmando, errorConfirmacion } = useConfirmarSesion()

  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() =>
          void confirmarSesion().then((ok) => {
            if (ok) void alConfirmar()
          })
        }
        disabled={confirmando}
        className="ml-2 rounded-md border border-brand-red/40 px-2 py-1 text-xs font-medium text-brand-red hover:bg-red-100 disabled:opacity-50"
      >
        {confirmando ? 'Confirmando…' : 'Confirmar sesión'}
      </button>
      {errorConfirmacion && <p className="mt-1 text-xs font-medium text-brand-red">{errorConfirmacion}</p>}
    </span>
  )
}
