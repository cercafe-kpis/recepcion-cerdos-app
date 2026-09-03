import { useEffect, useState } from 'react'
import { actualizarUsuario, crearUsuario, eliminarUsuario, listarUsuarios } from '../../graph/lists'
import { db } from '../../offline/db'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import type { Rol, Usuario } from '../../types/models'

const ROLES: Rol[] = ['Administrador', 'Supervisor', 'Auditor', 'Consultor']

/**
 * A diferencia de Asociados/Granjas/Vehículos, crear un usuario aquí SOLO
 * crea su registro en la lista Usuarios (con su Rol, que la app usa
 * únicamente para mostrar u ocultar botones — ver ProtegidoPorRol.tsx). El
 * permiso REAL de leer/escribir en SharePoint lo da el grupo del sitio al
 * que pertenece la cuenta, y esta pantalla no puede agregarlo ahí (Graph no
 * expone esa operación con los permisos que tiene esta app). Después de
 * crear o reactivar a alguien aquí, hay que agregarlo también manualmente
 * en el sitio → engranaje → Permisos del sitio → grupo Miembros (o
 * Visitantes si su rol es Consultor) — ver Arquitectura-App-Recepcion-Cerdos.md
 * sección 6.
 *
 * `usuario` es la persona con la sesión abierta (no la fila de la tabla) —
 * Editar/Eliminar de cada fila solo se muestran si esa persona es
 * Administrador (ver el comentario largo sobre esto en AsociadosAdmin.tsx).
 * Eliminar aquí solo borra el registro de Usuarios: NO quita a nadie del
 * grupo de SharePoint, eso sigue siendo un paso manual aparte.
 */
