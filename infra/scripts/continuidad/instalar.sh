#!/bin/sh
# AUD-01 (E2.4): puesta en marcha de la continuidad de un silo en su servidor.
# Se corre una vez por silo, en el host, desde la raiz del repo:
#
#   CLIENTE_SLUG=<silo> DOMINIO=<dominio> DESTINO_RESPALDO=s3://<bucket>/<silo>/ \
#   ALERTA_URL=<webhook> MAILTO=<correo del operador> sh infra/scripts/continuidad/instalar.sh
#
# 1. Crea infra/secrets/<slug>/respaldo.key si no existe (no la sobrescribe).
# 2. Agrega al crontab del usuario: respaldo diario 02:00, monitor de salud
#    cada 5 minutos y prueba de restauracion el dia 1 de cada mes (aviso por
#    correo para hacerla con descifrar_respaldo.sh + verificar_respaldo.sh).
#    No duplica lineas si ya estan.
# Requisitos del host: docker compose, openssl, curl, aws (si hay destino S3)
# y la zona horaria America/Santiago (cron usa la del sistema).
set -eu

RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
: "${CLIENTE_SLUG:?CLIENTE_SLUG es obligatoria}"
: "${DOMINIO:?DOMINIO es obligatoria}"
: "${MAILTO:?MAILTO es obligatoria (correo del operador)}"
SECRETOS="$RAIZ/infra/secrets/$CLIENTE_SLUG"
LLAVE="$SECRETOS/respaldo.key"

mkdir -p "$SECRETOS"
chmod 700 "$SECRETOS"
if [ ! -f "$LLAVE" ]; then
  umask 077
  openssl rand -base64 48 > "$LLAVE"
  echo "Llave de respaldo creada en $LLAVE: guardar una copia fuera del host (como la KEK)."
fi

MARCA="# vinculos:$CLIENTE_SLUG"
ACTUAL=$(crontab -l 2>/dev/null || true)
if printf '%s\n' "$ACTUAL" | grep -q "$MARCA"; then
  echo "El crontab ya tiene las tareas de $CLIENTE_SLUG: sin cambios."
  exit 0
fi
{
  printf '%s\n' "$ACTUAL"
  echo "MAILTO=$MAILTO"
  echo "0 2 * * * cd $RAIZ && CLIENTE_SLUG=$CLIENTE_SLUG DESTINO_RESPALDO=${DESTINO_RESPALDO:-} sh infra/scripts/continuidad/respaldar.sh $MARCA"
  echo "*/5 * * * * DOMINIO=$DOMINIO ALERTA_URL=${ALERTA_URL:-} sh $RAIZ/infra/scripts/continuidad/salud.sh $MARCA"
  echo "0 9 1 * * echo 'Prueba mensual de restauracion de $CLIENTE_SLUG (docs/cumplimiento/continuidad.md, seccion 3)' $MARCA"
} | crontab -
echo "Tareas de $CLIENTE_SLUG agregadas al crontab."
