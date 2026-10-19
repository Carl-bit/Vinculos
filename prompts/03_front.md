# Prompt - Seccion Frontend (Next.js)

Lee CLAUDE.md y los endpoints ya generados (seccion APIs) antes de empezar.
Este es el frontend de UN silo (una instancia de cliente), no la landing del
producto Vinculos, que es un sitio aparte. Generar el portal publico y el
backoffice completos en una sola pasada, no pantalla por pantalla.

## Paso 0: antes de generar cualquier vista
1. Traer el diseño real via el handoff de Claude Design a Claude Code (o el
   HTML standalone exportado en `design-reference/` si se uso esa ruta).
   Cada vista que ya tiene una pantalla equivalente ahi se implementa
   adaptando ese diseño, no reinterpretandolo ni cayendo en un layout
   generico propio.
2. Si existe `design-system/vinculos/MASTER.md` (generado por ui-ux-pro-max),
   leerlo y usarlo para las vistas que no estan en el handoff.
3. Evitar sin excepcion: degradados morado-a-azul de IA, Inter como unica
   tipografia, icono en tile cuadrado redondeado repetido sobre cada titulo,
   easing de rebote por defecto, tarjetas anidadas dentro de tarjetas.
4. Al terminar cada vista, correr `npx impeccable detect` sobre los archivos
   tocados y corregir lo que marque antes de pasar a la siguiente.

## Estructura general
- App Router de Next.js.
- `app/(publico)/...` renderiza SSR/SSG, sin autenticacion, optimizado para
  SEO (metadata por pagina, sitemap).
- `app/(admin)/...` renderiza CSR, protegido por el JWT del modulo Auth,
  redirige a login si no hay sesion valida.
- Cliente de datos: React Query (o SWR) para todo llamado al backend NestJS,
  nunca fetch suelto repetido por componente.

## Portal publico (captacion de pacientes)
- `/`: landing del centro (no del producto Vinculos), presenta al centro y
  a los profesionales.
- `/profesionales/[id]`: perfil educativo del profesional (especialidad,
  enfoque explicado sin tecnicismos, modalidad, tarifa).
- `/match`: flujo de preguntas -> llama al endpoint de match terapeutico ->
  muestra profesionales recomendados.
- `/busqueda`: filtros avanzados (enfoque, tarifa, modalidad,
  disponibilidad), llama al endpoint de busqueda.
- `/contacto/[profesionalId]`: formulario de mensaje (nombre, contacto,
  mensaje). Al enviar, solo pega al endpoint que reenvia por email y guarda
  historial in-app. No implementar bandeja de respuesta in-app, eso esta
  fuera de alcance.

## Backoffice (admin/profesional/practicante, segun rol)
- `/admin/dashboard`: vista global de ocupacion de agendas (solo ADMIN).
- `/admin/agenda`: calendario de espacios. Al seleccionar un horario libre,
  primero pega al endpoint de bloqueo temporal (soft-lock), muestra el
  espacio como "en proceso de reserva" con cuenta regresiva visible, y solo
  al confirmar pega al endpoint de confirmar cita. Si el backend devuelve
  409 (alguien gano la carrera), mostrar mensaje claro y refrescar
  disponibilidad, no reintentar solo. Refrescar disponibilidad por polling
  cada pocos segundos mientras la pantalla de agenda este abierta (no usar
  websockets, no esta en el alcance).
- `/admin/pacientes`: lista y ficha de pacientes, visible solo segun lo que
  el backend devuelva ya filtrado por RLS (el frontend no debe intentar
  ocultar/mostrar fichas por su cuenta, confia en lo que el backend
  entrega).
- `/admin/pacientes/[id]/evoluciones`: timeline de evoluciones (solo
  agregar, nunca editar una entrada existente en la UI, coherente con que
  el backend tampoco lo permite).
- `/admin/equipo`: gestion de profesionales y practicantes (solo ADMIN),
  incluye alta/baja de acceso temporal con fecha de expiracion visible.
- `/admin/cobros`: arriendos, comisiones, pagos, emision de boleta.

## Componentes (seguir la jerarquia de CLAUDE.md, no crear una propia)
- `components/ui/`: Button, Input, Badge, Modal, Card base. Extraer del
  handoff de Claude Design, no inventar variantes nuevas.
- `components/shared/`: LayoutPublico, LayoutAdmin (header distinto, admin
  siempre con el rol visible y logout), AvatarProfesional.
