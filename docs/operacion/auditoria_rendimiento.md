# AUD-02 - Auditoría de rendimiento y operación

Fecha: 2026-11-06. Solo auditoría: no se modificó código, migraciones,
configuración ni infraestructura.

## Entorno de medición

- BD: contenedor `erp-centro-prueba-db-1` (postgres:18-alpine), seed demo,
  25 MB (`pg_database_size`). Filas: citas 1.400, accesos_ficha 1.190,
  pagos 861, evoluciones 783, pacientes 236, notificaciones 3.644.
- API: `backend/dist/main` (build compilado) en Windows, fuera de Docker.
- Front: build de producción standalone (`.next-movil/standalone/server.js`,
  puerto 3200) para memoria; dev server para el resto.
- Tiempos con `scratchpad/medir.mjs` (6 llamadas, se descarta la primera,
  mediana y máximo) autenticado como `admin` o `profesional1`.
- Los EXPLAIN corren como `vinculos_owner` (sin RLS) sobre datos de seed:
  sirven para ver el plan, no el tiempo en producción.
- `pg_stat_statements` no está instalado: el conteo de consultas por
  petición queda SIN MEDIR (habilitarlo es un cambio de configuración).
- Leyenda de prioridad: P1 antes de la entrega y demo; P2 antes del piloto;
  P3 futuro.

## BD - Base de datos

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| BD-01 | Consultas N+1 en listados | PARCIAL | Listados principales en una función SQL o un `findMany`: `pacientes.service.ts:126`, `reporte_dashboard()` (`centro.service.ts:152`), `cobros.controller.ts:46`. Sin bucles con `await` en cobros, pacientes, auditoría ni centro. N+1 acotado en match: una consulta de disponibilidad por candidato (`match.service.ts:143` y `:201`, en paralelo). Cada request autenticada suma 4 viajes fijos: BEGIN + `set_config` + `acceso_vigente()/sesion_vigente()` + `SET CONSTRAINTS ALL IMMEDIATE` (`contexto-bd.service.ts:96-122`) | SIN MEDIR por petición. Medir: `CREATE EXTENSION pg_stat_statements` en un silo de prueba (o `log_statement=all` en la BD efímera de 04_pruebas), `pg_stat_statements_reset()`, una llamada por endpoint y `SELECT calls, query FROM pg_stat_statements` | Medir los 5 más usados (`/pacientes`, `/citas`, `/cobros/citas`, `/reportes/dashboard`, `/publico/profesionales/:id/disponibilidad`). Match: una sola consulta de disponibilidad para todos los candidatos | bajo (medir) / medio (match) | P2 |
| BD-02 | Solo las columnas necesarias | PARCIAL | 39 de 83 `findMany` con `select`/`omit` cerca. El listado de pacientes (`VISTA_PACIENTE`, `pacientes.service.ts:17-36`) trae y descifra 3 columnas cifradas por fila (`rut`, `telefono`, `contactoEmergencia`, `registro.ts:33-34,103`) para todos los pacientes y sin paginar. La extensión descifra todo campo cifrado del `select` (`cifrado.extension.ts`) | `/pacientes` admin: 127,9 KB, mediana 18 ms (236 pacientes) | Proyección liviana para la lista (sin `contactoEmergencia`; RUT solo si la vista lo muestra) y vista completa solo en `/pacientes/:id` | medio | P2 |
| BD-03 | Índices | PARCIAL | Agenda por box y rango: Seq Scan sobre citas (1.369 filas descartadas); el gist `citas_no_solapamiento_espacio` es parcial (solo CONFIRMADA/PENDIENTE_PAGO). Citas por profesional y estado: usa el gist `citas_margen_traslado` (parcial, CONFIRMADA). Pagos por estado y período: Seq Scan (sin índice en `estado`/`fecha`). `rut_hmac`: Index Scan (`pacientes_rut_hmac_key`). `accesos_ficha` por paciente: Bitmap Index Scan (`accesos_ficha_paciente_id_ocurrido_en_idx`) | 0,19 ms, 0,17 ms, 1,1 ms, 0,20 ms y 0,27 ms (seed chico: el plan importa más que el tiempo) | Faltantes: `citas (espacio_id, inicio)`, `citas (profesional_id, inicio)` y `pagos (fecha)` o `(estado, fecha)`. Sobrantes: ninguno demostrable; 27 índices no únicos tienen `idx_scan=0` en dev, casi todos índices de FK sobre tablas chicas (lista en `pg_stat_user_indexes`). Revisar de nuevo con datos del piloto | bajo (migración nueva) | P2 |
| BD-04 | Pool de conexiones | PARCIAL | `DATABASE_URL` sin `connection_limit` (`infra/docker-compose.yml:74`): Prisma usa `núcleos*2+1` = 3 en 1 vCPU. Cada request autenticada retiene una conexión durante todo el handler (transacción interactiva, `maxWait 5 s`, `timeout 20 s`, `contexto-bd.service.ts:122`); los jobs la retienen hasta 120 s (`jobs.service.ts:50`). Postgres por silo: `max_connections=100`, `shared_buffers=128MB` (valores por defecto) | 3 conexiones por silo. Cada silo tiene su Postgres: no se suman entre silos | Fijar `connection_limit` explícito (5 a 8) y bajar `max_connections` del silo a unos 20 (libera memoria). PgBouncer no hace falta: un proceso de API por silo y BD propia | bajo | P2 |
| BD-05 | Transacciones largas | FALTA | Todo el handler autenticado corre dentro de la transacción RLS (`rls.interceptor.ts:22`). Dentro de ella: consulta al RNPI con 5 s × 3 intentos (`verificador-prestadores.ts:106-134`; el comentario reconoce que cabe en los 20 s), PDF (`cobros.controller.ts:123,130`), imagen con sharp (`imagenes.ts:33`) y la exportación completa del centro descifrada en memoria (`nucleo.controller.ts:664`, `exportaciones.service.ts:183-191`). Los correos de cuenta autenticados van después del COMMIT (`alConfirmar`, p. ej. `usuarios.service.ts:99`). El job `enviar_notificaciones` envía SMTP con la transacción del lock abierta (`notificaciones.service.ts:140-146`) | SIN MEDIR. Medir: `SELECT now()-xact_start, query FROM pg_stat_activity WHERE state <> 'idle'` durante una exportación o una verificación SIS | Sacar de la transacción lo externo y lo pesado: RNPI con `alConfirmar` o en dos pasos, exportación del centro como job con estado, PDF fuera de la transacción. Con un pool de 3, una exportación lenta bloquea un tercio de la API | medio | P2 |

