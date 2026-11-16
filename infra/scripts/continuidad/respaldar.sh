#!/bin/sh
# AUD-01 (E2.4, CENS-S5): respaldo diario cifrado de un silo.
#
#   CLIENTE_SLUG=<silo> [ENV_SILO=<.env del silo>] sh infra/scripts/continuidad/respaldar.sh
#
# 1. pg_dump -Fc dentro del contenedor db del silo (credenciales de dueño del
#    .env del silo; nunca salen del host).
# 2. Cifra el archivo con AES-256 (openssl, PBKDF2) usando
#    infra/secrets/<slug>/respaldo.key (fuera de git, chmod 600; distinta de
#    la KEK: un respaldo filtrado no se abre sin esta llave y sus columnas
#    sensibles siguen cifradas con la KEK).
# 3. Si DESTINO_RESPALDO esta definido (p. ej. s3://bucket-respaldos/<slug>/),
#    lo copia ahi con la CLI de AWS (un prefijo por silo: nunca se mezclan).
# 4. Deja RETENCION_LOCAL_DIAS (7 por defecto) en infra/respaldos/<slug>/.
# Programar con cron del host (docs/cumplimiento/continuidad.md).
#
# R14 (2026-11-16): con la db detenida (silo en la gracia de una salida o db
# caida) no respalda: sale con 3, sin crear archivo ni rotar. Si pg_dump falla
# o el archivo cifrado pesa menos de RESPALDO_MINIMO bytes (1024 por defecto,
# el mismo umbral de la alerta del plano de control), sale con error y borra lo
# parcial. La rotacion corre solo despues de un respaldo bueno: nunca cambia
# respaldos reales por vacios. El volcado va cifrado por el pipe (nunca queda en
# claro en disco); el codigo de salida de pg_dump se guarda aparte porque sh no
# tiene pipefail.
set -eu

# pwd -W: ruta de Windows en Git Bash (docker y openssl nativos no entienden /c/...); en Linux, pwd.
# Igual que llaves/comun.sh (hallado 2026-11-15 al respaldar un silo en un host B con Windows).
RAIZ=$(cd "$(dirname "$0")/../../.." && (pwd -W 2>/dev/null || pwd))
: "${CLIENTE_SLUG:?CLIENTE_SLUG es obligatoria}"
SECRETOS="$RAIZ/infra/secrets/$CLIENTE_SLUG"
LLAVE="$SECRETOS/respaldo.key"
DIR="$RAIZ/infra/respaldos/$CLIENTE_SLUG"
RETENCION_LOCAL_DIAS="${RETENCION_LOCAL_DIAS:-7}"
RESPALDO_MINIMO="${RESPALDO_MINIMO:-1024}"
falla() { echo "respaldar.sh ($CLIENTE_SLUG): $1" >&2; exit "${2:-1}"; }
[ -f "$LLAVE" ] || falla "falta $LLAVE (openssl rand -base64 48 > $LLAVE; chmod 600)"

# Mismo compose que los scripts de llaves (proyecto erp-<slug>, servicio db).
dc() { docker compose -f "$RAIZ/infra/docker-compose.yml" --env-file "${ENV_SILO:-$RAIZ/infra/.env}" "$@"; }

# Antes de crear nada: sin la db en marcha no hay respaldo ni rotacion.
dc ps --status running --services 2>/dev/null | grep -qx db || falla "la db no esta en marcha: no se respalda ni se rota" 3

mkdir -p "$DIR"
chmod 700 "$DIR"
MARCA=$(date -u +%Y%m%dT%H%M%SZ)
SALIDA="$DIR/$CLIENTE_SLUG-$MARCA.dump.enc"
ESTADO="$DIR/.pg_dump-$MARCA.estado"
OK=0
trap 'rm -f "$ESTADO"; [ "$OK" = 1 ] || rm -f "$SALIDA" "$SALIDA.sha256"' EXIT

{ dc exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' || echo "$?" > "$ESTADO"; } \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$LLAVE" -out "$SALIDA" \
  || falla "openssl no pudo cifrar"
[ ! -s "$ESTADO" ] || falla "pg_dump fallo (codigo $(cat "$ESTADO"))"
TAMANO=$(wc -c < "$SALIDA" | tr -d ' ')
[ "$TAMANO" -ge "$RESPALDO_MINIMO" ] || falla "respaldo de $TAMANO bytes (minimo $RESPALDO_MINIMO): no se guarda"
sha256sum "$SALIDA" > "$SALIDA.sha256"

if [ -n "${DESTINO_RESPALDO:-}" ]; then
  aws s3 cp "$SALIDA" "$DESTINO_RESPALDO" --only-show-errors
  aws s3 cp "$SALIDA.sha256" "$DESTINO_RESPALDO" --only-show-errors
fi

OK=1
find "$DIR" -name "$CLIENTE_SLUG-*.dump.enc*" -mtime +"$RETENCION_LOCAL_DIAS" -delete
echo "Respaldo listo: $SALIDA ($TAMANO bytes)"
