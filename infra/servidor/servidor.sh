#!/bin/sh
# Servidor de pruebas (Ubuntu + Docker): silos de demostracion detras de
# Traefik y Cloudflare Tunnel. Paso a paso: docs/operacion/servidor_pruebas.md.
# Desde la raiz del repo:
#
#   sh infra/servidor/servidor.sh levantar <slug> [<dominio> "<nombre>"]
#       La primera vez genera infra/servidor/silos/<slug>.env (contraseñas al
#       azar), aprovisiona las llaves por el runbook y carga los datos demo.
#       Con PERFIL=estres sube el rate limit por IP (k6 sale de una sola IP).
#   sh infra/servidor/servidor.sh reiniciar <slug>   borra BD y llaves y vuelve a cargar el demo
#   sh infra/servidor/servidor.sh bajar <slug>       detiene el silo, conserva los datos
#   sh infra/servidor/servidor.sh estado
#
# Solo datos ficticios hasta nuevo aviso: las partes de recuperacion de la
# llave se borran (en un silo real se entregan a sus custodios).
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && (pwd -W 2>/dev/null || pwd))
ACCION=${1:-}
SLUG=${2:-}
ENV_SILO="$RAIZ/infra/servidor/silos/$SLUG.env"
SECRETOS="$RAIZ/infra/secrets/$SLUG"
# Tokens de /api/internal/* (uno por silo). El agente de Vinculos Control monta
# esta carpeta en solo lectura (TOKENS_INTERNOS_HOST); el silo guarda solo el hash.
INTERNOS="$RAIZ/infra/servidor/internos"
export MSYS_NO_PATHCONV=1

dc() { docker compose -f "$RAIZ/infra/docker-compose.yml" -f "$RAIZ/infra/docker-compose.build.yml" -f "$RAIZ/infra/servidor/docker-compose.servidor.yml" --env-file "$ENV_SILO" "$@"; }
plano() { docker compose -f "$RAIZ/docker-compose.yml" "$@"; }
BORDE="erp-${SLUG}_borde"
azar() { openssl rand -hex "$1"; }
falla() { echo "$*" >&2; exit 1; }

generar_env() {
  DOMINIO=${1:?La primera vez: levantar <slug> <dominio> "<nombre del centro>"}
  NOMBRE=${2:-Centro $SLUG}
  if [ "${PERFIL:-demo}" = estres ]; then LOGIN=1000 PUBLICO=1000000; else LOGIN=10 PUBLICO=60; fi
  mkdir -p "$(dirname "$ENV_SILO")"
  umask 077
  cat > "$ENV_SILO" <<FIN
# Generado por servidor.sh. Unico de este silo: nunca copiar a otro.
CLIENTE_SLUG=$SLUG
CENTRO_NOMBRE="$NOMBRE"
DOMINIO=$DOMINIO
# Estilo visual: moderno o cuaderno (app/temas/ del front). Cambiarlo: editar y volver a levantar.
TEMA=${TEMA:-moderno}
# Silo de prueba: imagenes construidas en local (infra/docker-compose.build.yml), sin registro (R1).
REGISTRO=
API_DIGEST=
WEB_DIGEST=
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$(azar 24)
POSTGRES_DB=app
OWNER_DB_PASSWORD=$(azar 24)
APP_DB_PASSWORD=$(azar 24)
JWT_SECRET=$(azar 32)
# Contraseña de todas las cuentas demo (docs/pruebas/usuarios_demo.md).
SEED_PASSWORD=$(azar 8)
LOGIN_LIMITE_POR_MINUTO=$LOGIN
PUBLICO_LIMITE_POR_MINUTO=$PUBLICO
SMTP_URL=smtp://mailpit:1025
# Remitente propio: los silos de prueba comparten Mailpit y las mismas cuentas demo; asi se distingue de que centro es cada codigo.
CORREO_REMITENTE=no-responder@$DOMINIO
FIN
  echo "Creado $ENV_SILO"
}

# Red de borde por silo (R11): Traefik y Mailpit son del plano del host y se
# unen a erp-<slug>_borde de cada silo; dos silos nunca comparten red. Si
# Traefik se recrea pierde estas uniones: unir_bordes las repone todas.
# Se une con el nombre del servicio como alias: el silo busca smtp://mailpit:1025 y
# `docker network connect` sin --alias solo registra el nombre del contenedor
# (hallado 2026-11-16: el login de un silo nuevo daba 503 al no poder mandar el codigo).
# Una union vieja sin el alias se rehace.
unir() { # <red> <servicio del plano>
  id=$(plano ps -q "$2")
  [ -n "$id" ] || falla "No corre $2 del plano del host"
  alias=$(docker inspect -f "{{with index .NetworkSettings.Networks \"$1\"}}{{join .Aliases \" \"}} |unida{{end}}" "$id")
  case " $alias " in
    *" $2 "*) return 0 ;;
    *unida*) docker network disconnect "$1" "$id" ;;
  esac
  docker network connect --alias "$2" "$1" "$id"
}
unir_bordes() {
  for red in $(docker network ls --filter label=cl.vinculos.red=borde --format '{{.Name}}'); do
    unir "$red" traefik
    unir "$red" mailpit
  done
}
# Antes de `down`: con Traefik unido Docker no puede borrar la red del silo.
soltar_borde() {
  docker network inspect "$BORDE" >/dev/null 2>&1 || return 0
  for servicio in traefik mailpit; do
    id=$(plano ps -q "$servicio")
    [ -z "$id" ] || docker network disconnect "$BORDE" "$id" 2>/dev/null || true
  done
}

