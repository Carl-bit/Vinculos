# Resultados de prompts/04_pruebas.md (2026-11-07)

Entorno: silo efimero `erp-stress` (`infra/stress/`) en el equipo de
desarrollo (Windows, Docker Desktop), con el compose real del silo y sus
limites: Postgres 256M y backend 256M, 1 vCPU cada uno, `connection_limit=8`,
`shared_buffers=64MB`, `max_connections=20` (despues subidos a 12 y 24: ver al final). Datos: seed demo. k6 0.54.0 en un
contenedor en la misma maquina (le quita CPU al silo: los tiempos son una
cota superior). Rate limit por IP subido en el silo de estres (k6 sale de una
sola IP; se mide capacidad, no el 429).

## Fase 1: integracion

`npm run test:e2e`: 29 archivos, 238 pruebas en verde tras corregir los
hallazgos de abajo. Los casos pedidos (RLS 404, derivacion, EXCLUDE
concurrente, menor sin adulto, practicante vencido) ya existian.

## Fases 2 y 3: k6 con limites (corrida final, 5 min)

| Medida | Resultado | Umbral |
|---|---|---|
| Colision: 30 VUs x 3 rondas, mismo profesional y horario | 3 reservas 201 (una por ronda), 87 con 409, 0 de otro estado | una 201 por ronda |
| Citas activas solapadas despues de la corrida (por profesional y por box) | **0** | 0 |
| `lectura_publica` (20 VUs: centro, catalogo, disponibilidad de 14 dias) | p95 6,6 ms, max 294 ms, 0 % de errores | p95 < 300 ms, 0 % 5xx |
| `carga_normal` (10 VUs del equipo: ocupacion y citas de 7 dias) | 100 % 200 | 100 % |
| Total | 23.789 peticiones, 79 por segundo, p95 8,2 ms | - |
| Memoria pico | backend 98 MiB, Postgres 100 MiB (de 256 MiB cada uno) | sin OOM |
| CPU pico | backend 32 %, Postgres 10 % | - |
| Reinicios / OOM | 0 / no | 0 |

Conclusion: el EXCLUDE sostiene la colision y el silo cabe con holgura en el
presupuesto de 1 GB con esta carga. Agenda y Espacios queda lista para el
tenant de prueba segun el criterio de 04 (cero duplicados y sin reinicios).
Falta repetirlo en Linux (fase 5 del plan) para la medicion definitiva.

## Hallazgos y lo que se cambio

| # | Hallazgo | Accion |
|---|---|---|
| 1 | `stress-agenda.js` (preparado en 02d) mandaba `espacioId` en `POST /citas`: desde 03b la cita no lleva box (la BD lo asigna desde el bloque del profesional) y la API responde 400 | Reescrito: la colision es sobre el mismo profesional y horario, con huecos reales de la disponibilidad publica alineados a la hora |
| 2 | Bajo rafaga (30 escrituras simultaneas + 30 VUs de lectura), el pool de 8 conexiones se agoto: 17 respuestas **500** por Prisma `P2028` (sin conexion en `maxWait` 5 s) en una de las corridas | `P2028` -> **503** con `Retry-After: 2` (`filtro-errores.ts`, prueba unitaria). La corrida final no saturo. Decidido 2026-11-07: `connection_limit` 12 y `max_connections` 24 (seccion final) |
| 3 | Bajo la misma rafaga, Postgres resolvio 7 a 12 deadlocks (`40P01`) entre las inserciones que chocan; ya salian como 409 (reintentar). Nunca dejaron duplicados | Documentado en `requisitos_02_apis.md`. Revisar el orden de bloqueos de la insercion de citas si aparece con carga real |
| 4 | La auditoria paginada validaba el cursor con `Date.parse`, que no acepta el offset `-03` de Postgres: la segunda pagina daba 400 | Validacion por formato; la prueba ahora fuerza varias paginas y empates de marca de tiempo |
| 5 | `seed-demo.ts` leia `GET /pacientes` como arreglo | Usa `/pacientes/resumen` |

## No probado

- Linux y Lightsail reales (memoria del SO, Traefik, Cloudflare): fase 5.
- El front bajo carga (fuera del alcance de 04).
- Varias IPs contra el rate limit real.

## Pool de conexiones subido (2026-11-07)

`connection_limit` 8 -> 12 (+50 %) y `max_connections` 20 -> 24: 12 de la API
+ ~4 de mantencion (migrate, pg_dump, soporte) + 3 reservadas del superusuario
= 19, con ~20 % de margen.

| Corrida | 201 | 409 | 503 (pool) | Solapes | Conexiones pico | Memoria pico |
|---|---|---|---|---|---|---|
| 30 reservas simultaneas, 5 min | 3 | 87 | 0 | 0 | 12 (+1 del muestreo) | Postgres 154 MiB, API 95 MiB |
| Extremo: 60 simultaneas, 90 s | 3 | 133 | 44 | 0 | 12 (+1) | Postgres 155 MiB, API 98 MiB |

En el extremo el pool llega al tope y la API responde 503 con `Retry-After: 2`
(antes 500); no colapsa: sin reinicios ni OOM, una reserva por ronda y cero
solapes. Lectura publica en el extremo: p95 22 ms. Si en produccion aparecen
503 sostenidos, el siguiente paso no es mas conexiones (la memoria de Postgres
ya subio de 100 a 155 MiB) sino acortar lo que espera cada insercion que choca
(`lock_timeout` en la insercion de citas) o subir de plan.
