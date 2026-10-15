#!/bin/sh
# SOLO DESARROLLO. BD local con el Postgres 18 instalado (sin Docker).
#
#   iniciar   Primera vez: crea un cluster propio en infra/local/pg (initdb),
#             lo levanta en el puerto de MIGRATION_DATABASE_URL, crea el dueño
#             (vinculos_owner) y deja la BD lista (como `recrear`). Despues:
#             solo lo levanta.
#   detener   Detiene ese cluster.
#   recrear   BORRA la BD y la vuelve a armar: migraciones, contraseña de
#             app_user, seed base y llaves de desarrollo nuevas
#             (infra/secrets/dev; las anteriores se borran). Solo necesita el
#             dueño, asi que sirve tambien contra otro Postgres local (por
#             ejemplo el servicio de Windows) donde ya exista vinculos_owner.
#             Detener la API antes (DROP ... WITH (FORCE) no corta sesiones
#             de app_user sin superusuario).
#
# Lee backend/.env (MIGRATION_DATABASE_URL, APP_DB_PASSWORD). Se niega con
# NODE_ENV=production y con un host que no sea local. Nunca contra un silo.
# Uso (desde la raiz del repo): sh infra/scripts/bd_local.sh iniciar|detener|recrear [--si]
set -e
cd "$(dirname "$0")/../.."
RAIZ=$(pwd)

[ -f backend/.env ] || { echo "Falta backend/.env (copiar backend/.env.example)" >&2; exit 1; }
set -a
. backend/.env
set +a

if [ "${NODE_ENV:-}" = production ]; then
  echo "NODE_ENV=production: este script es solo de desarrollo" >&2
  exit 1
fi

# Partes de MIGRATION_DATABASE_URL (postgresql://usuario:clave@host:puerto/bd?...).
parte() { node -e "const u = new URL(process.env.MIGRATION_DATABASE_URL); console.log($1)"; }
HOST=$(parte u.hostname)
PUERTO=$(parte "u.port || 5432")
BD=$(parte "u.pathname.slice(1)")
export OWNER_DB_PASSWORD
OWNER_DB_PASSWORD=$(parte "decodeURIComponent(u.password)")
case "$HOST" in
  localhost | 127.0.0.1) ;;
  *) echo "MIGRATION_DATABASE_URL apunta a $HOST: este script solo trabaja con una BD local" >&2; exit 1 ;;
esac

DATOS="$RAIZ/infra/local/pg"
SUPER_PASSWORD=${BD_LOCAL_SUPER_PASSWORD:-postgres-local}

levantar() {
  if ! pg_ctl -D "$DATOS" status >/dev/null 2>&1; then
    pg_ctl -D "$DATOS" -o "-p $PUERTO -c listen_addresses=localhost" -l "$RAIZ/infra/local/pg.log" -w start >/dev/null 2>&1
  fi
  echo "Postgres local en localhost:$PUERTO (datos en infra/local/pg)"
}

recrear() {
  if [ "${1:-}" != "--si" ]; then
    printf 'ADVERTENCIA: se borra la BD local "%s" y TODOS sus datos.\nEscribe "borrar" para continuar: ' "$BD"
    read -r respuesta
    [ "$respuesta" = "borrar" ] || { echo "Cancelado."; exit 1; }
  fi
  ADMIN_URL="postgresql://vinculos_owner:$OWNER_DB_PASSWORD@$HOST:$PUERTO/postgres"
  psql -X -q -v ON_ERROR_STOP=1 -d "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$BD\" WITH (FORCE)" -c "CREATE DATABASE \"$BD\""
  cd backend
  npx prisma migrate deploy
  node --env-file=.env prisma/scripts/rol_api.js
  npx prisma db seed
  cd ..
  rm -rf infra/secrets/dev
  CLIENTE_SLUG=dev MODO=local ACTOR=bd_local CUSTODIOS="Dev 1:desarrollo,Dev 2:desarrollo,Dev 3:desarrollo" \
    sh infra/scripts/llaves/aprovisionar.sh >/dev/null
  echo "BD local lista (llaves de desarrollo en infra/secrets/dev)."
}

case "${1:-}" in
  iniciar)
    if [ -d "$DATOS" ]; then
      levantar
      exit 0
    fi
    mkdir -p "$RAIZ/infra/local"
    PWFILE=$(mktemp)
    echo "$SUPER_PASSWORD" > "$PWFILE"
    initdb -D "$DATOS" -U postgres --pwfile="$PWFILE" -A scram-sha-256 -E UTF8 >/dev/null
    rm -f "$PWFILE"
    levantar
    export PGPASSWORD="$SUPER_PASSWORD"
    createdb -h localhost -p "$PUERTO" -U postgres "$BD"
    PGHOST=localhost PGPORT=$PUERTO POSTGRES_USER=postgres POSTGRES_DB=$BD sh infra/postgres/init/10-rol-owner.sh >/dev/null
    unset PGPASSWORD
    recrear --si
    ;;
  detener) pg_ctl -D "$DATOS" -m fast -w stop ;;
  recrear) recrear "${2:-}" ;;
  *) echo "Uso: sh infra/scripts/bd_local.sh iniciar|detener|recrear [--si]" >&2; exit 1 ;;
esac
