# Integraciones externas y mensajeria (02h, 02i)

Regla: los modulos de negocio dependen solo de **interfaces** definidas en
`backend/src/core` y nunca importan una implementacion concreta.
`CoreModule` elige la implementacion por configuracion (variables de
entorno). Un test unitario (`core/integraciones/integraciones.spec.ts`)
falla si un archivo de `src/modulos` importa una implementacion concreta o
si otro archivo de `core` que no sea `core.module.ts` la elige.

| Interfaz | Archivo | Implementaciones | Como se elige |
|---|---|---|---|
| `ProveedorCorreo` | `core/notificaciones/correo.ts` | `ProveedorCorreoSmtp` (generico), `ProveedorCorreoSimulado` | `SMTP_URL` presente -> SMTP; vacio -> simulado |
| `ProveedorVideollamada` | `core/integraciones/videollamada.ts` | `ProveedorVideollamadaPorProfesional`, `ProveedorVideollamadaSimulado` | `VIDEOLLAMADA_SIMULADA=true` -> simulado (default de los tests) |
| `ProveedorCalendario` | `core/integraciones/calendario.ts` | `CalendarioIcs` | unica (iCalendar RFC 5545) |

En los tests de integracion (`test/apoyo.ts`) las simuladas siguen siendo
el default (`VIDEOLLAMADA_SIMULADA=true`, `SMTP_URL` vacio).

## Mensajeria en tres capas (02i)

Evoluciona la tabla `notificaciones` (sin tablas duplicadas).

### 1. Eventos (catalogo fijo)

El catalogo es el enum `tipo_notificacion`. La API pide los suyos con
`notificar()` despues del COMMIT de la accion (contexto del actor); la BD
crea los que origina ella (triggers y jobs). La categoria
(`categoria_evento`) decide si el paciente puede desactivar el correo.

| Evento | Destinatario | Lo origina | Categoria |
|---|---|---|---|
| `CITA_CONFIRMADA` | paciente | API (Agenda) | operativo |
| `CITA_REPROGRAMADA` | paciente | API (Agenda) | operativo |
| `CITA_CANCELADA` | paciente; ademas el profesional si cancela el paciente con el enlace del recordatorio | API (Agenda) / BD (`responder_recordatorio`) | operativo |
| `RECORDATORIO_CITA` | paciente | job de recordatorios | recordatorio |
| `DERIVACION_OFRECIDA` | candidato (PROFESIONAL o PRACTICANTE) | BD (trigger; tambien via job o rechazo) | operativo (equipo) |
| `DERIVACION_ACTUALIZADA` | profesional que origino la derivacion | BD (trigger) | operativo (equipo) |
| `CONSENTIMIENTO_SOLICITADO` | paciente (menor: su adulto responsable por correo) | API (Derivaciones) | **legal** |
| `CONSENTIMIENTO_POR_VENCER` | paciente (menor: adulto responsable) | job (pasada la mitad del plazo, una vez) | **legal** |
| `AVISO_CAMBIO_SUPERVISOR` | paciente | API (Equipo) | **legal** |
| `DOCUMENTO_CLINICO` (documento emitido) | paciente | API (Fichas) | **legal** |
| `PAGO_REGISTRADO` | paciente | API (Cobros) | operativo |
| `BOLETA_EMITIDA` | paciente | API (Cobros) | operativo |
| `MENSAJE_PACIENTE` | profesional destinatario | API (Portal) | operativo (equipo) |

`ENLACE_ONLINE` (02f-02h) queda solo para filas historicas: el enlace de la
videollamada va ahora en la variable `{{enlace}}` de la confirmacion y la
reprogramacion.

### 2. Plantillas (`plantillas_mensaje`, categoria B)

- Una por evento, destinatario (PACIENTE o EQUIPO) y canal (BANDEJA o
  CORREO). La migracion carga ejemplos en español (`asunto_ejemplo`,
  `cuerpo_ejemplo`, fijos); ADMIN personaliza `asunto`, `cuerpo` y `activa`
  (`PATCH /api/plantillas-mensaje/:id`) y restaura el ejemplo
  (`POST /api/plantillas-mensaje/:id/restauracion`).
