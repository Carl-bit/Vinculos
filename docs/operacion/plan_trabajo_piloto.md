# Plan de trabajo hacia el piloto (2026-11-07)

Pendientes 1 a 13 tras 03b-6 y AUD-02 (sin finanzas: Cobros espera sus
reglas de negocio), mas el SMTP real con el VPS. Las tareas de despliegue en
Lightsail y Cloudflare quedan para su momento (seccion final). Lo de despues
del MVP esta en `docs/backlog_post_mvp.md`.

Cada fase se entrega con el formato de CLAUDE.md (archivos, pruebas reales,
docs, pendientes) y se aprueba antes de pasar a la siguiente. Los commits los
hace el usuario.

## Fase 0. Cerrar lo hecho (antes de commitear)

| # | Tarea | Detalle | Esfuerzo | Estado |
|---|---|---|---|---|
| 1 | Unir las migraciones de AUD-02 | Las 6 migraciones quedaron en `20261110000000_aud02_exportacion_centro` (estado final). La BD local se marco como aplicada con `prisma migrate resolve` (sin borrar datos) | bajo | hecho 2026-11-07 |
| 2 | Suites completas | Integracion del backend, Playwright de escritorio, celular con red 3G lenta, BD (`correr_tests_bd.sh`) y Vitest. Se corrigio la prueba del portal que dejaba deuda al paciente demo (anula su hora al terminar) | bajo (tiempo de maquina) | hecho 2026-11-07 |
| 3 | Commits | Mensajes propuestos por bloque: sitio y login Moderno; politicas en popup; portal; 03b-6; AUD-02 bloque 1; exportacion programada; iconos locales | bajo | despues de 1 y 2 |

## Fase 1. Pendientes de 03b-6

| # | Tarea | Detalle | Esfuerzo | Estado |
|---|---|---|---|---|
| 4 | Fuente de iconos local | Material Symbols en `frontend/src/app/fuentes/` con `next/font/local` (140 KB, 180 glifos); `npm run iconos` la regenera al cambiar la lista. Cero pedidos a Google | bajo | hecho 2026-11-07 |
| 5 | Prueba del recordatorio por token | Probado a mano con el job real y automatizado con el modo de prueba `JOBS_MANUALES` (`POST /api/pruebas/jobs/enviar_recordatorios`, solo desarrollo y tests; la API no arranca con el en produccion). Playwright: `publico.spec` "recordatorio por correo" (6 s) | bajo | hecho 2026-11-07 |

## Fase 2. Base de datos y API

| # | Tarea | Detalle | Esfuerzo | Prioridad |
|---|---|---|---|---|
| 8 | Indices de agenda | Migracion con `citas (espacio_id, inicio)` y `citas (profesional_id, inicio)`; EXPLAIN antes y despues (BD-03) | bajo | hecho 2026-11-07: `20261111000000_aud02_indices_agenda`; Seq Scan (1.398 filas descartadas) pasa a Bitmap Index Scan en ambas |
| 7 | Paginacion y listas livianas | Cursor con maximo 100 en `/pacientes`, `/auditoria/accesos` y `/notificaciones`; la lista de pacientes sin columnas cifradas que no muestra (contacto de emergencia; RUT solo si se ve). Toca front (cargar mas) y pruebas por rol (API-01, API-03, BD-02) | medio | hecho 2026-11-07: `/pacientes`, `/auditoria/accesos` y `/notificaciones` paginadas (50 por defecto, maximo 100; prueba `aud02-paginacion`); `/pacientes/resumen` sin columnas cifradas para los mapas de nombres; Fichas y Auditoria con "Cargar mas" |
| 9 | Compresion y cache | Middleware `compress` de Traefik solo para `/api` (el front ya comprime); `Cache-Control: no-store` global en la API salvo rutas publicas marcadas (API-05, INFRA-02) | bajo | hecho 2026-11-07: `configurar-app.ts` (prueba en 02a) y labels `compress` del router `-api` |
| 13 | Regla "nunca a cache" | Documento en `docs/seguridad/`: datos clinicos, RUT, correos, telefonos, contacto de emergencia, tokens, credenciales, holds y respuestas autenticadas (CACHE-04) | bajo | hecho 2026-11-07: `docs/seguridad/cache.md` |

