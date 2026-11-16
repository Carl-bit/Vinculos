// R10 B (Vinculos Control): resembrar el demo. Mantiene vigente un silo de
// demostracion sin borrar nada, como avanzaria un centro real:
//   - a cada par profesional-paciente con una sesion CONFIRMADA en los ultimos
//     60 dias y sin horas futuras le agenda la siguiente: mismo dia de la
//     semana, misma hora de Chile, misma modalidad y box, en los proximos 7 dias;
//   - renueva el acceso del practicante vigente del demo (no el vencido a
//     proposito, que muestra el estado "expirado").
// Lo de los visitantes queda como historia. Las reglas de la BD (EXCLUDE,
// disponibilidad, menor con adulto) se aplican igual: una hora que choca se salta.
//
// Solo con identidad_silo.es_demo (la marca la pone el dueno al crear un silo
// de prueba: ES_DEMO=true en su .env). Corre como dueno en el servicio
// `migrate` (sin KEK: no toca columnas cifradas):
//   docker compose ... run --rm --no-deps migrate node prisma/scripts/demo_resembrar.js
// Imprime solo conteos. Sale con 0 solo si quedan horas futuras.
const { Logger } = require('@nestjs/common');
const { PrismaClient } = require('@prisma/client');

const logger = new Logger('DemoResembrar');
const DIA = 86_400_000;
const ZONA = 'America/Santiago';
const PRACTICANTE_VIGENTE = 'practicante@centro-prueba.cl';

/** Fecha (AAAA-MM-DD), dia de la semana (0 domingo) y HH:MM de un instante, en Chile. */
function enChileDe(d) {
  const fecha = d.toLocaleDateString('sv-SE', { timeZone: ZONA });
  const hora = d.toLocaleTimeString('sv-SE', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
  return { fecha, hora, dow: new Date(`${fecha}T12:00:00Z`).getUTCDay() };
}

/** Instante de una hora de Chile (HH:MM) en una fecha, con el offset vigente ese dia. */
function enChile(fecha, hora) {
  const aprox = new Date(`${fecha}T${hora}:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, timeZoneName: 'longOffset' })
    .formatToParts(aprox)
    .find((p) => p.type === 'timeZoneName')
    .value.replace('GMT', '');
  return new Date(`${fecha}T${hora}:00${offset || '+00:00'}`);
}

/** Proximo dia (1 a 7 dias desde hoy en Chile) con el mismo dia de la semana, a la misma hora. */
function siguiente(inicio, ahora) {
  const o = enChileDe(inicio);
  for (let k = 1; k <= 7; k++) {
    const d = enChileDe(new Date(ahora.getTime() + k * DIA));
    if (d.dow === o.dow) return enChile(d.fecha, o.hora);
  }
  return null;
}

async function main() {
  const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  try {
    const [id] = await prisma.$queryRaw`SELECT slug, es_demo FROM identidad_silo`;
    if (!id) throw new Error('El silo no tiene identidad (migrate sin identidad_silo.js)');
    if (!id.es_demo) throw new Error(`El silo ${id.slug} no esta marcado como demo (identidad_silo.es_demo): no se resiembra`);
    const ahora = new Date();

    // Sesiones confirmadas recientes de pares sin ninguna hora futura activa.
    const pares = await prisma.$queryRaw`
      SELECT DISTINCT ON (c.profesional_id, c.paciente_id)
             c.profesional_id, c.paciente_id, c.modalidad::text AS modalidad, c.espacio_id, c.inicio, c.fin
      FROM citas c
      WHERE c.estado = 'CONFIRMADA' AND c.paciente_id IS NOT NULL
        AND c.inicio < now() AND c.inicio > now() - interval '60 days'
        AND NOT EXISTS (
          SELECT 1 FROM citas f
          WHERE f.profesional_id = c.profesional_id AND f.paciente_id = c.paciente_id
            AND f.inicio > now() AND f.estado IN ('CONFIRMADA', 'SOLICITADA', 'PROPUESTA'))
      ORDER BY c.profesional_id, c.paciente_id, c.inicio DESC`;
    let agendadas = 0;
    let saltadas = 0;
    for (const p of pares) {
      const inicio = siguiente(p.inicio, ahora);
      if (!inicio) continue;
      const fin = new Date(inicio.getTime() + (p.fin.getTime() - p.inicio.getTime()));
      try {
        await prisma.$executeRaw`
          INSERT INTO citas (paciente_id, profesional_id, modalidad, espacio_id, inicio, fin)
          VALUES (${p.paciente_id}::uuid, ${p.profesional_id}::uuid, ${p.modalidad}::modalidad_atencion, ${p.espacio_id}::uuid, ${inicio}, ${fin})`;
        agendadas++;
      } catch {
        // Choca con otra hora, un bloqueo o la disponibilidad: la BD manda.
        saltadas++;
      }
    }

    const renovado = await prisma.$executeRaw`
      UPDATE usuarios SET fecha_expiracion_acceso = now() + interval '90 days'
      WHERE email = ${PRACTICANTE_VIGENTE} AND fecha_expiracion_acceso IS NOT NULL
        AND fecha_expiracion_acceso < now() + interval '30 days'`;

    const [c] = await prisma.$queryRaw`
      SELECT (SELECT count(*) FROM usuarios WHERE activo)::int AS usuarios,
             (SELECT count(*) FROM profesionales)::int AS profesionales,
             (SELECT count(*) FROM citas WHERE inicio > now() AND estado IN ('CONFIRMADA', 'SOLICITADA', 'PROPUESTA'))::int AS futuras`;
    logger.log(
      `Demo ${id.slug}: ${agendadas} hora(s) agendada(s), ${saltadas} saltada(s) por las reglas, practicante ${renovado ? 'renovado' : 'vigente'}; ` +
        `${c.usuarios} usuarios activos, ${c.profesionales} profesionales, ${c.futuras} horas futuras`,
    );
    if (c.futuras === 0) throw new Error('El demo quedo sin horas futuras');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  logger.error(error.message);
  process.exitCode = 1;
});
