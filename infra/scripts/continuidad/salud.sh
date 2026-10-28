#!/bin/sh
# AUD-01 (E2.4): monitor de salud de un silo, para cron cada 5 minutos.
#
#   DOMINIO=<dominio del silo> [ALERTA_URL=<webhook>] sh infra/scripts/continuidad/salud.sh
#
# Consulta https://<dominio>/api/salud (BD y canarios de cifrado). Si falla
# dos veces seguidas, avisa al operador: POST a ALERTA_URL (si esta) y salida
# distinta de cero (cron lo manda por correo con MAILTO). El aviso no lleva
# datos de pacientes: solo el dominio y el estado.
set -u
: "${DOMINIO:?DOMINIO es obligatoria}"
URL="https://$DOMINIO/api/salud"
for intento in 1 2; do
  if curl -fsS --max-time 10 "$URL" | grep -q '"estado":"ok"'; then
    exit 0
  fi
  [ "$intento" = 1 ] && sleep 20
done
MENSAJE="Vinculos: $DOMINIO no responde sano en /api/salud ($(date -u +%FT%TZ))"
if [ -n "${ALERTA_URL:-}" ]; then
  curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' -d "{\"texto\":\"$MENSAJE\"}" "$ALERTA_URL" >/dev/null || true
fi
echo "$MENSAJE" >&2
exit 1
