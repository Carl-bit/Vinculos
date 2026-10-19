# Estado de la fase de API (02a-03a)

Prompts: 02a-02i (entregados en la conversacion). Reglas: CLAUDE.md (seccion
API), `docs/seguridad/requisitos_02_apis.md`, `matriz_permisos.md`.
Integraciones y mensajeria: `docs/api/integraciones.md`.

## Migraciones de la fase

| Migracion | Prompt | Contenido |
|---|---|---|
| `20261012000000_api_sesiones_alertas` | 02a | `sesiones` (refresh tokens rotativos), `alertas_internas`, trigger que revoca sesiones al cambiar la cuenta, default de `evoluciones.created_at` en la BD |
| `20261013000000_notificaciones` | 02f | `notificaciones` (registro de avisos) + funciones del job de envio |
| `20261014000000_portal_mensajes_epicrisis` | 02g | `mensajes_paciente`, `solicitudes_epicrisis` (contenido cifrado) |
| `20261015000000_ajustes_y_cobros` | 02h | A1 propuesta/aprobacion de `profesional_tipos_atencion`; A2 `tipos_documento_clinico` (B), `documentos_clinicos`, `envios_documento`, `descargas_documento`; A3 triggers de avisos de derivacion; A6 `salas_videollamada`, `feeds_calendario` + `feed_calendario()`; B `citas.monto`/`cancelada_en`, pagos solo via funciones, vista `estado_pago_citas`, boleta unica por cita, `resoluciones_cita`, arriendos por periodo, `liquidaciones`, configuracion de cancelacion y comision |
| `20261016000000_mensajeria_enums` | 02i | valores de enum (eventos nuevos, PENDIENTE/ENVIADO/FALLIDO, canal, destinatario, respuesta del recordatorio): migracion aparte porque un ADD VALUE no se usa en la misma transaccion |
| `20261016000100_mensajeria_recordatorios_documentos` | 02i | `notificaciones` por canal (BANDEJA/CORREO; WHATSAPP reservado) con cola y backoff y contenido cifrado; `plantillas_mensaje` (B, ejemplos cargados); `preferencias_notificacion`; `notificar()`/`encolar_notificacion`; `recordatorios_cita` + `configuracion_centro.recordatorio_horas_antes`; `citas.secuencia` (SEQUENCE) y feed con canceladas; plantilla por tipo de documento; `adjuntos_ficha`; aviso de consentimiento por vencer |
| `20261017000000_recordatorio_antes_de_cancelacion` | 02j | `recordatorio_horas_antes` default 48 y CHECK `configuracion_centro_recordatorio_antes_de_cancelacion` (activo -> mayor que `plazo_aviso_cancelacion_horas`); silos con recordatorio <= plazo se movieron al minimo coherente |
| `20261018000000_03a_enums` | 03a-1 | valores de enum: rol RESPONSABLE, cita SOLICITADA, medio de pago CONVENIO, avisos HORA_LIBERADA, ACCESO_CLINICO_TEMPORAL, SOLICITUD_HORA, CIERRE_REQUERIDO y alerta BAJA_CON_BORRADORES |
| `20261018000100_03a_cuentas_portal_agenda` | 03a-1 | varios roles por cuenta, tokens por correo y TOTP, politicas y aceptaciones, menores y RESPONSABLE, citas SOLICITADA y solicitudes de hora sin cuenta, horario del centro y por box, lista de espera, perfil publico ampliado, match configurable, imagenes publicas, modulos activables, reseñas, acceso clinico temporal, borradores de evolucion, altas, liquidacion por cita realizada, reportes (ver `docs/front/brechas.md` seccion 6) |
| `20261019000000_03a2_enums` | 03a-2 | valores de enum: alerta y aviso POSIBLE_DUPLICADO, aviso MENSAJE_INTERNO |
| `20261019000100_03a2_plantillas_mensajeria` | 03a-2 | `especialidades`, `profesional_especialidades`, `plantillas_clinicas` (versionadas, con ejemplos), `ingresos_ficha`, plantilla y valores en `evoluciones` y `borradores_evolucion`; `hilos_internos`, `participantes_hilo`, `mensajes_internos`, `lecturas_hilo`; `correos_cuenta_pendientes`; `configuracion_centro.retencion_mensajes_dias` y `edad_minima_cuenta`; duplicados solo via funcion (alerta y aviso); RUT antes de la primera evolucion para todo paciente |
| `20261024000000_quitar_lista_espera` | rollback | retira la lista de espera (con cuenta 03a, publica 03b y "avisarme si se libera una hora"): tablas, triggers de aviso, funciones, job y columnas. Implementacion futura; ver la seccion final |