## API - Endpoints

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| API-01 | Paginación con máximo y orden estable | FALTA | 0 usos de `skip`/`cursor` en `backend/src`, frente a 149 `@Get`. Hay topes sin página: 11 `take:` y 14 `LIMIT` en SQL (p. ej. auditoría `LIMITE = 300`, `auditoria.service.ts:7`). Sin paginar: `/pacientes`, `/citas` (por rango), `/cobros/citas` (por período), `/auditoria/accesos` (tope 300), `/notificaciones`, `/mensajes`, `/derivaciones`, `/cobros/liquidaciones`, `/cobros/deudas` | Ver API-03 | Cursor (`id` + fecha) con `limite` máximo 100 en `/pacientes`, `/auditoria/accesos`, `/cobros/citas` y `/notificaciones`. Los rangos de agenda ya acotan por fecha | medio | P2 |
| API-02 | Peticiones independientes en paralelo | PARCIAL | Server components del sitio en paralelo (`app/(publico)/page.tsx`, `pedir-hora/[id]/page.tsx:20` con `Promise.all`); match en paralelo (`match.service.ts:142`). En el backend las consultas de una request comparten una sola conexión transaccional: `Promise.all` dentro de la transacción no da paralelismo real | — | Nada urgente. No tiene sentido paralelizar dentro de la transacción RLS (una conexión) | bajo | P3 |
| API-03 | Tamaño de respuestas | PARCIAL | Más de 100 KB: `/cobros/citas` (30 días), `/pacientes` (admin) y `/auditoria/accesos` | `/cobros/citas` 181,2 KB, mediana 184 ms (el más lento). `/pacientes` 127,9 KB, 18 ms. `/auditoria/accesos` 107,1 KB, 17 ms. `/citas` de 7 días: 71,4 KB (admin) y 14,7 KB (profesional1). `/publico/profesionales` 5,4 KB, 6 ms. Disponibilidad pública (14 días): 7,9 KB, 6-12 ms | Paginación (API-01) y proyecciones de lista. Revisar qué campos de `/cobros/citas` no usa la vista | medio | P2 |
| API-04 | Dependencias sin usar y npm audit | PARCIAL | Sin uso en la API: `passport`, `passport-jwt` y `@nestjs/passport` (0 imports en `src`). `reflect-metadata` se queda (peer de Nest). `npm audit --omit=dev`: 0 vulnerabilidades en API y en front. Con dev: API 8 low y 9 moderate | — | Quitar las 3 de passport. Revisar las moderadas de desarrollo cuando haya versión compatible | bajo | P3 |
| API-05 | Compresión (en un solo lugar) | FALTA | La API no comprime (sin `compression` en `configurar-app.ts`; respuesta sin `Content-Encoding`). Traefik sin middleware `compress` (`infra/traefik/`, labels en `docker-compose.yml:103-109`). El front (Next) sí comprime | `/publico/profesionales` sin comprimir: 5.576 B; `/cobros/citas` 181 KB en claro | Middleware `compress` de Traefik solo en el router `-api` (el front ya comprime): una sola compresión por respuesta | bajo | P2 |

