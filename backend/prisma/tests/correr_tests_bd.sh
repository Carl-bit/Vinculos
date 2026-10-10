#!/bin/sh
# Tests de BD contra un cluster Postgres 18 temporal (se borra al final). Mismo
# orden que un silo nuevo en Docker:
#   initdb (superusuario, scram) -> infra/postgres/init/10-rol-owner.sh
#   -> prisma migrate deploy (como vinculos_owner) -> prisma/scripts/rol_api.js
#   -> seed (dos veces: idempotente) -> llaves con infra/scripts/llaves/aprovisionar.sh
#   -> prisma/tests/seguridad_bd.sql -> migrate diff
#   -> la API arranca solo con DATABASE_URL y carga el llavero como app_user
#   -> rotacion, recuperacion con 2 de 3 partes y cambio de custodios con los scripts.
# Requiere initdb/pg_ctl/psql 18 en el PATH. Uso, desde backend/:
#   sh prisma/tests/correr_tests_bd.sh
set -e

PUERTO=${PUERTO:-54329}
DIR=$(mktemp -d)
export PGHOST=localhost PGPORT=$PUERTO PGPASSWORD=super-test
export POSTGRES_USER=postgres POSTGRES_DB=app OWNER_DB_PASSWORD=owner-test APP_DB_PASSWORD=api-test
OWNER_URL="postgresql://vinculos_owner:$OWNER_DB_PASSWORD@localhost:$PUERTO/app"
APP_URL="postgresql://app_user:$APP_DB_PASSWORD@localhost:$PUERTO/app"
export MIGRATION_DATABASE_URL="$OWNER_URL?schema=public"
# Prisma CLI exige DATABASE_URL; para migrar es el mismo dueño (como el servicio migrate).
export DATABASE_URL="$MIGRATION_DATABASE_URL"

# La variable de identidad se llama app.current_usuario_id (01d): el nombre
# anterior no puede quedar en el repo (patron partido para no encontrarse a si mismo).
if grep -rn --exclude-dir=node_modules --exclude-dir=dist "current_profesional""_id" prisma src ../docs ../CLAUDE.md ../prompts; then
  echo "Queda el nombre anterior de la variable de contexto" >&2
  exit 1
fi

echo "$PGPASSWORD" > "$DIR/pw"
initdb -D "$DIR/data" -U postgres --pwfile="$DIR/pw" -A scram-sha-256 -E UTF8 >/dev/null
pg_ctl -D "$DIR/data" -o "-p $PUERTO" -l "$DIR/pg.log" -w start >/dev/null
# Llaves de prueba: un "silo" desechable en infra/secrets/<slug> (lo borra el trap).
export CLIENTE_SLUG="prueba-tests-$$" ACTOR=correr_tests_bd
SECRETOS="../infra/secrets/$CLIENTE_SLUG"
LLAVES="../infra/scripts/llaves"
trap 'pg_ctl -D "$DIR/data" -m fast -w stop >/dev/null; rm -rf "$DIR" "$SECRETOS"' EXIT
cli_llaves() { node -r ts-node/register src/common/crypto/cli-llaves.ts "$@"; }
debe_fallar() { if "$@" >/dev/null 2>&1; then echo "Debio fallar: $*" >&2; exit 1; fi; }
createdb -U postgres app

sh ../infra/postgres/init/10-rol-owner.sh
npx prisma generate >/dev/null
npx prisma migrate deploy
node prisma/scripts/rol_api.js
npx prisma db seed
npx prisma db seed

echo "== Llaves: aprovisionar (no sobrescribe) y verificar por KEK y por 2 de 3 partes"
sh "$LLAVES/aprovisionar.sh" >/dev/null
debe_fallar sh "$LLAVES/aprovisionar.sh"
P="$SECRETOS/partes_entregar"
cli_llaves verificar --kek "$SECRETOS/kek"
cli_llaves verificar --parte "$P/parte_1.shamir" --parte "$P/parte_3.shamir"
debe_fallar cli_llaves verificar --parte "$P/parte_2.shamir"

psql -X -v app_url="$APP_URL" -v owner_url="$OWNER_URL" -d "$OWNER_URL" -f prisma/tests/seguridad_bd.sql
npx prisma migrate diff --from-url "$MIGRATION_DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code