Todas siguen el checklist de tabla nueva: categoria A (salvo
`tipos_documento_clinico` y `plantillas_mensaje`, B), ENABLE + FORCE RLS, politicas por rol +
`<tabla>_acceso_vigente`, GRANT minimo (sin UPDATE ni DELETE en datos
clinicos, cobros ni auditoria; cambios de estado solo via funciones),
cifrado en `registro.ts`, casos en `seguridad_bd.sql` y filas en la matriz.

## Endpoints (prefijo /api)

| Modulo | Rutas |
|---|---|
| core | `POST auth/login`, `auth/refresh`, `auth/logout`; `GET salud`; `GET notificaciones` (registro); 02i: `GET notificaciones/bandeja`, `GET/PUT notificaciones/preferencias`, `plantillas-mensaje` (`:id`, `:id/restauracion`) |
| nucleo (02b) | `usuarios` (CRUD sin DELETE, `yo`, `yo/password`), `configuracion` (02h: nombre y RUT del centro, politica de cancelacion, comision), `practicantes` (`:id/acceso`, `:id/revocacion`, `:id/historial`), `bajas` (`por-reasignar`), `alertas` (`:id/atendida`), `directorio` (`mi-equipo`) |
| fichas (02c, 02h) | `pacientes` (busqueda `?rut=`), `pacientes/:id/adultos-responsables`, `pacientes/:id/ficha`, `fichas/:id/evoluciones`, `tipos-sesion`, `intervenciones`, `estados-avance`, `retencion/fichas`, `retencion/revisiones`; 02h: `tipos-documento-clinico`, `documentos-clinicos` (`:id/envios`, `:id/solicitud-adjunto`, `descarga/:token` -> PDF); 02i: `pacientes/:id/adjuntos` (multipart), `adjuntos-ficha/:id` |
| agenda (02d, 02h) | `espacios` (`ocupacion`), `profesionales/:id/{disponibilidad,bloqueos,huecos,conflictos-margen}`, `agenda/horarios-tomados`, `citas` (`verificacion`, `por-reprogramar`, `:id/cancelacion`, `:id/reprogramacion`, `:id/enlace`); 02h: `profesionales/yo/videollamada`, `profesionales/yo/calendario`, `calendario/:token` (publico); 02i: `recordatorios/:token` (`confirmacion`, `cancelacion`; publico) |
| equipo (02e, 02h) | `profesionales/yo/{perfil,datos-privados,tarifas,tipos-atencion}`, `profesionales/:id/{perfil,margen,trayectoria,datos-privados,tarifas,tipos-atencion,tipos-atencion/:tipoId}`, `trayectoria`, `tipos-atencion` (`propuestas`), `supervisiones`, `practicantes/:id/supervisor`, `supervision/casos`, `supervision/evoluciones/:id/comentarios`, `evoluciones/:id/comentarios` |
| derivaciones (02f) | `derivaciones` (`pendientes`, `:id/oferta`, `:id/respuesta`, `:id/cancelacion`, `:id/candidatos`, `:id/practicantes`, reintegro), `consentimientos` (`solicitudes`, `:id/respuesta`, `:id/revocacion`), `avisos-consentimiento` |
| match (02g) | `publico/{profesionales, profesionales/:id/disponibilidad, match}` (anonimo, rate limit), `portal/{equipo,citas,citas/:id/datos-pago,mensajes,epicrisis}`, `mensajes`, `epicrisis` |
| cobros (02h) | `cobros/citas` (`:id`, `:id/pagos`, `:id/resolucion`), `cobros/pagos/:id/anulacion`, `cobros/arriendos`, `cobros/liquidaciones` (`:id/emision`, `:id/pago`) |
| 03a-1 | `auth/{cambio-rol,totp,totp/enrolamiento,activacion,recuperacion(/confirmacion),enlace-acceso(/confirmacion),correo/verificacion}`; `usuarios/:id/{roles,roles/PROFESIONAL/baja,invitacion,totp/reinicio}`; `configuracion/{horario,logo,contenido-publico}`, `modulos`, `politicas`, `reportes/dashboard`; `pacientes/:id/{invitacion,duplicado-revisado,consentimiento-atencion(/enlace),aceptaciones,alta,altas,accesos-temporales,respuestas-match}`, `accesos-temporales`, `borradores` (`fichas/:fichaId/borradores`, `:id/confirmacion`), `profesionales/:id/estado-fichas`; `espacios/:id/horario`, `citas/:id/{aprobacion,cierre-requerido,profesional}`, `lista-espera` (`:id/cierre`); `profesionales/{yo,:id}/foto`, `profesionales/yo/resenas`; `match/{preguntas,opciones,metricas}`, `resenas` (`:id/moderacion`); `portal/{pacientes,mis-datos,consentimiento-atencion,resenas}`; `publico/{centro,cuestionario,match,solicitudes(/verificacion),politicas/:tipo,imagenes/:id,profesionales/:id/resenas,resenas/:id/reporte,consentimientos/{consulta,respuesta}}`; `cobros/reporte(/pdf)`, `cobros/liquidaciones/:id/pdf`; `consentimientos/:id/enlace`, `avisos-consentimiento/:id/enlace` |
| 03a-2 | `especialidades` (`:id`), `profesionales/yo/especialidades`, `profesionales/:id/especialidades` (`:especialidadId/revision`); `plantillas-clinicas` (`:id`, `:id/versiones`, `:id/publicacion`, `:id/desactivacion`); `fichas/:fichaId/ingresos`; `hilos` (`:id/mensajes`, `:id/participantes`, `mensajes/:mensajeId/retiro`); `notificaciones/preferencias/pacientes/:pacienteId`; `pacientes/:id/duplicado-revisado` ahora con `resolucion` |

