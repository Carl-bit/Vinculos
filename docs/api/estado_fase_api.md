# Estado de la fase de API (02a-02j)

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

## Tests

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
- **Coleccion Bruno** `backend/pruebas/bruno/` (121 requests, 158 tests,
  todos OK sobre datos recien reseteados) y guion
  `docs/pruebas/guion_manual.md`.
- **ESLint + Prettier** (`eslint.config.mjs`, `.prettierrc`, ancho 160 = p99
  del codigo existente). Solo formato y tres ajustes sin efecto funcional
  (ver entrega 02j).

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
