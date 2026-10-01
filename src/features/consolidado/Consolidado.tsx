import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import clsx from 'clsx'
import { db } from '../../offline/db'
import {
  cachearTiquetesDeRecepcion,
  corregirConsecutivoConflicto,
  descartarRecepcionConflicto,
  guardarEdicionTiqueteLocal,
  sincronizar,
} from '../../offline/syncService'
import {
  actualizarConsecutivoYOrden,
  actualizarGranjaDeRecepcion,
  actualizarHorasDeRecepcion,
  buscarRecepcionesPorConsecutivo,
  decrementarConteoOrigenTiquete,
  eliminarTiquete,
  generarTiquetesFaltantes,
  generarTiquetesNovedadCorral,
  listarRecepcionesPorRangoFecha,
  marcarLoteCompleto,
  obtenerNovedadCorralDeRecepcion,
  obtenerRecepcionActual,
  reabrirLote,
} from '../../graph/lists'
import { esErrorDeSesion } from '../../graph/client'
import { CampoSelect, CampoTexto } from '../../components/CamposFormulario'
import { BotonConfirmarSesion } from '../../components/BotonConfirmarSesion'
import { ReporteDiarioLote } from '../reportes/ReporteDiarioLote'
import type { ConsolidadoTiquete, Destino, NovedadCorral, Recepcion, Usuario } from '../../types/models'

function hoyISO() {
  return new Date().toISOString().slice(0, 10)
}

/** Mismo criterio que combinarFechaHora() en Recepcion.tsx — ver el comentario grande allá sobre
 * por qué se usa un offset fijo -05:00 en vez de dejar que el navegador ponga el suyo. */