## Fase 3. Operacion

| # | Tarea | Detalle | Esfuerzo | Prioridad |
|---|---|---|---|---|
| 11 | `pg_stat_statements` en la BD local | Reiniciar el contenedor `db` con el compose nuevo y correr `20-pg-stat-statements.sh`; medir consultas por peticion de los 5 endpoints mas usados (BD-01) | bajo | hecho 2026-11-07: 5 consultas por peticion autenticada (4 fijas de RLS + 1), 1 en la disponibilidad publica; sin N+1. `/cobros/citas` 149 ms de BD y 181 KB (backlog de Cobros) |
| 6 | Limites por contenedor | `mem_limit`/`cpus` en el compose segun el presupuesto de 1 GB (API 256M, front 256M, Postgres 256M ajustado: `shared_buffers=64MB`, `max_connections=24`, `work_mem=2MB`) (INFRA-03) | bajo | hecho 2026-11-07 (cpus 1.0; Traefik 128M). Postgres local en reposo: 22 MB de 256 MB. Medir en Linux en la fase 5 |
| 10 | Alertas y lentitud | `salud.sh` suma disco sobre 80 % y 5xx sostenidos; script de host con el p95 por ruta desde `docker logs` (OBS-01, OBS-04) | bajo a medio | hecho 2026-11-07: `salud.sh` (`DISCO_UMBRAL`, `UMBRAL_5XX`, `CLIENTE_SLUG` en el cron de `instalar.sh`) y `p95.sh` |

## Fase 4. Pruebas de capacidad

| # | Tarea | Detalle | Esfuerzo | Prioridad |
|---|---|---|---|---|
| 12 | `prompts/04_pruebas.md` | Integracion con BD efimera, k6 de colision de reservas (la prueba real: cero citas duplicadas) y fase 3 con los limites de 1 GB; escenario nuevo `lectura_publica` (catalogo, disponibilidad y agenda semanal, p95 < 300 ms, 0 % de 5xx). Necesita Docker; se puede correr en el VPS (fase 5) | medio a alto | hecho 2026-11-07 en local (`infra/stress/`, `docs/operacion/resultados_04_pruebas.md`): 0 solapes, una 201 por ronda, p95 publico 6,6 ms, picos 98/100 MiB de 256. Repetir en Linux en la fase 5 |

## Fase 5. VPS de prueba y SMTP real

El VPS (un equipo propio como servidor) sirve como ensayo del despliegue y
para el correo real antes de Lightsail.

| Tarea | Detalle |
|---|---|
| Silo en el VPS | `infra/docker-compose.yml` + Traefik tal cual; dominio de prueba; respaldos y `salud.sh` por cron (`infra/scripts/continuidad/instalar.sh`) |
| SMTP real | Recomendado: Amazon SES (ya previsto en `docs/api/correo_ses.md`): verificar el dominio (SPF, DKIM, DMARC), salir del sandbox, `SMTP_URL` por el puerto 587 (los ISP domesticos suelen bloquear el 25 de salida). Probar codigo 2FA, recuperacion, verificacion de reserva, recordatorio y aviso de exportacion. El remitente es el de la plataforma con el nombre del centro y Reply-To del centro |
| Medicion real | Memoria por contenedor en Linux (`docker stats`), headers de cache, optimizador de imagenes y la IP real del visitante detras de Traefik (CAP-01, INFRA-02) |
| Cuidado | Un equipo propio no es el destino final: sin datos reales de pacientes (solo el tenant de prueba) y con el disco cifrado |

## Al desplegar en Lightsail (cuando corresponda)

- Cloudflare: tunel `cloudflared`, certificados (origen o desafio DNS), IP
  real (`CF-Connecting-IP`/`X-Forwarded-For` de confianza), cache solo de
  estaticos y DPA firmado.
- Verificacion en produccion del optimizador de imagenes y los encabezados.
- Memoria real por contenedor para confirmar el plan de 1 GB.