echo "== API sin MIGRATION_DATABASE_URL"
# Arranque real de Nest (DI + PrismaService.$connect + llavero con huella y
# canarios + listen) y cierre: el proceso termina solo, sin dejar huerfanos.
npm run --silent build
env -u MIGRATION_DATABASE_URL DATABASE_URL="$APP_URL?schema=public" KEK_PATH="$SECRETOS/kek" \
  RECUPERACION_PUBLICA_PATH="$SECRETOS/recuperacion.pub" JWT_SECRET=secreto-de-prueba-de-al-menos-32-caracteres \
  JOBS_HABILITADOS=false LOG_LEVEL=warn node -e "
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('./dist/app.module');
  (async () => {
    const app = await NestFactory.create(AppModule.crear(), { logger: false });
    await app.listen(0);
    const [{ current_user }] = await app.get(require('./dist/core/prisma/prisma.service').PrismaService)
      .\$queryRaw\`SELECT current_user\`;
    if (current_user !== 'app_user') throw new Error('conectado como ' + current_user);
    await app.close();
  })().catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });
"
echo "API OK (arranca y conecta como app_user)"

echo "== Llavero de la API (app_user, llaves_vigentes) y registro de campos cifrados = columnas bytea de la BD"
cargar_llavero() {
  KEK_PATH="$1" DATABASE_URL="$APP_URL?schema=public" node -e "
    const { PrismaClient } = require('@prisma/client');
    const { Llavero } = require('./dist/common/crypto/cifrado');
    const p = new PrismaClient();
    p.\$queryRaw\`SELECT id::text, categoria::text AS categoria, version, activa, dek_por_kek, huella_kek, canario FROM llaves_vigentes()\`
      .then((f) => Llavero.cargar(require('fs').readFileSync(process.env.KEK_PATH), f.map((x) => ({
        id: x.id, categoria: x.categoria, version: x.version, activa: x.activa,
        dekPorKek: Buffer.from(x.dek_por_kek), huellaKek: x.huella_kek, canario: Buffer.from(x.canario) }))))
      .then(() => p.\$disconnect()).catch((e) => { process.stderr.write(e.message + '\n'); process.exit(1); });
  "
}
cargar_llavero "$SECRETOS/kek"
DATABASE_URL="$MIGRATION_DATABASE_URL" node -e "
  const { PrismaClient } = require('@prisma/client');
  const { CAMPOS_CIFRADOS } = require('./dist/common/crypto/registro');
  const p = new PrismaClient();
  p.\$queryRaw\`SELECT table_name || '.' || column_name AS c FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type = 'bytea' AND column_name NOT LIKE '%hmac'
      AND table_name NOT IN ('llaves_datos', 'sesiones') ORDER BY 1\`.then((filas) => {
    const bd = filas.map((f) => f.c).join(',');
    const reg = CAMPOS_CIFRADOS.map((c) => c.tabla + '.' + c.columna).sort().join(',');
    if (bd !== reg) { throw new Error('registro.ts != BD\nBD:  ' + bd + '\nreg: ' + reg); }
  }).then(() => p.\$disconnect()).catch((e) => { process.stderr.write(e.message + '\n'); process.exit(1); });
"
echo "Llavero OK; registro de campos cifrados = BD"

echo "== Rotacion en dos fases, recuperacion con 2 de 3 partes y cambio de custodios (scripts)"
sh "$LLAVES/rotar.sh" crear >/dev/null
debe_fallar sh "$LLAVES/rotar.sh" crear
sh "$LLAVES/rotar.sh" activar >/dev/null
# La HMAC no rota de forma rutinaria: solo con --compromiso-hmac (runbook).
debe_fallar cli_llaves rotar-crear --kek "$SECRETOS/kek" --publica "$SECRETOS/recuperacion.pub" --categorias HMAC --actor x
cargar_llavero "$SECRETOS/kek"
sh "$LLAVES/recuperar.sh" "$P/parte_2.shamir" "$P/parte_3.shamir" >/dev/null
cli_llaves verificar --kek "$SECRETOS/kek"
debe_fallar cli_llaves verificar --kek "$(ls "$SECRETOS"/kek.anterior-* | head -1)"
debe_fallar cargar_llavero "$(ls "$SECRETOS"/kek.anterior-* | head -1)"
cargar_llavero "$SECRETOS/kek"
sh "$LLAVES/rotar.sh" custodios >/dev/null
N=$(ls -d "$SECRETOS"/partes_entregar_* | head -1)
cli_llaves verificar --parte "$N/parte_1.shamir" --parte "$N/parte_2.shamir"
debe_fallar cli_llaves verificar --parte "$P/parte_1.shamir" --parte "$P/parte_2.shamir"
psql -X -At -d "$OWNER_URL" -c "SELECT string_agg(tipo::text, ',' ORDER BY ocurrido_en, tipo) FROM eventos_llaves WHERE actor <> 'api'"
echo "Llaves OK (7 versiones, ninguna destruida)"
