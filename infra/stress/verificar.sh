#!/bin/sh
# Verificacion del silo de estres despues de k6 (prompts/04_pruebas.md, flujo paso 4).
# La prueba real no es el reporte de k6: es que no haya citas activas solapadas.
# Sale distinto de cero si hay solapes o si un contenedor se reinicio o murio por memoria.
set -u
SQL_SOLAPES="
SELECT 'profesional' AS por, a.id, b.id FROM citas a JOIN citas b
  ON a.id < b.id AND a.profesional_id = b.profesional_id
 AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')
WHERE a.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA') AND b.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA')
UNION ALL
SELECT 'box', a.id, b.id FROM citas a JOIN citas b
  ON a.id < b.id AND a.espacio_id = b.espacio_id AND a.modalidad = 'PRESENCIAL' AND b.modalidad = 'PRESENCIAL'
 AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')
WHERE a.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA') AND b.estado IN ('CONFIRMADA', 'PENDIENTE_PAGO', 'RETENIDA');"

# Como vinculos_owner: con app_user la RLS de citas oculta filas ajenas.
solapes=$(docker exec erp-stress-db-1 psql -U vinculos_owner -d app -tAc "$SQL_SOLAPES")
fallo=0
if [ -n "$solapes" ]; then
  echo "SOLAPES (no avanzar a produccion):"; echo "$solapes"; fallo=1
else
  echo "Solapes de citas activas: 0"
fi

for c in erp-stress-db-1 erp-stress-backend-1; do
  estado=$(docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}} {{.State.Status}}' "$c")
  echo "$c reinicios/OOM/estado: $estado"
  case "$estado" in "0 false running") ;; *) fallo=1 ;; esac
done
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' erp-stress-db-1 erp-stress-backend-1
exit $fallo