# Token interno del silo (tarea 31, R2-R5): lo genera una vez, deja el token en
# internos/<slug>.token (600) y su SHA-256 en el .env (INTERNO_TOKEN_SHA256), que
# migrate guarda en identidad_silo. Idempotente; rotar = borrar el archivo y levantar.
token_interno() {
  mkdir -p "$INTERNOS"
  chmod 700 "$INTERNOS" 2>/dev/null || true
  if [ ! -s "$INTERNOS/$SLUG.token" ]; then
    # Sin fin de linea (\r\n en Git for Windows): el agente lo usa tal cual en el header.
    (umask 077 && azar 32 | tr -d '\r\n' > "$INTERNOS/$SLUG.token")
  fi
  HASH=$(tr -d '\r\n' < "$INTERNOS/$SLUG.token" | sha256sum | cut -d' ' -f1)
  if grep -q '^INTERNO_TOKEN_SHA256=' "$ENV_SILO"; then
    sed -i "s/^INTERNO_TOKEN_SHA256=.*/INTERNO_TOKEN_SHA256=$HASH/" "$ENV_SILO"
  else
    printf '# Hash del token de /api/internal (el token esta en infra/servidor/internos/%s.token).\nINTERNO_TOKEN_SHA256=%s\n' "$SLUG" "$HASH" >> "$ENV_SILO"
  fi
}

levantar() {
  [ -f "$RAIZ/.env" ] || falla "Falta $RAIZ/.env (cp .env.example .env y completar)"
  docker network inspect proxy >/dev/null 2>&1 || docker network create proxy >/dev/null
  echo "1/5 Plano del host (Traefik + Mailpit)"
  plano up -d
  unir_bordes
  [ -f "$ENV_SILO" ] || generar_env "$@"
  token_interno

  echo "2/5 BD y migraciones"
  dc up -d --build db migrate
  dc wait migrate >/dev/null

  if [ ! -f "$SECRETOS/kek" ]; then
    echo "3/5 Llaves (runbook): KEK, recuperacion y DEKs"
    CLIENTE_SLUG=$SLUG MODO=docker ENV_SILO="$ENV_SILO" ACTOR=servidor \
      CUSTODIOS="Proveedor:prueba,Centro:prueba,Sobre offline:prueba" \
      sh "$RAIZ/infra/scripts/llaves/aprovisionar.sh" >/dev/null
  else
    echo "3/5 Llaves: ya existen"
  fi
  rm -rf "$SECRETOS/partes_entregar"

  # Marca escrita solo si el seed termino: una corrida cortada lo repite (el seed es idempotente).
  if [ ! -f "$SECRETOS/.datos_demo" ]; then
    echo "4/5 Datos demo (unos minutos la primera vez: construye la imagen del seed)"
    dc --profile seed build seed
    dc --profile seed run --rm --no-deps seed
    touch "$SECRETOS/.datos_demo"
  else
    echo "4/5 Datos: ya cargados"
  fi

  echo "5/5 API y front (Traefik y Mailpit se unen a $BORDE)"
  dc up -d --build backend frontend
  unir "$BORDE" traefik
  unir "$BORDE" mailpit
  for _ in $(seq 1 40); do
    if dc exec -T backend wget -qO- http://127.0.0.1:3001/api/salud 2>/dev/null | grep -q '"estado":"ok"'; then
      echo "Listo: https://$(sed -n 's/^DOMINIO=//p' "$ENV_SILO")  (clave demo: SEED_PASSWORD en $ENV_SILO)"
      return 0
    fi
    sleep 3
  done
  dc logs --tail 30 backend >&2
  falla "La API no respondio sana"
}

case "$ACCION" in
  levantar)
    [ -n "$SLUG" ] || falla "Falta el slug"
    shift 2
    levantar "$@"
    ;;
  reiniciar)
    [ -f "$ENV_SILO" ] || falla "No existe $ENV_SILO"
    soltar_borde
    dc down -v --remove-orphans
    # Solo las llaves de cifrado; respaldo.key (si existe) se conserva.
    rm -rf "$SECRETOS/kek" "$SECRETOS/recuperacion.pub" "$SECRETOS/partes_entregar" "$SECRETOS/.datos_demo"
    levantar
    ;;
  bajar)
    [ -f "$ENV_SILO" ] || falla "No existe $ENV_SILO"
    soltar_borde
    dc down
    ;;
  estado)
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}' --filter name=erp- --filter name=vinculos-servidor
    ;;
  *)
    falla "Uso: servidor.sh levantar|reiniciar|bajar <slug> | estado"
    ;;
esac