- Variables permitidas, unicas: `{{nombre_paciente}}`,
  `{{nombre_profesional}}`, `{{fecha}}`, `{{hora}}`, `{{modalidad}}`,
  `{{enlace}}`, `{{nombre_centro}}`. Nunca motivo, diagnostico, notas ni
  contenido clinico. Validado en la BD al guardar (CHECK
  `plantillas_mensaje_variables_permitidas` -> 422).
- `nombre_paciente` solo se llena cuando el destinatario es el propio
  paciente; a un integrante del equipo nunca se le envia el nombre de un
  paciente (p. ej. una oferta de derivacion). `enlace`: la videollamada, el
  recordatorio o la descarga del documento segun el evento; si no, el portal.
- Una plantilla de CORREO inactiva = ese evento no sale por correo. BANDEJA
  no se desactiva.

### 3. Canales

| Canal | Uso |
|---|---|
| `BANDEJA` | Siempre. Registro oficial (portal del paciente y backoffice): `GET /api/notificaciones/bandeja`, solo los propios. Asunto y cuerpo se guardan cifrados (CLINICO) una vez armados. |
| `CORREO` | Copia o aviso por correo. Respeta las preferencias del paciente salvo en avisos legales. |
| `WHATSAPP` | Valor reservado en el enum, sin implementacion (CHECK lo rechaza en notificaciones y plantillas). |

Preferencias (`preferencias_notificacion`, A): el paciente desactiva
`recordatorios` y `avisosOperativos` (`PUT /api/notificaciones/preferencias`).
Solo afectan el correo: la bandeja siempre registra. Los avisos legales no
tienen campo (un campo extra es 400): nunca se desactivan.

### Cola de salida

- Una fila por canal: `estado` PENDIENTE | ENVIADO | FALLIDO, `intentos`,
  `proximo_intento`. El job `enviar_notificaciones` (cada minuto, advisory
  lock + SKIP LOCKED, idempotente) toma las pendientes vencidas, arma cada
  mensaje con la plantilla vigente (una vez, cifrado en la fila), cierra la
  bandeja y envia el correo.
- Fallo de envio: reintento con backoff exponencial (1, 2, 4, 8 minutos);
  al quinto intento queda FALLIDO. Sin email o con la plantilla de correo
  desactivada: FALLIDO sin reintento.
- Un fallo de correo nunca bloquea la operacion que lo origino (los avisos se
  registran despues del COMMIT) y el mensaje ya esta en la bandeja.
- Nunca se loguean destinatarios, enlaces ni contenido.

### Remitente

- SMTP generico configurado **a nivel de plataforma** (no por centro):
  `SMTP_URL` (`smtp://usuario:clave@host:587` o `smtps://...:465`). Sirve
  con Amazon SES (SMTP), Postmark, Mailgun o un servidor propio.
- Remitente: la direccion de la plataforma (`CORREO_REMITENTE`, por defecto
  `no-responder@vinculos.cl`) con el **nombre del centro** como nombre visible
  (`configuracion_centro.nombre_centro`, lo edita ADMIN).
- **Futuro: dominio propio por centro** (p. ej. `avisos@centro.cl`). Requiere
  que el centro publique SPF (incluir al proveedor de envio), firme con DKIM
  (llaves del proveedor en su DNS) y, idealmente, DMARC; la plataforma
  guardaria por silo la direccion verificada. Mientras tanto, la direccion de
  la plataforma evita que los correos caigan en spam.

## Recordatorios de citas (02i)

- `configuracion_centro.recordatorio_horas_antes` (default 48 desde 02j; 0 =
  desactivado). Job `enviar_recordatorios` (Agenda, cada 10 min, advisory
  lock): un recordatorio por cita y horario (`recordatorios_cita`, UNIQUE);
  si la cita se reprograma, sale otro para el horario nuevo.
- El mensaje lleva `{{enlace}}` a `FRONTEND_URL/recordatorio?token=...` (pagina publica: el enlace autoriza sin sesion, 03b-3).
  Token de 256 bits, **un solo uso** (confirmar o cancelar), valido hasta el
  inicio de la cita; se guarda su SHA-256 y la URL cifrada.
- Sin sesion (el token autoriza, rate limit publico):
  - `GET /api/recordatorios/:token`: horario, modalidad, profesional y la
    politica que aplicaria si cancela ahora (a tiempo o tardia, plazo y
    penalizacion vigentes). Se muestra antes de confirmar.
  - `POST /api/recordatorios/:token/confirmacion` y `.../cancelacion`. La
    cancelacion aplica la politica vigente (`plazo_aviso_cancelacion_horas`):
    responde si fue a tiempo y la penalizacion, cancela la cita y avisa al
    paciente y al profesional. Segundo uso o enlace vencido: 409.
