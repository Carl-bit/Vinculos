#!/bin/sh
# AUD-01 (E2.4, CENS-S5): respaldo diario cifrado de un silo.
#
#   CLIENTE_SLUG=<silo> sh infra/scripts/continuidad/respaldar.sh
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
set -eu

RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
: "${CLIENTE_SLUG:?CLIENTE_SLUG es obligatoria}"
SECRETOS="$RAIZ/infra/secrets/$CLIENTE_SLUG"
LLAVE="$SECRETOS/respaldo.key"
DIR="$RAIZ/infra/respaldos/$CLIENTE_SLUG"
RETENCION_LOCAL_DIAS="${RETENCION_LOCAL_DIAS:-7}"
[ -f "$LLAVE" ] || { echo "Falta $LLAVE (openssl rand -base64 48 > $LLAVE; chmod 600)" >&2; exit 1; }

mkdir -p "$DIR"
chmod 700 "$DIR"
MARCA=$(date -u +%Y%m%dT%H%M%SZ)
SALIDA="$DIR/$CLIENTE_SLUG-$MARCA.dump.enc"

# Mismo compose que los scripts de llaves (proyecto erp-<slug>, servicio db).
docker compose -f "$RAIZ/infra/docker-compose.yml" --env-file "$RAIZ/infra/.env" exec -T db sh -c 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$LLAVE" -out "$SALIDA"
[ -s "$SALIDA" ] || { echo "Respaldo vacio: revisar" >&2; exit 1; }
sha256sum "$SALIDA" > "$SALIDA.sha256"

if [ -n "${DESTINO_RESPALDO:-}" ]; then
  aws s3 cp "$SALIDA" "$DESTINO_RESPALDO" --only-show-errors
  aws s3 cp "$SALIDA.sha256" "$DESTINO_RESPALDO" --only-show-errors
fi

find "$DIR" -name "$CLIENTE_SLUG-*.dump.enc*" -mtime +"$RETENCION_LOCAL_DIAS" -delete
echo "Respaldo listo: $SALIDA"