- `components/agenda/`: SelectorHorario con estado visual de libre /
  bloqueado por mi / bloqueado por otro / confirmado.
- `components/pacientes/`: FormularioPaciente con validacion de fecha de
  nacimiento que anticipa si va a requerir adulto responsable (espejando la
  regla del backend, sin reemplazarla).
- Antes de escribir un componente nuevo, revisar si `ui/` o `shared/` ya
  tienen algo equivalente.

## Restricciones que no se pueden dejar pendientes
- El portal publico y el backoffice completo salen en esta pasada, no
  "primero el publico y despues el admin en otra conversacion".
- Ninguna pantalla debe replicar en el cliente una regla de negocio que ya
  vive en el backend (RLS, EXCLUDE, validacion de menores); el frontend
  refleja el estado que el backend entrega, no decide por su cuenta.

## Salida esperada
- Paginas y componentes listados arriba, con llamadas reales a los
  endpoints del modulo APIs (no mockeados).
- README corto indicando variables de entorno esperadas (URL del backend,
  etc.) para levantar el frontend contra el backend local.

## Fases 03b (registro de avance)

Cada fase deja aqui lo que quedo pendiente para la siguiente, para que no se
pierda entre sesiones. Una fase no empieza sin resolver sus "Antes de
empezar".

### 03b-3 Cuentas y portal del paciente (cerrada 2026-10-17)

Detalle en `docs/front/brechas.md` seccion 11 y capturas en
`docs/front/capturas/03b-3`. Pendiente de decidir: esas capturas (40 PNG,
12 MB) pasan a WebP o quedan fuera del repo y se adjuntan en la entrega.

### 03b-4 Backoffice segun diseño

Antes de empezar (pendientes de 03b-3, en este orden). **Hechos el
2026-10-17** (ver `docs/seguridad/requisitos_02_apis.md`, "Antes de
03b-4"); el 1 quedo solo con el tratante actual (otro profesional =
derivacion, C-4/C-5):

1. **Reserva desde la cuenta** (`POST /api/portal/citas`, PACIENTE y
   RESPONSABLE). Funcion SECURITY DEFINER
   `reservar_cita_portal(profesional, modalidad, inicio, fin, paciente)`:
   paciente propio o menor a cargo; hora dentro de `disponibilidad_publica()`;
   politica vigente aceptada; menor sin adulto responsable lo rechaza el
   trigger existente. Profesional que aprueba pacientes nuevos y paciente
   nuevo para el: SOLICITADA; si no: CONFIRMADA. El EXCLUDE manda (409 con
   alternativas); soft-lock solo mientras elige. Monto lo fija la BD al
   confirmar. **El adolescente (14-17) no reserva**: lo hace su adulto
   responsable (D-4). Front: `/portal/pedir-hora` reutiliza
   `SelectorHorario` sin el formulario de datos. Matriz, test por rol y caso
   en `seguridad_bd.sql`.
2. **Descarga directa de documentos en el portal**
   (`GET /api/documentos-clinicos/{id}/pdf`, PACIENTE y RESPONSABLE con
   sesion). Funcion SECURITY DEFINER `registrar_descarga_portal(documento)`
   que valida dueño o menor a cargo y registra `descargas_documento` y
   `accesos_ficha` (DESCARGA), igual que el enlace del correo. El
   adolescente queda fuera por `app_pacientes_plenos`. El envio por correo
   no cambia (enlace por defecto, adjunto solo si el paciente lo pide).
3. **ESLint en el front.** `frontend/eslint.config.mjs` (flat config) con
   `next/core-web-vitals`, `next/typescript` (via `FlatCompat`) y `jsx-a11y`
   recomendado; scripts `lint` (`eslint src e2e`) y `format:check`
   (Prettier). Corregir lo que marque en lo existente; las vistas de 03b-4 y
   03b-5 nacen pasando el lint. Hasta entonces la revision estatica es
   `tsc` + `next build`.
4. **Entorno local para probar.** La BD de desarrollo es el contenedor de
   Docker `erp-centro-prueba-db-1` (Postgres 18, `127.0.0.1:5432`), no
   `infra/local/pg`. Aplicar migraciones y cuentas demo con
   `npm run demo:reset` en `backend/` (recrea la BD: borra los datos
   locales; pedir confirmacion antes de correrlo). Mailpit no es un
   contenedor: se levanta con `npm run dev:mailpit` en la raiz (o todo junto
   con `npm run dev`); sin el fallan los e2e de `publico.spec.ts` que leen
   correos (`127.0.0.1:8025`).