- Respeta las preferencias del paciente (categoria recordatorio).
- Regla (02j, CHECK `configuracion_centro_recordatorio_antes_de_cancelacion`):
  si el recordatorio esta activo, `recordatorio_horas_antes` debe ser mayor
  que `plazo_aviso_cancelacion_horas`; si no, cancelar desde el recordatorio
  siempre seria tardio. Aplica cambie el que cambie (23514 -> 422 con mensaje
  propio). La migracion movio los silos con recordatorio <= plazo al minimo
  coherente (48, o plazo + 1; con plazo >= 168, desactivado).

## Calendario

- **UID fijo por cita** (`<id de la cita>@vinculos`) y **SEQUENCE** =
  `citas.secuencia`, que la BD sube en cada cambio de horario, modalidad, box
  o estado. Una reprogramacion actualiza el evento existente.
- **Adjunto `.ics`** en los correos de confirmacion, reprogramacion y
  cancelacion, con el estado actual de la cita: METHOD:PUBLISH, o
  **METHOD:CANCEL** + STATUS:CANCELLED si esta cancelada; ORGANIZER = nombre
  del centro con la direccion de la plataforma.
- **Feed iCal privado** por profesional: `POST /api/profesionales/yo/calendario`
  devuelve una URL `.../api/calendario/<token>.ics` (se muestra una sola vez).
  El token se guarda como SHA-256; regenerarlo invalida el anterior. El feed
  se sirve sin sesion (el token autoriza, rate limit publico) via
  `feed_calendario(hash)`: citas CONFIRMADA, POR_REPROGRAMAR (tentativas) y
  CANCELADA (STATUS:CANCELLED, para que el cliente la quite) de 30 dias atras
  a un año adelante, con el mismo UID y SEQUENCE.
- Regla de contenido unica (`eventoDeCita`): solo "Sesion", la modalidad, el
  horario y el enlace o el box. **Nunca** nombre del paciente ni motivo.

## Documentos clinicos (02h, 02i)

### Emitidos por el tratante

- Plantilla por tipo de documento (`tipos_documento_clinico.plantilla`, la
  edita ADMIN). Variables: `{{nombre_paciente}}`, `{{nombre_profesional}}`,
  `{{fecha}}`, `{{nombre_centro}}` y `{{contenido}}` (lo que redacta el
  profesional). CHECK `tipos_documento_clinico_plantilla_valida` (422).
- El profesional redacta en la app; el servidor arma el texto con la
  plantilla y lo guarda cifrado (`documentos_clinicos.contenido`, CLINICO).
  **Sin subida de archivos ni base64.**
- El PDF se genera al entregarlo (descarga o adjunto) con pdfkit y el formato
  del centro: encabezado con su nombre, titulo del tipo, el texto armado y la
  fecha de emision. Nada fuera de eso.
- Por correo (regla de 02h): **el unico contenido clinico que sale por correo
  son documentos emitidos**. Por defecto un **enlace** que expira
  (`DOCUMENTO_ENLACE_HORAS`, 72 h) y exige iniciar sesion como el paciente;
  cada descarga queda en `descargas_documento` y en `accesos_ficha`
  (DESCARGA). **Adjunto** solo si el paciente lo pidio
  (`solicitar_adjunto_documento`); sin solicitud la BD rechaza el envio
  (422). Cada envio queda en `envios_documento` y en `accesos_ficha` (ENVIO).
- **Firma electronica: pendiente.** Los PDF no llevan firma electronica
  (simple ni avanzada, Ley 19.799); se agregaria al generar el PDF.

### Adjuntos externos de la ficha

- `POST /api/pacientes/:id/adjuntos` (multipart, campo `archivo`), solo el
  tratante. multer procesa el stream y corta al pasar `ADJUNTO_MAX_MB`
  (default 10 MB) -> 413.
- Tipos permitidos: PDF, PNG y JPEG, **validados por contenido** (magic
  bytes; lo que declara el cliente se ignora) -> 422 `adjuntos_ficha_tipo`.
