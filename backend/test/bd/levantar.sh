#!/bin/sh
# BD efimera para los tests de integracion de la API (Jest + Supertest).
# Mismo orden que un silo nuevo (ver prisma/tests/correr_tests_bd.sh):
#   initdb -> rol dueño -> prisma migrate deploy -> contraseña de app_user
#   -> seed -> llaves (aprovisionar.sh) -> objetos solo de prueba.
# Escribe en $1 un JSON con las variables que usan los tests. Lo borra todo
# test/bd/bajar.sh. Requiere initdb/pg_ctl/psql 18 en el PATH.
# Uso (desde backend/): sh test/bd/levantar.sh <archivo-json>
set -e

SALIDA=${1:?archivo de salida}
PUERTO=${PUERTO_TEST:-54331}
DIR=$(mktemp -d)
export PGHOST=localhost PGPORT=$PUERTO PGPASSWORD=super-test
export POSTGRES_USER=postgres POSTGRES_DB=app OWNER_DB_PASSWORD=owner-test APP_DB_PASSWORD=api-test
OWNER_URL="postgresql://vinculos_owner:$OWNER_DB_PASSWORD@localhost:$PUERTO/app"
APP_URL="postgresql://app_user:$APP_DB_PASSWORD@localhost:$PUERTO/app"
export MIGRATION_DATABASE_URL="$OWNER_URL?schema=public"
export DATABASE_URL="$MIGRATION_DATABASE_URL"
export CLIENTE_SLUG="api-tests-$$" ACTOR=tests_api
# Ruta que entiende Node: en Git Bash (Windows) `pwd -W` da C:/...; en Linux, pwd.
RAIZ=$(cd .. && (pwd -W 2>/dev/null || pwd))
SECRETOS="$RAIZ/infra/secrets/$CLIENTE_SLUG"

echo "$PGPASSWORD" > "$DIR/pw"
initdb -D "$DIR/data" -U postgres --pwfile="$DIR/pw" -A scram-sha-256 -E UTF8 >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PUERTO" -l "$DIR/pg.log" -w start >/dev/null
createdb -U postgres app
sh ../infra/postgres/init/10-rol-owner.sh >/dev/null
npx prisma migrate deploy >/dev/null
node prisma/scripts/rol_api.js >/dev/null
npx prisma db seed >/dev/null
sh ../infra/scripts/llaves/aprovisionar.sh >/dev/null

# Objetos solo de prueba (nunca en una migracion): un error al COMMIT
# (trigger diferido, 23514) y un EXCLUDE (23P01) para probar el filtro global
# sin depender de un modulo de negocio.
psql -X -q -v ON_ERROR_STOP=1 -d "$OWNER_URL" <<'SQL'
CREATE SCHEMA prueba;
CREATE TABLE prueba.commit_diferido (id serial PRIMARY KEY, valor int NOT NULL);
CREATE FUNCTION prueba.fallar_al_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Regla diferida de prueba' USING ERRCODE = 'check_violation', CONSTRAINT = 'prueba_commit_diferido';
END;
$$;
CREATE CONSTRAINT TRIGGER prueba_commit_diferido AFTER INSERT ON prueba.commit_diferido
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION prueba.fallar_al_commit();
CREATE TABLE prueba.rangos (id serial PRIMARY KEY, r tstzrange NOT NULL,
  CONSTRAINT prueba_rangos_sin_solape EXCLUDE USING gist (r WITH &&));
GRANT USAGE ON SCHEMA prueba TO app_user;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA prueba TO app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA prueba TO app_user;
SQL

cat > "$SALIDA" <<JSON
{
  "dir": "$DIR",
  "secretos": "$SECRETOS",
  "ownerUrl": "$OWNER_URL?schema=public",
  "appUrl": "$APP_URL?schema=public",
  "kek": "$SECRETOS/kek",
  "publica": "$SECRETOS/recuperacion.pub"
}
JSON
