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
export MSYS_NO_PATHCONV=1

dc() { docker compose -f "$RAIZ/infra/docker-compose.yml" -f "$RAIZ/infra/servidor/docker-compose.servidor.yml" --env-file "$ENV_SILO" "$@"; }
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

levantar() {
  [ -f "$RAIZ/.env" ] || falla "Falta $RAIZ/.env (cp .env.example .env y completar)"
  docker network inspect proxy >/dev/null 2>&1 || docker network create proxy >/dev/null
  echo "1/5 Plano del host (Traefik + Mailpit)"
  docker compose -f "$RAIZ/docker-compose.yml" up -d
  [ -f "$ENV_SILO" ] || generar_env "$@"

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

  echo "5/5 API y front"
  dc up -d --build backend frontend
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
    dc down -v --remove-orphans
    # Solo las llaves de cifrado; respaldo.key (si existe) se conserva.
    rm -rf "$SECRETOS/kek" "$SECRETOS/recuperacion.pub" "$SECRETOS/partes_entregar" "$SECRETOS/.datos_demo"
    levantar
    ;;
  bajar)
    [ -f "$ENV_SILO" ] || falla "No existe $ENV_SILO"
    dc down
    ;;
  estado)
    docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}' --filter name=erp- --filter name=vinculos-servidor
    ;;
  *)
    falla "Uso: servidor.sh levantar|reiniciar|bajar <slug> | estado"
    ;;
esac