## COLA - Trabajos en segundo plano

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| COLA-01 | Tareas lentas dentro de la petición | PARCIAL | Ya fuera de la petición: notificaciones (outbox `notificaciones`, job cada minuto con `SKIP LOCKED` y backoff, `notificaciones.service.ts:89-151`); reintento de correos de cuenta (`:158`); recordatorios (`recordatorios.service.ts:35`); vencimiento de holds (`liberar_reservas_vencidas`, cada minuto, `jobs.service.ts:123`); purgas (`jobs.service.ts:158,172,226`). Dentro de la petición: SMTP directo del código 2FA (`auth.service.ts:155`), de recuperación y acceso (`:270,:286`) y de la verificación de la reserva pública (`solicitudes.service.ts:84`, `confirmacion-pago.service.ts:125`); PDFs de cobros; exportación del centro; RNPI | SIN MEDIR (SMTP real no configurado; Mailpit local). Medir: tiempo del login con `SMTP_URL` de SES en staging | Mantener directo el código 2FA (vence en 10 min), pero con timeout (EXT-01). Exportación del centro como job | medio | P2 |
| COLA-02 | Cola sobre Postgres | PARCIAL | Ya existe una cola propia en Postgres para correos: estado, `proximo_intento`, reintentos con backoff y FALLIDO (`marcar_notificacion`, índice `notificaciones_estado_proximo_intento_idx`), idempotente por fila. Falta: visibilidad para el ADMIN de correos FALLIDOS, y una cola genérica para exportación y PDFs | 3.644 notificaciones en el seed | No sumar pg-boss todavía: extender el patrón actual (tabla de tareas + job con `SKIP LOCKED`) a la exportación del centro, y mostrar FALLIDOS en Configuración > Notificaciones. pg-boss solo si aparecen más de 2 o 3 tipos de tarea | medio | P3 |
| COLA-03 | Trabajos programados | CUMPLE | 19 `@Cron` de `@nestjs/schedule` dentro del proceso de la API. Cada uno en su transacción con `pg_try_advisory_xact_lock` (`jobs.service.ts:40-58`): si el contenedor se reinicia a mitad de una corrida, la transacción hace rollback y el lock se libera solo; la siguiente corrida retoma (funciones idempotentes). Fuera del contenedor: cron del host para respaldo, salud y prueba de restauración (`infra/scripts/continuidad/instalar.sh:39-43`) | — | Documentar que los jobs comparten la única vCPU con las requests. Con varias réplicas, el advisory lock ya evita duplicados | bajo | P3 |

## EXT - Servicios externos

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| EXT-01 | Timeout y reintentos acotados | PARCIAL | RNPI: timeout 5 s y 2 reintentos (`verificador-prestadores.ts:106-134`). SMTP (SES y Mailpit): `createTransport(url)` sin `connectionTimeout`/`greetingTimeout`/`socketTimeout` (`correo.ts:63`); los valores por defecto de nodemailer son 2 min, 30 s y 10 min. Pasarela: solo simulada (`pasarela.ts`) | SIN MEDIR | Timeouts explícitos en el transporte SMTP (p. ej. 5 s, 5 s y 15 s). El login con 2FA hoy puede colgar minutos si SES no responde | bajo | P1 |
| EXT-02 | Idempotencia en pagos reintentables | PARCIAL | Webhook: id único del evento e idempotencia en la BD (`pasarela.ts:15`, `confirmacion-pago.service.ts:82,207`). Una transferencia abierta por cita (`transferencias_una_abierta`). No hay creación de cobro hacia un proveedor real (pasarela simulada) | — | Cuando haya conexión directa con un proveedor: clave de idempotencia por intento de cobro (id de cita + intento), guardada antes de llamar | medio | NO APLICA AÚN (P3) |
| EXT-03 | Caída del servicio externo | PARCIAL | Correo de cuenta: si falla, se encola para reintento y la operación sigue (`correos-cuenta.ts:78-82`); notificaciones con backoff y FALLIDO. Código 2FA: si falla, error y la persona pide otro (`correos-cuenta.ts:87-90`). RNPI: error tras 3 intentos; queda verificación manual (VERIFICADO_MANUAL) | Probado en unitarios (`correo.spec.ts`, `ProveedorCorreoSimulado.fallar`) | Mostrar al ADMIN los correos FALLIDOS (COLA-02). Mensaje claro en el login si el código no se pudo enviar | bajo | P2 |

