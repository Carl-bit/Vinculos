#!/bin/sh
# Crea el dueño de la BD del silo: vinculos_owner (no superusuario).
#
# Lo corre la imagen oficial de Postgres una sola vez, al crear el volumen
# (/docker-entrypoint-initdb.d), conectado como POSTGRES_USER (superusuario).
# Desde ahi el superusuario no se usa mas: migraciones y seed corren como
# vinculos_owner (MIGRATION_DATABASE_URL) y la API como app_user.
#
# Atributos de vinculos_owner:
#   CREATEROLE: crea app_user y app_reportes en las migraciones (queda con
#               ADMIN OPTION sobre ellos, asi puede fijar la contraseña de app_user).
#   BYPASSRLS:  dueño de los helpers SECURITY DEFINER sobre tablas con FORCE
#               RLS, y requisito para crear app_reportes con BYPASSRLS.
#   CREATEDB:   solo para la shadow DB de `prisma migrate dev` en desarrollo.
# Idempotente: se puede volver a correr a mano para rotar la contraseña
# (docker compose exec db sh /docker-entrypoint-initdb.d/10-rol-owner.sh).
set -e

: "${OWNER_DB_PASSWORD:?OWNER_DB_PASSWORD es obligatoria}"

psql -v ON_ERROR_STOP=1 -v pw="$OWNER_DB_PASSWORD" -v db="$POSTGRES_DB" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT 'CREATE ROLE vinculos_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinculos_owner') \gexec
ALTER ROLE vinculos_owner WITH LOGIN NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS PASSWORD :'pw';
-- Dueño de la BD = dueño del schema public (pg_database_owner, PG15+).
ALTER DATABASE :"db" OWNER TO vinculos_owner;
SQL
