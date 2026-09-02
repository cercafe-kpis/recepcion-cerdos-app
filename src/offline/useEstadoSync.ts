import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { sincronizar, type ResultadoSync } from './syncService'

/**
 * Punto único de estado de sincronización para toda la interfaz (el
 * contador en la barra superior, el botón "Sincronizar ahora", el aviso de
 * conflictos de Consecutivo). useLiveQuery hace que estos números se
 * actualicen solos apenas algo cambia en Dexie — ninguna pantalla necesita
 * volver a consultarlos a mano después de guardar una captura.
 */
export function useEstadoSync() {
  const [enLinea, setEnLinea] = useState(navigator.onLine)
  const [sincronizando, setSincronizando] = useState(false)
  const [ultimoResultado, setUltimoResultado] = useState<ResultadoSync>()

  useEffect(() => {
    const marcarEnLinea = () => setEnLinea(true)
    const marcarSinConexion = () => setEnLinea(false)
    window.addEventListener('online', marcarEnLinea)
    window.addEventListener('offline', marcarSinConexion)
    return () => {
      window.removeEventListener('online', marcarEnLinea)
      window.removeEventListener('offline', marcarSinConexion)
    }
  }, [])

  const pendientes =
    useLiveQuery(async () => {
      const [r, u, n, t] = await Promise.all([
        db.recepciones.where('EstadoSync').equals('Pendiente').count(),
        db.ubicaciones.where('EstadoSync').equals('Pendiente').count(),
        db.novedadesCorral.where('EstadoSync').equals('Pendiente').count(),
        db.consolidadoTiquetes.where('EstadoSync').equals('Pendiente').count(),
      ])
      return r + u + n + t
    }, []) ?? 0

  const conflictos =
    useLiveQuery(() => db.recepciones.where('EstadoSync').equals('ConflictoConsecutivo').count(), []) ?? 0

  async function sincronizarAhora(correoUsuario: string) {
    if (!enLinea || sincronizando) return
    setSincronizando(true)
    try {
      setUltimoResultado(await sincronizar(correoUsuario))
    } finally {
      setSincronizando(false)
    }
  }

  return { enLinea, pendientes, conflictos, sincronizando, ultimoResultado, sincronizarAhora }
}
