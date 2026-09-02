import { useEffect, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { db } from '../offline/db'
import { buscarUsuarioPorCorreo } from '../graph/lists'
import type { Usuario } from '../types/models'

interface EstadoUsuarioActual {
  usuario: Usuario | undefined
  cargando: boolean
  error: string | undefined
}

/**
 * Resuelve el Usuario (con su Rol) de la persona que inició sesión con su
 * cuenta @cercafe.com.co. Con conexión, confirma contra la lista Usuarios de
 * SharePoint y refresca la copia local; sin conexión, cae a la última copia
 * local conocida (la que quedó guardada la última vez que hubo internet, ver
 * descargarMaestros() en src/offline/syncService.ts) — así la app sigue
 * sabiendo qué puede hacer este usuario aunque no haya señal.
 *
 * El Rol que devuelve este hook es solo para decidir qué botones mostrar en
 * pantalla (ver src/components/ProtegidoPorRol.tsx, pendiente). El control
 * real de permisos lo hace el grupo de SharePoint al que pertenece la cuenta
 * — ver Arquitectura-App-Recepcion-Cerdos.md sección 6.
 */
export function useCurrentUser(): EstadoUsuarioActual {
  const { accounts } = useMsal()
  const correo = accounts[0]?.username

  const [usuario, setUsuario] = useState<Usuario>()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!correo) {
      setCargando(false)
      return
    }

    let cancelado = false

    async function resolver() {
      try {
        const remoto = await buscarUsuarioPorCorreo(correo!)
        if (cancelado) return
        if (remoto) {
          setUsuario(remoto)
          setError(undefined)
          await db.usuarios.put(remoto)
        } else {
          setError('Este correo no está registrado en la lista Usuarios de SharePoint. Pídele a un Administrador que te cree el registro.')
        }
      } catch {
        // Sin conexión (o Graph no responde en este momento) — usa la última copia local conocida.
        const local = await db.usuarios.where('Correo').equals(correo!).first()
        if (cancelado) return
        if (local) {
          setUsuario(local)
          setError(undefined)
        } else {
          setError('No hay conexión y este usuario todavía no tiene una copia local guardada. Conéctate una vez para poder trabajar luego sin internet.')
        }
      } finally {
        if (!cancelado) setCargando(false)
      }
    }

    void resolver()
    return () => {
      cancelado = true
    }
  }, [correo])

  return { usuario, cargando, error }
}
