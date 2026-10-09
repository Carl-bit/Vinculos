#!/bin/sh
# Aprovisiona las llaves de un silo (una sola vez, a mano; ver
# docs/seguridad/runbooks_llaves.md). Genera KEK, par de recuperacion, DEKs y
# canarios; divide la privada en 3 partes (2 de 3) en archivos separados y
# verifica que cada par reconstruye la privada. La privada nunca se escribe
# en disco. Se niega si ya hay KEK, publica, partes o filas en llaves_datos.
#
# Uso: CLIENTE_SLUG=centro-prueba [MODO=docker] sh infra/scripts/llaves/aprovisionar.sh
. "$(dirname "$0")/comun.sh"

cli aprovisionar --kek "$D/kek" --publica "$D/recuperacion.pub" --partes "$D/partes_entregar" \
  --custodios "$CUSTODIOS" --actor "$ACTOR"

cat <<FIN
Listo. Ahora, en este orden:
  1. Entregar $SECRETOS/partes_entregar/parte_1.shamir, parte_2 y parte_3
     a cada custodio por canales distintos.
  2. Borrar partes_entregar/ de este equipo (shred -u si existe).
  3. Respaldar la BD y correr verificar_respaldo.sh con la KEK y con 2 partes.
FIN
