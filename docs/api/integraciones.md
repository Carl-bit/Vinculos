# Integraciones externas (02h)

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

## Correo

- SMTP generico configurado **a nivel de plataforma** (no por centro):
  `SMTP_URL` (`smtp://usuario:clave@host:587` o `smtps://...:465`). Sirve
  con Amazon SES (SMTP), Postmark, Mailgun o un servidor propio.
- Remitente: la direccion de la plataforma (`CORREO_REMITENTE`, por defecto
  `no-responder@vinculos.cl`) con el **nombre del centro** como nombre visible
  (`configuracion_centro.nombre_centro`, lo edita ADMIN).
- Los correos no llevan contenido clinico: avisan y remiten al portal. Las
  unicas excepciones son el enlace de videollamada, el `.ics` de la cita y
  los **documentos clinicos emitidos** (ver abajo). Los mensajes del paciente
  no cambian: el correo al profesional solo avisa que hay un mensaje.
- El job `enviar_notificaciones` (cada minuto, advisory lock) arma cada correo
  con `notificaciones_por_enviar()`; nunca loguea destinatarios, enlaces ni
  contenido.

### Documentos clinicos por correo

- Regla: **el unico contenido clinico que sale por correo son documentos
  emitidos** por el tratante (`documentos_clinicos`, catalogo
  `tipos_documento_clinico`).
- Por defecto se envia un **enlace** que expira (`DOCUMENTO_ENLACE_HORAS`,
  72 h) y que exige iniciar sesion como el paciente; cada descarga queda en
  `descargas_documento` y en `accesos_ficha` (DESCARGA). El token (256 bits)
  se guarda como SHA-256; la URL va cifrada solo para el job de correo.
- **Adjunto** solo si el paciente lo pidio explicitamente desde el portal
  (`solicitar_adjunto_documento`, queda la fecha); sin solicitud la BD
  rechaza el envio (422).
- Cada envio queda en `envios_documento` (append-only) y en `accesos_ficha`
  (ENVIO). ADMIN audita envios y descargas sin ver el documento.

## Videollamada

Modo por profesional (tabla `salas_videollamada`, la edita el propio):

| Modo | Enlace de la cita | Notas |
|---|---|---|
| `ENLACE_PROPIO` (default) | la sala fija del profesional (Zoom, Meet, Jitsi propio...) | guardada cifrada; sin enlace configurado la cita online se rechaza (422 `videollamada_sin_sala`) |
| `JITSI` | sala unica por cita: `JITSI_URL_BASE/vinculos-<128 bits hex>` | desactivado por defecto (`JITSI_HABILITADO=false` -> 422 `videollamada_jitsi_deshabilitado`); URL base configurable (servidor propio recomendado) |

El enlace de cada cita se guarda cifrado en `citas.enlace_online` con
expiracion (`ENLACE_ONLINE_HORAS_TRAS_FIN`) y se envia al paciente.

## Calendario

- **Feed iCal privado** por profesional: `POST /api/profesionales/yo/calendario`
  devuelve una URL `.../api/calendario/<token>.ics` (se muestra una sola vez).
  El token se guarda como SHA-256; regenerarlo invalida el anterior. El feed
  se sirve sin sesion (el token autoriza, rate limit publico) via
  `feed_calendario(hash)`: citas CONFIRMADA y POR_REPROGRAMAR (marcadas
  "por reprogramar", tentativas) de 30 dias atras a un año adelante.
- **Adjunto `.ics`** en los correos de confirmacion y reprogramacion.
- Regla de contenido unica (`eventoDeCita`): solo "Sesion", la modalidad, el
  horario y el enlace o el box. **Nunca** nombre del paciente ni motivo.

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
