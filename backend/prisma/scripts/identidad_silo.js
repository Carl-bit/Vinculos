// Ata la BD del silo a su slug (R11, tabla identidad_silo) y fija el hash del
// token de /api/internal/* (plano de control, R2 a R5).
//
// Corre en el servicio `migrate`, despues de las migraciones y de rol_api.js,
// como dueño (MIGRATION_DATABASE_URL). Idempotente:
//   - BD sin identidad: la registra con CLIENTE_SLUG.
//   - BD con el mismo slug: no cambia el slug.
//   - BD de otro slug: falla y migrate termina con error, asi backend y
//     frontend no arrancan (depends_on: service_completed_successfully).
//   - INTERNO_TOKEN_SHA256 (64 hex) presente: lo guarda (rotacion = cambiar el
//     .env y volver a correr migrate). Ausente: deja el que habia.
// Los valores viajan como parametros bind, nunca interpolados.
const { Logger } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');

const logger = new Logger('IdentidadSilo');

async function main() {
  const slug = process.env.CLIENTE_SLUG;
  if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error('CLIENTE_SLUG es obligatoria (minusculas, digitos y guiones)');
  }
  const hash = (process.env.INTERNO_TOKEN_SHA256 ?? '').trim();
  if (hash && !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('INTERNO_TOKEN_SHA256 debe ser el SHA-256 en hex (64 caracteres) del token interno');
  }
  const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  try {
    await prisma.$executeRaw`INSERT INTO identidad_silo (slug) VALUES (${slug}) ON CONFLICT (id) DO NOTHING`;
    const [fila] = await prisma.$queryRaw`SELECT slug, interno_token_sha256 FROM identidad_silo`;
    if (fila.slug !== slug) {
      throw new Error(`La BD pertenece al silo ${fila.slug}, no a ${slug}: revisar el .env y el volumen (o el respaldo restaurado)`);
    }
    if (hash && fila.interno_token_sha256 !== hash) {
      await prisma.$executeRaw`UPDATE identidad_silo SET interno_token_sha256 = ${hash}`;
      logger.log(`BD del silo ${slug}; token interno ${fila.interno_token_sha256 ? 'rotado' : 'registrado'}`);
    } else {
      logger.log(`BD del silo ${slug}${fila.interno_token_sha256 || hash ? '' : ' (sin token interno: /api/internal cerrado)'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error(error.message);
  process.exitCode = 1;
});
