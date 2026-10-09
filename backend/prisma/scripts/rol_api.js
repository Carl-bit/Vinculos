// Fija la contraseña de app_user (rol de la API) desde APP_DB_PASSWORD.
//
// Idempotente: el servicio `migrate` lo corre en cada despliegue, despues de
// `prisma migrate deploy` (la migracion crea el rol; aqui solo va la
// contraseña, que nunca se escribe en una migracion). Conecta como dueño
// (MIGRATION_DATABASE_URL), que tiene ADMIN OPTION sobre app_user.
//
// ALTER ROLE no acepta parametros: la contraseña viaja como valor de
// set_config (parametro bind) y la cita la propia BD con format(%L), sin
// interpolar strings en JS.
const { Logger } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');

const logger = new Logger('RolApi');

async function main() {
  const password = process.env.APP_DB_PASSWORD;
  if (!password) {
    throw new Error('APP_DB_PASSWORD es obligatoria');
  }
  const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  try {
    await prisma.$transaction([
      prisma.$queryRaw`SELECT set_config('vinculos.app_db_password', ${password}, true)`,
      prisma.$executeRawUnsafe(
        "DO $$ BEGIN EXECUTE format('ALTER ROLE app_user WITH PASSWORD %L', current_setting('vinculos.app_db_password')); END $$",
      ),
    ]);
    logger.log('Contraseña de app_user actualizada');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error(error.message);
  process.exitCode = 1;
});
