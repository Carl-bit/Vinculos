#!/bin/sh
# AUD-02: estadisticas de consultas del silo (pg_stat_statements). Mide
# cuantas consultas hace cada endpoint y cuales son lentas (BD-01, CACHE-06,
# dimensionar el plan por centro). Guarda el texto normalizado ($1, $2...):
# sin valores de pacientes. El operador lo lee como POSTGRES_USER dentro del
# contenedor; un rol sin pg_read_all_stats (app_user) solo ve el texto de sus
# propias consultas, y nadie salvo el superusuario puede reiniciarlo.
#
# Requiere shared_preload_libraries=pg_stat_statements (command del servicio
# db en docker-compose.yml). Corre una vez al crear el volumen; en un silo ya
# creado se aplica a mano (idempotente):
#   docker compose exec db sh /docker-entrypoint-initdb.d/20-pg-stat-statements.sh
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON FUNCTION pg_stat_statements_reset(oid, oid, bigint, boolean) FROM PUBLIC;
SQL