## Tests

- 03a-1: `npm run test:e2e` 135 casos (03a-alineacion 19 nuevos); `npx jest` 34 unitarios (totp y reglas del match); `correr_tests_bd.sh` 115 casos SQL (101-115 nuevos; 46, 49, 67, 78, 89, 95 ajustados). Detalle por fase anterior:
- `npm run test:e2e`: 116 casos de integracion (Jest + Supertest) contra un
  Postgres 18 efimero (`test/bd/levantar.sh`: migraciones, seed, llaves de
  prueba). Por archivo: 02a 22, 02b 19, 02c 13, 02d 12, 02e 8, 02f 8, 02g 8,
  02h-ajustes 8, 02h-cobros 5, 02h-simulacro-hmac 1, 02i-mensajeria 10,
  02j-openapi 2. Si el puerto por defecto cae en un rango reservado por
  Windows (Hyper-V), usar `PUERTO_TEST=5440 npm run test:e2e` y
  `PUERTO=5441 sh prisma/tests/correr_tests_bd.sh`.
- `npx jest`: 29 unitarios (cifrado y contingencia 16; programacion de jobs
  con reloj simulado 5, incluye recordatorios y consentimientos por vencer;
  integraciones 8: modos de videollamada, regla del .ics, UID/SEQUENCE/CANCEL
  y que ningun modulo importe una implementacion concreta).
- `sh prisma/tests/correr_tests_bd.sh`: 100 casos SQL (02i: 96-99 y redefine
  88 y 91; 02j: 100) + `migrate diff` + arranque real de la API + scripts de llaves.

## Decisiones de 02h

- **Montos**: sin tarifa aplicable el monto queda en 0 (SIN_COBRO). Citas
  anteriores a 02h quedan con `monto` nulo hasta su proxima confirmacion.
- **Estado de pago**: ademas de PENDIENTE, PARCIAL y PAGADO se agrega
  SIN_COBRO (exigible 0: sin tarifa, cancelada sin cobro o trasladada).