## CACHE - Caché por silo

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| CACHE-01 | Datos que se leen repetidos sin cambiar | PARCIAL | Front: Data Cache de Next de 60 s para centro, perfiles y reseñas (`frontend/src/lib/api/servidor.ts:21-26`); políticas sin caché desde hoy (`servidor.ts`, `apiSinCache`). API: caché en memoria de 30 s de los módulos activos (`core/modulos/modulos.ts:21-41`). Ver P1-2: el límite de 60 por minuto por IP afecta al SSR del front | `/publico/centro` 2-3 ms; `/publico/profesionales` 6 ms; disponibilidad pública 6-12 ms; landing en producción p50 8 ms y p95 9 ms (20 llamadas). Frecuencia SIN MEDIR: no hay métricas por ruta. Medir con `responseTime` de pino-http agrupado por ruta | Ninguna caché nueva. Las lecturas públicas ya son rápidas y el front las cachea | — | P3 |
| CACHE-02 | Interfaz con memoria por defecto y Redis opcional | NO APLICA AÚN | Ver la sección final CACHE | — | No implementar hasta cumplir CACHE-06 | — | P3 |
| CACHE-03 | Parámetros de Redis | NO APLICA AÚN | No se recomienda Redis | — | Si un silo lo activa: `maxmemory 32mb`, `maxmemory-policy allkeys-lru`, `save ""` y `appendonly no`, `requirepass` desde un secret del silo, solo en la red `interna`, sin puerto publicado. Unos 10-15 MB en reposo | bajo | P3 |
| CACHE-04 | Lo que NUNCA va a caché | PARCIAL | Implícito: respuestas clínicas sin `Cache-Control` público; descargas "sin cache" (`fichas.controller.ts:97`, `nucleo.controller.ts:615`); iCal y recordatorios con `private, no-store` (`agenda.controller.ts:360,381`). La lista no está escrita como regla | — | Escribir la regla en `docs/seguridad/`: datos clínicos, RUT, correos, teléfonos, contacto de emergencia, tokens, credenciales, holds y respuestas autenticadas | bajo | P2 |
| CACHE-05 | Invalidación | PARCIAL | Front: vence por tiempo (60 s); no hay `revalidateTag` al cambiar tarifa, horario, perfil o configuración. API: los módulos se olvidan con `olvidar()` (`modulos.ts:44-46`) | SIN MEDIR el desfase real. Por diseño, un cambio puede tardar hasta 60 s más una petición (revalidación tras vencer) en verse en el sitio. Medir: publicar un cambio y recargar el perfil cada 5 s hasta verlo | Aceptar los 60 s y documentarlo, o `revalidateTag` desde un endpoint interno al publicar perfil, tarifas o contenido | bajo | P3 |
| CACHE-06 | Criterio para activar Redis | NO APLICA AÚN | — | p95 público medido de 6 a 12 ms, muy bajo el umbral de 300 ms | Adoptar el criterio propuesto: activar en un silo solo si el p95 del catálogo público supera 300 ms durante 7 días, o si más del 50 % del tiempo de BD (`pg_stat_statements.total_exec_time`) se va en lecturas repetidas de catálogo | bajo | P3 |

## INFRA - Infraestructura

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| INFRA-01 | Compresión Brotli o Gzip | PARCIAL | Front: gzip de Next (`Content-Encoding: gzip`). API: sin compresión (API-05). Traefik: sin `compress`. Cloudflare: no configurado (no hay evidencia) | — | Ver API-05 | bajo | P2 |
| INFRA-02 | Estáticos con hash y respuestas autenticadas | PARCIAL | `/_next/static/*`: `public, max-age=31536000, immutable` (medido con `next start`). Imágenes públicas: `public, max-age=31536000, immutable` (`match.controller.ts:125`). La API autenticada no envía `Cache-Control` (solo ETag): ningún caché intermedio la guarda hoy (no hay CDN), pero no está declarado. Cloudflare no está configurado | — | `Cache-Control: no-store` global en la API salvo rutas públicas marcadas. Si se agrega Cloudflare: regla de caché solo para `/_next/static/*` e imágenes públicas, bypass para `/api/*` y `/sesion/*` | bajo | P2 |
| INFRA-03 | Límites de recursos por contenedor | FALTA | `infra/docker-compose.yml`: sin `mem_limit`, `cpus` ni `deploy.resources` en db, backend, frontend ni traefik. Postgres sin ajuste de memoria (`shared_buffers=128MB`, `max_connections=100`). `prompts/04_pruebas.md:110-130` propone límites solo para el entorno de estrés | Ver CAP-01 | Límites por servicio (propuesta en CAP) y Postgres ajustado (`shared_buffers=48MB`, `max_connections=20`, `work_mem=2MB`) | bajo | P2 |
| INFRA-04 | Cercanía API y BD | CUMPLE | Mismo host y red `interna` (`docker-compose.yml:40-42,100-102,148-149`); la BD no sale al proxy ni al host | — | Documentar la regla: si la BD pasa a un servicio gestionado, misma región y zona que la API, por red privada, sin IP pública | bajo | P3 |
| INFRA-05 | Escalado horizontal sin estado en memoria | PARCIAL | Sesiones (tabla `sesiones`), holds (`bloqueos_temporales` con TTL y `citas` RETENIDA), colas (`notificaciones`) y jobs (advisory lock) viven en Postgres. En memoria: rate limit de `@nestjs/throttler` (almacén por defecto, `core.module.ts:66-74`), caché de módulos (30 s, `modulos.ts`) y caché de llaves del llavero | — | Camino, sin implementar: con más de una réplica, almacén del throttler en Postgres o Redis del silo; la caché de módulos tolera 30 s de diferencia | medio | P3 |

