/**
 * Centro de demostracion para pruebas manuales (02j): npm run seed:demo.
 * Separado del seed de tests (prisma/seed.ts), sobre el que se apoya (usa sus
 * usuarios y catalogos). Datos ficticios evidentes; RUT validos de prueba.
 *
 * Carga casi todo por la API real (levantada en este proceso, sin crons):
 * pasa por RLS, cifrado, funciones SECURITY DEFINER y avisos igual que una
 * prueba a mano. Como dueño (sin RLS) solo lo que la API no permite por
 * diseño: vencer el acceso de un practicante (exige expiracion futura) y las
 * citas pasadas (solo agenda en huecos futuros); la BD aplica igual sus
 * reglas (disponibilidad, EXCLUDE, monto fijado al confirmar).
 *
 * Idempotente: si los usuarios demo ya existen no hace nada. Para volver a
 * cargar desde cero: npm run demo:reset (recrea la BD local). Se niega con
 * NODE_ENV=production. Usuarios y contraseña: docs/pruebas/guion_manual.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { codigoTotp } from '../src/core/auth/totp';
import { dvRut } from '../src/core/validacion/validadores';

const logger = new Logger('SeedDemo');
const PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password';
const DOMINIO = 'centro-prueba.cl';
const MARCA = `gestion@${DOMINIO}`;
const DIA = 86_400_000;
/** Secretos TOTP de las cuentas demo (03a: obligatorio para el equipo clinico). Fuera de git. */
const ARCHIVO_TOTP = join(__dirname, '..', '..', 'infra', 'local', 'totp-demo.txt');

const rut = (cuerpo: string) => `${cuerpo}-${dvRut(cuerpo)}`;

/** Fecha (AAAA-MM-DD) de Chile a n dias habiles de hoy (negativo = pasado). */
function diaHabil(n: number): string {
  const paso = n < 0 ? -1 : 1;
  let d = new Date();
  let restantes = Math.abs(n);
  while (restantes > 0) {
    d = new Date(d.getTime() + paso * DIA);
    const dow = new Date(d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      restantes--;
    }
  }
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
}