- **Credito de una cancelacion a tiempo** = TRASLADO a una cita nueva ya
  agendada; no hay saldo a favor suelto (si aun no hay cita nueva, se
  decide despues). Una cancelacion sin decision no cobra nada.
- **Boleta**: una por cita, al quedar PAGADA; si lo pagado viene trasladado
  de una cita que ya tenia boleta, no se emite otra. No se anula un pago con
  boleta (nota de credito: con el SII, fuera de alcance).
- **Liquidacion**: comision sobre lo cobrado por el centro menos
  devoluciones; arriendos que empiezan en el periodo; periodos sin solape.
  Un pago de un periodo emitido no se anula.
- **Avisos de derivacion** desde la BD (triggers): sin autor
  (`creada_por_id` nulo) para no revelar quien rechazo; un aviso pendiente
  por derivacion al origen.
- **Tipos de atencion**: el filtro de candidatos de derivacion es el del
  directorio (solo APROBADOS); la BD no exige que el candidato tenga el tipo.
- **Videollamada**: sin sala configurada (ENLACE_PROPIO) o con JITSI
  deshabilitado, la cita online se rechaza (422) en vez de quedar sin enlace.
- **Body JSON**: 02i lo vuelve a 1 MB (ver abajo).

## Decisiones de 02i

- **Una fila por canal** en `notificaciones`: la BANDEJA es el registro
  oficial (siempre); el CORREO es otra fila con su propia cola. La bandeja se
  arma en el job (cada minuto): un mensaje aparece en el portal con hasta un
  minuto de demora.
- **Preferencias** solo afectan canales externos (correo); la bandeja
  registra todo. Legales: consentimiento solicitado o por vencer, cambio de
  supervisor y documento emitido.
- **Destinatario de plantilla** = PACIENTE o EQUIPO (no cada rol); el nombre
  del paciente solo se usa cuando el destinatario es el propio paciente.
- **Contenido**: el job arma el mensaje una vez y lo guarda cifrado; un
  cambio posterior de plantilla no reescribe la bandeja. Los reintentos usan
  el mismo texto (mismos enlaces).
- **Recordatorio**: un enlace (`{{enlace}}`) a una pagina del portal con
  token de un solo uso: ahi el paciente ve la politica y elige confirmar o
  cancelar (la lista de variables permitidas tiene un solo `enlace`).
  Cancelar por token marca la cita CANCELADA, informa a tiempo/tardia y avisa
  al profesional; la decision de cobro (devolucion o traslado) sigue siendo
  de ADMIN/GESTION con `resolver_cita`, con el mismo criterio (cancelada_en).
- **Devolucion sin penalizacion**: cancelacion a tiempo, con pagos y sin
  reagendar -> `resolver_cita` DEVOLUCION devuelve todo (porcentaje 0); el
  TRASLADO a una cita nueva sigue disponible.
- **.ics**: PUBLISH para confirmacion/reprogramacion y CANCEL para la
  cancelacion, con ORGANIZER = centro; el adjunto refleja el estado actual de
  la cita al armarse el correo (SEQUENCE de la BD).
- **Documentos emitidos**: texto armado con la plantilla del tipo y guardado
  cifrado; PDF (pdfkit, sin compresion de streams) al entregar. El paciente
  lee solo los tipos de sus documentos (titulo del PDF).
- **Emitir para un paciente ajeno**: 404 (no revela que existe); ADMIN o
  GESTION, que si lo ven, 403.
- **Adjuntos**: en Postgres (bytea cifrado, base64) con limite de 10 MB;
  ruta futura a almacenamiento de objetos documentada.
- **Videollamada**: solo nivel 1 (enlace propio) en uso; Jitsi (nivel 2)
  queda implementado y desactivado por configuracion.

## 02j: preparacion para pruebas manuales

- **Recordatorio vs. cancelacion**: regla en la BD (CHECK sobre la fila de
  `configuracion_centro`), asi aplica cambie el recordatorio o el plazo;
  23514 -> 422 con mensaje propio. 0 sigue desactivando el recordatorio.
