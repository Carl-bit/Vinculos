#!/bin/sh
# Registra en eventos_llaves una operacion hecha a mano (simulacro, restauracion
# verificada, compromiso, quienes participaron).
#
# Uso: CLIENTE_SLUG=... [MODO=docker] sh infra/scripts/llaves/registrar.sh TIPO "detalle"
#   TIPO: VERIFICACION | SIMULACRO | RESTAURACION | COMPROMISO | CAMBIO_CUSTODIO
. "$(dirname "$0")/comun.sh"

[ $# -eq 2 ] || { echo "Uso: registrar.sh TIPO \"detalle\"" >&2; exit 1; }
cli registrar --tipo "$1" --detalle "$2" --actor "$ACTOR"
