import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Rol, Usuario } from '../types/models'

interface Props {
  usuario: Usuario
  permitido: Rol[]
  children: ReactNode
}

/**
 * Oculta una ruta según el Rol leído de la lista Usuarios — es una
 * conveniencia de interfaz, no el control de acceso real. El cumplimiento
 * real de permisos lo hace el grupo de SharePoint al que pertenece la
 * cuenta (Administradores/Supervisores/Auditores/Consulta): aunque alguien
 * manipulara el cliente para saltarse esta pantalla, Graph le rechazaría la
 * escritura si su cuenta no está en el grupo correspondiente. Ver
 * Arquitectura-App-Recepcion-Cerdos.md sección 6.
 */
export function ProtegidoPorRol({ usuario, permitido, children }: Props) {
  if (!permitido.includes(usuario.Rol)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