- **OpenAPI**: `@nestjs/swagger` con el plugin del CLI (DTOs desde
  class-validator y JSDoc). `/docs` y `/docs-json` fuera de produccion
  (`DOCS_API` lo fuerza). `@Roles` agrega JWT, la lista de roles y los
  errores 400/401/403/404/409/422; `@Publico` 400/429; 413 en adjuntos y
  documentos. Tags por modulo. `npm run openapi:exportar` ->
  `docs/api/openapi.json` (modo preview: sin BD ni KEK). Las respuestas 2xx
  van sin esquema (los servicios devuelven tipos de Prisma, no clases).
- **BD local sin Docker**: `infra/scripts/bd_local.sh` (`npm run bd:local --
  iniciar|detener|recrear`), cluster propio en `infra/local/pg` (ignorado
  por git); `recrear` solo necesita al dueño.
- **Centro demo**: `prisma/seed-demo.ts` (`npm run seed:demo`), por la API
  real levantada en el mismo proceso; como dueño solo el practicante
  expirado y las citas pasadas. Idempotente por marca (usuario GESTION).
  `npm run demo:reset` = recrear la BD local + seed demo; se niega con
  `NODE_ENV=production` o BD no local. Se agrego `profesional3` (dos
  candidatos de derivacion ademas del origen).
- **Correo local**: Mailpit (binario de Windows). Verificado el 2026-10-12:
  confirmacion, reprogramacion y cancelacion llegan con `sesion.ics`
  (PUBLISH / CANCEL, mismo UID, SEQUENCE creciente); el recordatorio llega
  con el enlace de un solo uso (sin `.ics`, como se diseño en 02i); el
  documento emitido llega como enlace y la descarga con sesion del paciente
  entrega el PDF.
- Guion `docs/pruebas/guion_manual.md`. (La coleccion Bruno de 02j se
  elimino en 03a: las pruebas manuales se hacen en Postman.)
- **ESLint + Prettier** (`eslint.config.mjs`, `.prettierrc`, ancho 160 = p99
  del codigo existente). Solo formato y tres ajustes sin efecto funcional
  (ver entrega 02j).

## Decisiones de 03a-1

Decisiones del usuario y su resolucion: `docs/front/brechas.md` (seccion 6).
Ademas, al implementar:

- **Cuenta invitada**: el CHECK `usuarios_cuenta_cerrada_vacia` acepta una
  cuenta abierta sin contraseña (invitacion pendiente); solo entra al
  activarla con el token.
- **Liquidacion (C-11)**: cuenta pagos cobrados por el centro de citas
  REALIZADAS (CONFIRMADA, terminada, sin inasistencia) por la fecha de la
  cita. Ya no resta devoluciones (solo existen en citas canceladas, que no se
  liquidan). Un pago no se anula si su cita cae en un periodo emitido.
  **PENDIENTE (decision del usuario, 2026-10-15)**: se mantiene asi por
  ahora; queda por decidir si los cobros por cancelacion tardia e
  inasistencia (que el centro si retiene) se liquidan al profesional.
- **Menores (D-4)**: menos de 14 sin cuenta; 14 a 17 cuenta restringida; el
  adulto responsable con cuenta (rol RESPONSABLE) ve citas, pagos y documentos
  emitidos, nunca la ficha ni los mensajes del adolescente. **Validacion
  legal pendiente**: la edad de 14 y el alcance del adulto responsable deben
  revisarse con la Ley 21.331 (salud mental), la Ley 20.584 (derechos y
  deberes del paciente) y la Ley 21.719 (datos personales) antes de operar
  con pacientes reales.
- **Centro demo**: el seed demo enrola el TOTP de las cuentas del equipo y
  deja los secretos en `infra/local/totp-demo.txt` (fuera de git).

## Decisiones de 03a-2

- **Plantilla por version**: `plantilla_id` apunta a la fila de la version
  (no se guarda aparte el numero: sale de la plantilla). La plantilla de
  ejemplo no tiene autor (`propuesta_por_id` nulo).
- **"Un tratante nuevo de otra especialidad lee los registros anteriores con
  su propia plantilla"** (prompt): contradice "cada registro se muestra con
  la version con que se escribio". Se implemento lo segundo: los registros
  anteriores se muestran con su plantilla original (de la especialidad que
  sea; el equipo ve las plantillas publicadas e inactivas) y el tratante
  nuevo escribe los suyos con la plantilla de su especialidad.
