#!/bin/sh
# AUD-02 (OBS-01): p50, p95 y maximo de la duracion por ruta de la API, leidos
# de los logs de pino-http (`responseTime` en ms). Sin OpenTelemetry.
#
#   CLIENTE_SLUG=<slug> [DESDE=24h] sh infra/scripts/continuidad/p95.sh
#   docker logs ... | sh infra/scripts/continuidad/p95.sh -     (logs por stdin)
#
# Las rutas se agrupan sin query string, con los UUID como :id y los numeros
# como :n, asi un token o un id nunca aparece en el reporte.
set -u
if [ "${1:-}" = "-" ]; then
  cat
else
  : "${CLIENTE_SLUG:?CLIENTE_SLUG es obligatoria (o pasar - y los logs por stdin)}"
  docker logs --since "${DESDE:-24h}" "erp-$CLIENTE_SLUG-backend-1" 2>&1
fi |
  grep '"msg":"request completed"' |
  sed -n 's/.*"method":"\([A-Z]*\)","url":"\([^"?]*\)[^"]*".*"responseTime":\([0-9]*\).*/\1 \2 \3/p' |
  sed -E 's#/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}#/:id#g; s#/[0-9]+(/|$| )#/:n\1#g' |
  awk '{ print $1 " " $2 "\t" $3 }' |
  sort -t "$(printf '\t')" -k1,1 -k2,2n |
  awk -F '\t' '
    # Percentil por rango mas cercano: el valor en la posicion ceil(p * n).
    function rango(p) { i = int(p * n); return i < p * n ? i + 1 : i }
    function salida() {
      if (n == 0) return
      i50 = rango(0.50); i95 = rango(0.95)
      printf "%6d %7d %7d %7d  %s\n", n, v[i50], v[i95], v[n], ruta
    }
    BEGIN { printf "%6s %7s %7s %7s  %s\n", "n", "p50_ms", "p95_ms", "max_ms", "ruta" }
    $1 != ruta { salida(); ruta = $1; n = 0 }
    { v[++n] = $2 }
    END { salida() }
  ' |
  { IFS= read -r encabezado; echo "$encabezado"; sort -k3,3nr; }
