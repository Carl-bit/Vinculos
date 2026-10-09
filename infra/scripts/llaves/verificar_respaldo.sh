#!/bin/sh
# Restaura un respaldo (pg_dump -Fc) en un Postgres 18 temporal y lee los
# canarios de todas las DEK, por la KEK o por la via de recuperacion. El
# contenedor se borra al terminar. Prueba mensual (KEK) y simulacro
# trimestral (recuperacion): docs/seguridad/runbooks_llaves.md.
#
# Uso:
#   CLIENTE_SLUG=... sh infra/scripts/llaves/verificar_respaldo.sh RESPALDO.dump kek
#   CLIENTE_SLUG=... sh infra/scripts/llaves/verificar_respaldo.sh RESPALDO.dump recuperacion PARTE_A PARTE_B
# Corre la CLI en modo local (requiere backend con dependencias instaladas).
MODO=local
. "$(dirname "$0")/comun.sh"

RESPALDO=$1
VIA=$2
[ -f "$RESPALDO" ] && { [ "$VIA" = kek ] || { [ "$VIA" = recuperacion ] && [ $# -eq 4 ]; }; } || {
  echo "Uso: verificar_respaldo.sh RESPALDO kek | RESPALDO recuperacion PARTE_A PARTE_B" >&2
  exit 1
}

NOMBRE="vinculos-verificacion-$$"
CLAVE=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
docker run -d --rm --name "$NOMBRE" -e POSTGRES_PASSWORD="$CLAVE" -p 127.0.0.1::5432 postgres:18-alpine >/dev/null
trap 'docker rm -f "$NOMBRE" >/dev/null 2>&1' EXIT
until docker exec "$NOMBRE" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; do sleep 1; done
PUERTO=$(docker port "$NOMBRE" 5432/tcp | head -1 | sed 's/.*://')

docker exec "$NOMBRE" createdb -U postgres app
docker exec -i "$NOMBRE" pg_restore -U postgres -d app --no-owner --no-acl < "$RESPALDO"
export MIGRATION_DATABASE_URL="postgresql://postgres:$CLAVE@127.0.0.1:$PUERTO/app"

if [ "$VIA" = kek ]; then
  cli verificar --kek "$SECRETOS/kek"
else
  cli verificar --parte "$3" --parte "$4"
fi
echo "Respaldo verificado por $VIA. Registrar con registrar.sh (ver runbook)."