## OBS - Observabilidad

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| OBS-01 | Medición de peticiones lentas | PARCIAL | pino-http registra cada respuesta con su duración (`responseTime`, por defecto) y request id (`logs.ts:59-82`). No hay agregación (p95 por ruta) ni trazas de Prisma | — | Opción liviana para 512 MB: sin OpenTelemetry. Script de host que lee `docker logs` y calcula el p95 por ruta del día, más `pg_stat_statements` en Postgres. OpenTelemetry solo si se contrata un plan mayor | bajo | P2 |
| OBS-02 | Sin datos clínicos, RUT ni tokens en logs | PARCIAL | Redacción de campos cifrados, tokens y cabeceras (`logs.ts:18-45`); la URL se registra sin query (`logs.ts:73`). Pero la ruta sí se registra y tres rutas llevan un token en el path: `GET /api/calendario/:token` (feed iCal; los calendarios lo consultan cada pocos minutos), `GET /api/recordatorios/:token` y `POST .../:token/confirmacion|cancelacion` (`agenda.controller.ts:358,380,386,392`), y `GET /api/documentos/descarga/:token` (`fichas.controller.ts:491`) | Cada consulta deja el token en claro en stdout del contenedor | Serializer que reemplace segmentos de token por `:token` antes de registrar (o mover el token a la query, que ya se descarta). Contradice la decisión "ningún token en logs" | bajo | P1 |
| OBS-03 | Web Vitals solo en el sitio público | FALTA | Sin analítica de terceros (verificado en 03b-6); sin recolección propia de Web Vitals | — | `useReportWebVitals` solo en `app/(publico)` que envíe LCP, INP y CLS (ruta sin query, sin identificadores) a un endpoint público del silo con rate limit, agregado por día | bajo | P3 |
| OBS-04 | Alertas mínimas | PARCIAL | Contenedor caído o BD caída: `salud.sh` cada 5 min con 2 intentos y webhook o MAILTO (`infra/scripts/continuidad/salud.sh`). Respaldo fallido: `respaldar.sh` sale distinto de cero y el cron lo envía por MAILTO (`instalar.sh:39-41`, `respaldar.sh:24,34`). Disco sobre 80 %: FALTA. 5xx sostenidos: FALTA (solo quedan en los logs) | — | Agregar a `salud.sh`: `df` del volumen de Docker con aviso al 80 %, y conteo de líneas `statusCode>=500` en `docker logs --since 5m` sobre un umbral | bajo | P2 |

## CAP - Capacidad por silo

| ID | Punto | Estado | Evidencia | Medición actual | Acción propuesta | Esfuerzo | Prioridad |
|---|---|---|---|---|---|---|---|
| CAP-01 | Memoria en reposo y bajo carga | PARCIAL | Mediciones locales (Windows, fuera de los límites de Docker) | API (`dist/main`): 144-146 MB en reposo, 149 MB tras 100 peticiones públicas. Front producción (standalone): 107 MB en reposo, 168 MB tras 300 vistas con 10 en paralelo. Postgres (docker stats): 204 MiB tras las suites e2e, con `shared_buffers` de 128 MB. Traefik: SIN MEDIR (`docker stats` en el host) | Medir dentro de Docker con límites (`docker compose up` + `docker stats`) en la fase 3 de 04_pruebas | bajo | P2 |
| CAP-02 | Silos por host y primer cuello de botella | PARCIAL (resuelto por decisión) | Suma de un silo sin ajustar: unos 520 MB (API 150 + front 170 + Postgres 200), más Traefik y el sistema operativo. Decisión 2026-11-06: plan base de 1 GB, un silo por host | Con 512 MB no cabía; con 1 GB, 1 silo con margen (falta confirmar en Linux con Docker, fase 3 de 04_pruebas) | Límites del compose según el presupuesto CAP de 1 GB (INFRA-03) | bajo | P2 |
| CAP-03 | k6 existente y escenario nuevo | FALTA | `backend/pruebas/stress-agenda.js` preparado (colisión de reservas en un box, escenarios `carga_normal` y de choque) y nunca corrido (`docs/api/estado_fase_api.md:218`: "preparado, no corrido: sin Docker") | Sin resultados | Correr 04_pruebas (fase 2 y 3). Escenario nuevo `lectura_publica`: 20 VUs durante 5 min alternando `GET /publico/centro`, `/publico/profesionales`, disponibilidad pública de 14 días y, autenticado, `GET /citas` de 7 días. Umbrales p95 < 300 ms y 0 % de 5xx. Correrlo desde varias IPs, o subir `PUBLICO_LIMITE_POR_MINUTO` en el silo de estrés, para no medir el 429 | medio | P2 |

## Resumen de P1

