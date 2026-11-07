#!/bin/sh
# AUD-01 (E2.4) y AUD-02 (OBS-04): monitor de un silo, para cron cada 5 minutos.
#
#   DOMINIO=<dominio del silo> [CLIENTE_SLUG=<slug>] [ALERTA_URL=<webhook>] sh infra/scripts/continuidad/salud.sh
#
# Revisa, y avisa al operador si algo falla (POST a ALERTA_URL si esta, y
# salida distinta de cero para que cron lo mande por correo con MAILTO):
#   1. https://<dominio>/api/salud (BD y canarios de cifrado), dos intentos.
#   2. Disco del host donde vive Docker sobre DISCO_UMBRAL % (80).
#   3. Con CLIENTE_SLUG: respuestas 5xx de la API en los ultimos 5 minutos
#      sobre UMBRAL_5XX (10), leidas de `docker logs` del backend.
# El aviso no lleva datos de pacientes: solo dominio, porcentaje y conteo.
set -u
: "${DOMINIO:?DOMINIO es obligatoria}"
DISCO_RUTA="${DISCO_RUTA:-/var/lib/docker}"
DISCO_UMBRAL="${DISCO_UMBRAL:-80}"
UMBRAL_5XX="${UMBRAL_5XX:-10}"
PROBLEMAS=""

URL="https://$DOMINIO/api/salud"
sano=0
for intento in 1 2; do
  if curl -fsS --max-time 10 "$URL" | grep -q '"estado":"ok"'; then
    sano=1
    break
  fi
  [ "$intento" = 1 ] && sleep 20
done
[ "$sano" = 1 ] || PROBLEMAS="$PROBLEMAS; no responde sano en /api/salud"

[ -d "$DISCO_RUTA" ] || DISCO_RUTA=/
uso=$(df -P "$DISCO_RUTA" | awk 'NR == 2 { sub("%", "", $5); print $5 }')
if [ -n "$uso" ] && [ "$uso" -ge "$DISCO_UMBRAL" ]; then
  PROBLEMAS="$PROBLEMAS; disco al $uso % ($DISCO_RUTA)"
fi

if [ -n "${CLIENTE_SLUG:-}" ]; then
  n5xx=$(docker logs --since 5m "erp-$CLIENTE_SLUG-backend-1" 2>&1 | grep -c '"statusCode":5[0-9][0-9]')
  if [ "$n5xx" -ge "$UMBRAL_5XX" ]; then
    PROBLEMAS="$PROBLEMAS; $n5xx respuestas 5xx en 5 minutos"
  fi
fi

[ -z "$PROBLEMAS" ] && exit 0
MENSAJE="Vinculos: $DOMINIO${PROBLEMAS} ($(date -u +%FT%TZ))"
if [ -n "${ALERTA_URL:-}" ]; then
  curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' -d "{\"texto\":\"$MENSAJE\"}" "$ALERTA_URL" >/dev/null || true
fi
echo "$MENSAJE" >&2
exit 1
