# Vinculos

ERP modular para centros clinicos/psicologicos. Un repo = un producto; cada
cliente es una instancia desplegada del mismo codigo (silo: 1 contenedor + 1 DB
Postgres), nunca una rama ni un fork.

Las reglas no negociables de arquitectura, diseño y convenciones estan en
[`CLAUDE.md`](CLAUDE.md). Este README describe el alcance, la estructura y como
levantar el proyecto.

Los silos se aprovisionan, actualizan, monitorean y dan de baja desde
**Vinculos Control** (repositorio aparte:
https://github.com/Carl-bit/VinculosControl), que se comunica con cada silo
solo por `/api/internal/*` y nunca ve datos de pacientes.

## Alcance del MVP

Modulos: nucleo de seguridad y roles, Fichas y Pacientes, Agenda y Espacios,
Equipo, Match Terapeutico y Sitio Publico. **Sin cobros ni finanzas**: el
modulo de cobros se retiro completo (BD, API y front, migracion
`20261116000000_mvp_sin_cobros`); las tarifas quedan solo como dato
informativo. Lo posterior al MVP esta en
[`docs/backlog_post_mvp.md`](docs/backlog_post_mvp.md).

## Inicio rapido para evaluar

Camino mas corto para ver el sistema funcionando en un equipo Windows con
Docker Desktop, Node 22 y Git for Windows (detalle en "Levantar en local"):

```powershell
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env          # SMTP_URL="smtp://localhost:1025"
cp frontend/.env.example frontend/.env.local
npm install; npm --prefix backend install; npm --prefix frontend install
sh infra/scripts/reset_dev.sh --si            # BD en Docker, migraciones, seed base y llaves de desarrollo
npm --prefix backend run seed:demo            # centro demo con datos ficticios
powershell -ExecutionPolicy Bypass -File infra\scripts\dev\instalar_mailpit.ps1
npm run dev                                   # Mailpit + API + front
```

- Sitio y panel: http://localhost:3000 (la API queda en http://localhost:3001/api).
- Cuentas demo: `admin@centro-prueba.cl` y las demas de
  [`docs/pruebas/usuarios_demo.md`](docs/pruebas/usuarios_demo.md); contrasena
  de todas: `dev-password`.
- El segundo paso del ingreso envia un codigo por correo: se lee en Mailpit,
  http://localhost:8025.
- Todos los datos son ficticios. Especificacion de la API: [`docs/api/openapi.json`](docs/api/openapi.json).
- Pruebas: `npm --prefix backend run test:bd` (seguridad de la BD),
  `npm --prefix backend test` (unitarias), `npm --prefix backend run test:e2e`
  (integracion) y `npm --prefix frontend test` (front).

## Estructura

```
backend/                  NestJS + Prisma (monolito modular, single-tenant)
  prisma/                   schema.prisma + migraciones (SQL crudo incluido)
  src/core/                 transversal: config, bd (RLS + cifrado), auth, errores, logs, jobs, notificaciones, eventos
  src/modulos/              un bounded context por carpeta (ver su README)
  test/                     integracion (Jest + Supertest) contra Postgres efimero
  pruebas/                  k6: carga de agenda y rampa de estres (resultados en docs/operacion/ y en Vinculos Control)
frontend/                 Next.js App Router (portal publico SSR/SSG + backoffice CSR)
  src/app/(publico)/        landing del centro, perfiles, match, busqueda, contacto
  src/app/(admin)/          backoffice auth-gated
  src/components/           ui/ -> shared/ -> <modulo>/ (ver su README)
  src/lib/                  cliente HTTP, React Query, helpers
design-system/vinculos/   MASTER.md de ui-ux-pro-max + overrides por pagina
design-reference/         export HTML del handoff de Claude Design (si se usa esa via)
infra/                    docker-compose por silo + Traefik compartido
docs/                     seguridad (matriz, cifrado, runbooks) y estado de fases
prompts/                  prompts de generacion (ver prompts/00_index.md)
```

## Levantar en local

La BD de desarrollo no viaja con el repo (vive en el volumen de Docker de cada
equipo, y `infra/local/` e `infra/secrets/` estan ignorados). En un equipo
nuevo, o despues de clonar, se recrea con estos pasos; el seed es codigo
(`prisma/seed.ts` y `prisma/seed-demo.ts`) y deja siempre los mismos datos.

Requisitos: Node 22 (el mismo de los Dockerfile; `winget install OpenJS.NodeJS.22`,
abrir una terminal nueva despues), Docker Desktop corriendo, `sh` (Git for
Windows) y el puerto 5432 libre (detener el servicio de Postgres de Windows si
existe).

```bash
# 1. Variables (los .env.example ya traen contraseñas que coinciden entre
#    infra/.env y backend/.env: OWNER_DB_PASSWORD, APP_DB_PASSWORD).
#    En backend/.env: SMTP_URL="smtp://localhost:1025" (el equipo entra con
#    codigo por correo; sin SMTP el correo es simulado y el codigo no llega).
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local

# 2. Dependencias
npm install                       # raiz: solo concurrently
npm --prefix backend install
npm --prefix frontend install

# 3. Base de datos. BORRA la BD de desarrollo y la recrea: down -v, up db
#    (healthy), migrate deploy, contraseña de app_user, seed base y llaves de
#    desarrollo nuevas en infra/secrets/dev (sin ellas la API no arranca). El
#    override de dev expone el 5432 solo en 127.0.0.1.
sh infra/scripts/reset_dev.sh --si

# 4. Centro demo (usuarios en docs/pruebas/usuarios_demo.md). Levanta su propia
#    API en un puerto libre, no necesita la API de desarrollo arriba.
#    Idempotente; para recargar desde cero: npm run demo:reset (en backend).
npm --prefix backend run seed:demo

# 5. API y front, cada uno en su terminal
npm run dev:api                   # http://localhost:3001/api (app_user, sujeto a RLS)
npm run dev:front                 # http://localhost:3000 (/api/* va a la API por rewrite)

# Tests de BD (cluster Postgres 18 temporal; no toca la BD de desarrollo)
npm --prefix backend run test:bd
```

### Todo junto: Mailpit + API + front

Postgres sigue en Docker (`docker compose ... up -d db`, o `reset_dev.sh`).
Si el Postgres de Windows está corriendo, hay que detenerlo para liberar el 5432.

```powershell
# Una vez: Mailpit (SMTP falso con bandeja web). Versión fija y SHA-256
# verificado; queda en tools\mailpit\.
powershell -ExecutionPolicy Bypass -File infra\scripts\dev\instalar_mailpit.ps1
npm install                # raíz: solo concurrently

npm run dev                # mailpit + api + front en paralelo
```

Si Mailpit ya esta corriendo aparte, no usar `npm run dev`: choca con su puerto
y `concurrently -k` corta tambien la API y el front. Usar `dev:api` y `dev:front`
por separado (paso 5).

- Correos: `SMTP_URL="smtp://localhost:1025"` en `backend/.env`; bandeja en http://localhost:8025.
- VS Code: tarea "Vinculos: dev" (`.vscode/tasks.json`), equivalente a `npm run dev`.
- E2E del front, con la API arriba y el seed demo cargado (`npm run seed:demo` en `backend`):
  `cd frontend && npx playwright install chromium && npm run test:e2e`.

## Servidor de pruebas (demo y estres)

```bash
cp .env.example .env    # token de Cloudflare, dominio de Mailpit
PERFIL=estres sh infra/servidor/servidor.sh levantar estres estres.midominio.cl "Centro Estres"
sh infra/servidor/servidor.sh levantar demo demo.midominio.cl "Centro Demo"
```

Paso a paso (Cloudflare Tunnel, llaves, reinicio del demo, k6):
[`docs/operacion/servidor_pruebas.md`](docs/operacion/servidor_pruebas.md).

## Desplegar un silo

```bash
docker network create proxy                                   # una vez por host
docker compose -f infra/traefik/docker-compose.yml up -d      # una vez por host (CF_DNS_API_TOKEN, ACME_EMAIL)
sh infra/scripts/imagenes/publicar.sh                         # por version (R1): sube y anota digests
cp infra/.env.example infra/.env                              # uno por cliente
cat infra/imagenes/<version>.env >> infra/.env                # REGISTRO, API_DIGEST, WEB_DIGEST
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d
docker network connect erp-<slug>_borde <contenedor-traefik>  # Traefik entra a la red de borde del silo
```

Un silo real no construye: corre `vinculos-api` y `vinculos-web` por digest
del registro privado del host B (R1, [`docs/operacion/imagenes.md`](docs/operacion/imagenes.md)).
En desarrollo se construye con el override `infra/docker-compose.build.yml`.

`CLIENTE_SLUG`, `DOMINIO`, las contraseñas de Postgres (`POSTGRES_PASSWORD`,
`OWNER_DB_PASSWORD`, `APP_DB_PASSWORD`) y `JWT_SECRET` son distintos por silo,
sin excepciones. El servicio `migrate` corre las migraciones y fija la
contraseña de `app_user` en cada `up`; la API arranca despues y solo recibe
`DATABASE_URL`.

Mismo esqueleto para todos (R11): las imagenes `vinculos-api` y `vinculos-web`
son comunes; nombre, tema y dominio del centro entran en runtime por el `.env`
(`CENTRO_NOMBRE`, `TEMA`, `DOMINIO`). Cada silo tiene sus redes
(`erp-<slug>_interna`, `_silo`, `_borde`), labels `cl.vinculos.silo` y una
fila en `identidad_silo`: `migrate` se niega a correr si la BD es de otro silo.

`/api/internal/*` es solo para Vinculos Control (tarea 31 y siguientes): token
por silo, del que la BD guarda solo el SHA-256 (`INTERNO_TOKEN_SHA256` en el
`.env`, aplicado por `migrate`); Traefik la bloquea desde afuera. Sin hash
configurado, esas rutas responden 401.

## Estado

MVP cerrado (2026-11-19). Orden y detalle en [`prompts/00_index.md`](prompts/00_index.md)
y [`docs/roadmap_mvp.md`](docs/roadmap_mvp.md).

- [x] Base de datos (01 a 01g): RLS forzado, restricciones de exclusion, cifrado envolvente y llaves con recuperacion 2 de 3 — [`docs/bd/estado_fase_bd.md`](docs/bd/estado_fase_bd.md)
- [x] API (02a a 02j) — [`docs/api/estado_fase_api.md`](docs/api/estado_fase_api.md)
- [x] Front (03a, 03b y rediseño visual)
- [x] Pruebas de integracion y estres (04) — [`docs/operacion/resultados_04_pruebas.md`](docs/operacion/resultados_04_pruebas.md)
- [x] Auditorias internas AUD-01 (cumplimiento) y AUD-02 (rendimiento) — `docs/cumplimiento/brechas_saas.md`, `docs/operacion/auditoria_rendimiento.md`
- [x] Integracion con Vinculos Control: `/api/internal/*`, imagenes por digest, solo lectura en la salida, notas de version y centros demo
- [ ] Piloto con usuarios del centro y despliegue en la infraestructura definitiva (AWS)
