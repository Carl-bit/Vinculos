#!/bin/sh
# AUD-01 (E2.4): descifra un respaldo de respaldar.sh para restaurarlo o para
# la prueba mensual con infra/scripts/llaves/verificar_respaldo.sh.
#
#   CLIENTE_SLUG=<silo> sh infra/scripts/continuidad/descifrar_respaldo.sh ARCHIVO.dump.enc SALIDA.dump
set -eu
RAIZ=$(cd "$(dirname "$0")/../../.." && pwd)
: "${CLIENTE_SLUG:?CLIENTE_SLUG es obligatoria}"
[ $# -eq 2 ] || { echo "Uso: descifrar_respaldo.sh ARCHIVO.dump.enc SALIDA.dump" >&2; exit 1; }
if [ -f "$1.sha256" ]; then
  (cd "$(dirname "$1")" && sha256sum -c "$(basename "$1").sha256" >/dev/null) || { echo "El respaldo no calza con su sha256" >&2; exit 1; }
fi
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$RAIZ/infra/secrets/$CLIENTE_SLUG/respaldo.key" -in "$1" -out "$2"
chmod 600 "$2"
echo "Descifrado en $2 (borrarlo con shred -u al terminar)."
