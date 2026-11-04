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
| Token `neutral-700` (#645c50) sobre `neutral-300` donde quedaba | 4.4:1 | token oscurecido a #5f574b (03b-4.1) | 4.8:1 |
| Token `accent-2-700` (#56633f) sobre `neutral-300` | 4.35:1 | token oscurecido a #515e3b (03b-4.1) | 4.7:1 |

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
| Configuración del centro | Admin - Configuracion; Opción A submenú agrupado por tema | `ConfiguracionCentro`, `DatosCentro`, `HorarioPoliticasCentro`, `PlantillasMensaje`, `ReglasCentro` | `nucleo/` |
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
| Control segmentado (opciones excluyentes con icono, radios nativos) | (nuevo, 03b-4.1) | `ControlSegmentado` | `ui/` |
| Campo único de RUT (formatea, valida DV, normaliza; acepta correo en el login) | (nuevo, 03b-4.1) | `CampoRut` | `shared/` |
| Fecha de nacimiento en tres desplegables (bisiestos, aviso de menor) | (nuevo, 03b-4.1) | `FechaNacimiento` | `shared/` |
| Segundo paso por correo, códigos de respaldo, verificación de la cuenta | (nuevo, 03b-4.1) | `PasoSegundoFactor`, `CodigosRespaldo`, `SegundoFactorCuenta` | `shared/` |
| "Iniciar sesión" / "Ir a mi panel" del header público (renueva la sesión en silencio) | Landing | `AccesoCuenta` | `shared/` |
| "Viendo a" del selector de equipo | (nuevo, 03b-4.1) | `ViendoA` (en `EquipoActivo`) | `shared/` |
| Cabecera de Mi perfil (foto, indicadores, próxima sesión) | Admin - Mi Perfil | `CabeceraMiPerfil` | `equipo/` |
| Mis datos y descripción, calificaciones, resto del perfil | Admin - Mi Perfil | `MisDatosDescripcion`, `MisResenas`, `MasDeMiPerfil` | `equipo/` |
| Mis horas e información de pacientes | Admin - Mi Perfil | `MisPacientesEstado` | `pacientes/` |
| Mi cuenta (filas desplegables) | Admin - Mi Perfil | `MiCuentaAccesos` | `nucleo/` |
| Periodo de la agenda (< periodo >, Semana \| Mes, Hoy) y vista mensual | Admin - Agenda y Espacios | `SelectorPeriodo`, `CalendarioAgenda` | `agenda/` |

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

## Evoluciones: editor y archivo en pila (2026-10-31)

Implementado desde `design-reference/Evoluciones editor y archivo en pila (sin IA)-html`. Colores y fuentes salen de Organic (Figtree, sin Bricolage Grotesque). Diferencias por lo que entrega la API:

- La API guarda un solo texto de notas: título, formato, escalas y tareas viajan dentro de `notas` (`lib/notasEvolucion.ts`). Se escriben como marcas en el campo de texto (`**negrita**`) y se ven con formato al leer. El PDF de una exportación las quita (`notasSinMarcas`); el JSON conserva el texto tal cual.
- El riesgo se guarda en el borrador y se confirma en el modal. El tipo de sesión (obligatorio en la API, ausente del diseño) se pide solo en ese modal.
- "Tarea para el paciente" no llega al portal (no hay API): queda como "Tarea acordada" dentro de la evolución y se muestra al escribir la siguiente, sin casillas.
- "Campo de plantilla" no está en el menú Insertar: los campos dependen de la plantilla elegida (la API valida contra esa versión) y aparecen juntos al elegirla.
- Una escala nueva se guarda solo con valor. El gráfico de ánimo usa escalas llamadas "Ánimo" o el campo numérico `animo` de la plantilla.
- Con varias correcciones "Corregir" solo aparece en la versión vigente.
- La evolución elegida se abre sobre las pilas (el diseño la muestra debajo) y la pantalla sube con ella hasta el documento. Contacto de emergencia y conversaciones van en la columna derecha, bajo "Para escribir esta sesión" cuando el editor está abierto.
- Agenda (Opción A, `design-reference/Opción A semana unificada con panel lateral-html`, 2026-11-03): "Mi horario" une presencial y online (Día | Semana | Mes) con un panel lateral: filtro de modalidad con conteo del rango, boxes (estado ahora, barra de ocupación del rango = apartado / (apartado + libre), horas de sesión libres) y "Por confirmar" (pago pendiente desde hoy + conteo por reprogramar). Reemplaza la pestaña "Por box" (`?vista=box` cae en "Mi horario") y el interruptor "Mis sesiones encima" (las sesiones van siempre encima, rellenas con el color de su modalidad y sombra para destacarse del fondo del box).
- Con un box elegido en el panel: cada sesión ajena es un bloque "Ocupado" (`sesiones_espacios()`, sin quién entre profesionales). Las horas futuras libres del box ("HH:00 Libre en Box") y las disponibles dentro de lo apartado abren "Agendar sesión" presencial; una hora libre se aparta al reservar y se libera si la cita no se confirma.
- Hora vacía a futuro (día o semana, filtro distinto de Presencial): abre "Agendar sesión" online con esa hora (no ocupa box; la API verifica al retener). Solo con mouse (`tabIndex=-1`): con teclado se agenda desde el botón "Agendar sesión", para no sumar decenas de paradas de tabulación.
- Diferencias con el diseño: los botones "Registrar pago" y "Recordar al paciente" de "Por confirmar" no están; cada hora abre el detalle de la sesión, donde se registra el pago (la API no tiene un endpoint de "recordar" a demanda; los avisos de pago salen solos a las 48 y 24 h). La marca "PAGO" usa el tono oscuro (`pendiente-900`) en vez de `#A06E0E` para cumplir AA con texto de 9,5 px. ADMIN con "Todo el equipo" ve también el color por modalidad (antes, color por profesional) y el nombre del profesional en la tarjeta.
- Configuración (Opción A, `design-reference/Opción A submenú agrupado por tema-html`, 2026-11-03): submenú lateral agrupado por tema (El centro, Operación, Finanzas, Comunicación, Equipo, Legal y privacidad, Vinculos) con buscador de ajustes (filtra por nombre y palabras clave, sin tildes) y contadores calculados con datos que la vista ya pide: misión o visión vacía, sin horario, medios activos, plantillas, integrantes sin leer el protocolo vigente, módulos activos. Diez secciones con título y bajada; los `?vista=` anteriores (`modulos`, `soporte`, `politicas`, `notificaciones`, `reglas`, `roles`, `auditoria`, `derechos`, `exportacion`, `feriados`) llevan a la sección que hoy los contiene.
- Secciones: Horario y feriados lado a lado (interruptor por día, atajo "Lunes a viernes, 09:00 a 20:00"); Agenda y plazos y Cobros y comisiones guardan juntos con la barra "Descartar / Guardar esta sección"; "Quién cobra las sesiones" en tarjetas A/B/C (`modeloCobro`: DIRECTO, CENTRO, MIXTO); Avisos como tabla evento × destino (Editada = distinta del ejemplo, tachada = desactivada) con editor y vista "Así le llega" al costado (sobre 2xl) o arriba de la tabla (bajo 2xl, se trae a la vista al elegir); el contrato con Vinculos pasa de Políticas a "Módulos, contrato y soporte".
- Configuración, 2.ª pasada (2026-11-05): Datos y página pública igual al diseño (identidad y contacto en dos columnas, logo, textos con aviso de misión y visión vacías, servicios en filas con Editar y Quitar, color de marca al costado con 5 colores sugeridos, hexadecimal, vista previa y contraste AA calculado). Horario con pausa por día (dos tramos = dos filas de `horario_centro`) y aviso "cerrado" real: sin días el centro está cerrado en la BD. Feriados compacto (próximos + agregar + "Ver año completo"). Cobros y acuerdos: acuerdo por defecto (A/B/C = `modeloCobro`), acuerdos por profesional reales (`/api/cobros/acuerdos`, componente `cobros/AcuerdosProfesionales` que la página pasa a Configuración) con ejemplo de un mes, cancelaciones y parámetros tributarios (`lib/tributario.ts`). Roles con conteo de personas por rol (directorio). Consentimientos en filas (Ver texto / Nueva versión, lecturas del protocolo con "Ver quién falta"). Auditoría plegada con resumen de 7 días. Barra común `nucleo/BarraGuardado`.
- Diseño de ejemplo, sin aplicar (no hay endpoint o adaptador): "Link de pago" y "Conexiones de cobro" en Medios (pasarela: el interruptor y "Conectar" quedan deshabilitados; la transferencia del centro sí es real), "Solicitar" un módulo no contratado y "Recordar a pendientes" del protocolo (botones deshabilitados con explicación).
- Diferencias con el diseño (Configuración): sin "Si la cuota supera lo recaudado" (la liquidación deja el total negativo = el profesional le debe al centro), sin "Comisión de la pasarela la paga" (no hay pasarela) y sin arrastre de servicios ("::"). Practicantes: "No cobra · No se liquida" sin supervisor ni fecha de término en la fila. Cuota fija: una por cada día 1 de mes dentro del período liquidado. Colores del sistema Organic, no los del mockup.

## Excepciones aceptadas de impeccable (2026-10-30)

`nested-cards` en Agenda (tiles de horario), Equipo (datos del integrante),
Configuración (texto de la política) y detalle del paciente (avisos): copian el
diseño del handoff, que manda en lo visual. No se corrigen.