- **Hilo GENERAL con participantes explicitos** (el creador elige; cualquier
  participante agrega). Hilo CASO sin participantes guardados: son quienes
  tienen acceso clinico vigente en cada lectura.
- **Escribir en un hilo CASO con acceso temporal de solo lectura** se
  permite: el mensaje no es parte de la ficha.
- **Avisos de mensaje interno**: a lo mas uno por hilo y persona cada 15
  minutos (evita una ráfaga de correos).
- **Duplicado MISMO_PACIENTE**: se registra la decision; la fusion de fichas
  no es automatica (pendiente).
- **Rate limit de mensajes**: 30 por usuario y minuto, en la API (consulta en
  la misma transaccion).
- **Tests dependientes del reloj (preexistentes)**: 02i creaba citas que de
  noche cruzaban la medianoche local (fuera de la disponibilidad por dia) y el
  caso SQL 95 tomaba un periodo que de noche no incluia las citas: corregidos.

## Pendiente / no probado

- Porcentajes de penalizacion, inasistencia y comision: quedan en 0 por
  defecto, a definir con el caso de estudio.
- Pasarela de pago, medios de pago, SII y propuestas financieras: fuera de
  alcance (numero de boleta simulado, `pdf_url` nulo).
- SMTP real: implementado (nodemailer) pero no probado contra un servidor;
  los tests usan el simulado. Jitsi probado solo como generacion de URL.
- k6 (`backend/pruebas/stress-agenda.js`) preparado, no corrido: sin Docker.
  La colision concurrente si esta cubierta en `02d-agenda.e2e-spec.ts`.
- Simulacro HMAC en Docker (`MODO=docker`): sin Docker; se ensayo en modo
  local con los mismos scripts (`02h-simulacro-hmac.e2e-spec.ts`).
- 02i: correo real (SMTP) y como lo muestran los clientes de correo y
  calendario (Gmail, Outlook, Apple) el .ics con METHOD:CANCEL/SEQUENCE: no
  probado (solo el texto generado). WhatsApp: reservado, sin implementar.
  Dominio propio por centro (SPF/DKIM) y firma electronica de documentos:
  pendientes. Pagina del portal para el enlace del recordatorio: es del
  frontend (fase siguiente).
- 03a-1: preferencias de notificacion para RESPONSABLE no implementadas;
  correos de cuenta (invitacion, verificacion, recuperacion) sin reintento;
  RUT obligatorio solo para pacientes creados por solicitud (se exige al
  registrar la primera evolucion); el tratante tambien puede limpiar
  `posible_duplicado` en la BD. `seed:demo` no se corrio contra 03a.
  La coleccion Bruno se elimino (las pruebas manuales se hacen en Postman). Campos clinicos
  por especialidad y mensajeria interna: 03a-2.
- 03a-2: tiempo real (SSE) de la mensajeria; adjuntos en mensajes; reportes
  sobre campos de plantilla; fusion de fichas duplicadas; validacion legal de
  D-4 (los cortes de edad ya son configurables). C-11 sigue pendiente.
- 03b-3: la reserva desde la cuenta y la descarga directa de documentos
  quedaron resueltas antes de 03b-4 (`POST portal/citas`,
  `GET documentos-clinicos/{id}/pdf`). El
  texto del consentimiento de practicante no esta versionado en la BD (el
  portal registra `practicante-portal-v1`). Pendiente: tipo de politica
  propio si el centro necesita editarlo.

## 03b-4 (backoffice)

- Sin migraciones ni endpoints nuevos. Contrato OpenAPI completado para las
  vistas del backoffice (ver `docs/seguridad/requisitos_02_apis.md`, 03b-4):
  60 de 276 operaciones siguen sin schema de respuesta.
- `HorarioCentroDto` (antes `HorarioDto` del nucleo, choque de nombres con
  Agenda en el OpenAPI).
