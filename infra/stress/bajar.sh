#!/bin/sh
# Borra el silo de estres: contenedores, volumenes (BD) y sus llaves de prueba.
set -e
RAIZ=$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))
docker compose -f "$RAIZ/infra/docker-compose.yml" -f "$RAIZ/infra/docker-compose.build.yml" \
  -f "$RAIZ/infra/stress/docker-compose.stress.yml" \
  --env-file "$RAIZ/infra/stress/stress.env" down -v --remove-orphans
rm -rf "$RAIZ/infra/secrets/stress"
