# Estado de la fase de API (02a-02h)

Prompts: 02a-02h (entregados en la conversacion). Reglas: CLAUDE.md (seccion
API), `docs/seguridad/requisitos_02_apis.md`, `matriz_permisos.md`.
Integraciones: `docs/api/integraciones.md`.

## Migraciones de la fase

| Migracion | Prompt | Contenido |
|---|---|---|
| `20261012000000_api_sesiones_alertas` | 02a | `sesiones` (refresh tokens rotativos), `alertas_internas`, trigger que revoca sesiones al cambiar la cuenta, default de `evoluciones.created_at` en la BD |
| `20261013000000_notificaciones` | 02f | `notificaciones` (registro de avisos) + funciones del job de envio |
| `20261014000000_portal_mensajes_epicrisis` | 02g | `mensajes_paciente`, `solicitudes_epicrisis` (contenido cifrado) |
| `20261015000000_ajustes_y_cobros` | 02h | A1 propuesta/aprobacion de `profesional_tipos_atencion`; A2 `tipos_documento_clinico` (B), `documentos_clinicos`, `envios_documento`, `descargas_documento`; A3 triggers de avisos de derivacion; A6 `salas_videollamada`, `feeds_calendario` + `feed_calendario()`; B `citas.monto`/`cancelada_en`, pagos solo via funciones, vista `estado_pago_citas`, boleta unica por cita, `resoluciones_cita`, arriendos por periodo, `liquidaciones`, configuracion de cancelacion y comision |

Todas siguen el checklist de tabla nueva: categoria A (salvo
`tipos_documento_clinico`, B), ENABLE + FORCE RLS, politicas por rol +
`<tabla>_acceso_vigente`, GRANT minimo (sin UPDATE ni DELETE en datos
clinicos, cobros ni auditoria; cambios de estado solo via funciones),
cifrado en `registro.ts`, casos en `seguridad_bd.sql` y filas en la matriz.

## Endpoints (prefijo /api)

| Modulo | Rutas |
|---|---|
| core | `POST auth/login`, `auth/refresh`, `auth/logout`; `GET salud`; `GET notificaciones` |
| nucleo (02b) | `usuarios` (CRUD sin DELETE, `yo`, `yo/password`), `configuracion` (02h: nombre y RUT del centro, politica de cancelacion, comision), `practicantes` (`:id/acceso`, `:id/revocacion`, `:id/historial`), `bajas` (`por-reasignar`), `alertas` (`:id/atendida`), `directorio` (`mi-equipo`) |
| fichas (02c, 02h) | `pacientes` (busqueda `?rut=`), `pacientes/:id/adultos-responsables`, `pacientes/:id/ficha`, `fichas/:id/evoluciones`, `tipos-sesion`, `intervenciones`, `estados-avance`, `retencion/fichas`, `retencion/revisiones`; 02h: `tipos-documento-clinico`, `documentos-clinicos` (`:id/envios`, `:id/solicitud-adjunto`, `descarga/:token`) |
| agenda (02d, 02h) | `espacios` (`ocupacion`), `profesionales/:id/{disponibilidad,bloqueos,huecos,conflictos-margen}`, `agenda/horarios-tomados`, `citas` (`verificacion`, `por-reprogramar`, `:id/cancelacion`, `:id/reprogramacion`, `:id/enlace`); 02h: `profesionales/yo/videollamada`, `profesionales/yo/calendario`, `calendario/:token` (publico) |
| equipo (02e, 02h) | `profesionales/yo/{perfil,datos-privados,tarifas,tipos-atencion}`, `profesionales/:id/{perfil,margen,trayectoria,datos-privados,tarifas,tipos-atencion,tipos-atencion/:tipoId}`, `trayectoria`, `tipos-atencion` (`propuestas`), `supervisiones`, `practicantes/:id/supervisor`, `supervision/casos`, `supervision/evoluciones/:id/comentarios`, `evoluciones/:id/comentarios` |
| derivaciones (02f) | `derivaciones` (`pendientes`, `:id/oferta`, `:id/respuesta`, `:id/cancelacion`, `:id/candidatos`, `:id/practicantes`, reintegro), `consentimientos` (`solicitudes`, `:id/respuesta`, `:id/revocacion`), `avisos-consentimiento` |
| match (02g) | `publico/{profesionales, profesionales/:id/disponibilidad, match}` (anonimo, rate limit), `portal/{equipo,citas,citas/:id/datos-pago,mensajes,epicrisis}`, `mensajes`, `epicrisis` |
| cobros (02h) | `cobros/citas` (`:id`, `:id/pagos`, `:id/resolucion`), `cobros/pagos/:id/anulacion`, `cobros/arriendos`, `cobros/liquidaciones` (`:id/emision`, `:id/pago`) |

## Tests

- `npm run test:e2e`: 104 casos de integracion (Jest + Supertest) contra un
  Postgres 18 efimero (`test/bd/levantar.sh`: migraciones, seed, llaves de
  prueba). Por archivo: 02a 22, 02b 19, 02c 13, 02d 12, 02e 8, 02f 8, 02g 8,
  02h-ajustes 8, 02h-cobros 5, 02h-simulacro-hmac 1.
- `npx jest`: 28 unitarios (cifrado y contingencia 16; programacion de jobs
  con reloj simulado 5; integraciones 7: modos de videollamada, regla del
  .ics y que ningun modulo importe una implementacion concreta).
- `sh prisma/tests/correr_tests_bd.sh`: 95 casos SQL (02h: 90-95 y redefine
  32, 51, 52, 53, 71) + `migrate diff` + arranque real de la API + scripts de
  llaves.

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
- **Body JSON**: limite 8 MB (documentos en base64, max. ~5 MB por archivo).

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