function combinarFechaHora(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00-05:00`
}

/** Contraparte de combinarFechaHora(): saca "HH:MM" de una fecha-hora ISO guardada, para precargar
 * el <input type="time"> al entrar a editar. Mismo criterio que horaCorta() en los reportes
 * (ReporteDiarioLote.tsx/ReporteCierreDiario.tsx, `iso.slice(11, 16)`). */
function horaCorta(iso: string | undefined): string {
  if (!iso || iso.length < 16) return ''
  return iso.slice(11, 16)
}

/**
 * El objetivo de todo el flujo (Recepción → Ubicación/Novedades en Corral →
 * Consolidado): ponerle Tiquete y Destino a cada animal que tuvo alguna
 * novedad, uno por uno. Las filas de la tabla las genera el servidor de
 * sincronización (ver generarTiquetesFaltantes / generarTiquetesNovedadCorral
 * en src/graph/lists.ts) — esta pantalla no crea tiquetes, solo permite
 * completarlos. Por eso solo aparecen aquí las Recepciones que ya
 * sincronizaron al menos una vez.
 */
export function Consolidado({ usuario }: { usuario: Usuario }) {
  const [recepcionId, setRecepcionId] = useState('')
  const [actualizando, setActualizando] = useState(false)
  const [regenerando, setRegenerando] = useState(false)
  const [terminando, setTerminando] = useState(false)
  const [reabriendo, setReabriendo] = useState(false)
  const [fechaBusqueda, setFechaBusqueda] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [consecutivoBusqueda, setConsecutivoBusqueda] = useState('')
  const [buscandoConsecutivo, setBuscandoConsecutivo] = useState(false)
  const [error, setError] = useState<string>()
  const [verReporteInmediato, setVerReporteInmediato] = useState(false)
  const [novedadCorral, setNovedadCorral] = useState<NovedadCorral>()
  const esAdmin = usuario.Rol === 'Administrador'
  // Panel "Consecutivos repetidos" más abajo: a diferencia de "Editar Consecutivo/Número de orden"
  // (candado `soloLectura`, igual que Granja — ver más abajo), esto corrige o descarta una captura
  // que TODAVÍA no llegó a SharePoint y que la propia persona capturó — a pedido de Nathalia
  // (2026-09-29), para que quien audita no dependa de un Administrador cada vez que le pasa esto.
  // Abierto a cualquiera que pueda capturar (Administrador/Supervisor/Auditor); solo Consultor, de
  // solo lectura, se queda sin verlo. No usa `soloLectura` porque un conflicto no está ligado a un
  // lote "Completo"/"En proceso" — el registro ni siquiera llegó a SharePoint.
  const puedeResolverConflictos = usuario.Rol !== 'Consultor'

  // Edición de Consecutivo/Número de orden (2026-09-26, a pedido de Nathalia) — ver el botón
  // "Editar" más abajo y actualizarConsecutivoYOrden() en graph/lists.ts. Solo estos 2 campos: el
  // resto de la Recepción sigue sin poder tocarse una vez capturada. Candado: ver el comentario
  // junto al botón, más abajo (usa `soloLectura`, igual que Granja, desde 2026-10-01).
  const [editandoConsecutivo, setEditandoConsecutivo] = useState(false)
  const [nuevoConsecutivo, setNuevoConsecutivo] = useState('')
  const [nuevoNumeroOrden, setNuevoNumeroOrden] = useState('')
  const [guardandoConsecutivo, setGuardandoConsecutivo] = useState(false)

  // Eliminar novedad (2026-09-24, a pedido de Nathalia) — ver eliminarFila() más abajo.
  const [eliminandoId, setEliminandoId] = useState<string>()

  // Editar Granja (2026-09-24, a pedido de Nathalia): usa el candado `soloLectura` del resto de la
  // pantalla — cualquiera que no sea Consultor puede corregirla mientras el lote siga "En proceso",
  // y solo un Administrador una vez que quede "Completo". Ver guardarGranja() y actualizarGranja()
  // en graph/lists.ts. (Desde 2026-10-01, Consecutivo/Número de orden arriba usa el mismo candado.)
  const [editandoGranja, setEditandoGranja] = useState(false)
  const [nuevaGranjaId, setNuevaGranjaId] = useState('')
  const [guardandoGranja, setGuardandoGranja] = useState(false)

  // Editar horas (2026-09-28, a pedido de Nathalia) — candado: siempre Administrador, en
  // cualquier momento, sin usar `soloLectura` (a diferencia de Granja y, desde 2026-10-01, también
  // Consecutivo/Número de orden). Ver empezarEdicionHoras()/guardarHoras() más abajo y
  // actualizarHorasDeRecepcion() en graph/lists.ts.
  const [editandoHoras, setEditandoHoras] = useState(false)
  const [nuevaHoraProgramada, setNuevaHoraProgramada] = useState('')
  const [nuevaHoraLlegadaVehiculo, setNuevaHoraLlegadaVehiculo] = useState('')
  const [nuevaHoraInicioDesembarque, setNuevaHoraInicioDesembarque] = useState('')
  const [nuevaHoraFinalDesembarque, setNuevaHoraFinalDesembarque] = useState('')
  const [guardandoHoras, setGuardandoHoras] = useState(false)

  // Panel "Consecutivos repetidos" (2026-09-29, a pedido de Nathalia — primer caso real de este
  // conflicto en producción): antes la app solo avisaba cuántos había (badge en Navbar.tsx), sin
  // ninguna pantalla para resolverlos. Candado: `puedeResolverConflictos` arriba (abierto a
  // cualquiera que no sea Consultor desde el primer día de este panel, a pedido de Nathalia). Ver
  // corregirConsecutivoConflicto()/descartarRecepcionConflicto() en syncService.ts.
  const [editandoConflictoId, setEditandoConflictoId] = useState<string>()
  const [consecutivoConflicto, setConsecutivoConflicto] = useState('')
  const [numeroOrdenConflicto, setNumeroOrdenConflicto] = useState('')
  const [resolviendoConflictoId, setResolviendoConflictoId] = useState<string>()

  const recepciones =
    useLiveQuery(
      () => db.recepciones.where('EstadoSync').equals('Sincronizada').reverse().sortBy('FechaRecepcion'),
      [],
    ) ?? []

  const recepcionesConflicto =
    useLiveQuery(
      () => db.recepciones.where('EstadoSync').equals('ConflictoConsecutivo').reverse().sortBy('FechaRecepcion'),
      [],
    ) ?? []

  // A pedido de Nathalia (2026-09-11): el desplegable de "Recepción" ya no muestra TODO el
  // historial que este dispositivo tenga acumulado en Dexie (crecía cada vez más con los meses,
  // sobre todo si se usaba "Buscar por fecha" seguido) — por defecto solo se ven los lotes
  // recibidos HOY. `idsFueraDeHoy` guarda, aparte, los ids de cualquier Recepción que un buscador
  // (por fecha o por Consecutivo, ambos más abajo) haya traído a la vista en esta sesión aunque no
  // sea de hoy — así siguen apareciendo en el desplegable sin que este vuelva a mostrar todo el
  // historial completo.
  const [idsFueraDeHoy, setIdsFueraDeHoy] = useState<string[]>([])
  const hoy = hoyISO()
  const recepcionesVisibles = useMemo(
    () => recepciones.filter((r) => r.FechaRecepcion === hoy || idsFueraDeHoy.includes(r.id)),
    [recepciones, hoy, idsFueraDeHoy],
  )

  const recepcion = useMemo(() => recepciones.find((r) => r.id === recepcionId), [recepciones, recepcionId])

  // Candado de edición del LOTE completo, a pedido explícito del usuario: se bloquea para
  // no-Administradores solo cuando ALGUIEN lo marca a mano como terminado con el botón "Terminar
  // proceso" (ver terminarProceso() más abajo, que llama a marcarLoteCompleto()) — nunca
  // automáticamente. Antes se cerraba solo apenas todos los tiquetes tenían Tiquete+Destino (ver la
  // nota histórica sobre cerrarLotesCompletos() en syncService.ts), pero eso podía bloquear un
  // Fortuito antes de alcanzar a ponerle la Factura, justo cuando el proceso se hace en varias
  // partes/sesiones separadas. Nathalia confirmó explícitamente (2026-09-11) dejar esta parte tal
  // cual: un Administrador siempre puede seguir editando un lote ya cerrado, viejo y nuevo.
  const loteCompleto = recepcion?.EstadoLote === 'Completo'
  const soloLectura = usuario.Rol === 'Consultor' || (loteCompleto && !esAdmin)

  /**
   * Candado adicional, por TIQUETE individual (2026-09-11, a pedido de Nathalia): Auditor y
   * Supervisor pueden completar cualquier tiquete que todavía esté vacío — sin importar si es de
   * una novedad vieja o de una que se acaba de capturar en Ubicación/Novedades en Corral — pero en
   * cuanto un tiquete YA tiene Tiquete+Destino cargados, solo un Administrador puede seguir
   * modificándolo. Antes, mientras el lote seguía "En proceso", cualquier perfil que no fuera
   * Consultor podía editar CUALQUIER tiquete del lote, incluido uno que otra persona ya había
   * completado — este candado nuevo cierra ese hueco sin tocar el candado de LOTE de arriba (que
   * sigue igual: Consultor siempre bloqueado, y un lote "Completo" sigue bloqueando a todo el que
   * no sea Administrador).
   *
   * "Ya tiene Tiquete+Destino cargados" se lee de `EstadoTiquete === 'Completo'` (lo calcula
   * SharePoint apenas el tiquete tiene esos 2 campos, ver actualizarTiquete() en
   * src/graph/lists.ts) y NO de tiqueteYaCompletado() de más abajo — a propósito, porque
   * tiqueteYaCompletado() además exige Factura en los Fortuitos, y ese requisito es solo para la
   * etiqueta "Falta factura" y el aviso de terminarProceso(), no para este candado. Como
   * `EstadoTiquete` en Dexie solo se pone al día con un refresco explícito contra SharePoint (ver
   * el comentario grande de terminarProceso()), quien acaba de escribir un Tiquete/Destino todavía
   * puede corregirlo hasta que se refresque — recién ahí queda bloqueado para su propio perfil.
   */
  function filaSoloLectura(t: ConsolidadoTiquete): boolean {
    if (soloLectura) return true
    if (esAdmin) return false
    return t.EstadoTiquete === 'Completo'
  }

  const granja = useLiveQuery(() => (recepcion ? db.granjas.get(recepcion.GranjaId) : undefined), [recepcion])
  const asociado = useLiveQuery(() => (recepcion ? db.asociados.get(recepcion.AsociadoId) : undefined), [recepcion])
  const vehiculo = useLiveQuery(() => (recepcion ? db.vehiculos.get(recepcion.PlacaVehiculoId) : undefined), [recepcion])
  // Opciones para "Editar Granja" — mismo criterio que el combo de Recepcion.tsx: solo activas y
  // solo del mismo Asociado que ya tiene esta Recepción (Asociado no se puede corregir desde aquí).
  const granjasDelAsociado =
    useLiveQuery(
      () => (recepcion ? db.granjas.where('AsociadoId').equals(recepcion.AsociadoId).filter((g) => g.Activa).toArray() : []),
      [recepcion],
    ) ?? []

  const tiquetes =
    useLiveQuery(
      () => (recepcion?.spId ? db.consolidadoTiquetes.where('RecepcionId').equals(recepcion.spId).sortBy('TipoNovedad') : []),
      [recepcion],
    ) ?? []

  // Al elegir una recepción, trae la versión más fresca de sus tiquetes si hay conexión
  // (por si otro dispositivo ya le puso Tiquete/Destino a alguno).
  useEffect(() => {
    if (recepcion?.spId && navigator.onLine) {
      void cachearTiquetesDeRecepcion(recepcion.spId)
    }
  }, [recepcion?.spId])

  // Trae la Novedad en Corral (Lesionado/Caído/Agitado capturados en Ubicación/Novedades en
  // Corral) directo de Graph, para el "reporte inmediato" de abajo — igual que
  // regenerarTiquetes() más abajo, no se guarda en Dexie: solo hace falta para mostrarla en el
  // reporte de este lote en pantalla.
  useEffect(() => {
    setNovedadCorral(undefined)
    if (recepcion?.spId && navigator.onLine) {
      void obtenerNovedadCorralDeRecepcion(recepcion.spId).then(setNovedadCorral)
    }
  }, [recepcion?.spId])

  /**
   * "Actualizar desde SharePoint" (botón más abajo). Antes solo traía de nuevo los tiquetes
   * (cachearTiquetesDeRecepcion) — a pedido de Nathalia (2026-10-01), después de que corrigiera a
   * mano en SharePoint la FechaRecepcion de un lote ya capturado y la app le siguiera mostrando la
   * fecha vieja, también se trae de nuevo la Recepción misma (obtenerRecepcionActual) y se
   * sobrescribe el registro local completo con lo que haya en SharePoint en este momento. Hacía
   * falta: ni los buscadores de abajo ni la sincronización automática vuelven a pisar un registro
   * que ya está en Dexie salvo por un puñado de campos puntuales (y solo si el lote sigue "En
   * proceso") — ver el comentario grande de obtenerRecepcionActual() en graph/lists.ts. Se excluye
   * `id` a propósito: es la llave primaria local (un UUID si este dispositivo capturó la Recepción,
   * no necesariamente igual a su spId) y no debe tocarse al actualizar.
   */
  async function actualizar() {
    if (!recepcion?.spId) return
    setActualizando(true)
    try {
      await cachearTiquetesDeRecepcion(recepcion.spId)
      const fresca = await obtenerRecepcionActual(recepcion.spId)
      const { id: _id, ...campos } = fresca
      await db.recepciones.update(recepcion.id, campos)
    } finally {
      setActualizando(false)
    }
  }

  /**
   * "Limpiar filtros" (2026-10-01, a pedido de Nathalia): borra de un solo clic los dos buscadores
   * de abajo (Consecutivo y fecha), el mensaje de error/aviso que haya quedado de alguno de los dos
   * (ej. "Las Recepciones de esa fecha ya estaban en este dispositivo…") y `idsFueraDeHoy`, para que
   * el desplegable de "Recepción" vuelva a mostrar solo los lotes de hoy. Si la Recepción
   * seleccionada en ese desplegable no es de hoy (la trajo alguno de los dos buscadores), también se
   * des-selecciona — si no, quedaría elegida una opción que el desplegable ya no muestra.
   */
  function limpiarFiltros() {
    setConsecutivoBusqueda('')
    setFechaBusqueda('')
    setIdsFueraDeHoy([])
    setError(undefined)
    if (recepcion && recepcion.FechaRecepcion !== hoy) {
      setRecepcionId('')
    }
  }

  /**
   * El selector de Recepción de arriba solo lista lo que YA está en Dexie en
   * ESTE dispositivo — y lo único que se trae solo, sin pedirlo, son las
   * Recepciones todavía "En proceso" (ver descargarRecepcionesEnProceso() en
   * syncService.ts, que a propósito no trae las que ya quedaron "Completo",
   * para no descargar cada vez más historial con los meses). Por eso una
   * Recepción capturada y ya cerrada (con "Terminar proceso", o antes con la
   * regla automática vieja) en OTRO dispositivo nunca aparecía sola en este
   * — había que haberla traído mientras todavía estaba "En proceso". Esto le
   * da una salida manual: buscar por fecha exacta en SharePoint (funciona
   * para cualquier Recepción, esté completa o no) y traerla a Dexie de este
   * dispositivo, igual que descargarRecepcionesEnProceso() pero sin ese
   * filtro — sin pisar nada si ya existía localmente.
   */
  async function buscarPorFecha() {
    if (!fechaBusqueda) return
    setBuscando(true)
    setError(undefined)
    try {
      const remotas = await listarRecepcionesPorRangoFecha(fechaBusqueda, fechaBusqueda)
      let nuevas = 0
      const idsEncontrados: string[] = []
      for (const rec of remotas) {
        const local = await db.recepciones.where('spId').equals(rec.spId as string).first()
        if (!local) {
          await db.recepciones.put(rec)
          nuevas++
        }
        idsEncontrados.push(local?.id ?? rec.id)
      }
      // Si esa fecha no es la de hoy, el desplegable las seguiría ocultando apenas termine esta
      // búsqueda — se agregan a idsFueraDeHoy para que se queden visibles (ver el comentario grande
      // de esa lista más arriba).
      if (fechaBusqueda !== hoy) {
        setIdsFueraDeHoy((actuales) => [...new Set([...actuales, ...idsEncontrados])])
      }
      if (remotas.length === 0) {
        setError('No se encontró ninguna Recepción sincronizada con esa fecha.')
      } else if (nuevas === 0) {
        setError('Las Recepciones de esa fecha ya estaban en este dispositivo — revisa el selector de arriba.')
      }
    } catch (err) {
      setError(`No se pudo buscar por esa fecha: ${(err as Error).message}`)
    } finally {
      setBuscando(false)
    }
  }

  /**
   * Busca por Consecutivo EXACTO, sin importar la fecha (2026-09-11, a pedido de Nathalia) —
   * complementa a buscarPorFecha() de arriba para el caso más común: se sabe el Consecutivo del
   * lote, no la fecha exacta en que se recibió. Encuentra cualquier Recepción sincronizada aunque
   * nunca se haya traído antes a este dispositivo (mismo criterio que buscarPorFecha, vía Graph
   * directo) y, si encuentra exactamente una, la selecciona de una vez — si encuentra más de una
   * (no debería pasar, ver existeConsecutivo() en graph/lists.ts, pero nada lo impide del todo),
   * las deja todas visibles en el desplegable para que la persona elija cuál es.
   */
  async function buscarPorConsecutivo() {
    const consecutivo = consecutivoBusqueda.trim()
    if (!consecutivo) return
    setBuscandoConsecutivo(true)
    setError(undefined)
    try {
      const remotas = await buscarRecepcionesPorConsecutivo(consecutivo)
      if (remotas.length === 0) {
        setError(`No se encontró ninguna Recepción sincronizada con el Consecutivo "${consecutivo}".`)
        return
      }
      const idsEncontrados: string[] = []
      for (const rec of remotas) {
        const local = await db.recepciones.where('spId').equals(rec.spId as string).first()
        if (!local) await db.recepciones.put(rec)
        idsEncontrados.push(local?.id ?? rec.id)
      }
      setIdsFueraDeHoy((actuales) => [...new Set([...actuales, ...idsEncontrados])])
      if (idsEncontrados.length === 1) {
        setRecepcionId(idsEncontrados[0])
      } else {
        setError(
          `Se encontraron ${idsEncontrados.length} recepciones con ese Consecutivo — elige cuál es en el desplegable de arriba.`,
        )
      }
    } catch (err) {
      setError(`No se pudo buscar por Consecutivo: ${(err as Error).message}`)
    } finally {
      setBuscandoConsecutivo(false)
    }
  }

  /**
   * Repara una Recepción que ya quedó "Sincronizada" pero con 0 tiquetes
   * generados — pasó por un bug donde ConsolidadoTiquetes rechazaba el
   * registro en SharePoint (columna Title obligatoria sin llenar, o una
   * columna de Elección con otro nombre/otras opciones) y el error se perdía
   * en silencio (ver el comentario en sincronizar() en syncService.ts, ya
   * corregido). Solo hace falta usar esto para Recepciones capturadas ANTES
   * de esa corrección; de aquí en adelante generarTiquetesFaltantes/
   * generarTiquetesNovedadCorral ya deberían crear los tiquetes solos al
   * sincronizar. Es seguro repetirlo las veces que sea: generarTiquetesFaltantes
   * nunca duplica una fila que ya exista.
   *
   * La novedad de corral se trae de Graph (obtenerNovedadCorralDeRecepcion),
   * no de Dexie local: este botón se usa típicamente desde un dispositivo
   * distinto al que capturó Novedades en Corral (por ejemplo, Consolidado
   * desde el computador de planta y la captura desde el celular), y Dexie
   * local de ESTE dispositivo nunca tiene ese registro — solo SharePoint sí.
   */
  async function regenerarTiquetes() {
    if (!recepcion?.spId) return
    setRegenerando(true)
    setError(undefined)
    try {
      await generarTiquetesFaltantes(recepcion)
      const novedad = await obtenerNovedadCorralDeRecepcion(recepcion.spId)
      if (novedad) {
        await generarTiquetesNovedadCorral(novedad, { spId: recepcion.spId, Consecutivo: recepcion.Consecutivo })
      }
      await cachearTiquetesDeRecepcion(recepcion.spId)
    } catch (err) {
      setError(`No se pudieron generar los tiquetes: ${(err as Error).message}`)
    } finally {
      setRegenerando(false)
    }
  }

  /**
   * Punto final manual y explícito del proceso, a pedido de Nathalia: como
   * Recepción → Ubicación/Novedades en Corral → Consolidado se hace en
   * varias partes y a veces en varias sesiones, hacía falta un gesto claro
   * de "esta recepción ya quedó totalmente gestionada" en vez de que el
   * sistema lo adivinara solo (eso fue justo lo que causó el problema:
   * cerrarse automáticamente antes de que alguien pusiera la Factura de un
   * Fortuito, dejando el campo bloqueado sin poder completarlo). Si todavía
   * falta algo por diligenciar, se avisa y se deja decidir a la persona si
   * de verdad quiere cerrar así.
   *
   * IMPORTANTE: `EstadoTiquete` en Dexie (lo que usa tiqueteYaCompletado())
   * solo se pone al día con un refresco explícito contra SharePoint (botón
   * "Actualizar", o al elegir la Recepción) — guardar un campo NO lo
   * actualiza solo (ver el comentario grande de esa función). Por eso, antes
   * de revisar qué falta, esta función sincroniza y vuelve a traer los
   * tiquetes primero (si hay conexión); si se revisara `tiquetes` tal cual
   * está en pantalla, alguien que acabara de llenar todo vería "faltan
   * todos" por pura desactualización, no porque de verdad falte algo.
   */
  async function terminarProceso() {
    if (!recepcion?.spId) return
    setTerminando(true)
    setError(undefined)
    try {
      if (navigator.onLine) {
        await sincronizar(usuario.Correo)
        await cachearTiquetesDeRecepcion(recepcion.spId)
      }
      const frescos = await db.consolidadoTiquetes.where('RecepcionId').equals(recepcion.spId).toArray()
      const faltantes = frescos.filter((t) => !tiqueteYaCompletado(t))
      if (faltantes.length > 0) {
        const continuar = window.confirm(
          `${faltantes.length} de ${frescos.length} tiquetes todavía no tienen Tiquete, Destino y Factura (si aplica) completos.\n\n¿Terminar el proceso de todas formas? Después de esto solo un Administrador podrá seguir editando este lote.`,
        )
        if (!continuar) return
      }
      await marcarLoteCompleto(recepcion.spId)
      await db.recepciones.update(recepcion.id, { EstadoLote: 'Completo' })
    } catch (err) {
      setError(`No se pudo terminar el proceso: ${(err as Error).message}`)
    } finally {
      setTerminando(false)
    }
  }

  /**
   * Contraparte de terminarProceso(), solo para Administrador: reabre un
   * lote que quedó "Completo" por error — en particular, cualquier lote que
   * se haya cerrado solo bajo la regla automática vieja (ver la nota
   * histórica en syncService.ts) antes de que existiera este botón, sin que
   * los Fortuitos alcanzaran a tener su Factura.
   */
  async function reabrirProceso() {
    if (!recepcion?.spId) return
    setReabriendo(true)
    setError(undefined)
    try {
      await reabrirLote(recepcion.spId)
      await db.recepciones.update(recepcion.id, { EstadoLote: 'En proceso' })
    } catch (err) {
      setError(`No se pudo reabrir el proceso: ${(err as Error).message}`)
    } finally {
      setReabriendo(false)
    }
  }

  function empezarEdicionConsecutivo() {
    if (!recepcion) return
    setNuevoConsecutivo(recepcion.Consecutivo)
    setNuevoNumeroOrden(recepcion.NumeroOrden)
    setError(undefined)
    setEditandoConsecutivo(true)
  }

  /**
   * Solo revisa contra otras Recepciones si el Consecutivo de verdad cambió — si no, buscar por el
   * mismo valor encontraría esta misma Recepción y bloquearía guardar sin haber cambiado nada. Igual
   * que existeConsecutivo()/buscarRecepcionesPorConsecutivo() en graph/lists.ts, es una revisión de
   * "mejor esfuerzo" (2 personas corrigiendo el mismo Consecutivo al mismo tiempo en dispositivos
   * distintos podrían igual chocar) — suficiente para el caso real que la motivó: una persona
   * corrigiendo un typo que se le pasó.
   */
  async function guardarConsecutivo() {
    if (!recepcion?.spId) return
    const consecutivo = nuevoConsecutivo.trim()
    const numeroOrden = nuevoNumeroOrden.trim()
    if (!consecutivo || !numeroOrden) {
      setError('Consecutivo y Número de orden son obligatorios.')
      return
    }
    setGuardandoConsecutivo(true)
    setError(undefined)
    try {
      if (consecutivo !== recepcion.Consecutivo) {
        const otras = (await buscarRecepcionesPorConsecutivo(consecutivo)).filter((r) => r.spId !== recepcion.spId)
        if (otras.length > 0) {
          setError(
            `Ya existe otra Recepción con el Consecutivo "${consecutivo}" (${otras[0].FechaRecepcion}) — revisa cuál es el correcto antes de guardar.`,
          )
          return
        }
      }
      await actualizarConsecutivoYOrden(recepcion.spId, { Consecutivo: consecutivo, NumeroOrden: numeroOrden })
      await db.recepciones.update(recepcion.id, { Consecutivo: consecutivo, NumeroOrden: numeroOrden })
      setEditandoConsecutivo(false)
    } catch (err) {
      setError(`No se pudo guardar el cambio: ${(err as Error).message}`)
    } finally {
      setGuardandoConsecutivo(false)
    }
  }

  function empezarEdicionGranja() {
    if (!recepcion) return
    setNuevaGranjaId(recepcion.GranjaId)
    setError(undefined)
    setEditandoGranja(true)
  }

  async function guardarGranja() {
    if (!recepcion?.spId) return
    if (!nuevaGranjaId) {
      setError('Selecciona una Granja.')
      return
    }
    setGuardandoGranja(true)
    setError(undefined)
    try {
      await actualizarGranjaDeRecepcion(recepcion.spId, nuevaGranjaId)
      await db.recepciones.update(recepcion.id, { GranjaId: nuevaGranjaId })
      setEditandoGranja(false)
    } catch (err) {
      setError(`No se pudo guardar el cambio: ${(err as Error).message}`)
    } finally {
      setGuardandoGranja(false)
    }
  }

  function empezarEdicionHoras() {
    if (!recepcion) return
    setNuevaHoraProgramada(horaCorta(recepcion.HoraProgramada))
    setNuevaHoraLlegadaVehiculo(horaCorta(recepcion.HoraLlegadaVehiculo))
    setNuevaHoraInicioDesembarque(horaCorta(recepcion.HoraInicioDesembarque))
    setNuevaHoraFinalDesembarque(horaCorta(recepcion.HoraFinalDesembarque))
    setError(undefined)
    setEditandoHoras(true)
  }

  async function guardarHoras() {
    if (!recepcion?.spId) return
    if (!nuevaHoraProgramada || !nuevaHoraLlegadaVehiculo) {
      setError('Hora programada y Hora de llegada del vehículo son obligatorias.')
      return
    }
    setGuardandoHoras(true)
    setError(undefined)
    try {
      const cambios = {
        HoraProgramada: combinarFechaHora(recepcion.FechaRecepcion, nuevaHoraProgramada),
        HoraLlegadaVehiculo: combinarFechaHora(recepcion.FechaRecepcion, nuevaHoraLlegadaVehiculo),
        // Opcionales: '' en el input significa "se borró a propósito" (algunos lotes llegan
        // después de la jornada y esta hora nunca se llega a saber, ver el comentario junto a
        // estos 2 campos en src/types/models.ts) — se manda `null` para borrarla de verdad en
        // SharePoint, no `undefined` (que actualizarHorasDeRecepcion() interpreta como "no tocar").
        HoraInicioDesembarque: nuevaHoraInicioDesembarque
          ? combinarFechaHora(recepcion.FechaRecepcion, nuevaHoraInicioDesembarque)
          : null,
        HoraFinalDesembarque: nuevaHoraFinalDesembarque
          ? combinarFechaHora(recepcion.FechaRecepcion, nuevaHoraFinalDesembarque)
          : null,
      }
      await actualizarHorasDeRecepcion(recepcion.spId, cambios)
      await db.recepciones.update(recepcion.id, {
        HoraProgramada: cambios.HoraProgramada,
        HoraLlegadaVehiculo: cambios.HoraLlegadaVehiculo,
        HoraInicioDesembarque: cambios.HoraInicioDesembarque ?? undefined,
        HoraFinalDesembarque: cambios.HoraFinalDesembarque ?? undefined,
      })
      setEditandoHoras(false)
    } catch (err) {
      setError(`No se pudo guardar el cambio: ${(err as Error).message}`)
    } finally {
      setGuardandoHoras(false)
    }
  }

  async function guardarCambio(t: ConsolidadoTiquete, cambios: Partial<ConsolidadoTiquete>) {
    await guardarEdicionTiqueteLocal(t.id, cambios)
    if (navigator.onLine) {
      void sincronizar(usuario.Correo)
    }
  }

  /**
   * Elimina una fila de "novedad" (un animal) del Consolidado — a pedido de Nathalia (2026-09-24),
   * para cuando alguien se equivoca al capturar (un animal contado de más, un tipo de novedad
   * equivocado, etc.). Mismo candado que ya rige el resto de la pantalla (`soloLectura`, arriba):
   * antes de "Terminar proceso" puede borrar cualquier perfil que no sea Consultor, y una vez el
   * lote queda "Completo" solo un Administrador puede seguir haciéndolo — igual que ya pasa con
   * editar Tiquete/Destino/Factura. Solo en línea: hace falta Graph para borrar de verdad en
   * SharePoint (ver eliminarTiquete() en graph/lists.ts), así que no se ofrece sin conexión.
   *
   * Además de borrar la fila, resta 1 del conteo de origen en Recepción/Novedades en Corral que la
   * generó (decrementarConteoOrigenTiquete(), en graph/lists.ts — llamada ANTES de eliminarTiquete()
   * a propósito: si por algo falla, la fila no se borra, para no dejar el conteo desactualizado).
   * Pedido explícito de Nathalia (2026-09-24, segunda ronda): sin esto, "Eliminar" dejaba el conteo
   * de origen desincronizado y un futuro "Volver a generar tiquetes" sobre el mismo lote podía volver
   * a crear una fila igual.
   */
  async function eliminarFila(t: ConsolidadoTiquete) {
    if (!t.spId || !recepcion?.spId) return
    const confirmar = window.confirm(
      `¿Eliminar esta novedad (${t.GrupoNovedad} · ${t.TipoNovedad} #${t.NumeroAnimalEnLote})?\n\n` +
        `Esto también resta 1 del conteo de esa novedad en Recepción/Novedades en Corral.\n\n` +
        `Esta acción no se puede deshacer.`,
    )
    if (!confirmar) return
    setEliminandoId(t.id)
    setError(undefined)
    try {
      await decrementarConteoOrigenTiquete(t, recepcion.spId)
      await eliminarTiquete(t.spId)
      await db.consolidadoTiquetes.delete(t.id)
    } catch (err) {
      setError(`No se pudo eliminar la novedad: ${(err as Error).message}`)
    } finally {
      setEliminandoId(undefined)
    }
  }

  function empezarCorregirConflicto(rec: Recepcion) {
    setEditandoConflictoId(rec.id)
    setConsecutivoConflicto(rec.Consecutivo)
    setNumeroOrdenConflicto(rec.NumeroOrden)
    setError(undefined)
  }

  /**
   * Guarda el Consecutivo/Número de orden corregidos y deja la Recepción en 'Pendiente' otra vez
   * (ver corregirConsecutivoConflicto() en syncService.ts). Si hay conexión, sincroniza de una vez
   * para no hacer esperar al próximo ciclo automático — si sigue chocando (por ejemplo, un segundo
   * error de digitación), simplemente vuelve a aparecer en este mismo panel.
   */
  async function guardarCorreccionConflicto(id: string) {
    setResolviendoConflictoId(id)
    setError(undefined)
    try {
      await corregirConsecutivoConflicto(id, {
        Consecutivo: consecutivoConflicto.trim(),
        NumeroOrden: numeroOrdenConflicto.trim(),
      })
      setEditandoConflictoId(undefined)
      if (navigator.onLine) {
        await sincronizar(usuario.Correo)
      }
    } catch (err) {
      setError(`No se pudo guardar la corrección: ${(err as Error).message}`)
    } finally {
      setResolviendoConflictoId(undefined)
    }
  }

  async function descartarConflicto(rec: Recepcion) {
    const confirmar = window.confirm(
      `¿Descartar por completo esta captura (Consecutivo ${rec.Consecutivo}, ${rec.FechaRecepcion})?\n\n` +
        `No se va a subir a SharePoint y esta acción no se puede deshacer.`,
    )
    if (!confirmar) return
    setResolviendoConflictoId(rec.id)
    setError(undefined)
    try {
      await descartarRecepcionConflicto(rec.id)
    } catch (err) {
      setError(`No se pudo descartar: ${(err as Error).message}`)
    } finally {
      setResolviendoConflictoId(undefined)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 print:hidden">Consolidado</h1>
      <p className="mt-1 text-sm text-slate-500 print:hidden">
        Asigna el número de tiquete y el destino (Procesado, Decomisado o Decomisado en canal) a cada animal con novedad.
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-brand-red print:hidden">
          {error}
          {esErrorDeSesion(error) && <BotonConfirmarSesion alConfirmar={() => setError(undefined)} />}
        </p>
      )}

      {/* Panel "Consecutivos repetidos" — abierto a cualquiera que no sea Consultor (ver
          puedeResolverConflictos arriba), no solo Administrador: a diferencia de "Editar
          Consecutivo/Número de orden" (esa sí siempre solo Administrador, porque edita una Recepción
          YA sincronizada), esto corrige o descarta una captura que TODAVÍA no llegó a SharePoint. Ver
          el comentario grande de corregirConsecutivoConflicto()/descartarRecepcionConflicto() en
          syncService.ts. Estas Recepciones nunca llegaron a crearse en SharePoint (perdieron la
          carrera por el Consecutivo contra otro dispositivo, o chocaron contra un falso positivo del
          índice de búsqueda de SharePoint desactualizado), así que no aparecen en el selector de abajo
          (ese solo lista 'Sincronizada') ni en ningún reporte — quedan solo aquí hasta que se
          corrijan o se descarten. */}
      {puedeResolverConflictos && recepcionesConflicto.length > 0 && (
        <div className="mt-4 max-w-2xl rounded-md border border-amber-300 bg-amber-50 p-3 print:hidden">
          <p className="text-sm font-semibold text-amber-900">
            {recepcionesConflicto.length} Consecutivo{recepcionesConflicto.length > 1 ? 's' : ''} repetido
            {recepcionesConflicto.length > 1 ? 's' : ''} — sin subir a SharePoint
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Dos dispositivos usaron el mismo Consecutivo estando ambos sin conexión. Esta captura se
            quedó guardada solo en este dispositivo. Corrígele el Consecutivo (y vuelve a intentar
            subirla) o descártala si ya no hace falta.
          </p>
          <ul className="mt-3 space-y-3">
            {recepcionesConflicto.map((rec) => (
              <li key={rec.id} className="rounded-md border border-amber-200 bg-white p-2.5">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-slate-600">
                  <span>
                    <strong className="text-slate-800">Fecha:</strong> {rec.FechaRecepcion}
                  </span>
                  <span>
                    <strong className="text-slate-800">Consecutivo:</strong> {rec.Consecutivo}
                  </span>
                  <span>
                    <strong className="text-slate-800">N.° de orden:</strong> {rec.NumeroOrden}
                  </span>
                  <span>
                    <strong className="text-slate-800">N.° animales:</strong> {rec.NumeroTotalCerdos}
                  </span>
                </div>

                {editandoConflictoId === rec.id ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <CampoTexto
                      etiqueta="Nuevo Consecutivo"
                      value={consecutivoConflicto}
                      onChange={(e) => setConsecutivoConflicto(e.target.value)}
                    />
                    <CampoTexto
                      etiqueta="Nuevo Número de orden"
                      value={numeroOrdenConflicto}
                      onChange={(e) => setNumeroOrdenConflicto(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => void guardarCorreccionConflicto(rec.id)}
                      disabled={
                        resolviendoConflictoId === rec.id || !consecutivoConflicto.trim() || !numeroOrdenConflicto.trim()
                      }
                      className="rounded-md bg-brand-navy px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-navy-hover disabled:opacity-50"
                    >
                      {resolviendoConflictoId === rec.id ? 'Guardando…' : 'Guardar y reintentar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditandoConflictoId(undefined)
                        setError(undefined)
                      }}
                      disabled={resolviendoConflictoId === rec.id}
                      className="text-xs font-medium text-slate-500 hover:text-brand-red disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => empezarCorregirConflicto(rec)}
                      disabled={resolviendoConflictoId === rec.id}
                      className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                    >
                      Corregir Consecutivo
                    </button>
                    <button
                      type="button"
                      onClick={() => void descartarConflicto(rec)}
                      disabled={resolviendoConflictoId === rec.id}
                      className="text-xs font-medium text-brand-red hover:underline disabled:opacity-50"
                    >
                      {resolviendoConflictoId === rec.id ? 'Descartando…' : 'Descartar'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 max-w-sm print:hidden">
        <CampoSelect
          etiqueta="Recepción"
          value={recepcionId}
          onChange={(e) => setRecepcionId(e.target.value)}
          opciones={recepcionesVisibles.map((r) => ({ value: r.id, label: r.Title }))}
          placeholder="Selecciona una recepción sincronizada de hoy…"
        />
      </div>
      <p className="mt-1 max-w-sm text-xs text-slate-400 print:hidden">
        Por defecto solo se ven los lotes recibidos hoy — usa uno de los buscadores de abajo para
        encontrar cualquier otro.
      </p>

      {/* flex-col por defecto y solo lado a lado desde sm: el <input type="date"> nativo tiene un
          ancho mínimo propio que en celular (con "Recepción" ya ocupando el máximo de max-w-sm)
          empujaba al botón "Buscar" fuera de la fila y lo montaba encima del campo — apilarlos en
          pantallas angostas lo evita de raíz, sin depender de que el input logre encogerse. Mismo
          patrón para el buscador por Consecutivo de abajo. */}
      <div className="mt-3 flex max-w-sm flex-col gap-2 sm:flex-row sm:items-end print:hidden">
        <div className="min-w-0 flex-1">
          <CampoTexto
            etiqueta="Buscar por Consecutivo"
            ayuda="Encuentra cualquier lote sin importar la fecha en que se recibió"
            value={consecutivoBusqueda}
            onChange={(e) => setConsecutivoBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void buscarPorConsecutivo()}
          />
        </div>
        <button
          type="button"
          onClick={() => void buscarPorConsecutivo()}
          disabled={buscandoConsecutivo || !consecutivoBusqueda.trim() || !navigator.onLine}
          className="rounded-md border border-brand-navy px-3 py-2 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
        >
          {buscandoConsecutivo ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      <div className="mt-3 flex max-w-sm flex-col gap-2 sm:flex-row sm:items-end print:hidden">
        <div className="min-w-0 flex-1">
          <CampoTexto
            etiqueta="¿No sabes el Consecutivo? Buscar por fecha"
            type="date"
            value={fechaBusqueda}
            onChange={(e) => setFechaBusqueda(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={() => void buscarPorFecha()}
          disabled={buscando || !fechaBusqueda || !navigator.onLine}
          className="rounded-md border border-brand-navy px-3 py-2 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
        >
          {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </div>
      <p className="mt-1 max-w-sm text-xs text-slate-400 print:hidden">
        Ambos buscadores traen a este dispositivo las Recepciones sincronizadas que encuentren,
        capturadas desde otro celular o computador — incluidas las que ya quedaron completas.
      </p>

      <div className="mt-2 print:hidden">
        <button
          type="button"
          onClick={limpiarFiltros}
          disabled={!consecutivoBusqueda && !fechaBusqueda && idsFueraDeHoy.length === 0 && !error}
          className="text-xs font-medium text-slate-500 hover:text-brand-red disabled:opacity-40 disabled:hover:text-slate-500"
        >
          Limpiar filtros
        </button>
      </div>

      {!recepcion && recepciones.length === 0 && (
        <p className="mt-6 text-sm text-slate-500">
          Todavía no hay ninguna recepción sincronizada en este dispositivo. Sincroniza primero desde la barra
          superior.
        </p>
      )}

      {recepcion && (
        <>
          <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4 print:hidden">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Dato etiqueta="Fecha" valor={recepcion.FechaRecepcion} />
              {editandoGranja ? (
                <CampoSelect
                  etiqueta="Granja"
                  requerido
                  value={nuevaGranjaId}
                  onChange={(e) => setNuevaGranjaId(e.target.value)}
                  opciones={granjasDelAsociado.map((g) => ({ value: g.id, label: g.Title }))}
                />
              ) : (
                <Dato etiqueta="Granja" valor={granja?.Title ?? '—'} />
              )}
              {editandoConsecutivo ? (
                <>
                  <CampoTexto
                    etiqueta="Consecutivo"
                    requerido
                    value={nuevoConsecutivo}
                    onChange={(e) => setNuevoConsecutivo(e.target.value)}
                  />
                  <CampoTexto
                    etiqueta="Número de orden"
                    requerido
                    value={nuevoNumeroOrden}
                    onChange={(e) => setNuevoNumeroOrden(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <Dato etiqueta="Consecutivo" valor={recepcion.Consecutivo} />
                  <Dato etiqueta="Número de orden" valor={recepcion.NumeroOrden} />
                </>
              )}
              {editandoHoras ? (
                <>
                  <CampoTexto
                    type="time"
                    etiqueta="Hora programada"
                    requerido
                    value={nuevaHoraProgramada}
                    onChange={(e) => setNuevaHoraProgramada(e.target.value)}
                  />
                  <CampoTexto
                    type="time"
                    etiqueta="Hora de llegada del vehículo"
                    requerido
                    value={nuevaHoraLlegadaVehiculo}
                    onChange={(e) => setNuevaHoraLlegadaVehiculo(e.target.value)}
                  />
                  <CampoTexto
                    type="time"
                    etiqueta="Hora de inicio de desembarque"
                    ayuda="Opcional"
                    value={nuevaHoraInicioDesembarque}
                    onChange={(e) => setNuevaHoraInicioDesembarque(e.target.value)}
                  />
                  <CampoTexto
                    type="time"
                    etiqueta="Hora final de desembarque"
                    ayuda="Opcional"
                    value={nuevaHoraFinalDesembarque}
                    onChange={(e) => setNuevaHoraFinalDesembarque(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <Dato etiqueta="Hora programada" valor={horaCorta(recepcion.HoraProgramada) || '—'} />
                  <Dato etiqueta="Hora llegada vehículo" valor={horaCorta(recepcion.HoraLlegadaVehiculo) || '—'} />
                  <Dato etiqueta="Hora inicio desembarque" valor={horaCorta(recepcion.HoraInicioDesembarque) || '—'} />
                  <Dato etiqueta="Hora final desembarque" valor={horaCorta(recepcion.HoraFinalDesembarque) || '—'} />
                </>
              )}
            </div>
            {/* Editar Consecutivo/Número de orden — y solo en línea (hace falta Graph para revisar
                que el Consecutivo nuevo no esté repetido y para guardar el cambio, ver
                guardarConsecutivo() arriba). Antes era siempre Administrador; a pedido de Nathalia
                (2026-10-01) ahora usa el mismo candado `soloLectura` que Granja (justo abajo):
                cualquiera que no sea Consultor puede corregirlo mientras el lote siga "En proceso",
                y una vez "Completo" solo un Administrador. El resto de la Recepción sigue sin poder
                editarse desde aquí. */}
            {!soloLectura && (
              <div className="mt-3 flex items-center gap-3">
                {editandoConsecutivo ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void guardarConsecutivo()}
                      disabled={guardandoConsecutivo || !navigator.onLine}
                      className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-navy-hover disabled:opacity-50"
                    >
                      {guardandoConsecutivo ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditandoConsecutivo(false)
                        setError(undefined)
                      }}
                      disabled={guardandoConsecutivo}
                      className="text-xs font-medium text-slate-500 hover:text-brand-red disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={empezarEdicionConsecutivo}
                    disabled={!navigator.onLine}
                    title="Corregir Consecutivo o Número de orden por un error de captura"
                    className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                  >
                    Editar Consecutivo / Número de orden
                  </button>
                )}
              </div>
            )}
            {/* Editar horas (2026-09-28, a pedido de Nathalia) — candado: siempre Administrador, en
                cualquier momento, sin usar `soloLectura` (a diferencia de Consecutivo/Número de
                orden arriba, que desde 2026-10-01 sí lo usa). Ver guardarHoras() y
                actualizarHorasDeRecepcion() en graph/lists.ts. */}
            {esAdmin && (
              <div className="mt-3 flex items-center gap-3">
                {editandoHoras ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void guardarHoras()}
                      disabled={guardandoHoras || !navigator.onLine}
                      className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-navy-hover disabled:opacity-50"
                    >
                      {guardandoHoras ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditandoHoras(false)
                        setError(undefined)
                      }}
                      disabled={guardandoHoras}
                      className="text-xs font-medium text-slate-500 hover:text-brand-red disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={empezarEdicionHoras}
                    disabled={!navigator.onLine}
                    title="Corregir Hora programada, Hora de llegada del vehículo, Hora de inicio de desembarque o Hora final de desembarque por un error de captura"
                    className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                  >
                    Editar horas
                  </button>
                )}
              </div>
            )}
            {/* Editar Granja (2026-09-24, a pedido de Nathalia) — a diferencia del candado de
                arriba (siempre Administrador), este usa `soloLectura`: cualquiera que no sea
                Consultor puede corregirla mientras el lote siga "En proceso", y una vez
                "Completo" solo un Administrador (ver actualizarGranja() en graph/lists.ts). */}
            {!soloLectura && (
              <div className="mt-3 flex items-center gap-3">
                {editandoGranja ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void guardarGranja()}
                      disabled={guardandoGranja || !navigator.onLine}
                      className="rounded-md bg-brand-navy px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-navy-hover disabled:opacity-50"
                    >
                      {guardandoGranja ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditandoGranja(false)
                        setError(undefined)
                      }}
                      disabled={guardandoGranja}
                      className="text-xs font-medium text-slate-500 hover:text-brand-red disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={empezarEdicionGranja}
                    disabled={!navigator.onLine}
                    title="Corregir la Granja por un error de captura"
                    className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                  >
                    Editar Granja
                  </button>
                )}
              </div>
            )}
          </div>

          {loteCompleto && (
            <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-600 print:hidden">
              <span>
                {esAdmin
                  ? 'Este lote ya está completo. Como Administrador puedes seguir editándolo.'
                  : 'Este lote ya está completo. Solo un Administrador puede editarlo.'}
              </span>
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => void reabrirProceso()}
                  disabled={reabriendo || !navigator.onLine}
                  title="Vuelve a poner este lote 'En proceso' — útil si se cerró antes de tiempo"
                  className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                >
                  {reabriendo ? 'Reabriendo…' : 'Reabrir proceso'}
                </button>
              )}
            </p>
          )}

          {loteCompleto && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setVerReporteInmediato((v) => !v)}
                className="text-xs font-medium text-brand-navy hover:underline print:hidden"
              >
                {verReporteInmediato ? 'Ocultar reporte del lote' : 'Ver reporte del lote (para enviar al asociado)'}
              </button>
              {verReporteInmediato && (
                <div className="mt-3 print:mt-0">
                  <div className="mb-2 flex justify-end print:hidden">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="text-xs font-medium text-brand-navy hover:underline"
                    >
                      Imprimir / Descargar PDF
                    </button>
                  </div>
                  <ReporteDiarioLote
                    recepcion={recepcion}
                    asociadoNombre={asociado?.Title ?? '—'}
                    granjaNombre={granja?.Title ?? '—'}
                    placa={vehiculo?.Title ?? '—'}
                    tiquetes={tiquetes}
                    novedadCorral={novedadCorral}
                  />
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between print:hidden">
            <p className="text-sm text-slate-500">
              {tiquetes.length} animal{tiquetes.length === 1 ? '' : 'es'} con novedad en este lote
            </p>
            <div className="flex items-center gap-3">
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => void regenerarTiquetes()}
                  disabled={regenerando || !navigator.onLine}
                  title="Vuelve a intentar crear los tiquetes de esta Recepción — útil si quedó Sincronizada pero sin tiquetes por un error de sincronización"
                  className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
                >
                  {regenerando ? 'Generando…' : 'Volver a generar tiquetes'}
                </button>
              )}
              <button
                type="button"
                onClick={() => void actualizar()}
                disabled={actualizando || !navigator.onLine}
                title="Trae de nuevo desde SharePoint el Tiquete/Destino/Factura/Estado de esta Recepción, y también sus propios datos (fecha, horas, Consecutivo, Granja, etc.) — útil si otra persona le cambió algo desde otro celular o computador, o si tú misma corregiste algo directamente en SharePoint"
                className="text-xs font-medium text-brand-navy hover:underline disabled:text-slate-400"
              >
                {actualizando ? 'Actualizando…' : 'Actualizar desde SharePoint'}
              </button>
              {!soloLectura && !loteCompleto && (
                <button
                  type="button"
                  onClick={() => void terminarProceso()}
                  disabled={terminando || !navigator.onLine}
                  title="Marca esta recepción como totalmente gestionada — de ahí en adelante solo un Administrador podrá editar sus tiquetes"
                  className="rounded-md border border-brand-navy px-2.5 py-1 text-xs font-medium text-brand-navy hover:bg-brand-navy-tint disabled:opacity-50"
                >
                  {terminando ? 'Terminando…' : 'Terminar proceso'}
                </button>
              )}
            </div>
          </div>

          {tiquetes.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 print:hidden">Este lote no tiene animales con novedad.</p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white print:hidden">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Grupo</th>
                    <th className="px-3 py-2">Novedad</th>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Tiquete</th>
                    <th className="px-3 py-2">Destino</th>
                    <th className="px-3 py-2">Factura</th>
                    <th className="px-3 py-2">Estado</th>
                    <th className="px-3 py-2">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tiquetes.map((t) => (
                    <FilaTiquete
                      key={t.id}
                      tiquete={t}
                      soloLectura={filaSoloLectura(t)}
                      // El botón "Eliminar" usa el candado de LOTE (soloLectura), no el de tiquete
                      // individual (filaSoloLectura) — a propósito: se puede querer borrar una
                      // novedad completa aunque ya tenga Tiquete/Destino cargados, mientras el lote
                      // siga "En proceso". Ver el comentario grande de eliminarFila() arriba.
                      puedeEliminar={!soloLectura}
                      eliminando={eliminandoId === t.id}
                      onGuardar={(cambios) => guardarCambio(t, cambios)}
                      onEliminar={() => void eliminarFila(t)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{etiqueta}</p>
      <p className="text-sm font-medium text-slate-700">{valor}</p>
    </div>
  )
}

/**
 * Un tiquete queda "de verdad" completo cuando SharePoint ya lo marcó
 * EstadoTiquete === 'Completo' (eso pasa solo con Tiquete + Destino, ver
 * actualizarTiquete() en src/graph/lists.ts) Y, si es un Fortuito (el único
 * grupo con Factura), también tiene la Factura puesta — sin esta segunda
 * condición, un Fortuito con Tiquete+Destino pero SIN factura ya contaría
 * como completo, aunque a simple vista le falte lo más importante. Se usa
 * solo para lo informativo (la etiqueta "Falta factura" en la tabla, y el
 * aviso de terminarProceso() si se intenta cerrar con tiquetes a medias) —
 * YA NO bloquea la edición por sí solo: ese candado ahora es 100% manual,
 * ver el comentario de soloLectura más arriba.
 */
function tiqueteYaCompletado(t: ConsolidadoTiquete): boolean {
  const esFortuito = t.GrupoNovedad === 'Fortuito'
  return t.EstadoTiquete === 'Completo' && (!esFortuito || Boolean(t.Factura))
}

function FilaTiquete({
  tiquete,
  soloLectura,
  puedeEliminar,
  eliminando,
  onGuardar,
  onEliminar,
}: {
  tiquete: ConsolidadoTiquete
  soloLectura: boolean
  puedeEliminar: boolean
  eliminando: boolean
  onGuardar: (cambios: Partial<ConsolidadoTiquete>) => void
  onEliminar: () => void
}) {
  const [numeroTiquete, setNumeroTiquete] = useState(tiquete.Tiquete ?? '')
  const [destino, setDestino] = useState<Destino | ''>(tiquete.Destino ?? '')
  const [factura, setFactura] = useState(tiquete.Factura ?? '')

  // Factura solo aplica a Fortuitos (Muerto en Transporte/Desembarque/Reposo) — ver el
  // comentario en el campo Factura de ConsolidadoTiquete en src/types/models.ts.
  const esFortuito = tiquete.GrupoNovedad === 'Fortuito'
  const faltaFactura = tiquete.EstadoTiquete === 'Completo' && esFortuito && !tiquete.Factura
  const completo = tiqueteYaCompletado(tiquete)

  return (
    <tr className={clsx(tiquete.EstadoSync === 'Pendiente' && 'bg-amber-50/60')}>
      <td className="px-3 py-2 text-slate-600">{tiquete.GrupoNovedad}</td>
      <td className="px-3 py-2 text-slate-600">{tiquete.TipoNovedad}</td>
      <td className="px-3 py-2 text-slate-600">{tiquete.NumeroAnimalEnLote}</td>
      <td className="px-3 py-2">
        <input
          value={numeroTiquete}
          disabled={soloLectura}
          onChange={(e) => setNumeroTiquete(e.target.value)}
          onBlur={() => numeroTiquete !== (tiquete.Tiquete ?? '') && onGuardar({ Tiquete: numeroTiquete || undefined })}
          className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
          placeholder="N.º"
        />
      </td>
      <td className="px-3 py-2">
        <select
          value={destino}
          disabled={soloLectura}
          onChange={(e) => {
            const nuevo = e.target.value as Destino | ''
            setDestino(nuevo)
            onGuardar({ Destino: nuevo || undefined })
          }}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
        >
          <option value="">—</option>
          <option value="Procesado">Procesado</option>
          <option value="Decomisado">Decomisado</option>
          <option value="Decomisado en canal">Decomisado en canal</option>
        </select>
      </td>
      <td className="px-3 py-2">
        {esFortuito ? (
          <input
            value={factura}
            disabled={soloLectura}
            onChange={(e) => setFactura(e.target.value)}
            onBlur={() => factura !== (tiquete.Factura ?? '') && onGuardar({ Factura: factura || undefined })}
            className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy disabled:bg-slate-50"
            placeholder="N.º factura"
          />
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-2">
        <span
          className={clsx(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            completo
              ? 'bg-emerald-100 text-emerald-700'
              : faltaFactura
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600',
          )}
        >
          {faltaFactura ? 'Falta factura' : tiquete.EstadoTiquete}
        </span>
        {tiquete.EstadoSync === 'Pendiente' && (
          <span className="ml-1.5 text-xs text-amber-600">sin subir</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {puedeEliminar && (
          <button
            type="button"
            onClick={onEliminar}
            disabled={eliminando || !navigator.onLine}
            title="Elimina definitivamente esta novedad de Consolidado"
            className="text-xs font-medium text-brand-red hover:underline disabled:text-slate-300"
          >
            {eliminando ? 'Eliminando…' : 'Eliminar'}
          </button>
        )}
      </td>
    </tr>
  )
}