- Cifrado con la DEK CLINICO y AAD `adjuntos_ficha:contenido:<id>` (id
  generado por la API), guardado como bytea con la misma RLS y auditoria que
  la ficha (ADMIN, GESTION y el paciente no los ven; subida y descarga en
  `accesos_ficha`).
- El cuerpo JSON de la API queda limitado a 1 MB.
- **Ruta futura: almacenamiento de objetos.** Hoy el archivo pasa por memoria
  y se guarda en Postgres (simple, mismo respaldo y misma RLS; sirve con
  limites chicos). Con volumen o archivos grandes: subir en streaming a un
  bucket por silo (S3 o Lightsail Object Storage) cifrado del lado de la API
  con la misma DEK y AAD, guardando en la BD solo la referencia, el hash y
  los metadatos (la RLS sigue en la fila); descargas con URL firmada de vida
  corta. Requiere respaldo y retencion del bucket alineados con la ficha.

## Videollamada

Niveles:

| Nivel | Que es | Estado |
|---|---|---|
| 1. `ENLACE_PROPIO` | Sala fija del profesional (Zoom, Meet, Jitsi propio...), guardada cifrada; sin enlace configurado la cita online se rechaza (422 `videollamada_sin_sala`) | **Habilitado (unico en uso)** |
| 2. `JITSI` | Sala unica por cita: `JITSI_URL_BASE/vinculos-<128 bits hex>` | Implementado, **desactivado** (`JITSI_HABILITADO=false` -> 422 `videollamada_jitsi_deshabilitado`). Para usarlo: servidor Jitsi propio y `JITSI_HABILITADO=true` |
| 3. Integrada | Salas creadas via API del proveedor (Meet con Google Workspace, Zoom) con OAuth por centro o profesional, sala de espera y control de acceso | Futuro (ver "Por que Google queda pospuesto") |

El enlace de cada cita se guarda cifrado en `citas.enlace_online` con
expiracion (`ENLACE_ONLINE_HORAS_TRAS_FIN`) y va al paciente en
`{{enlace}}` de la confirmacion o reprogramacion.

## Por que Google queda pospuesto

- **Gestion de Workspace**: crear salas de Meet o eventos en nombre del
  centro exige una cuenta Google Workspace del cliente (y su administracion),
  que no todos los centros tienen.
- **OAuth por profesional**: escribir en el calendario de cada profesional
  exige que cada uno autorice la app, guardar y renovar refresh tokens por
  usuario (otro secreto sensible por silo) y manejar revocaciones.
- **Verificacion de Google**: los scopes de Calendar son sensibles; una app
  publica requiere la verificacion de Google (politica de privacidad,
  revision, posible auditoria de seguridad) antes de salir de modo prueba.
- **Datos de salud en terceros**: un evento en Google con datos de la sesion
  es un dato de salud en un tercero; exige evaluacion legal (Ley 20.584 y
  21.719) y contrato de tratamiento de datos con Google por cada centro.

El feed iCal y el `.ics` cubren la necesidad (ver las citas en Google
Calendar, Outlook o Apple) sin credenciales ni datos del paciente en
terceros.

## Como se agregaria Google como adaptador opcional

1. Implementar `ProveedorVideollamada` (Meet via Calendar API
   `conferenceData`) y/o un adaptador de `ProveedorCalendario` que empuje los
   eventos de `eventoDeCita` (misma regla de contenido) en vez de generar ICS.
2. Guardar las credenciales OAuth por profesional cifradas (tabla nueva,
   categoria A, columna en `registro.ts`) y un modo nuevo `GOOGLE_MEET` en
   `modo_videollamada`.
3. Elegirlo en `CoreModule` por configuracion (`GOOGLE_HABILITADO`), sin
   tocar los modulos de negocio. Las simuladas siguen siendo el default de
   los tests.
4. Antes de habilitarlo en un silo: verificacion de la app en Google y
   evaluacion legal del centro.

## Correos de cuenta (03a)

Invitacion, verificacion de correo, recuperacion, enlace de acceso y enlace
de consentimiento salen directo por `ProveedorCorreo`
(`core/notificaciones/correos-cuenta.ts`), no por la cola de
`notificaciones`: llevan un token de un solo uso que no debe quedar guardado
en el mensaje cifrado. Sin reintento: si el envio falla se pide de nuevo.
