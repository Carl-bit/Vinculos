#!/bin/sh
# Comun a los scripts de llaves. Se incluye con: . "$(dirname "$0")/comun.sh"
#
# Variables:
#   CLIENTE_SLUG  silo (obligatoria). Las llaves viven en infra/secrets/<slug>/
#                 (fuera de git): kek, recuperacion.pub. Las partes de la
#                 privada se escriben en partes_entregar/ y se sacan del equipo.
#   MODO          local  (por defecto, desarrollo): corre la CLI con ts-node y
#                        MIGRATION_DATABASE_URL del entorno o de backend/.env
#                        (el entorno tiene prioridad).
#                 docker (silo): corre la CLI dentro del servicio migrate (unico
#                        con credenciales de dueño) con infra/secrets/<slug>
#                        montado en /llaves.
#   ACTOR         quien opera (queda en eventos_llaves). Por defecto, el usuario.
#   ENV_SILO      .env del silo para MODO=docker (por defecto infra/.env; el silo
#                 de estres usa infra/stress/stress.env).
set -e

# pwd -W: ruta de Windows en Git Bash (docker no entiende /c/...); en Linux, pwd.
RAIZ=$(cd "$(dirname "$0")/../../.." && (pwd -W 2>/dev/null || pwd))
: "${CLIENTE_SLUG:?CLIENTE_SLUG es obligatoria}"
SECRETOS="$RAIZ/infra/secrets/$CLIENTE_SLUG"
ACTOR="${ACTOR:-$(whoami)}"
CUSTODIOS="${CUSTODIOS:-Proveedor:operador de la plataforma,Centro:direccion del centro,Sobre offline:caja fuerte}"

# D = ruta de los secretos tal como la ve la CLI.
if [ "${MODO:-local}" = docker ]; then
  D=/llaves
else
  D="$SECRETOS"
fi

# Linux: la CLI escribe en /llaves con el usuario del host. Si corre como root
# (el usuario de la imagen), la KEK y las partes quedan de root y el operador
# no puede borrarlas. Docker Desktop (Windows/macOS) no tiene ese problema.
USUARIO=""
if [ "$(uname -s)" = Linux ]; then USUARIO="--user $(id -u):$(id -g)"; fi

cli() {
  if [ "${MODO:-local}" = docker ]; then
    docker compose -f "$RAIZ/infra/docker-compose.yml" --env-file "${ENV_SILO:-$RAIZ/infra/.env}" \
      run --rm --no-deps $USUARIO -v "$SECRETOS:/llaves" migrate node dist/common/crypto/cli-llaves.js "$@"
  else
    (cd "$RAIZ/backend" && node $([ -f .env ] && echo --env-file=.env) -r ts-node/register       src/common/crypto/cli-llaves.ts "$@")
  fi
}

mkdir -p "$SECRETOS"
chmod 700 "$SECRETOS"
