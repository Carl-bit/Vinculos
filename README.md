# Vinculos

ERP modular para centros clinicos/psicologicos. Un repo = un producto; cada
cliente es una instancia desplegada del mismo codigo (silo: 1 contenedor + 1 DB
Postgres), nunca una rama ni un fork.

Las reglas no negociables de arquitectura, diseño y convenciones estan en
[`CLAUDE.md`](CLAUDE.md). Este README solo describe la estructura y como
levantar el proyecto.

## Estructura

```
backend/                  NestJS + Prisma (monolito modular, single-tenant)
  prisma/                   schema.prisma + migraciones (SQL crudo incluido)
  src/core/                 transversal: config, bd (RLS + cifrado), auth, errores, logs, jobs, notificaciones, eventos
  src/modulos/              un bounded context por carpeta (ver su README)
  test/                     integracion (Jest + Supertest) contra Postgres efimero
  pruebas/                  estres de agenda (k6, pendiente de Docker)
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
# verificado; queda en tools\mailpit\ (ignorado por git).
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

## Desplegar un silo

```bash
docker network create proxy                                   # una vez por host
docker compose -f infra/traefik/docker-compose.yml up -d      # una vez por host
cp infra/.env.example infra/.env                              # uno por cliente
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

`CLIENTE_SLUG`, `DOMINIO`, las contraseñas de Postgres (`POSTGRES_PASSWORD`,
`OWNER_DB_PASSWORD`, `APP_DB_PASSWORD`) y `JWT_SECRET` son distintos por silo,
sin excepciones. El servicio `migrate` corre las migraciones y fija la
contraseña de `app_user` en cada `up`; la API arranca despues y solo recibe
`DATABASE_URL`.

## Estado

Orden y detalle en [`prompts/00_index.md`](prompts/00_index.md).

- [x] Fase de BD (01 a 01g) — ver [`docs/bd/estado_fase_bd.md`](docs/bd/estado_fase_bd.md)
- [ ] API (02a a 02h)
- [ ] Pruebas de integracion y estres (04)
- [ ] Front (03)