1. **OBS-02. Tokens en los logs.** El feed iCal, los recordatorios y la
   descarga de documentos dejan su token en la ruta registrada. Contradice
   una decisión tomada. Arreglo chico en el serializer de `logs.ts`.
2. **Rate limit del SSR público** (regresión introducida el 2026-11-06).
   El sitio público lee la API desde el servidor Next: en producción todas
   esas lecturas salen de la IP del contenedor `frontend` y comparten el
   límite de `PUBLICO_LIMITE_POR_MINUTO=60`. Medido: la petición 61 en un
   minuto a `/api/publico/politicas/POLITICA_DATOS` devuelve 429. Hasta hoy
   la Data Cache de 60 s lo amortiguaba, pero las políticas pasaron a
   `no-store` para no aceptar versiones viejas. Cada vista de
   `/pedir-hora/[id]` gasta 2 lecturas sin caché: unas 30 vistas por minuto
   en todo el sitio bastan para que la página falle. Opciones: excluir del
   throttler las llamadas del contenedor `frontend` (IP de la red del silo o
   cabecera interna con secreto), o volver a cachear las políticas unos
   pocos segundos con revalidación al publicar una versión. El 422 de
   versión nueva ya se maneja en el formulario.
3. **EXT-01. Timeouts SMTP.** El código 2FA se envía dentro del login sin
   timeout explícito (valores por defecto de nodemailer: 2 min, 30 s y
   10 min). Si SES no responde, el login cuelga.
4. **CAP-02. Decisión de capacidad** (abajo): con 512 MB no cabe un silo
   completo sin ajustes, y menos varios.

## Presupuesto de memoria por silo (CAP)

Mediciones locales; en Linux, dentro de Docker, la API y Postgres suelen
pesar algo menos.

Presupuesto para el plan de **1 GB** (decisión 2026-11-06), un silo por host:

| Componente | Medido | Límite propuesto | Notas |
|---|---|---|---|
| API (Nest + Prisma) | 145-150 MB | 256 MB | `NODE_OPTIONS=--max-old-space-size=192`. La exportación del centro en memoria es el pico de riesgo (BD-05): pasa a job por flujo |
| Front (Next standalone) | 107 MB en reposo, 168 MB con carga | 256 MB | `--max-old-space-size=192` |
| Postgres | 204 MiB sin ajustar | 256 MB | `shared_buffers=64MB`, `max_connections=24`, `work_mem=2MB` |
| Redis (opcional) | — | 0 MB (no se recomienda) | 32 MB si un silo cumple CACHE-06 |
| **Silo** | **unos 460-520 MB** | **768 MB** | |
| Traefik (uno por host) | SIN MEDIR | unos 40 MB | |
| Sistema operativo y Docker | SIN MEDIR | unos 200 MB | Ubuntu de Lightsail en reposo |

Conclusión original (con 512 MB): en un Lightsail de 512 MB no cabe ni un silo con márgenes
(512 MB del silo + unos 200 MB del sistema + Traefik), salvo con swap y el
riesgo de OOM. El primer cuello de botella es la **memoria**, antes que la
CPU. El segundo es el **pool de 3 conexiones** con transacciones que
retienen la conexión durante llamadas externas (BD-04 y BD-05). En 1 GB
cabe 1 silo con holgura; en 2 GB, unos 3 silos.

## Recomendación sobre Redis (CACHE)

**No agregar Redis ahora.** Las lecturas repetidas medidas responden en
2 a 12 ms (lejos del umbral de 300 ms), el sitio público ya tiene caché de
60 s en Next y la memoria es el recurso escaso. Redis sumaría unos 15 MB
por silo sin beneficio medido. Si un silo cumple CACHE-06, se agrega por
perfil de Docker Compose (`profiles: [cache]`), solo en la red `interna`
del silo, con los parámetros de CACHE-03 y detrás de una interfaz con
adaptador en memoria por defecto. Nunca compartido entre silos.

## Contradicciones con decisiones tomadas

1. **"Ningún token en logs"** se incumple hoy (OBS-02, P1).
2. **"Lightsail de 512 MB por plan base; varios silos pueden compartir
   host"** no calza con lo medido: un silo completo ronda los 460-520 MB
   más el sistema y Traefik. Con 512 MB no comparte host ni un solo silo
   sin swap.
3. **Holds con TTL en Postgres y EXCLUDE como respaldo:** se cumple
   (`bloqueos_temporales`, `citas` RETENIDA con `pago_vence_en`,
   `citas_no_solapamiento_espacio`). Sin contradicción.
4. **Pagos directos (Vinculos no recibe dinero):** se cumple; solo hay una
   pasarela simulada y validación de transferencias a la cuenta del centro.

## Preguntas para ti

1. ¿El plan base pasa a 1 GB (1 silo por host) o se mantiene 512 MB con
   swap y los límites ajustados de CAP, aceptando el riesgo?
2. Para el P1 del rate limit: ¿prefieres eximir al contenedor `frontend`
   del throttler o volver a cachear las políticas unos segundos con
   revalidación al publicar?
