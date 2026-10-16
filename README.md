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

```bash
# 1. Base de datos (Postgres 18). Las contraseñas de infra/.env y backend/.env
#    deben coincidir (OWNER_DB_PASSWORD, APP_DB_PASSWORD).
cp infra/.env.example infra/.env
cp backend/.env.example backend/.env
(cd backend && npm install)
# BORRA la BD de desarrollo y la recrea: down -v, up db (healthy), migrate
# deploy, contraseña de app_user, seed, llaves de desarrollo. El override de
# dev expone el 5432 solo en 127.0.0.1. (Requiere Docker.)
sh infra/scripts/reset_dev.sh

# 2. Backend (se conecta como app_user: sujeto a RLS)
cd backend
npm run start:dev          # http://localhost:3001/api

# Tests de BD (cluster Postgres 18 temporal; no toca la BD de desarrollo)
sh prisma/tests/correr_tests_bd.sh

# 3. Frontend
cd ../frontend
cp .env.example .env.local
npm install
npm run dev                # http://localhost:3000 (/api/* va a la API por rewrite)
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