- Tests: unitarios 39/39, integracion 163/163
  (`PUERTO_TEST=55431 npx jest --config test/jest-e2e.json --runInBand`),
  front Vitest 21/21 y Playwright 29/29 (incluye `e2e/panel.spec.ts`, 8
  casos del backoffice). `PUERTO=55439 sh prisma/tests/correr_tests_bd.sh`:
  todos los casos OK (sin cambios en la BD en esta fase).

## 03b-5.1 (ficha clinica)

- Endpoints: `POST documentos-clinicos/vista-previa`, `GET
  documentos-clinicos/:id/copia`, `PATCH intervenciones/:id`, `PATCH
  estados-avance/:id`; `GET borradores` con `pacienteId`. Detalle en
  `docs/seguridad/requisitos_02_apis.md` (03b-5.1).
- OpenAPI: 280 operaciones; Fichas sin operaciones sin schema.
- Tests de integracion nuevos: vista previa y copia por rol (02h), catalogos
  desactivables solo por ADMIN (02c), `pacienteId` en borradores (03a).
- Seed demo: especialidad aprobada para Profesional Uno, plantillas de
  ingreso y evolucion publicadas, un ingreso, una evolucion con plantilla y
  un borrador pendiente (Paciente Prueba).

## 03b-5.2 (acceso a fichas ajenas y equipo)

- Migraciones: `20261023000000_03b5_enums`,
  `20261023000100_03b5_consentimiento_practicante` (detalle en
  requisitos_02_apis.md 03b-5.2). `seguridad_bd.sql` caso 64: version no
  vigente rechazada; los casos 64, 73 y 75 aceptan con la version vigente.
- Tests de integracion actualizados: 02f (pacienteId en la derivacion, antes
  y despues del traspaso; version vigente), 03b3 (el enlace muestra el texto
  y la version del consentimiento de practicante; una version vieja da 422).
- Seed demo: comentario de supervision, conversacion general y del caso,
  acceso temporal de interconsulta.

## 03b-5.3 (cierre de flujos)

- Sin cambios de API ni migraciones. El front usa el resto del contrato
  (epicrisis, cierre requerido, cita por id, verificacion previa, horarios
  tomados, match directo, reporte de reseñas). Cobertura: 274 operaciones
  con pantalla, 6 excepciones justificadas.

## Rollback: lista de espera (implementacion futura)

La lista de espera se ve en una entrega posterior; se retira de la primera
version de prueba con una migracion nueva (`20261024000000_quitar_lista_espera`),
sin editar las aplicadas:

- BD: sin `lista_espera`, `lista_espera_publica`, `estado_lista_espera`,
  `solicitudes_hora.lista_espera` ni `configuracion_centro.dias_lista_espera_publica`;
  sin los triggers `citas_hora_liberada` y `bloques_atencion_avisan` ni las
  funciones de inscripcion, verificacion, baja y avisos. `crear_solicitud_hora`
  pierde `p_lista_espera`; `concretar_solicitud_hora`, `registrar_alta`,
  `reporte_dashboard` (sin `pendientes.lista_espera`) y
  `notificaciones_por_enviar` se redefinen sin la lista. Se borran las
  plantillas de HORA_LIBERADA y los enlaces de la lista publica pendientes.
- Quedan sin uso los valores de enum HORA_LIBERADA (`tipo_notificacion`) y
  VERIFICACION_LISTA_ESPERA / BAJA_LISTA_ESPERA (`tipo_token_correo`):
  PostgreSQL no quita valores de un enum sin recrear el tipo.
- API: sin `/lista-espera` ni `/publico/lista-espera`, sin el job
  `avisar_lista_espera_publica` y sin `listaEspera` en la solicitud de hora.
- Front: sin la seccion del portal, la pestaña de Agenda, el formulario en
  Pedir hora, las paginas `/lista-espera/verificar` y `/lista-espera/baja` ni
  la tarjeta del dashboard.
- Tests: `seguridad_bd.sql` casos 107 y 124 verifican que no queda nada
  (sin avisos al cancelar, sin tablas, funciones ni columnas); 106 y 110
  quedan sin la lista.
- Para retomarla: el diseño anterior queda en el historial de git (commits de
  03a-1 y 03b) y en `design-system/vinculos/MASTER.md`.
