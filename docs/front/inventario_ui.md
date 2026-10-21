# Inventario UI (03b-1)

Fuente: las 15 vistas de `design-system/vinculos/Tenant/*.dc.html` y los
tokens del sistema Organic exportado en `design-reference/`. Las vistas son
referencia: se reimplementan como componentes React, nunca se copian.

## Tokens

Valores en `frontend/src/app/globals.css` (`@theme`). Así se usan como
utilidades de Tailwind (`bg-accent-2-700`, `shadow-md`, `rounded-lg`).

| Token | Usos en las vistas | Rol |
|---|---|---|
| `--font-body` (Figtree 400-900) | 320 | Única tipografía de las vistas (títulos en 900 con tracking negativo) |
| `--color-text` | 232 | Texto principal |
| `--color-bg` | 167 | Superficie de tarjetas, sidebar y páginas públicas |
| `--color-neutral-100..900` | 785 | 600/700: textos secundarios; 300: fondo del backoffice; 400: bordes de botones y campos |
| `--color-divider` | 212 | Bordes de tarjetas y separadores |
| `--color-accent-2-100..900` (verde) | 465 | Paciente y público: acciones, item activo del menú, enlaces |
| `--color-accent`, `-100..900` (terracota) | 495 | Equipo: acciones del panel, sobretítulos, avisos |
| `--radius-lg` (28 px) | 116 | Tarjetas y paneles. Botones, campos y badges usan pastilla (999 px) |
| `--shadow-sm/md/lg` | 138 | sm: tarjetas en reposo; md: paneles y sidebar; lg: hover y login |
| `--font-heading` (Caprasimo) | 0 | Está en el sistema, pero ninguna vista la usa: no se carga |

Iconos: Material Symbols Rounded (peso 500), como en todas las vistas. Google
sirve solo los glifos de `frontend/src/lib/iconos.ts` (`icon_names`); un icono
fuera de esa lista no compila. Figtree se sirve desde el mismo origen
(`next/font`). El sistema Organic declara Lucide, pero las vistas del tenant no
lo usan. Gana la vista.

### Ajuste por contraste AA (desviación del diseño)

`impeccable detect` y el cálculo WCAG dan menos de 4.5:1 en dos combinaciones
del diseño. Se sube un tono:

| Diseño | Contraste | Implementado | Contraste |
|---|---|---|---|
| Texto `neutral-100` sobre botón `accent-2-600` | 3.8:1 | `accent-2-700` (hover `-800`) | 5.9:1 |
| Texto `neutral-100` sobre botón `accent-600` | 4.1:1 | `accent-700` (hover `-800`) | 6.2:1 |
| Texto secundario `neutral-600` sobre `bg` | 3.6:1 | `neutral-700` | 5.5:1 |
| Placeholder | 3.1:1 | `neutral-700` | 5.5:1 |
| Texto secundario `neutral-700` sobre el fondo del panel `neutral-300` | 4.4:1 | `neutral-800` (bajada, volver, ayuda de campo, opciones; 03b-5.1) | 6.9:1 |

El punto de la marca y los bordes siguen con `-600` (son decorativos, no son texto).

## Componentes repetidos y dónde viven