3. ¿Se puede habilitar `pg_stat_statements` en los silos? Mide BD-01 y
   CACHE-06 sin herramientas de terceros.
4. ¿La exportación completa del centro puede pasar a un job asíncrono
   (aviso por correo cuando esté lista), o debe seguir siendo una descarga
   inmediata?
5. ¿Cloudflare entra en el plan (solo para estáticos), o la entrega sigue
   solo con Traefik?

## Decisiones posteriores (2026-11-06)

1. **Plan base:** Lightsail de 1 GB y un silo por host; puede volver a
   subir después de las pruebas de rendimiento por centro (04_pruebas).
   Actualizados `CLAUDE.md` (sección Pruebas) y `prompts/04_pruebas.md`
   (fase 3, límites de 256 MB por servicio).
2. **Rate limit del SSR público:** opción recomendada: el front reenvía la
   IP real del visitante (`X-Forwarded-For`) solo en las lecturas sin
   caché; el límite sigue siendo por visitante, sin exenciones. Pendiente de
   implementar (P1).
3. **pg_stat_statements:** sirve para medir consultas (BD-01, CACHE-06,
   dimensionar el plan por centro), no para cobrar. Pendiente de respuesta.
4. **Exportación del centro:** pasa a job asíncrono. Riesgo corroborado:
   incluye 98 tablas con archivos guardados en la BD (`adjuntos_ficha`,
   respaldos, documentos, imágenes) como hexadecimal dentro de un JSON en
   memoria, con 4 a 6 copias y la transacción de 20 s abierta. Plan de
   trabajo propio por aprobar.
5. **Cloudflare:** sigue en el plan, como túnel (sin puertos abiertos), al
   llegar a las pruebas en servidor. Implica: certificados de origen o
   desafío DNS (el TLS-ALPN de Let's Encrypt no funciona sin el 443
   entrante), IP real por `CF-Connecting-IP` y caché solo de estáticos.
   A confirmar: Cloudflare termina el TLS y ve los datos en claro (encargado
   de tratamiento con DPA; `docs/cumplimiento/subencargados.md`).

## Bloque 1 aplicado (2026-11-06)

| Punto | Estado nuevo | Cambio | Prueba |
|---|---|---|---|
| OBS-02 | CUMPLE | `rutaParaLog` (`backend/src/core/logs/logs.ts`): el segmento del token de `/api/calendario/`, `/api/recordatorios/` y `/api/documentos-clinicos/descarga/` se registra como `:token` | `src/core/logs/logs.spec.ts` (6 casos) |
| EXT-01 | CUMPLE (SMTP) | `TIEMPOS_SMTP` en `correo.ts`: conexion 5 s, saludo 5 s, socket 15 s | `correo-tiempos.spec.ts`: un SMTP que nunca saluda falla en unos 5 s |
| EXT-03 (código 2FA) | CUMPLE | Si el código no se puede enviar, el login responde 503 "No pudimos enviar el código a tu correo..." (antes 500); el front muestra el texto del 503 (`lib/api/errores.ts`) | `test/03b41-correctivo.e2e-spec.ts` (correo caído -> 503) |
| P1-2 rate limit SSR | CUMPLE | `frontend/src/lib/api/servidor.ts`: las lecturas sin caché reenvían la IP del visitante en `X-Forwarded-For`; la API ya confía en la red interna (`trust proxy`) | `test/02g-match-portal.e2e-spec.ts` (8 IPs sin 429, la misma IP sí). Medido por SSR: 40 visitantes distintos en `/pedir-hora/[id]`, 40 × 200; un mismo visitante, 30 vistas y luego error (su límite) |
| BD-01 / CACHE-06 | Habilitado para medir | `pg_stat_statements` en el compose y `infra/postgres/init/20-pg-stat-statements.sh` (`docs/operacion/pg_stat_statements.md`) | Contenedor efímero: extensión 1.12 cargada y texto normalizado |
| CAP-02 | Resuelto por decisión | Plan de 1 GB | — |

Pendiente de verificar en el servidor (con Cloudflare): que Traefik descarte
el `X-Forwarded-For` que mande el visitante (comportamiento por defecto sin
`forwardedHeaders.trustedIPs`) y que confíe en `cloudflared` para conservar
la IP real. Prueba: `curl -H "X-Forwarded-For: 1.2.3.4"` 61 veces a
`/api/publico/politicas/POLITICA_DATOS` debe dar 429 igual.

## Bloque 2 aplicado (2026-11-06)

