#!/bin/sh
# Silo de estres efimero (prompts/04_pruebas.md, fase 3): mismo compose y mismos
# limites del silo real, llaves por el runbook (aprovisionar.sh) y datos demo.
# Uso (desde la raiz del repo, Git Bash o Linux): sh infra/stress/levantar.sh
# Lo borra todo: sh infra/stress/bajar.sh
set -e
RAIZ=$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))
ENV_SILO="$RAIZ/infra/stress/stress.env"
dc() { docker compose -f "$RAIZ/infra/docker-compose.yml" -f "$RAIZ/infra/stress/docker-compose.stress.yml" --env-file "$ENV_SILO" "$@"; }
export MSYS_NO_PATHCONV=1

docker network inspect proxy >/dev/null 2>&1 || docker network create proxy >/dev/null

echo "1/4 BD y migraciones (imagen del backend)"
dc up -d --build db migrate mailpit
dc wait migrate >/dev/null

echo "2/4 Llaves (runbook): KEK, recuperacion y DEK; las partes se borran (silo de prueba)"
if [ ! -f "$RAIZ/infra/secrets/stress/kek" ]; then
  CLIENTE_SLUG=stress MODO=docker ENV_SILO="$ENV_SILO" ACTOR=stress \
    CUSTODIOS="Proveedor:stress,Centro:stress,Sobre offline:stress" \
    sh "$RAIZ/infra/scripts/llaves/aprovisionar.sh" >/dev/null
  rm -rf "$RAIZ/infra/secrets/stress/partes_entregar"
fi

echo "3/4 Datos: seed base + demo (desde el host, contra 127.0.0.1:15434)"
DUENO="postgresql://vinculos_owner:stress-owner@127.0.0.1:15434/app?schema=public"
SECRETOS=$(cd "$RAIZ/infra/secrets/stress" && (pwd -W 2>/dev/null || pwd))
(
  cd "$RAIZ/backend"
  export MIGRATION_DATABASE_URL="$DUENO" DATABASE_URL="postgresql://app_user:stress-api@127.0.0.1:15434/app?schema=public"
  export KEK_PATH="$SECRETOS/kek" RECUPERACION_PUBLICA_PATH="$SECRETOS/recuperacion.pub" SMTP_URL="" NODE_ENV=development
  DATABASE_URL="$DUENO" npx prisma db seed >/dev/null
  npm run --silent seed:demo
)

echo "4/4 API con limites (256M / 1 vCPU)"
dc up -d backend
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:3101/api/salud 2>/dev/null | grep -q '"estado":"ok"' && { echo "Listo: http://127.0.0.1:3101/api"; exit 0; }
  sleep 2
done
echo "La API no respondio sana" >&2
dc logs --tail 30 backend >&2
exit 1