export function UsuariosAdmin({ usuario }: { usuario: Usuario }) {
  const esAdmin = usuario.Rol === 'Administrador'

  const [usuarios, setUsuarios] = useState<Usuario[]>()
  const [error, setError] = useState<string>()
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoCorreo, setNuevoCorreo] = useState('')
  const [nuevoRol, setNuevoRol] = useState<Rol>('Auditor')
  const [guardando, setGuardando] = useState(false)

  const [editandoId, setEditandoId] = useState<string>()
  const [editNombre, setEditNombre] = useState('')
  const [editCorreo, setEditCorreo] = useState('')

  async function recargar() {
    try {
      const lista = await listarUsuarios()
      setUsuarios(lista)
      setError(undefined)
      await db.usuarios.bulkPut(lista)
    } catch (err) {
      setError(`No se pudo cargar Usuarios: ${(err as Error).message}`)
    }
  }

  useEffect(() => {
    void recargar()
  }, [])

  async function agregar() {
    if (!nuevoNombre.trim() || !nuevoCorreo.trim()) return
    setGuardando(true)
    try {
      await crearUsuario({ Title: nuevoNombre.trim(), Correo: nuevoCorreo.trim(), Rol: nuevoRol })
      setNuevoNombre('')
      setNuevoCorreo('')
      setNuevoRol('Auditor')
      await recargar()
    } catch (err) {
      setError(`No se pudo crear el usuario: ${(err as Error).message}`)
    } finally {
      setGuardando(false)
    }
  }

  async function cambiarRol(fila: Usuario, rol: Rol) {
    try {
      await actualizarUsuario(fila.id, { Rol: rol })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar el rol: ${(err as Error).message}`)
    }
  }

  async function alternarActivo(fila: Usuario) {
    try {
      await actualizarUsuario(fila.id, { Activo: !fila.Activo })
      await recargar()
    } catch (err) {
      setError(`No se pudo actualizar: ${(err as Error).message}`)
    }
  }

  function empezarEdicion(fila: Usuario) {
    setEditandoId(fila.id)
    setEditNombre(fila.Title)
    setEditCorreo(fila.Correo)
  }

  async function guardarEdicion(id: string) {
    if (!editNombre.trim() || !editCorreo.trim()) return
    try {
      await actualizarUsuario(id, { Title: editNombre.trim(), Correo: editCorreo.trim() })
      setEditandoId(undefined)
      await recargar()
    } catch (err) {
      setError(`No se pudo guardar: ${(err as Error).message}`)
    }
  }

  async function eliminar(fila: Usuario) {
    const confirmado = window.confirm(
      `¿Eliminar definitivamente a "${fila.Title}"? Esto borra su registro de Usuarios sin poder deshacerlo. ` +
        'No lo quita del grupo de SharePoint (Miembros/Visitantes) — si además quieres cortarle el acceso real, ' +
        'hazlo también ahí. Si solo quieres que no pueda usar la app por ahora, mejor usa "Desactivar".',
    )
    if (!confirmado) return
    try {
      await eliminarUsuario(fila.id)
      await recargar()
    } catch (err) {
      setError(`No se pudo eliminar: ${(err as Error).message}`)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800">Usuarios</h1>
      <p className="mt-1 text-sm text-slate-500">Tabla maestra — requiere conexión a internet.</p>
      <p className="mt-2 max-w-2xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        Crear o reactivar a alguien aquí NO le da acceso al sitio de SharePoint. Después de este paso, agrégalo
        manualmente en el sitio → engranaje → Permisos del sitio → grupo <strong>Miembros</strong> (o{' '}
        <strong>Visitantes</strong> si su rol es Consultor) — de lo contrario no va a poder leer ni guardar datos.
      </p>

      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red">{error}</p>}

      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="w-52">
          <CampoTexto etiqueta="Nombre completo" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} />
        </div>
        <div className="w-64">
          <CampoTexto
            type="email"
            etiqueta="Correo @cercafe.com.co"
            value={nuevoCorreo}
            onChange={(e) => setNuevoCorreo(e.target.value)}
          />
        </div>
        <div className="w-44">
          <CampoSelect
            etiqueta="Rol"
            value={nuevoRol}
            onChange={(e) => setNuevoRol(e.target.value as Rol)}
            opciones={ROLES.map((r) => ({ value: r, label: r }))}
          />
        </div>
        <button
          type="button"
          onClick={() => void agregar()}
          disabled={guardando || !nuevoNombre.trim() || !nuevoCorreo.trim()}
          className="rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy-hover disabled:opacity-60"
        >
          Agregar
        </button>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">Correo</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Estado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {usuarios === undefined && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {usuarios?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                  Todavía no hay usuarios registrados.
                </td>
              </tr>
            )}
            {usuarios?.map((u) =>
              editandoId === u.id ? (
                <tr key={u.id} className="bg-brand-navy-tint/40">
                  <td className="px-3 py-2">
                    <input
                      value={editNombre}
                      onChange={(e) => setEditNombre(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="email"
                      value={editCorreo}
                      onChange={(e) => setEditCorreo(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2 text-slate-600">{u.Rol}</td>
                  <td className="px-3 py-2 text-slate-600">{u.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => void guardarEdicion(u.id)}
                      disabled={!editNombre.trim() || !editCorreo.trim()}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline disabled:opacity-50"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditandoId(undefined)}
                      className="text-xs font-medium text-slate-500 hover:underline"
                    >
                      Cancelar
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-medium text-slate-700">{u.Title}</td>
                  <td className="px-3 py-2 text-slate-600">{u.Correo}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.Rol}
                      onChange={(e) => void cambiarRol(u, e.target.value as Rol)}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-slate-600">{u.Activo ? 'Activo' : 'Inactivo'}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => empezarEdicion(u)}
                        className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                      >
                        Editar
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void alternarActivo(u)}
                      className="mr-3 text-xs font-medium text-brand-navy hover:underline"
                    >
                      {u.Activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {esAdmin && (
                      <button
                        type="button"
                        onClick={() => void eliminar(u)}
                        className="text-xs font-medium text-brand-red hover:underline"
                      >
                        Eliminar
                      </button>
                    )}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
