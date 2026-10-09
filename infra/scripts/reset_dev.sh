#!/bin/sh
# SOLO DESARROLLO. BORRA TODOS LOS DATOS de la BD local y la recrea:
# down -v -> up db (espera healthy) -> migrate deploy -> contraseña app_user -> seed
# -> llaves de desarrollo nuevas en infra/secrets/dev (las anteriores se borran:
# los datos cifrados con ellas ya no existen). Nunca reutilizar llaves de dev
# en otro entorno. La API local usa KEK_PATH=../infra/secrets/dev/kek.
# Nunca correr contra un silo de cliente.
#
# Uso (desde la raiz del repo): sh infra/scripts/reset_dev.sh [--si]
# Requiere infra/.env y backend/.env con las mismas contraseñas.
set -e
cd "$(dirname "$0")/../.."

if [ "${1:-}" != "--si" ]; then
  printf 'ADVERTENCIA: se borra el volumen de Postgres de desarrollo y TODOS sus datos.\nEscribe "borrar" para continuar: '
  read -r respuesta
  [ "$respuesta" = "borrar" ] || { echo "Cancelado."; exit 1; }
fi

compose() {
  docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml --env-file infra/.env "$@"
}

compose down -v
compose up -d --wait db

cd backend
npx prisma migrate deploy
node --env-file=.env prisma/scripts/rol_api.js
npx prisma db seed
cd ..
rm -rf infra/secrets/dev
CLIENTE_SLUG=dev MODO=local ACTOR=reset_dev   CUSTODIOS="Dev 1:desarrollo,Dev 2:desarrollo,Dev 3:desarrollo" sh infra/scripts/llaves/aprovisionar.sh
echo "BD de desarrollo lista (llaves de dev en infra/secrets/dev)." 
