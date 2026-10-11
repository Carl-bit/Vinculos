#!/bin/sh
# Rotacion de llaves. Nunca destruye versiones: las anteriores quedan
# retiradas y siguen descifrando sus datos.
#
#   rotar.sh crear [CATEGORIAS]  fase 1: version nueva inactiva por categoria
#                                (por defecto IDENTIFICACION,CLINICO,FINANCIERO;
#                                HMAC no rota: invalidaria los indices ciegos).
#                                Despues: respaldar la BD y verificar el respaldo.
#   rotar.sh activar             fase 2: verifica (KEK + canario + envoltura de
#                                recuperacion) y activa. Reiniciar la API.
#   rotar.sh kek                 KEK nueva (re-envuelve todas las DEK). Deja
#                                kek.nueva; el script reemplaza kek y guarda la
#                                anterior como kek.anterior-<fecha>.
#   rotar.sh custodios           par de recuperacion nuevo y 3 partes nuevas
#                                (cambio de custodio). Las partes viejas no sirven.
#   rotar.sh hmac-compromiso     fase 1 de una DEK HMAC nueva. SOLO ante
#                                compromiso (runbook 5.5), con la API detenida:
#                                hmac-compromiso -> recalcular-hmac -> activar
#                                -> verificar-hmac. Nunca desde el contenedor de la API.
#   rotar.sh recalcular-hmac     recalcula todos los rut_hmac con la HMAC nueva
#                                aun pendiente (o la activa si no hay pendiente).
#   rotar.sh verificar-hmac      despues de activar: cada rut_hmac coincide con
#                                la HMAC activa y no hay indices repetidos.
#
# Uso: CLIENTE_SLUG=... [MODO=docker] sh infra/scripts/llaves/rotar.sh <fase>
. "$(dirname "$0")/comun.sh"

case "${1:-}" in
  crear)
    cli rotar-crear --kek "$D/kek" --publica "$D/recuperacion.pub" \
      --categorias "${2:-IDENTIFICACION,CLINICO,FINANCIERO}" --actor "$ACTOR"
    ;;
  hmac-compromiso)
    cli rotar-crear --kek "$D/kek" --publica "$D/recuperacion.pub" --categorias HMAC --compromiso-hmac si --actor "$ACTOR"
    ;;
  recalcular-hmac)
    # Runbook de compromiso 5.5: despues de hmac-compromiso y antes de activar.
    cli recalcular-hmac --kek "$D/kek" --actor "$ACTOR"
    ;;
  verificar-hmac)
    cli verificar-hmac --kek "$D/kek" --actor "$ACTOR"
    ;;
  activar)
    cli rotar-activar --kek "$D/kek" --actor "$ACTOR"
    ;;
  kek)
    cli rotar-kek --kek "$D/kek" --kek-nueva "$D/kek.nueva" --actor "$ACTOR"
    mv "$SECRETOS/kek" "$SECRETOS/kek.anterior-$(date +%Y%m%d%H%M%S)"
    mv "$SECRETOS/kek.nueva" "$SECRETOS/kek"
    echo "KEK reemplazada. Reiniciar la API; destruir kek.anterior-* despues de verificar."
    ;;
  custodios)
    STAMP=$(date +%Y%m%d%H%M%S)
    cli cambiar-custodios --kek "$D/kek" --publica "$D/recuperacion.pub.nueva" \
      --partes "$D/partes_entregar_$STAMP" --custodios "$CUSTODIOS" --actor "$ACTOR"
    mv "$SECRETOS/recuperacion.pub" "$SECRETOS/recuperacion.pub.anterior-$STAMP"
    mv "$SECRETOS/recuperacion.pub.nueva" "$SECRETOS/recuperacion.pub"
    echo "Entregar partes_entregar_$STAMP/ a los custodios nuevos y borrarla de este equipo."
    ;;
  *)
    echo "Uso: rotar.sh crear [CATEGORIAS] | activar | kek | custodios | hmac-compromiso | recalcular-hmac | verificar-hmac" >&2
    exit 1
    ;;
esac