| Patrón en el diseño | Vistas (apariciones) | Componente | Carpeta |
|---|---|---|---|
| Botón pastilla (sólido, con borde, sin borde) | 13 (85) | `Button` (primary, team, secondary, ghost) | `ui/` |
| Superficie con borde, `radius-lg` y sombra | 15 (116) | `Card` | `ui/` |
| Sobretítulo en mayúsculas con línea bajo el h1 | 14 (23) | `Eyebrow` | `ui/` |
| Etiqueta pastilla con borde (box, estado) | 7 | `Badge` | `ui/` |
| Círculo con iniciales | 6 (11) | `Avatar` | `ui/` |
| Campo con etiqueta, texto o área de texto | 12 (29 inputs, 12 textareas) | `Field` + `Input` / `Textarea` / `Select` | `ui/` |
| Grupo de casillas u opciones | 2 | `ChoiceGroup` | `ui/` |
| Icono | todas | `Icon` | `ui/` |
| Punto de color + nombre del centro | todas | `Marca` | `shared/` |
| Header público (marca, nav, "Iniciar sesión", pie) | Landing, Equipo, Match | `LayoutPublico` | `shared/` |
| Header del portal (marca, nav, chip de usuario) | Paciente - Mi Cuenta / Pedir Hora | `LayoutPortal` | `shared/` |
| Sidebar del backoffice (grupos, módulos, usuario) | 9 vistas Admin | `LayoutAdmin` | `shared/` |
| Login con fondo difuso y selector paciente/equipo | Inicio de Sesión | `FormularioIngreso` | `shared/` |
| Saludo con fecha | Dashboard, Mi Cuenta | `Bienvenida` | `shared/` |
| Enlace con forma de boton | Landing, Equipo, Match | `ButtonLink` (mismas variantes que `Button` + `outlinePatient`) | `ui/` |
| "← Volver" | Pedir Hora | `EnlaceVolver` | `ui/` |
| Foto o iniciales del profesional | Landing, Equipo, Match, Pedir Hora | `AvatarProfesional` | `shared/` |
| Bloque verde de llamado a la accion | Landing, Equipo | `LlamadoAccion` | `shared/` |
| Texto de politica versionada | (nuevo) | `DocumentoPolitica` | `shared/` |
| Portada, servicios, mision/vision, equipo destacado, contacto | Landing | `Landing.tsx` | `nucleo/` |
| Tarjeta de profesional, perfil completo, reseñas | Equipo Publico | `TarjetaPerfil`, `PerfilCompleto`, `EquipoPublico` | `equipo/` |
| Cuestionario paso a paso y resultado | Match Publico | `AsistenteMatch`, `PreguntaMatch` | `match/` |
| Bifurcacion, horario, datos, retencion, verificacion | Paciente - Pedir Hora | `InicioPedirHora`, `SelectorHorario`, `SolicitudHora`, `CuentaRegresiva`, `VerificarSolicitud`, `ResultadoEnlace` | `agenda/` |
| Paso de pago (medios del centro, datos para transferir, comprobante, pasarela simulada) y pago desde la cuenta; 03b-3.2: con la hora retenida, antes del correo | (nuevo, 03b-3.1) | `PasoPago`, `PagoCitaPortal` (sondeo del estado en `lib/pagos.ts`) | `agenda/` |
| Casilla obligatoria con forma de tarjeta (aceptar politicas) | Pedir Hora | `Casilla` | `ui/` |
| Ruta del panel o del portal sin pagina (404 dentro del layout) | (nuevo, 03b) | `not-found` de `/admin` y `/portal` con `EstadoVista` | `app/` |
| Modal (overlay fijo) | 7 (9) | `Modal` (sobre `<dialog>` nativo, 03b-3) | `ui/` |
| Tabla | 2 | pendiente | `ui/` |
| Pestañas | 3 | `Pestanas` (pildoras, patron tablist, 03b-3) | `ui/` |
| Bloque de aviso (advertencia, exito, nota punteada) | Mi Cuenta | `Aviso` | `ui/` |
| Seccion con h2 y bajada (superficie neutral-100 o verde) | Mi Cuenta | `Panel` | `ui/` |
| Pildora de estado (Confirmada, Completada, Cancelada) | Mi Cuenta | `Badge tono` | `ui/` |
| Interruptor, calificacion con estrellas | (nuevo, 03b-3) | `Interruptor`, `Estrellas` | `ui/` |
| Encabezado de pagina, saludo del portal | Mi Cuenta | `Encabezado`, `SaludoPortal` | `shared/` |
| Tarjeta de login (vidrio + manchas), paso TOTP con QR, contraseña nueva, cambio de contraseña | Inicio de Sesion + nuevo | `TarjetaIngreso`, `PasoTotp`, `CamposPassword`, `CambioPassword` | `shared/` |
| Contexto del portal (menor elegido, cuenta restringida) | (nuevo, 03b-3) | `ContextoPortal`, `SoloCuentaPlena` | `shared/` |
| Mi profesional, horas, mensajes, datos (Mi Cuenta) | Paciente - Mi Cuenta | `MiProfesional` (equipo), `MisHoras` (agenda), `MensajeProfesional`, `MisDatos`, `NotaFicha` (pacientes) | `<modulo>/` |
| Pagos, documentos y copia de ficha, consentimientos, avisos, reseñas, pedir hora | (nuevo, 03b-3) | `PagosPortal` (cobros), `DocumentosPortal`/`CopiaFicha`/`ConsentimientosPortal` (pacientes), `AvisosPortal` (nucleo), `PedirHoraPortal` (agenda), `ResenasPortal` (equipo) | `<modulo>/` |
| Paginas por enlace: recuperar, acceso, activar, correo, consentimiento, recordatorio, descarga | (nuevo, 03b-3) | `RecuperarCuenta`, `EnlaceAcceso`, `ActivarCuenta`, `ConfirmarCorreo` (nucleo), `ConsentimientoEnlace`, `DescargaDocumento` (pacientes), `RecordatorioEnlace` (agenda) | `<modulo>/` |
| Tile de estadística, tarjeta de módulo | Dashboard | `Estadistica`, `TarjetaModulo` (03b-4) | `shared/` |
| Panel con título y acción, tabla con encabezado en mayúsculas | Fichas, Cobros | `Panel`, `Tabla`/`Th`/`Td` | `ui/` |
| Dashboard por rol | Admin - Dashboard | `InicioPanel` | `nucleo/` |
| Lista, vista administrativa y detalle de paciente, derivar | Admin - Fichas y Pacientes, Vista Administrativa | `ListaPacientes`, `VistaAdministrativa`, `DetallePaciente`, `SeccionesPaciente`, `CrearDerivacion` | `pacientes/` |
| Calendario consolidado, detalle de sesión (cubrir, derivar, aprobar), agendar con retención | Admin - Agenda y Espacios | `AgendaEspacios`, `CalendarioAgenda`, `DetalleCita`, `AgendarSesion` | `agenda/` |
| Espacios, horarios del equipo, pendientes | Admin - Agenda y Espacios (+ intermedias) | `EspaciosAgenda`, `HorariosEquipo`, `PendientesAgenda` | `agenda/` |
| Resumen, asistencia y pago, liquidaciones y arriendos | Admin - Cobros | `CobrosCentro`, `ResumenCobros`, `SesionesPorCobrar`, `RegistrarAsistenciaPago`, `LiquidacionesCobros` | `cobros/` |
| Configuración del centro | Admin - Configuracion | `ConfiguracionCentro`, `DatosCentro`, `HorarioPoliticasCentro`, `PlantillasMensaje`, `ReglasCentro` | `nucleo/` |
| Equipo: integrantes, perfil, practicantes, catálogos, reseñas, alertas | Admin - Perfil Profesional | `EquipoCentro`, `FichaIntegrante`, `FormularioPerfil`, `PracticantesEquipo`, `CatalogosEquipo`, `ModeracionResenas`, `AlertasEquipo`, `NuevaCuenta` | `equipo/` |
| Mi perfil | Admin - Mi Perfil | `MiCuentaEquipo` (nucleo), `MiPerfilProfesional` (equipo), `IntegracionesAgenda` (agenda), `CambioPassword` (shared) | `<modulo>/` |
| Configuración del match | Admin - Match Configuracion | `ConfiguracionMatch` | `match/` |
| Ficha clínica: evoluciones (timeline + editor con borrador), ingreso, documentos con vista previa, adjuntos, alta | (nuevo, 03b-5.1) | `FichaClinica`, `FichaClinicaTimeline`, `EditorEvolucion`, `IngresoFicha`, `DocumentosFicha`, `AdjuntosFicha`, `AltaPaciente` | `pacientes/` |
| Borradores, plantillas clínicas (editor de campos), catálogos clínicos, retención | (nuevo, 03b-5.1) | `BorradoresPendientes`, `PlantillasClinicas`, `EditorPlantilla`, `CatalogosClinicos`, `RetencionFichas` | `pacientes/` |
| Valores de un registro según la versión de su plantilla | (nuevo, 03b-5.1) | `ValoresPlantilla` (junto a `FormularioDinamico`; lo reusa la supervisión) | `shared/` |
| Accesos temporales, derivaciones (ofertas, bandeja, gestión), consentimientos del equipo, mensajes de pacientes | (nuevo, 03b-5.2) | `AccesosTemporales`, `Derivaciones`, `ConsentimientosEquipo`, `MensajesPacientes` | `pacientes/` |
| Supervisión seudonimizada, mensajería interna, asignar tipos | (nuevo, 03b-5.2) | `SupervisionCasos`, `MensajeriaInterna`, `FichaIntegrante` | `equipo/` |
| Comentarios de supervisión (supervisor y practicante) | (nuevo, 03b-5.2) | `ComentariosSupervision` | `shared/` |
| Margen de traslado y horas en conflicto | (nuevo, 03b-5.2) | `MargenTraslado` | `agenda/` |
| Bandeja de avisos | (nuevo, 03b-5.2) | `BandejaAvisos` | `nucleo/` |
| Solicitudes de copia de la ficha (equipo) | (nuevo, 03b-5.3) | `SolicitudesEpicrisis` | `pacientes/` |
| Filtro directo del match público | (nuevo, 03b-5.3) | `FiltroDirecto` | `match/` |
| Reportar una reseña pública | (nuevo, 03b-5.3) | `ReportarResena` | `equipo/` |
| Menú del panel en móvil | (nuevo, 03b-5.3) | `LayoutAdmin` | `shared/` |

## Huecos del diseño (resueltos en `design-system/vinculos/MASTER.md`)

- Selector de rol activo y selector de equipo: no están diseñados.
- Estados de carga, vacío, error y sin permiso: no están diseñados.
- Segundo paso TOTP del login: no está diseñado.

## Lo que el diseño muestra y no se implementa en 03b-1

- Módulo inactivo con candado en el menú. La regla 03b es ocultarlo
  (`GET /api/modulos`: "el front oculta los inactivos").
- Cargo bajo el nombre del usuario ("Directora"): la API no tiene cargo, así
  que se muestra el rol activo.
- Login: "¿La olvidaste?", "Recibir enlace de acceso por correo", "Usa tu
  código de invitación" y "Pide tu primera hora" quedan para la fase del
  portal. La API ya los soporta (`recuperacion`, `enlace-acceso`,
  `activacion`, `publico/solicitudes`).
- Dashboard (estadísticas, módulos, sesiones de hoy, pendientes): fase del
  dashboard.