Avance de 03b-4 (2026-10-17, sesion cortada por limite de uso):

- Hecho: Dashboard por rol (`components/nucleo/InicioPanel.tsx`, tiles
  `shared/Estadistica`, `shared/TarjetaModulo`), alta de paciente en modal
  (`pacientes/FormularioPaciente`, `pacientes/NuevoPaciente`, anticipa el
  adulto responsable si es menor), hooks del panel (`lib/panel.ts`) y DTOs de
  respuesta de `reportes/dashboard`, `pacientes`, `citas`, `espacios`,
  `tipos-atencion`. Compila (tsc back y front). Capturas del Dashboard en el
  scratchpad, sin revisar todavia.
- Falta: revisar capturas del Dashboard + impeccable; Fichas y pacientes
  (vista profesional y administrativa, RUT en recepcion); Agenda y espacios
  ("Derivar paciente" y "Cubrir sesion"); Cobros ("registrar asistencia y
  pago", liquidacion por citas realizadas); Configuracion; Perfil
  profesional; Mi perfil; Match configuracion. Documentar en el backend los
  schemas de respuesta que cada vista use (quedan ~190 sin schema). Docs de
  la fase (brechas, inventario, MASTER, guion) y e2e del panel.

Avance de 03b-4 (2026-10-18):

- Hecho: Fichas y pacientes (lista con filtros en la URL, vista
  administrativa por profesional, detalle con RUT de recepcion, duplicados,
  adulto responsable, consentimiento, cuenta, historial de sesiones y
  "Derivar paciente"; `?derivar=1` abre la derivacion desde la agenda).
- Hecho: Agenda y espacios (`components/agenda/AgendaEspacios` y pagina
  `/admin/agenda`): calendario consolidado de la semana por profesional o
  por box; detalle de sesion con aprobar (SOLICITADA), reprogramar,
  cancelar, "Cubrir sesion" (ADMIN otorga el acceso clinico temporal de
  reemplazo en el mismo paso; GESTION solo si ya existe) y "Derivar
  paciente" (solo el tratante, va a la ficha); agendar con soft-lock y
  cuenta regresiva, 409 con alternativas; pestañas Espacios (horario base y
  por periodo, % apartado de la semana), Horarios del equipo (horario
  habitual, apartar horas de box con sugerencia segun el habitual, liberar,
  bloquear agenda), Pendientes (por aprobar y por reprogramar) y Lista de
  espera interna. DTO nuevo `AccesoTemporalVista`. e2e en
  `frontend/e2e/panel.spec.ts` (3, pasan).
- Hecho: Cobros (`components/cobros/CobrosCentro`, `/admin/cobros`):
  resumen del periodo, "registrar asistencia y pago" (pago, inasistencia,
  devolucion o traslado, anulacion), liquidaciones (generar, emitir, pagada,
  PDF) y arriendos de box. La comision es el porcentaje del centro sobre lo
  cobrado (no "cobro por derivacion" como en el diseño: no existe en la BD).
- Hecho: Configuracion (`components/nucleo/ConfiguracionCentro`,
  `/admin/configuracion`, solo ADMIN): datos y logo, servicios, marca,
  modulos (solo lectura), horario del centro, politicas versionadas, reglas
  y plazos, roles.
- Hecho (backend): schemas de respuesta de Equipo, Usuarios, Practicantes,
  Bajas, Alertas, Cobros, Configuracion, Match (preguntas, metricas),
  plantillas de mensaje, videollamada y calendario. `HorarioDto` del nucleo
  renombrado a `HorarioCentroDto` (chocaba con el de Agenda en el OpenAPI).
- Hecho: Equipo (`components/equipo/EquipoCentro`, `/admin/equipo`):
  integrantes con ficha (perfil, revisiones, trayectoria, tarifas, datos
  para pagos a pedido, horas y pacientes, calificaciones, cuenta),
  practicantes, catalogos, moderacion de reseñas, alertas, bajas y pacientes
  por reasignar; Nueva cuenta. Mi perfil (`/admin/perfil`, en el menu).
  Match configuracion (`/admin/match`). Pestaña Notificaciones (plantillas)
  en Configuracion.
- Docs: `brechas.md` seccion 12, `inventario_ui.md`, `MASTER.md`
  (Backoffice 03b-4), `guion_manual.md` seccion 10, `requisitos_02_apis.md`
  y `estado_fase_api.md` (03b-4).
- Tests: unitarios 39, integracion 163, BD todos OK, Vitest 21, Playwright
  29 (8 del backoffice en `e2e/panel.spec.ts`). impeccable: solo `side-tab`
  en el calendario (borde de 4 px del diseño, aceptado).
- Capturas de 03b-4 fuera del repo (decidido: no se versionan).
- Entorno: en Windows, el `next dev` con webpack dejaba de hidratar despues
  de algunas recompilaciones (chunk 404, aviso de cache de webpack). El
  script `dev` del front usa ahora `next dev --turbopack` (solo desarrollo;
  `next build` no cambia). Si vuelve a pasar: detener `npm run dev`, borrar
  `frontend/.next` y levantar de nuevo.

**03b-4 cerrado (2026-10-18).**

Alcance (conectar a la API, segun `docs/front/brechas.md`):

- Dashboard por rol activo (sin datos clinicos para ADMIN/GESTION).
- Fichas y pacientes, y vista administrativa (solo metadata). Registro de
  RUT en la primera sesion (recepcion).
- Agenda y espacios: en vez de "reasignar", dos acciones: "Derivar
  paciente" (abre derivacion) y "Cubrir sesion" (acceso clinico temporal).
- Cobros: "cerrar sesion" pasa a "registrar asistencia y pago"; la
  liquidacion segun citas realizadas.
- Configuracion, Perfil profesional, Mi perfil (usa `shared/CambioPassword`
  de 03b-3), Match configuracion.
- Si una vista contradice una regla, seguir la regla y reportarlo.
- Generar tambien las pantallas intermedias que el flujo necesite aunque no
  esten pedidas explicitamente (flujo completo).

### 03b-5 Pantallas nuevas

No estan en el diseño: diseñarlas con el sistema Organic y el inventario de
03b-1 (`docs/front/inventario_ui.md`, `design-system/vinculos/MASTER.md`).

- Clinico: ficha de ingreso y evoluciones con formularios dinamicos segun la
  plantilla de la especialidad (version con que se escribio cada registro),
  mas campos estructurados (tipo de sesion, intervenciones, estado de
  avance, nivel de riesgo); borrador con guardado automatico y "Confirmar en
  el expediente" (aviso de que despues no se edita) y lista de borradores
  pendientes; correccion como registro nuevo; documentos emitidos
  (redaccion y vista previa del PDF); adjuntos; contacto de emergencia
  visible para el tratante; alta del paciente; catalogos con propuesta y
  aprobacion; revision de retencion.
- Plantillas clinicas: editor por especialidad (campos, tipos, opciones,
  orden, visible en supervision), propuesta del profesional, publicacion por
  ADMIN, historial de versiones. Especialidades del profesional con
  aprobacion.
- Accesos clinicos temporales: otorgar (REEMPLAZO o INTERCONSULTA, alcance,
  fecha de termino), ver activos y vencidos; aviso al paciente.
- Derivaciones: crear con candidatos, estado para el origen, bandeja de
  ofertas del candidato (solo motivo, edad y tipo), gestion de ADMIN.
- Practicantes: consentimientos, supervision seudonimizada con comentarios,
  accesos, cambio de supervisor.
- Equipo: trayectoria con verificacion, datos privados, tarifas, tipos de
  atencion y especialidades con aprobacion, prevision, idiomas, cita
  destacada, consentimiento de perfil publico, modo de videollamada, roles
  de la cuenta, bajas por rol con bandeja de reasignacion (avisar borradores
  pendientes), alertas internas, directorio.
- Agenda: horario del centro y por box, disponibilidad semanal por
  modalidad, bloqueos, margen de traslado, alternativas ante 409, citas por
  reprogramar, conflictos de margen, lista de espera, feed iCal (copiar y
  regenerar), aprobacion de pacientes nuevos.
- Cobros: pagos parciales, anulaciones, boletas, resoluciones de
  cancelacion, liquidaciones y arriendos, exportar PDF de reportes y
  liquidaciones, opcion "exigir evolucion registrada para liquidar".
- Mensajeria: bandeja del equipo y editor de plantillas de mensajes
  (variables permitidas); mensajeria interna con hilos GENERAL (aviso de no
  nombrar pacientes) y CASO (solo con acceso clinico; desaparece al perder
  el acceso), retirar mensaje dentro de 5 minutos, leidos, polling.
- Reseñas: moderacion (publicar, ocultar con motivo, reportes) y feedback
  privado del profesional.
- Configuracion completa del centro: GESTION, plazos, margenes,
  porcentajes, modelo de cobro, recordatorio, dias de gracia, retencion de
  mensajes, contenido publico, horarios. **Incluye (pendiente de 03b-3)
  el consentimiento de practicante versionado**: valor nuevo
  `CONSENTIMIENTO_PRACTICANTE` en `tipo_politica` (migracion propia, como
  `03b_enums`); `responder_consentimiento` exige la version vigente (422
  `aceptaciones_politica_version_vigente`); `consultar_token_consentimiento`
  y el portal devuelven el texto de esa politica; ADMIN la publica aqui; el
  seed publica una v1. Reemplaza `practicante-portal-v1` del front. Las
  respuestas ya registradas conservan su version (append-only).
- Pasar cada vista nueva por impeccable y adjuntar captura.

#### Division de 03b-5 (2026-10-18)

Diagnostico al empezar (`docs/api/openapi.json` contra el front): 276
operaciones, 55 sin schema de respuesta y ~70 que ninguna pantalla usa
(descontando auth, salud y descargas por enlace). Varias son huecos de flujo
de 03b-3/03b-4 (la regla era generar tambien las pantallas intermedias que
el flujo necesite): la oferta de derivacion no llega al candidato, la
solicitud de consentimiento del practicante, la resolucion de epicrisis en
el portal, el reporte publico de reseñas, conflictos de margen, "requerir
cierre", foto, margen y tipos de atencion por profesional. Se cierran aqui.

Criterio de cierre de la seccion: toda operacion del OpenAPI la usa una
pantalla o tiene la justificacion escrita en
`frontend/scripts/cobertura-api.excepciones.json`
(`npm run api:cobertura` en `frontend/`), y ninguna operacion que use el
front queda sin schema de respuesta. Al final, inventario de todas las
pantallas nuevas para revision del usuario antes de pasar a 04.

Tres fases, sin recortar alcance (todo lo de la lista de arriba entra):

1. **03b-5.1 Clinico (Fichas y pacientes).** Schemas de respuesta de todo
   Fichas. Ficha clinica del tratante: ingreso y evoluciones con
   `shared/FormularioDinamico` segun la version de plantilla de cada
   registro, campos estructurados, borradores (autoguardado, "Confirmar en
   el expediente", pendientes), correccion como registro nuevo, documentos
   emitidos (redaccion, vista previa, envios, tipos de documento),
   adjuntos, contacto de emergencia, alta e historial de altas. Catalogos
   clinicos (tipos de sesion, intervenciones, estados de avance) con
   propuesta y aprobacion. Editor de plantillas clinicas (campos, tipos,
   opciones, orden, visible en supervision; propuesta, publicacion,
   versiones, desactivacion). Revision de retencion.
2. **03b-5.2 Acceso a fichas ajenas y equipo.** Accesos clinicos
   temporales (otorgar, activos y vencidos). Derivaciones completas
   (candidatos, estado del origen, bandeja de ofertas del candidato,
   respuesta, cancelacion, reintegro, practicantes, gestion ADMIN).
   Practicantes: solicitud de consentimientos y enlaces, supervision
   seudonimizada con comentarios, cambio de supervisor, consentimiento de
   practicante versionado (migracion). Mensajeria interna (hilos GENERAL y
   CASO, retiro en 5 min, leidos, polling) y notificaciones. Equipo: foto,
   margen y tipos de atencion por profesional, especialidades con
   aprobacion, directorio `mi-equipo`.
3. **03b-5.3 Cierre de flujos y auditoria.** Agenda (conflictos de margen,
   requerir cierre), cobros (PDF), portal (resolucion de epicrisis, leido de
   mensajes), reporte publico de reseñas, contenido publico del centro.
   Auditoria item por item de la lista contra las pantallas de 03b-4.
   `api:cobertura` en cero, impeccable, e2e, docs (brechas, inventario,
   MASTER, guion, matriz si cambia) e inventario de pantallas para revision.

Avance de 03b-5.1 (2026-10-18):

- Hecho: ficha clinica `/admin/fichas/[id]/ficha` (evoluciones con borrador
  y confirmacion, correccion, ingreso, documentos con vista previa del PDF,
  adjuntos, alta, contacto de emergencia), Fichas › Borradores, Plantillas
  clinicas (editor y versiones), Catalogos clinicos y Retencion. Backend:
  schemas de todo Fichas y de las descargas binarias, `vista-previa` y
  `copia` de documentos, PATCH de intervenciones y estados de avance,
  `pacienteId` en borradores. Seed demo con especialidad, plantillas,
  ingreso, evolucion con plantilla y borrador. Huecos de 03b-4 corregidos:
  ruta de la ficha (404), `?filtro=borradores` del dashboard, "Todos" en la
  vista de ADMIN, acceso temporal sin boton de ficha. Detalle en
  `docs/front/brechas.md` 13.
- Criterio de cierre medible: `npm run api:cobertura` (frontend) con
  excepciones justificadas en `scripts/cobertura-api.excepciones.json`.
- Tests: integracion 02c/02h/03a OK (42 + 14), Vitest 26, Playwright 32
  (3 nuevos en `e2e/ficha.spec.ts`, idempotentes).
- impeccable sobre el HTML renderizado con sesion (no solo regex): sin
  tarjetas anidadas, sin saltos de encabezado, contraste AA. Falsos
  positivos comprobados con HTML minimo: `cramped-padding` con
  `calc()`/`clamp()` (todo el padding de Tailwind v4). La vista previa del
  PDF se ve en blanco solo en Chromium headless (sin visor); en Chrome real
  se ve el PDF.
- Para 5.3 (shell de 03b-4, aparece en todas las pantallas): etiquetas del
  menu "Modulos"/"Centro" a 10.5 px y "Rol activo" a 11.5 px (impeccable:
  bajo el minimo), y el menu lateral no se colapsa en movil (queda apilado
  sobre el contenido).

Avance de 03b-5.2 (2026-10-18):

- Hecho: accesos clinicos temporales (ficha, detalle del paciente, Fichas ›
  Accesos), derivaciones (ofertas del candidato, bandeja de ADMIN y
  supervisores, lista y gestion), consentimientos de practicante (equipo) y
  su version vigente (migraciones 03b5), supervision seudonimizada con
  comentarios (Equipo › Supervision y en la ficha del practicante),
  `/admin/mensajes` (equipo, de pacientes, avisos), asignar tipos (ADMIN),
  margen de traslado con horas en conflicto. Schemas de todo el contrato
  (solo `GET salud` sin schema, justificado). Detalle en brechas.md 14.
- `ui/Modal` en portal sobre `body` (impeccable: dialogo anidado en tarjeta);
  texto de 10.5 px a 11 px y "Rol activo" a 12 px en todo el panel.
- Tests: integracion 166/166, BD OK, Vitest 26, Playwright 37 (5 nuevos en
  `e2e/equipo-clinico.spec.ts`; el de retirar mensaje apuntaba a la burbuja
  equivocada y se corrigio).
- Para decidir en 5.3: impeccable marca "tarjeta dentro de tarjeta" en
  pantallas de 03b-4 que copian el diseño (tiles de horario dentro de la
  tarjeta del profesional, datos dentro del panel del integrante, texto de
  la politica dentro de su panel). La regla de 03_front lo prohibe; el
  diseño lo tiene.

Avance de 03b-5.3 (2026-10-19):

- Hecho: solicitudes de copia de la ficha (equipo), requerir cierre, enlace
  directo a una cita, verificacion previa y retomar la retencion al agendar,
  filtro directo del match publico (la opcion existia en Configuracion sin
  efecto), reporte publico de reseñas, menu del panel en movil. Auditoria de
  la lista de 03b-5 contra 03b-4: completa. `npm run api:cobertura`:
  "Cobertura completa" (274 operaciones con pantalla, 6 excepciones).
- Tests: integracion 166/166, BD OK, Vitest 26, `next build` OK. Playwright:
  41 tests (4 nuevos en `e2e/cierre-flujos.spec.ts`); la corrida completa dio
  40/41 y el que fallo (agendar) paso tras la correccion al repetir
  `panel.spec.ts` (8/8). La verificacion previa al
  agendar se hacia despues de retener y la propia retencion contaba como
  choque (lo detecto el e2e de agendar): ahora verifica antes.
- impeccable sobre el HTML renderizado de cada pantalla nueva. Corregido:
  dialogos anidados (Modal en portal), contraste de textos sobre el fondo del
  panel, texto de 10 px, saltos de encabezado. Falsos positivos comprobados:
  `cramped-padding` con calc()/clamp().
- Inventario para revision: `docs/front/pantallas_03b5.md`.

**03b-5 cerrado (2026-10-19), pendiente de la revision del usuario.**