| Punto | Estado nuevo | Cambio | Prueba |
|---|---|---|---|
| BD-05 (exportación del centro) | CUMPLE en ese punto | La exportación sale de la petición: job con lectura por lotes en una transacción de solo lectura REPEATABLE READ y escritura cifrada por flujo al volumen `exportaciones` (`modulos/nucleo/exportacion-centro.service.ts`). Siguen dentro de la transacción de la petición: RNPI y PDFs de cobros (P2) | `test/aud01-cumplimiento`: con 12 adjuntos de 4 MB la memoria viva (heap + externa) sube menos de 64 MB |
| COLA-01 (exportación) | CUMPLE en ese punto | Avance en `exportaciones_centro`, aviso por correo, FALLIDA si la API se reinicia, vencimiento a las 24 h (job horario) | BD caso 162; integración (409 y reinicio); Playwright `cumplimiento.spec` Fase 3 |

Nota de capacidad: mientras corre, el job ocupa una conexión del pool por
toda su duración (más otra breve para el avance). Con el pool por defecto de
3 conexiones en 1 vCPU, eso refuerza BD-04: fijar `connection_limit` entre
5 y 8 antes del piloto.

## Decisiones sobre los pendientes de BD-05 (2026-11-06)

- **RNPI:** por ahora la verificación es manual: el profesional informa su
  número de registro SIS y sube el documento, y el ADMIN verifica
  (`VERIFICADO_MANUAL`). Sin `SUPERSALUD_APIKEY` la API usa el verificador
  simulado (`core/core.module.ts:133-135`): no hay llamada externa dentro de
  la transacción. Si se contrata la apikey, mover la consulta fuera de la
  transacción antes de activarla.
- **PDF de Cobros** (`GET cobros/reporte/pdf` y `GET cobros/liquidaciones/:id/pdf`,
  `cobros.service.ts:269,293`): quedan dentro de la petición hasta cerrar las
  reglas de negocio de Cobros. Son PDF chicos (una tabla por período o por
  liquidación); el riesgo es menor que el de la exportación del centro.

## BD-04 aplicado (2026-11-06)

`infra/docker-compose.yml`: `DATABASE_URL` del backend con
`connection_limit=8` (antes 3 por defecto en 1 vCPU). Margen para que el job
de exportación y los jobs programados no dejen a los usuarios esperando
conexión. Postgres del silo sigue con `max_connections=100` (sobra).

## Exportacion programada y a prueba de reinicios (2026-11-06)

El job ya no depende de la memoria del proceso: la BD guarda la llave
publica de la clave (cifra, no abre) y el job corre en la ventana nocturna
del centro o ya si es urgente; un reinicio la retoma (3 intentos). Medido en
local: 3,6 s para el centro demo y p95 de 18 a 29 ms para un profesional
mientras corre. Detalle y estimacion por tamaño de centro en
`docs/cumplimiento/exportacion.md` seccion 3.

## Avance (2026-11-07)

- BD-03: hecho (indices `citas (espacio_id, inicio)` y `(profesional_id, inicio)`, migracion `20261111000000_aud02_indices_agenda`; de Seq Scan a Bitmap Index Scan).
- API-05 e INFRA-01: hecho (middleware `compress` solo en el router `-api`; excluye PDF, imagenes y binarios).
- INFRA-02: hecho (`Cache-Control: no-store` global en `configurar-app.ts`; las imagenes publicas lo reemplazan con `@Header`).
- CACHE-04: hecho (`docs/seguridad/cache.md`).
- INFRA-03 y BD-04: hecho (`mem_limit`/`cpus` por servicio; Postgres `shared_buffers=64MB`, `max_connections=24`, `work_mem=2MB`).
- BD-01: medido con `pg_stat_statements`: 5 consultas por peticion autenticada (4 fijas del contexto RLS + 1) en `/pacientes`, `/citas`, `/cobros/citas` y `/reportes/dashboard`; 1 en la disponibilidad publica. Sin N+1. `/cobros/citas` 149 ms de BD.
- OBS-01: hecho (`infra/scripts/continuidad/p95.sh`, p50/p95/max por ruta desde los logs).
- OBS-04: hecho (`salud.sh` avisa disco sobre 80 % y 5xx sostenidos).
- API-01, API-03 y BD-02: hecho (cursor con maximo 100 en `/pacientes`, `/auditoria/accesos` y `/notificaciones`; `/pacientes` sin contacto de emergencia; `/pacientes/resumen` solo con columnas en claro para los nombres del panel). `/cobros/citas` sigue sin paginar: va con las reglas de Cobros.
- CAP-01, CAP-02 y CAP-03: medidos con limites en Docker (`docs/operacion/resultados_04_pruebas.md`): backend 98 MiB y Postgres 100 MiB de pico bajo k6; `lectura_publica` p95 6,6 ms; 0 solapes. Hallazgo: el pool de 8 se satura en rafagas (P2028, ahora 503). Falta Linux.
- BD-04 (2026-11-07): `connection_limit` 8 -> 12 (+50 %) y `max_connections` 20 -> 24 (+20 % de margen sobre 12 + mantencion + 3 reservadas). k6: 30 reservas simultaneas sin 503; 60 simultaneas, 503 con Retry-After en vez de 500, 0 solapes, sin OOM (Postgres 155 MiB de 256).
