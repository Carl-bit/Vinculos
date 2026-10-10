# Estado de la fase de API (02a-02g; 02h en propuesta)

Prompts: 02a-02h (entregados en la conversacion). Reglas: CLAUDE.md (seccion
API), `docs/seguridad/requisitos_02_apis.md`, `matriz_permisos.md`.

## Migraciones de la fase

| Migracion | Prompt | Contenido |
|---|---|---|
| `20261012000000_api_sesiones_alertas` | 02a | `sesiones` (refresh tokens rotativos), `alertas_internas`, trigger que revoca sesiones al cambiar la cuenta, default de `evoluciones.created_at` en la BD |
| `20261013000000_notificaciones` | 02f | `notificaciones` (registro de avisos) + funciones del job de envio |
| `20261014000000_portal_mensajes_epicrisis` | 02g | `mensajes_paciente`, `solicitudes_epicrisis` (contenido cifrado) |

Las tres siguen el checklist de tabla nueva: categoria A, ENABLE + FORCE RLS,
politicas por rol + `<tabla>_acceso_vigente`, GRANT minimo (sin UPDATE ni
DELETE; cambios de estado solo via funciones), cifrado en `registro.ts`,
casos 86-89 en `seguridad_bd.sql` y filas en la matriz.

## Endpoints (prefijo /api)

| Modulo | Rutas |
|---|---|
| core | `POST auth/login`, `auth/refresh`, `auth/logout`; `GET salud`; `GET notificaciones` |
| nucleo (02b) | `usuarios` (CRUD sin DELETE, `yo`, `yo/password`), `configuracion`, `practicantes` (`:id/acceso`, `:id/revocacion`, `:id/historial`), `bajas` (`por-reasignar`), `alertas` (`:id/atendida`), `directorio` (`mi-equipo`) |
| fichas (02c) | `pacientes` (busqueda `?rut=`), `pacientes/:id/adultos-responsables`, `pacientes/:id/ficha`, `fichas/:id/evoluciones`, `tipos-sesion`, `intervenciones`, `estados-avance`, `retencion/fichas`, `retencion/revisiones` |
| agenda (02d) | `espacios` (`ocupacion`), `profesionales/:id/{disponibilidad,bloqueos,huecos,conflictos-margen}`, `agenda/horarios-tomados`, `citas` (`verificacion`, `por-reprogramar`, `:id/cancelacion`, `:id/reprogramacion`, `:id/enlace`) |
| equipo (02e) | `profesionales/yo/{perfil,datos-privados,tarifas}`, `profesionales/:id/{perfil,margen,trayectoria,datos-privados,tarifas,tipos-atencion}`, `trayectoria`, `tipos-atencion`, `supervisiones`, `practicantes/:id/supervisor`, `supervision/casos`, `supervision/evoluciones/:id/comentarios`, `evoluciones/:id/comentarios` |
| derivaciones (02f) | `derivaciones` (`pendientes`, `:id/oferta`, `:id/respuesta`, `:id/cancelacion`, `:id/candidatos`, `:id/practicantes`, reintegro), `consentimientos` (`solicitudes`, `:id/respuesta`, `:id/revocacion`), `avisos-consentimiento` |
| match (02g) | `publico/{profesionales, profesionales/:id/disponibilidad, match}` (anonimo, rate limit), `portal/{equipo,citas,citas/:id/datos-pago,mensajes,epicrisis}`, `mensajes`, `epicrisis` |

## Tests

- `npm run test:e2e`: 90 casos de integracion (Jest + Supertest) contra un
  Postgres 18 efimero (`test/bd/levantar.sh`: migraciones, seed, llaves de
  prueba). Por archivo: 02a 22, 02b 19, 02c 13, 02d 12, 02e 8, 02f 8, 02g 8.
- `npx jest`: 16 unitarios (cifrado y contingencia).
- `sh prisma/tests/correr_tests_bd.sh`: 89 casos SQL + `migrate diff` + arranque
  real de la API (ahora con llavero) + scripts de llaves.

## Pendiente / no probado

- **02h Cobros**: detenido a proposito; ver `propuesta_02h_cobros.md`.
- k6 (`backend/pruebas/stress-agenda.js`) preparado, no corrido: sin Docker.
  La colision concurrente si esta cubierta en `02d-agenda.e2e-spec.ts`.
- Proveedor real de correo y de videollamada: solo implementaciones simuladas.
- Notificaciones de ofertas que pasan al siguiente candidato por un job o por
  un rechazo que el actor no puede ver: no se registran (sin actor con
  visibilidad). Se ven en la bandeja/oferta.
- Recalculo de `rut_hmac` (compromiso de la HMAC): CLI manual
  (`rotar.sh recalcular-hmac`), probado contra la BD efimera; el flujo
  completo con una DEK HMAC nueva no se ensayo end-to-end.
