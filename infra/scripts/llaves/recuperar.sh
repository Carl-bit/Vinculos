#!/bin/sh
# KEK perdida o comprometida. Con 2 de las 3 partes reconstruye en memoria la
# privada de recuperacion, recupera todas las DEK, genera una KEK nueva y las
# re-envuelve. La KEK anterior queda como kek.anterior-<fecha> (si existia).
#
# Uso: CLIENTE_SLUG=... [MODO=docker] sh infra/scripts/llaves/recuperar.sh PARTE_A PARTE_B
# Las partes se copian a infra/secrets/<slug>/recuperacion_tmp/ y se borran al terminar.
. "$(dirname "$0")/comun.sh"

[ $# -eq 2 ] || { echo "Uso: recuperar.sh PARTE_A PARTE_B" >&2; exit 1; }
TMP="$SECRETOS/recuperacion_tmp"
mkdir -p "$TMP" && chmod 700 "$TMP"
trap 'command -v shred >/dev/null && shred -u "$TMP"/* 2>/dev/null; rm -rf "$TMP"' EXIT
cp "$1" "$TMP/a.shamir"
cp "$2" "$TMP/b.shamir"

cli recuperar --parte "$D/recuperacion_tmp/a.shamir" --parte "$D/recuperacion_tmp/b.shamir" \
  --kek-nueva "$D/kek.nueva" --actor "$ACTOR"

[ -f "$SECRETOS/kek" ] && mv "$SECRETOS/kek" "$SECRETOS/kek.anterior-$(date +%Y%m%d%H%M%S)"
mv "$SECRETOS/kek.nueva" "$SECRETOS/kek"
echo "KEK nueva instalada. Reiniciar la API. Si fue compromiso: seguir el runbook (rotar DEKs y custodios)."