/** Instante de una hora de Chile (HH:MM) en una fecha, con el offset vigente ese dia (horario de verano). */
function enChile(fecha: string, hora: string): Date {
  const aprox = new Date(`${fecha}T${hora}:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', timeZoneName: 'longOffset' })
    .formatToParts(aprox)
    .find((p) => p.type === 'timeZoneName')!
    .value.replace('GMT', '');
  return new Date(`${fecha}T${hora}:00${offset || '+00:00'}`);
}

const horario = (dias: number, hora: string, minutos = 50) => {
  const inicio = enChile(diaHabil(dias), hora);
  return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + minutos * 60_000).toISOString() };
};

type Cuerpo = Record<string, unknown>;

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:demo es solo de desarrollo (NODE_ENV=production)');
  }
  const dueno = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  if (await dueno.usuario.findUnique({ where: { email: MARCA } })) {
    logger.log('Datos demo ya cargados: nada que hacer (npm run demo:reset para recargar)');
    await dueno.$disconnect();
    return;
  }

  Object.assign(process.env, { JOBS_HABILITADOS: 'false', LOGIN_LIMITE_POR_MINUTO: '1000', LOG_LEVEL: 'warn' });
  delete process.env.MIGRATION_DATABASE_URL;
  const app = await NestFactory.create<NestExpressApplication>(AppModule.crear(), { logger: ['warn', 'error'] });
  configurarApp(app);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;

  const llamar = async (token: string | null, metodo: string, ruta: string, cuerpo?: Cuerpo) => {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await r.text();
    if (!r.ok) {
      throw new Error(`${metodo} ${ruta} -> ${r.status} ${texto}`);
    }
    return (texto ? JSON.parse(texto) : {}) as Cuerpo & { id: string };
  };
  // Segundo factor (03a): se enrola en el primer login y el secreto queda en ARCHIVO_TOTP para entrar a mano.
  const secretosTotp = new Map<string, string>();
  const login = async (email: string) => {
    const r = await llamar(null, 'POST', '/auth/login', { email, password: PASSWORD });
    if (!r.requiereTotp) {
      return r.accessToken as string;
    }
    if (!secretosTotp.has(email)) {
      secretosTotp.set(email, (await llamar(null, 'POST', '/auth/totp/enrolamiento', { desafio: r.desafio })).secreto as string);
    }
    return (await llamar(null, 'POST', '/auth/totp', { desafio: r.desafio, codigo: codigoTotp(secretosTotp.get(email)!) })).accessToken as string;
  };

  try {
    // --- Centro y equipo -------------------------------------------------------
    const admin = await login(`admin@${DOMINIO}`);
    await llamar(admin, 'PATCH', '/configuracion', {
      rolGestionHabilitado: true,
      modeloCobro: 'CENTRO',
      nombreCentro: 'Centro de Prueba Vinculos (DEMO)',
      rutCentro: rut('76111222'),
      plazoAvisoCancelacionHoras: 24,
      recordatorioHorasAntes: 48,
    });
    const crearUsuario = (cuerpo: Cuerpo) => llamar(admin, 'POST', '/usuarios', { password: PASSWORD, ...cuerpo });
    const yo = async (token: string) => (await llamar(token, 'GET', '/usuarios/yo')).id;

    await crearUsuario({ email: MARCA, nombre: 'Gestion Demo', rol: 'GESTION' });
    const prof3Id = (await crearUsuario({ email: `profesional3@${DOMINIO}`, nombre: 'Profesional Tres (Demo)', rol: 'PROFESIONAL' })).id;
    const inactivo = await crearUsuario({ email: `inactivo@${DOMINIO}`, nombre: 'Profesional Inactivo (Demo)', rol: 'PROFESIONAL' });
    await llamar(admin, 'PATCH', `/usuarios/${inactivo.id}`, { activo: false });

    const prof1 = await login(`profesional1@${DOMINIO}`);
    const prof2 = await login(`profesional2@${DOMINIO}`);
    const prof3 = await login(`profesional3@${DOMINIO}`);
    const [prof1Id, prof2Id] = [await yo(prof1), await yo(prof2)];

    const practica = { fechaInicioPractica: diaHabil(-20), fechaTerminoPractica: diaHabil(120) };
    const practicanteId = (
      await crearUsuario({
        email: `practicante@${DOMINIO}`,
        nombre: 'Practicante Demo',
        rol: 'PRACTICANTE',
        supervisorId: prof2Id,
        fechaExpiracionAcceso: new Date(Date.now() + 90 * DIA).toISOString(),
        ...practica,
      })
    ).id;
    const expiradoId = (
      await crearUsuario({
        email: `practicante.expirado@${DOMINIO}`,
        nombre: 'Practicante Expirado (Demo)',
        rol: 'PRACTICANTE',
        supervisorId: prof2Id,
        fechaExpiracionAcceso: new Date(Date.now() + DIA).toISOString(),
        ...practica,
      })
    ).id;
    // Unica escritura como dueño: la API (y la BD para app_user) exigen expiracion futura.
    await dueno.usuario.update({ where: { id: expiradoId }, data: { fechaExpiracionAcceso: new Date(Date.now() - DIA) } });
    const practicante = await login(`practicante@${DOMINIO}`);

    // Catalogos: tipos de atencion propuestos por cada profesional y aprobados por ADMIN.
    const tipos = (await llamar(admin, 'GET', '/tipos-atencion')) as unknown as { id: string; nombre: string }[];
    const tipo = (nombre: string) => tipos.find((t) => t.nombre === nombre)!.id;
    const adultos = tipo('Psicoterapia individual adultos');
    const infanto = tipo('Psicoterapia infanto-juvenil');
    for (const [token, id, nombres] of [
      [prof1, prof1Id, [adultos, tipo('Evaluacion psicologica')]],
      [prof2, prof2Id, [adultos, infanto]],
      [prof3, prof3Id, [adultos]],
    ] as const) {
      for (const tipoAtencionId of nombres) {
        await llamar(token, 'POST', '/profesionales/yo/tipos-atencion', { tipoAtencionId });
        await llamar(admin, 'PATCH', `/profesionales/${id}/tipos-atencion/${tipoAtencionId}`, { estado: 'APROBADO' });
      }
    }

    // Perfil, tarifas, sala de videollamada, disponibilidad (lunes a viernes 09:00-19:00, ambas modalidades).
    const perfiles = [
      [prof1, prof1Id, 'Ps. Profesional Uno (Demo)', 'Psicologia clinica adultos', 35000, 30000],
      [prof2, prof2Id, 'Ps. Profesional Dos (Demo)', 'Psicologia infanto-juvenil', 40000, 35000],
      [prof3, prof3Id, 'Ps. Profesional Tres (Demo)', 'Psicologia clinica adultos', 38000, null],
    ] as const;
    for (const [token, id, nombrePublico, especialidad, general, online] of perfiles) {
      await llamar(token, 'POST', '/profesionales/yo/tarifas', { monto: general });
      if (online) {
        await llamar(token, 'POST', '/profesionales/yo/tarifas', { monto: online, modalidad: 'ONLINE' });
      }
      await llamar(token, 'PUT', '/profesionales/yo/perfil', {
        especialidad,
        modalidad: 'MIXTA',
        nombrePublico,
        enfoques: ['Cognitivo-conductual'],
        bio: 'Perfil ficticio del centro de demostracion.',
        perfilPublico: true,
      });
      await llamar(token, 'PUT', '/profesionales/yo/videollamada', { modo: 'ENLACE_PROPIO', enlace: `https://meet.jit.si/vinculos-demo-${id.slice(0, 8)}` });
    }
    await llamar(practicante, 'PUT', '/profesionales/yo/videollamada', {
      modo: 'ENLACE_PROPIO',
      enlace: `https://meet.jit.si/vinculos-demo-${practicanteId.slice(0, 8)}`,
    });
    for (const id of [prof1Id, prof2Id, prof3Id, practicanteId]) {
      for (let diaSemana = 1; diaSemana <= 5; diaSemana++) {
        for (const modalidad of ['PRESENCIAL', 'ONLINE']) {
          await llamar(admin, 'POST', `/profesionales/${id}/disponibilidad`, { diaSemana, inicioMin: 9 * 60, finMin: 19 * 60, modalidad });
        }
      }
    }
    // Datos para la copia de autoria de las evoluciones y para las liquidaciones (cifrados).
    await llamar(prof1, 'PUT', '/profesionales/yo/datos-privados', {
      rut: rut('12345678'),
      banco: 'BancoEstado',
      tipoCuenta: 'CUENTA_RUT',
      numeroCuenta: '12345678',
      titular: 'Profesional Uno (Demo)',
    });
    await llamar(prof1, 'POST', '/trayectoria', {
      tipo: 'TITULO',
      titulo: 'Psicologo (Demo)',
      institucion: 'Universidad Ficticia',
      anio: 2015,
      registroSuperintendencia: '000000',
    });
    await llamar(admin, 'POST', '/tipos-documento-clinico', { nombre: 'Certificado de atencion (Demo)' });
    const box1 = (await llamar(admin, 'POST', '/espacios', { nombre: 'Box 1 (Demo)' })).id;
    await llamar(admin, 'POST', '/espacios', { nombre: 'Box 2 (Demo)' });

    // --- Pacientes ---------------------------------------------------------------
    // Paciente Prueba (seed base, de Profesional Uno): se le agrega RUT para la busqueda.
    const pacientePrueba = (await dueno.usuario.findUniqueOrThrow({ where: { email: `paciente@${DOMINIO}` } })).pacienteId!;
    await llamar(prof1, 'PATCH', `/pacientes/${pacientePrueba}`, { rut: rut('11111111'), email: `paciente@${DOMINIO}`, telefono: '+56911111111' });

    const camila = await llamar(prof1, 'POST', '/pacientes', {
      nombre: 'Camila',
      apellido: 'Demo Practicante',
      rut: rut('22222222'),
      fechaNacimiento: '1998-03-14',
      email: `paciente2@${DOMINIO}`,
      tipoAtencionId: adultos,
    });
    await crearUsuario({ email: `paciente2@${DOMINIO}`, nombre: 'Camila Demo Practicante', rol: 'PACIENTE', pacienteId: camila.id });

    const diego = await llamar(prof1, 'POST', '/pacientes', {
      nombre: 'Diego',
      apellido: 'Demo Derivacion',
      rut: rut('33333333'),
      fechaNacimiento: '1985-11-02',
      email: `paciente3@${DOMINIO}`,
      tipoAtencionId: adultos,
    });
    await crearUsuario({ email: `paciente3@${DOMINIO}`, nombre: 'Diego Demo Derivacion', rol: 'PACIENTE', pacienteId: diego.id });

    const sofia = await llamar(prof2, 'POST', '/pacientes', {
      nombre: 'Sofia',
      apellido: 'Demo Menor',
      rut: rut('24444444'),
      fechaNacimiento: '2014-06-20',
      tipoAtencionId: infanto,
    });
    await llamar(prof2, 'POST', `/pacientes/${sofia.id}/adultos-responsables`, {
      nombre: 'Madre Demo Responsable',
      parentesco: 'Madre',
      rut: rut('15555555'),
      telefono: '+56955555555',
      email: `madre.demo@${DOMINIO}`,
    });

    // Practicante: derivacion de Camila -> supervisor propone al practicante -> acepta -> consentimiento aceptado por la paciente.
    const derivCamila = await llamar(prof1, 'POST', '/derivaciones', {
      fichaId: camila.fichaId,
      motivo: 'Derivacion demo a practicante supervisado',
      tipoAtencionId: adultos,
      candidatos: [],
    });
    await llamar(prof2, 'POST', `/derivaciones/${derivCamila.id}/practicantes`, { practicanteId });
    await llamar(practicante, 'POST', `/derivaciones/${derivCamila.id}/respuesta`, { acepta: true });
    const paciente2 = await login(`paciente2@${DOMINIO}`);
    const [solicitud] = (await llamar(paciente2, 'GET', '/consentimientos')) as unknown as { id: string }[];
    await llamar(paciente2, 'POST', `/consentimientos/${solicitud.id}/respuesta`, { acepta: true, versionDocumento: 'v1-demo', otorgadoPorTipo: 'PACIENTE' });

    // Derivacion en curso de Diego con dos candidatos: la oferta queda en Profesional Dos.
    await llamar(prof1, 'POST', '/derivaciones', {
      fichaId: diego.fichaId,
      motivo: 'Derivacion demo en curso (cambio de enfoque)',
      detalle: 'Texto clinico ficticio del centro de demostracion.',
      tipoAtencionId: adultos,
      candidatos: [prof2Id, prof3Id],
    });

    // --- Evoluciones (copia de autoria; ADMIN no las lee) --------------------------
    const tiposSesion = (await llamar(prof1, 'GET', '/tipos-sesion?estado=APROBADO')) as unknown as { id: string }[];
    // El seed base crea a Paciente Prueba sin ficha: la abre su tratante.
    const fichaPrueba = (await llamar(prof1, 'POST', `/pacientes/${pacientePrueba}/ficha`)).id;
    await llamar(prof1, 'POST', `/fichas/${fichaPrueba}/evoluciones`, {
      notas: 'Evolucion demo: sesion de evaluacion inicial (texto ficticio).',
      tipoSesionId: tiposSesion[0].id,
      nivelRiesgo: 'BAJO',
    });
    await llamar(practicante, 'POST', `/fichas/${String(camila.fichaId)}/evoluciones`, {
      notas: 'Evolucion demo del practicante (la ve el supervisor seudonimizada).',
      tipoSesionId: tiposSesion[0].id,
      nivelRiesgo: 'BAJO',
    });

    // --- Citas -------------------------------------------------------------------
    const gestion = await login(MARCA);
    const cita = (cuerpo: Cuerpo) => llamar(gestion, 'POST', '/citas', cuerpo);
    // Pasadas: la API solo agenda en huecos futuros; como dueño, con las mismas reglas de la BD (disponibilidad, EXCLUDE, monto).
    const pasada = await dueno.cita.create({
      data: { pacienteId: pacientePrueba, profesionalId: prof1Id, modalidad: 'PRESENCIAL', espacioId: box1, ...horario(-5, '10:00') },
    });
    await llamar(gestion, 'POST', `/cobros/citas/${pasada.id}/pagos`, { monto: 35000, medioPago: 'TRANSFERENCIA' });
    await dueno.cita.create({ data: { pacienteId: camila.id, profesionalId: practicanteId, modalidad: 'ONLINE', ...horario(-3, '16:00') } });
    const parcial = await cita({ pacienteId: pacientePrueba, profesionalId: prof1Id, modalidad: 'PRESENCIAL', espacioId: box1, ...horario(4, '10:00') });
    await llamar(gestion, 'POST', `/cobros/citas/${parcial.id}/pagos`, { monto: 15000, medioPago: 'EFECTIVO' });
    await cita({ pacienteId: pacientePrueba, profesionalId: prof1Id, modalidad: 'ONLINE', ...horario(6, '12:00') });
    await cita({ pacienteId: sofia.id, profesionalId: prof2Id, modalidad: 'PRESENCIAL', espacioId: box1, ...horario(4, '15:00') });
    await cita({ pacienteId: camila.id, profesionalId: practicanteId, modalidad: 'ONLINE', ...horario(5, '17:00') });
    await cita({ pacienteId: diego.id, profesionalId: prof1Id, modalidad: 'PRESENCIAL', espacioId: box1, ...horario(7, '11:00') });
  } finally {
    await app.close();
    await dueno.$disconnect();
    if (secretosTotp.size) {
      mkdirSync(join(ARCHIVO_TOTP, '..'), { recursive: true });
      writeFileSync(ARCHIVO_TOTP, [...secretosTotp].map(([email, s]) => `${email} ${s}`).join('\n') + '\n');
    }
  }
  // El logger de la app (pino, nivel warn) ya no esta: aviso final directo.
  process.stdout.write(`Centro demo cargado. Usuarios @${DOMINIO}, contraseña "${PASSWORD}"; secretos TOTP en infra/local/totp-demo.txt (ver docs/pruebas/guion_manual.md)
`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
