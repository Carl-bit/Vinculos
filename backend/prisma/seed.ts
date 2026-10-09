/**
 * Seed minimo del tenant de prueba: 1 ADMIN + 2 PROFESIONAL + 1 PACIENTE
 * (vinculado a un paciente de Profesional Uno), con el rol GESTION
 * deshabilitado, y catalogos minimos (tipos de atencion, tipos de sesion
 * aprobados, intervenciones, estados de avance) SOLO para desarrollo: en un
 * centro real los tipos de sesion los proponen los profesionales y los
 * aprueba ADMIN. Para probar la RLS a mano apenas migre.
 * Idempotente (upsert por email / nombre). Corre con el rol dueño de la DB
 * (MIGRATION_DATABASE_URL), no con el rol de la API: no pasa por RLS.
 *
 * Sin RUT ni telefonos: son columnas cifradas y el servicio migrate no monta
 * la KEK (solo la API cifra). Los ids los genera el seed, como la API.
 */
import { Logger } from '@nestjs/common';
import { PrismaClient, Rol } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
const logger = new Logger('Seed');

const PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password';

const usuarios = [
  { email: 'admin@centro-prueba.cl', nombre: 'Admin Centro Prueba', rol: Rol.ADMIN },
  { email: 'profesional1@centro-prueba.cl', nombre: 'Profesional Uno', rol: Rol.PROFESIONAL },
  { email: 'profesional2@centro-prueba.cl', nombre: 'Profesional Dos', rol: Rol.PROFESIONAL },
];

const tiposAtencion = ['Psicoterapia individual adultos', 'Psicoterapia infanto-juvenil', 'Evaluacion psicologica'];
const tiposSesion = ['Individual', 'Evaluacion inicial', 'Familiar'];
const intervenciones = ['Psicoeducacion', 'Reestructuracion cognitiva', 'Entrevista motivacional'];
const estadosAvance = ['Inicio', 'En proceso', 'Mantencion', 'Alta'];

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  for (const u of usuarios) {
    const usuario = await prisma.usuario.upsert({
      where: { email: u.email },
      update: {},
      create: { id: randomUUID(), ...u, passwordHash },
    });
    logger.log(`${usuario.rol} ${usuario.email} -> ${usuario.id}`);
  }

  // Catalogos minimos para poder derivar y evolucionar en desarrollo.
  for (const nombre of tiposAtencion) {
    await prisma.tipoAtencion.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin@centro-prueba.cl' } });
  for (const nombre of tiposSesion) {
    await prisma.tipoSesion.upsert({
      where: { nombre },
      update: {},
      create: { nombre, estado: 'APROBADO', propuestoPorId: admin.id, revisadoPorId: admin.id, revisadoEn: new Date() },
    });
  }
  for (const nombre of intervenciones) {
    await prisma.intervencion.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }
  for (const nombre of estadosAvance) {
    await prisma.estadoAvance.upsert({ where: { nombre }, update: {}, create: { nombre } });
  }

  // La fila unica la crea la migracion; aqui solo se fija el estado esperado.
  await prisma.configuracionCentro.update({
    where: { id: true },
    data: { rolGestionHabilitado: false },
  });

  const profesional = await prisma.usuario.findUniqueOrThrow({
    where: { email: 'profesional1@centro-prueba.cl' },
  });
  const existente = await prisma.usuario.findUnique({ where: { email: 'paciente@centro-prueba.cl' } });
  const pacienteId = existente?.pacienteId ?? randomUUID();
  const paciente = await prisma.paciente.upsert({
    where: { id: pacienteId },
    update: {},
    create: {
      id: pacienteId,
      nombre: 'Paciente',
      apellido: 'Prueba',
      fechaNacimiento: new Date('1990-05-10'),
      profesionalId: profesional.id,
    },
  });
  const usuarioPaciente = await prisma.usuario.upsert({
    where: { email: 'paciente@centro-prueba.cl' },
    update: {},
    create: {
      id: randomUUID(),
      email: 'paciente@centro-prueba.cl',
      nombre: 'Paciente Prueba',
      rol: Rol.PACIENTE,
      pacienteId: paciente.id,
      passwordHash,
    },
  });
  logger.log(`${usuarioPaciente.rol} ${usuarioPaciente.email} -> paciente ${paciente.id}`);
}

main()
  .catch((error) => {
    logger.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
