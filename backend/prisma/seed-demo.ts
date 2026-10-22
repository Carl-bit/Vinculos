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
 * NODE_ENV=production. Usuarios y contraseña: docs/pruebas/usuarios_demo.md.
 *
 * 03b-4.1: el equipo entra con un codigo por correo. El seed captura los
 * codigos que emite su propia API (no los envia); al usar la app, los codigos
 * llegan a Mailpit (http://localhost:8025).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/configurar-app';
import { hashToken } from '../src/core/auth/tokens-correo';
import { JobsService } from '../src/core/jobs/jobs.service';
import { type Correo, ProveedorCorreo } from '../src/core/notificaciones/correo';
import { dvRut } from '../src/core/validacion/validadores';

const logger = new Logger('SeedDemo');
const PASSWORD = process.env.SEED_PASSWORD ?? 'dev-password';
const DOMINIO = 'centro-prueba.cl';
const MARCA = `gestion@${DOMINIO}`;
const DIA = 86_400_000;

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
  // Codigos de verificacion (03b-4.1): se capturan aca y no salen; el resto de los correos sigue su curso.
  const codigos = new Map<string, string>();
  const correo = app.get(ProveedorCorreo);
  const enviar = correo.enviar.bind(correo);
  correo.enviar = async (c: Correo) => {
    if (!c.asunto.startsWith('Tu código de verificación')) {
      return enviar(c);
    }
    codigos.set(c.para, /(\d{6})/.exec(c.texto)![1]);
  };

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
  // Segundo factor por correo (03b-4.1): el codigo capturado responde el desafio.
  const login = async (email: string) => {
    const r = await llamar(null, 'POST', '/auth/login', { email, password: PASSWORD });
    if (!r.requiereSegundoFactor) {
      return r.accessToken as string;
    }
    return (await llamar(null, 'POST', '/auth/segundo-factor', { desafio: r.desafio, codigo: codigos.get(email) })).accessToken as string;
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
    // 03b-4.1: el ADMIN del demo tambien atiende (selector de rol activo).
    await llamar(admin, 'POST', `/usuarios/${await yo(admin)}/roles`, { rol: 'PROFESIONAL' });

    await crearUsuario({ email: MARCA, nombre: 'Gestion Demo', rol: 'GESTION' });
    // C-1: cuenta con dos roles (ADMIN + PROFESIONAL) para el selector de rol activo del front.
    const directoraId = (await crearUsuario({ email: `directora@${DOMINIO}`, nombre: 'Directora Demo', rol: 'ADMIN' })).id;
    await llamar(admin, 'POST', `/usuarios/${directoraId}/roles`, { rol: 'PROFESIONAL' });
    const prof3Id = (await crearUsuario({ email: `profesional3@${DOMINIO}`, nombre: 'Profesional Tres (Demo)', rol: 'PROFESIONAL' })).id;
    const inactivo = await crearUsuario({ email: `inactivo@${DOMINIO}`, nombre: 'Profesional Inactivo (Demo)', rol: 'PROFESIONAL' });
    await llamar(admin, 'PATCH', `/usuarios/${inactivo.id}`, { activo: false });

    const prof1 = await login(`profesional1@${DOMINIO}`);
    const prof2 = await login(`profesional2@${DOMINIO}`);
    const prof3 = await login(`profesional3@${DOMINIO}`);
    const [prof1Id, prof2Id] = [await yo(prof1), await yo(prof2)];
    // 03b-4.1: tres profesionales mas (seis con perfil publico) para probar filtros, presupuesto y match.
    const nuevos: { id: string; token: string }[] = [];
    for (const [usuario, nombre] of [
      ['profesional4', 'Profesional Cuatro (Demo)'],
      ['profesional5', 'Profesional Cinco (Demo)'],
      ['profesional6', 'Profesional Seis (Demo)'],
    ]) {
      const id = (await crearUsuario({ email: `${usuario}@${DOMINIO}`, nombre, rol: 'PROFESIONAL' })).id;
      nuevos.push({ id, token: await login(`${usuario}@${DOMINIO}`) });
    }
    const [prof4, prof5, prof6] = nuevos;

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
    // Nombres que el cuestionario del match reconoce (adolescentes, niños, parejas).
    for (const nombre of ['Psicoterapia adolescentes', 'Psicoterapia niños', 'Terapia de pareja']) {
      await llamar(admin, 'POST', '/tipos-atencion', { nombre });
    }
    const tipos = (await llamar(admin, 'GET', '/tipos-atencion')) as unknown as { id: string; nombre: string }[];
    const tipo = (nombre: string) => tipos.find((t) => t.nombre === nombre)!.id;
    const adultos = tipo('Psicoterapia individual adultos');
    const infanto = tipo('Psicoterapia infanto-juvenil');
    for (const [token, id, nombres] of [
      [prof1, prof1Id, [adultos, tipo('Evaluacion psicologica')]],
      [prof2, prof2Id, [adultos, infanto]],
      [prof3, prof3Id, [adultos]],
      [prof4.token, prof4.id, [adultos, tipo('Terapia de pareja')]],
      [prof5.token, prof5.id, [tipo('Psicoterapia adolescentes'), tipo('Psicoterapia niños'), infanto]],
      [prof6.token, prof6.id, [adultos, tipo('Psicoterapia adolescentes')]],
    ] as const) {
      for (const tipoAtencionId of nombres) {
        await llamar(token, 'POST', '/profesionales/yo/tipos-atencion', { tipoAtencionId });
        await llamar(admin, 'PATCH', `/profesionales/${id}/tipos-atencion/${tipoAtencionId}`, { estado: 'APROBADO' });
      }
    }

    // Perfil, tarifas, sala de videollamada y horario habitual (lunes a viernes 09:00-19:00, referencia para apartar box).
    // Perfiles publicos variados (03b-2): secciones condicionales del perfil, filtros y match.
    const perfiles = [
      [
        prof1,
        prof1Id,
        'Ps. Profesional Uno (Demo)',
        'Psicologia clinica adultos',
        35000,
        30000,
        {
          enfoques: ['Cognitivo-conductual', 'Ansiedad', 'Estrés', 'Duelo'],
          convenios: ['FONASA'],
          boletaReembolsable: true,
          idiomas: ['Español', 'Inglés'],
          citaDestacada: 'Cada proceso parte por entender qué te trae y qué te gustaría que cambiara.',
        },
      ],
      [
        prof2,
        prof2Id,
        'Ps. Profesional Dos (Demo)',
        'Psicologia infanto-juvenil',
        40000,
        35000,
        {
          enfoques: ['Sistémico', 'Familia', 'Conducta'],
          idiomas: ['Español'],
        },
      ],
      [
        prof3,
        prof3Id,
        'Ps. Profesional Tres (Demo)',
        'Psicologia clinica adultos',
        38000,
        null,
        {
          enfoques: ['Cognitivo-conductual', 'Trabajo', 'Ánimo'],
        },
      ],
      [
        prof4.token,
        prof4.id,
        'Ps. Profesional Cuatro (Demo)',
        'Terapia de pareja y familia',
        25000,
        null,
        { enfoques: ['Sistémico', 'Pareja', 'Familia', 'Estrés'], convenios: ['FONASA'], modalidad: 'ONLINE', idiomas: ['Español', 'Portugués'] },
      ],
      [
        prof5.token,
        prof5.id,
        'Ps. Profesional Cinco (Demo)',
        'Psicologia infanto-juvenil',
        55000,
        null,
        { enfoques: ['Conducta', 'Ansiedad', 'Sueño', 'Autoestima'], boletaReembolsable: true, modalidad: 'PRESENCIAL' },
      ],
      [
        prof6.token,
        prof6.id,
        'Ps. Profesional Seis (Demo)',
        'Psicologia clinica adultos',
        45000,
        42000,
        { enfoques: ['Humanista', 'Duelo', 'Ánimo', 'Trabajo', 'Autoestima'], convenios: ['FONASA'], boletaReembolsable: true },
      ],
    ] as const;
    for (const [token, id, nombrePublico, especialidad, general, online, extra] of perfiles) {
      await llamar(token, 'POST', '/profesionales/yo/tarifas', { monto: general });
      if (online) {
        await llamar(token, 'POST', '/profesionales/yo/tarifas', { monto: online, modalidad: 'ONLINE' });
      }
      await llamar(token, 'PUT', '/profesionales/yo/perfil', {
        especialidad,
        modalidad: 'MIXTA',
        nombrePublico,
        bio: 'Perfil ficticio del centro de demostracion.',
        perfilPublico: true,
        ...extra,
      });
      await llamar(token, 'PUT', '/profesionales/yo/videollamada', { modo: 'ENLACE_PROPIO', enlace: `https://meet.jit.si/vinculos-demo-${id.slice(0, 8)}` });
    }
    await llamar(practicante, 'PUT', '/profesionales/yo/videollamada', {
      modo: 'ENLACE_PROPIO',
      enlace: `https://meet.jit.si/vinculos-demo-${practicanteId.slice(0, 8)}`,
    });
    const soloOnline = [prof4.id];
    const soloPresencial = [prof5.id];
    for (const id of [prof1Id, prof2Id, prof3Id, practicanteId, prof4.id, prof5.id, prof6.id]) {
      for (let diaSemana = 1; diaSemana <= 5; diaSemana++) {
        for (const modalidad of soloOnline.includes(id) ? ['ONLINE'] : soloPresencial.includes(id) ? ['PRESENCIAL'] : ['PRESENCIAL', 'ONLINE']) {
          await llamar(admin, 'POST', `/profesionales/${id}/disponibilidad`, { diaSemana, inicioMin: 9 * 60, finMin: 19 * 60, modalidad });
        }
      }
    }
    // 03b: la agenda sale del box. ADMIN define cuando se usa cada box; cada profesional aparta sus horas
    // (de una semana atras a seis adelante, para las citas pasadas y futuras del demo). Box 3 abre solo este
    // trimestre (horario por periodo) y queda sin apartar para probarlo desde el backoffice.
    const box1 = (await llamar(admin, 'POST', '/espacios', { nombre: 'Box 1 (Demo)' })).id;
    const box2 = (await llamar(admin, 'POST', '/espacios', { nombre: 'Box 2 (Demo)' })).id;
    const box3 = (await llamar(admin, 'POST', '/espacios', { nombre: 'Box 3 Sala grupal (Demo)', nota: 'Solo este trimestre' })).id;
    const habiles = [1, 2, 3, 4, 5].map((diaSemana) => ({ diaSemana, inicioMin: 9 * 60, finMin: 19 * 60 }));
    await llamar(admin, 'PUT', `/espacios/${box1}/horario`, { bloques: habiles });
    await llamar(admin, 'PUT', `/espacios/${box2}/horario`, { bloques: habiles });
    await llamar(admin, 'PUT', `/espacios/${box3}/horario`, {
      bloques: habiles.map((h) => ({ ...h, finMin: 13 * 60, vigenteDesde: diaHabil(0), vigenteHasta: diaHabil(63) })),
    });
    const fechas = [...new Set(Array.from({ length: 37 }, (_v, i) => diaHabil(i - 6)))];
    const diaSemana = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const apartar = (token: string, id: string, espacioId: string, desde: string, hasta: string, dias = [1, 2, 3, 4, 5], desdeFecha = '') =>
      llamar(token, 'POST', `/profesionales/${id}/bloques`, {
        bloques: fechas
          .filter((f) => dias.includes(diaSemana(f)) && f >= desdeFecha)
          .map((f) => ({ espacioId, inicio: enChile(f, desde).toISOString(), fin: enChile(f, hasta).toISOString() })),
      });
    await apartar(prof1, prof1Id, box1, '09:00', '14:00');
    await apartar(prof2, prof2Id, box1, '14:00', '19:00');
    await apartar(prof3, prof3Id, box2, '09:00', '13:00', [1, 3, 5]);
    await apartar(practicante, practicanteId, box2, '15:00', '19:00');
    await apartar(prof4.token, prof4.id, box2, '13:00', '15:00');
    await apartar(prof6.token, prof6.id, box2, '09:00', '13:00', [2, 4]);
    // Box 3: Profesional Cinco lunes, miercoles y viernes (martes y jueves quedan libres para probar "Apartar horas").
    await apartar(prof5.token, prof5.id, box3, '09:00', '13:00', [1, 3, 5], diaHabil(0));

    // Datos para la copia de autoria de las evoluciones y para las liquidaciones (cifrados).
    await llamar(prof1, 'PUT', '/profesionales/yo/datos-privados', {
      rut: rut('12345678'),
      banco: 'BancoEstado',
      tipoCuenta: 'CUENTA_RUT',
      numeroCuenta: '12345678',
      titular: 'Profesional Uno (Demo)',
    });
    // Trayectoria verificada por ADMIN: es la que muestra el perfil publico (titulos y años de experiencia).
    for (const [token, cuerpo] of [
      [prof1, { tipo: 'TITULO', titulo: 'Psicologo (Demo)', institucion: 'Universidad Ficticia', anio: 2015, registroSuperintendencia: '000000' }],
      [prof1, { tipo: 'MAGISTER', titulo: 'Magister en Psicologia Clinica (Demo)', institucion: 'Universidad Ficticia', anio: 2019 }],
      [prof2, { tipo: 'TITULO', titulo: 'Psicologa (Demo)', institucion: 'Universidad Ficticia', anio: 2012 }],
    ] as const) {
      const { id } = await llamar(token, 'POST', '/trayectoria', cuerpo);
      await llamar(admin, 'POST', `/trayectoria/${id}/verificacion`, { verificado: true });
    }

    // Sitio publico (03b-2): contenido editable por ADMIN y politicas que se aceptan al pedir hora.
    await llamar(admin, 'PATCH', '/configuracion/contenido-publico', {
      heroTitulo: 'Acompañamiento psicológico, con orden detrás.',
      heroTexto: 'Atendemos consultas individuales, de pareja y familiares. Reserva en línea y un equipo que se coordina en la misma plataforma.',
      servicios: [
        { icono: 'person', titulo: 'Terapia individual', texto: 'Sesiones presenciales o por videollamada, con seguimiento entre sesiones.' },
        { icono: 'favorite', titulo: 'Terapia de pareja', texto: 'Acompañamiento para conflictos de convivencia, comunicación y proyectos en común.' },
        { icono: 'escalator_warning', titulo: 'Niños y adolescentes', texto: 'Evaluación y terapia con participación de la familia.' },
      ],
      contactoCorreo: `contacto@${DOMINIO}`,
      contactoTelefono: '+56222222222',
      direccion: 'Dirección ficticia 123, Santiago',
    });
    await llamar(admin, 'POST', '/politicas', {
      tipo: 'POLITICA_DATOS',
      texto: 'Politica de datos ficticia del centro de demostracion. Tus datos se usan solo para tu atencion y se guardan cifrados.',
    });
    await llamar(admin, 'POST', '/politicas', {
      tipo: 'TERMINOS_AGENDAMIENTO',
      texto: 'Terminos de agendamiento ficticios del centro de demostracion. Puedes cancelar sin costo con 24 horas de aviso.',
    });
    await llamar(admin, 'POST', '/tipos-documento-clinico', { nombre: 'Certificado de atencion (Demo)' });

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
    await llamar(paciente2, 'POST', `/consentimientos/${solicitud.id}/respuesta`, { acepta: true, versionDocumento: '1', otorgadoPorTipo: 'PACIENTE' });

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

    // --- 03b-5: especialidad aprobada y plantillas clinicas publicadas (ingreso y evolucion) ---
    const especialidad = await llamar(admin, 'POST', '/especialidades', { nombre: 'Psicologia clinica (Demo)' });
    await llamar(prof1, 'POST', '/profesionales/yo/especialidades', { especialidadId: especialidad.id });
    await llamar(admin, 'POST', `/profesionales/${prof1Id}/especialidades/${especialidad.id}/revision`, { aprobar: true });
    const campos = (lista: [string, string, string, Cuerpo?][]) =>
      lista.map(([clave, etiqueta, tipo, extra], i) => ({
        clave,
        etiqueta,
        tipo,
        obligatorio: false,
        orden: i + 1,
        visible_en_supervision: false,
        es_texto_libre: tipo === 'TEXTO' || tipo === 'TEXTO_LARGO',
        ...extra,
      }));
    const plantillaIngreso = await llamar(admin, 'POST', '/plantillas-clinicas', {
      especialidadId: especialidad.id,
      tipo: 'INGRESO',
      nombre: 'Anamnesis adultos (Demo)',
      definicion: campos([
        ['motivo_consulta', 'Motivo de consulta', 'TEXTO_LARGO', { obligatorio: true }],
        ['derivado_por', 'Derivado por', 'SELECCION_UNICA', { opciones: ['Consulta espontanea', 'Medico', 'Colegio', 'Otro'] }],
        ['tratamiento_previo', 'Tratamiento psicologico previo', 'SI_NO'],
        ['antecedentes', 'Antecedentes relevantes', 'TEXTO_LARGO'],
      ]),
    });
    await llamar(admin, 'POST', `/plantillas-clinicas/${plantillaIngreso.id}/publicacion`);
    const plantillaEvolucion = await llamar(admin, 'POST', '/plantillas-clinicas', {
      especialidadId: especialidad.id,
      tipo: 'EVOLUCION',
      nombre: 'Evolucion psicoterapia (Demo)',
      definicion: campos([
        [
          'foco',
          'Foco de la sesion',
          'SELECCION_MULTIPLE',
          { opciones: ['Sintomas', 'Vinculos', 'Trabajo', 'Plan de seguridad'], visible_en_supervision: true },
        ],
        ['animo', 'Animo reportado (1 a 10)', 'NUMERO', { visible_en_supervision: true }],
        ['tareas', 'Tareas acordadas', 'TEXTO'],
      ]),
    });
    await llamar(admin, 'POST', `/plantillas-clinicas/${plantillaEvolucion.id}/publicacion`);
    await llamar(prof1, 'POST', `/fichas/${fichaPrueba}/ingresos`, {
      plantillaId: plantillaIngreso.id,
      valores: { motivo_consulta: 'Motivo ficticio del centro de demostracion.', derivado_por: 'Consulta espontanea', tratamiento_previo: false },
    });
    await llamar(prof1, 'POST', `/fichas/${fichaPrueba}/evoluciones`, {
      notas: 'Evolucion demo con plantilla (texto ficticio).',
      tipoSesionId: tiposSesion[0].id,
      nivelRiesgo: 'NINGUNO',
      plantillaId: plantillaEvolucion.id,
      valores: { foco: ['Sintomas'], animo: 6 },
    });
    await llamar(prof1, 'POST', `/fichas/${fichaPrueba}/borradores`, { contenido: 'Borrador demo sin confirmar (texto ficticio).' });

    // --- 03b-5.2: supervision seudonimizada, mensajeria interna y acceso temporal ---
    const [caso] = (await llamar(prof2, 'GET', '/supervision/casos')) as unknown as { codigo: string }[];
    const [evolucionCaso] = (await llamar(prof2, 'GET', `/supervision/casos/${caso.codigo}/evoluciones`)) as unknown as { evolucionId: string }[];
    await llamar(prof2, 'POST', `/supervision/evoluciones/${evolucionCaso.evolucionId}/comentarios`, {
      texto: 'Comentario demo de supervision: revisar el plan de la proxima sesion (texto ficticio).',
    });
    await llamar(prof1, 'POST', '/hilos', { tipo: 'GENERAL', asunto: 'Coordinacion de la semana (demo)', participantes: [prof2Id] });
    const hiloCaso = await llamar(prof1, 'POST', '/hilos', { tipo: 'CASO', asunto: 'Interconsulta del caso (demo)', pacienteId: pacientePrueba });
    await llamar(prof1, 'POST', `/hilos/${hiloCaso.id}/mensajes`, { contenido: 'Mensaje demo del caso (texto ficticio).' });
    await llamar(prof1, 'POST', `/pacientes/${pacientePrueba}/accesos-temporales`, {
      profesionalId: prof3Id,
      motivo: 'INTERCONSULTA',
      alcance: 'LECTURA',
      hasta: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    });

    // --- Citas -------------------------------------------------------------------
    const gestion = await login(MARCA);
    const cita = (cuerpo: Cuerpo) => llamar(gestion, 'POST', '/citas', cuerpo);
    // Pasadas: la API solo agenda en huecos futuros; como dueño, con las mismas reglas de la BD (bloques de box, EXCLUDE,
    // monto). El box presencial lo pone la BD (el del bloque del profesional).
    const pasada = await dueno.cita.create({
      data: { pacienteId: pacientePrueba, profesionalId: prof1Id, modalidad: 'PRESENCIAL', ...horario(-5, '10:00') },
    });
    await llamar(gestion, 'POST', `/cobros/citas/${pasada.id}/pagos`, { monto: 35000, medioPago: 'TRANSFERENCIA' });
    // Reseña publicada (perfil publico): el paciente con una sesion realizada la escribe y ADMIN la modera.
    const paciente = await login(`paciente@${DOMINIO}`);
    const resena = await llamar(paciente, 'POST', '/portal/resenas', {
      profesionalId: prof1Id,
      calificacion: 5,
      texto: 'Reseña ficticia de demostracion: explica con claridad y escucha sin apuro.',
      mostrarComo: 'NOMBRE_INICIAL',
    });
    await llamar(admin, 'POST', `/resenas/${resena.id}/moderacion`, { publicar: true });
    await dueno.cita.create({ data: { pacienteId: camila.id, profesionalId: practicanteId, modalidad: 'ONLINE', ...horario(-3, '16:00') } });
    const parcial = await cita({ pacienteId: pacientePrueba, profesionalId: prof1Id, modalidad: 'PRESENCIAL', ...horario(4, '10:00') });
    await llamar(gestion, 'POST', `/cobros/citas/${parcial.id}/pagos`, { monto: 15000, medioPago: 'EFECTIVO' });
    await cita({ pacienteId: pacientePrueba, profesionalId: prof1Id, modalidad: 'ONLINE', ...horario(6, '12:00') });
    await cita({ pacienteId: sofia.id, profesionalId: prof2Id, modalidad: 'PRESENCIAL', ...horario(4, '15:00') });
    await cita({ pacienteId: camila.id, profesionalId: practicanteId, modalidad: 'ONLINE', ...horario(5, '17:00') });
    await cita({ pacienteId: diego.id, profesionalId: prof1Id, modalidad: 'PRESENCIAL', ...horario(7, '11:00') });

    // --- Portal del paciente (03b-3) -------------------------------------------
    // Adulto responsable con cuenta: en produccion la vincula la invitacion por correo (enlace de un solo uso);
    // aca la cuenta se crea por la API y el vinculo con el adulto lo pone el dueño (la API no lo expone).
    const madre = await crearUsuario({ email: `madre.demo@${DOMINIO}`, nombre: 'Madre Demo Responsable', rol: 'RESPONSABLE' });
    await dueno.adultoResponsable.updateMany({ where: { pacienteId: sofia.id }, data: { usuarioId: madre.id } });
    // Adolescente de 16 con cuenta restringida (D-4): sus citas, recordatorios y mensajes; su adulto responsable, el resto.
    const tomas = await llamar(prof2, 'POST', '/pacientes', {
      nombre: 'Tomas',
      apellido: 'Demo Adolescente',
      rut: rut('25555555'),
      fechaNacimiento: `${new Date().getFullYear() - 16}-04-10`,
      email: `adolescente@${DOMINIO}`,
      tipoAtencionId: infanto,
    });
    await llamar(prof2, 'POST', `/pacientes/${tomas.id}/adultos-responsables`, {
      nombre: 'Padre Demo Responsable',
      parentesco: 'Padre',
      rut: rut('16666666'),
      telefono: '+56966666666',
      email: `padre.demo@${DOMINIO}`,
    });
    await crearUsuario({ email: `adolescente@${DOMINIO}`, nombre: 'Tomas Demo Adolescente', rol: 'PACIENTE', pacienteId: tomas.id });
    await cita({ pacienteId: tomas.id, profesionalId: prof2Id, modalidad: 'ONLINE', ...horario(5, '16:00') });
    await llamar(prof1, 'PATCH', `/pacientes/${pacientePrueba}`, { contactoEmergencia: 'Contacto Demo (hermana) +56922222222' });
    // 03b-4.1: un paciente y horas para cada profesional nuevo (agenda, cobros y fichas sin vistas vacias).
    // n-esimo dia habil desde `desde` que cae en uno de los dias de la semana con horas apartadas.
    const diaCon = (diasSemana: number[], desde: number) => {
      let n = desde;
      while (!diasSemana.includes(new Date(`${diaHabil(n)}T12:00:00Z`).getUTCDay())) n++;
      return n;
    };
    for (const [p, nombre, cuerpoRut, modalidad, dias, hora, tipoAtencionId] of [
      [prof4, 'Andres', '26666666', 'ONLINE', diaCon([1, 2, 3, 4, 5], 3), '13:00', adultos],
      [prof5, 'Valentina', '27777777', 'PRESENCIAL', diaCon([1, 3, 5], 2), '10:00', infanto],
      [prof6, 'Rocio', '28888888', 'PRESENCIAL', diaCon([2, 4], 2), '09:00', adultos],
    ] as const) {
      const nuevo = await llamar(p.token, 'POST', '/pacientes', {
        nombre,
        apellido: 'Demo',
        rut: rut(cuerpoRut),
        fechaNacimiento: nombre === 'Valentina' ? `${new Date().getFullYear() - 15}-02-02` : '1991-07-07',
        email: `${nombre.toLowerCase()}.demo@${DOMINIO}`,
        tipoAtencionId,
      });
      if (nombre === 'Valentina') {
        await llamar(p.token, 'POST', `/pacientes/${nuevo.id}/adultos-responsables`, {
          nombre: 'Madre de Valentina (Demo)',
          parentesco: 'Madre',
          rut: rut('17777777'),
          telefono: '+56977777777',
          email: `madre.valentina@${DOMINIO}`,
        });
      }
      await cita({ pacienteId: nuevo.id, profesionalId: p.id, modalidad, ...horario(dias, hora) });
      // Misma semana siguiente (5 dias habiles despues: mismo dia de la semana).
      await cita({ pacienteId: nuevo.id, profesionalId: p.id, modalidad, ...horario(dias + 5, hora) });
    }

    // Paciente Prueba: mensajes a su profesional, documento emitido y copia de ficha pedida.
    await llamar(paciente, 'POST', '/portal/mensajes', {
      profesionalId: prof1Id,
      contenido: 'Mensaje demo: ¿la sesión del jueves es presencial u online? Gracias.',
    });
    const tiposDoc = (await llamar(prof1, 'GET', '/tipos-documento-clinico')) as unknown as { id: string; nombre: string }[];
    await llamar(prof1, 'POST', '/documentos-clinicos', {
      pacienteId: pacientePrueba,
      tipoDocumentoId: tiposDoc.find((d) => d.nombre.includes('Demo'))!.id,
      contenido: 'Certificado ficticio de atencion del centro de demostracion.',
    });
    await llamar(paciente, 'POST', '/portal/epicrisis', { motivo: 'Copia demo para un control con otro especialista.' });
    const madreToken = await login(`madre.demo@${DOMINIO}`);
    await llamar(madreToken, 'POST', '/portal/mensajes', {
      profesionalId: prof2Id,
      pacienteId: sofia.id,
      contenido: 'Mensaje demo de la madre: Sofía llegará 10 minutos tarde el martes.',
    });

    // --- 03b-3.1 / 03b-3.2: la hora se confirma con el pago ------------------------
    // Cuenta del centro, los tres medios (pasarela simulada: modo demostracion) y 50% para confirmar. Las citas
    // anteriores quedan CONFIRMADAS (se agendaron con solo pago en el centro); abajo, un ejemplo de cada estado.
    await llamar(admin, 'PUT', '/cobros/cuenta-centro', {
      rut: rut('76111222'),
      banco: 'Banco Ficticio (Demo)',
      tipoCuenta: 'Cuenta corriente',
      numeroCuenta: '000-111-222',
      titular: 'Centro de Prueba Vinculos SpA (Demo)',
    });
    await llamar(admin, 'PATCH', '/configuracion', {
      mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'TRANSFERENCIA', 'PASARELA'],
      plazoValidacionTransferenciaHoras: 24,
      porcentajePagoConfirmacion: 50,
    });
    // Agendada por el equipo: pendiente de pago hasta 12 h antes de la sesion (aviso al paciente; recordatorios 48 h y 24 h).
    await cita({ pacienteId: diego.id, profesionalId: prof1Id, modalidad: 'PRESENCIAL', ...horario(8, '11:00') });
    const politicaDatos = (await llamar(null, 'GET', '/publico/politicas/POLITICA_DATOS')).id;
    const terminosAgenda = (await llamar(null, 'GET', '/publico/politicas/TERMINOS_AGENDAMIENTO')).id;
    // Pedir hora sin cuenta: la reserva (cita RETENIDA, sin paciente) se crea con la funcion de la BD (sin cifrados: sin
    // telefono ni RUT) para conocer el token de la reserva; el medio y el pago pasan por la API como en el navegador.
    const pedirSinCuenta = async (nombre: string, dias: number) => {
      const reserva = randomBytes(32).toString('base64url');
      const h = horario(dias, '09:00');
      const [r] = await dueno.$queryRaw<{ cita_id: string }[]>`
        SELECT cita_id FROM crear_solicitud_hora(${randomUUID()}::uuid, ${prof1Id}::uuid, 'PRESENCIAL', ${new Date(h.inicio)},
          ${new Date(h.fin)}, ${nombre}, 'Demo Pago', '1990-05-05', ${`${nombre.toLowerCase()}.pago@${DOMINIO}`}, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL, ${politicaDatos}::uuid, ${terminosAgenda}::uuid, ${hashToken(randomBytes(32).toString('base64url'))},
          ${hashToken(reserva)})`;
      return { reserva, citaId: r.cita_id };
    };
    // Retenida: medio sin elegir (vence a los minutos_retencion_solicitud; la libera el job).
    await pedirSinCuenta('Rita', 13);
    // Pago en el centro: el gatillo es el correo (aca el enlace se emite como dueño para conocer el token).
    const centro = await pedirSinCuenta('Sara', 14);
    const correo = randomBytes(32).toString('base64url');
    await dueno.$queryRaw`
      SELECT * FROM elegir_medio_reserva(${hashToken(centro.reserva)}, 'PAGO_EN_CENTRO', ${randomUUID()}::uuid, ${hashToken(correo)})`;
    await llamar(null, 'POST', '/publico/solicitudes/verificacion', { token: correo });
    // Transferencia por validar (sin comprobante: es opcional; GESTION la valida en Cobros y ahi nace el paciente). Subir
    // el comprobante extiende el plazo hasta la validacion; aca se extiende como dueño para que el ejemplo dure.
    const transferencia = await pedirSinCuenta('Tamara', 9);
    await llamar(null, 'POST', '/publico/reservas/medio', { reserva: transferencia.reserva, medio: 'TRANSFERENCIA' });
    await dueno.cita.update({ where: { id: transferencia.citaId }, data: { pagoVenceEn: new Date(Date.now() + 24 * 3_600_000) } });
    // Pagada en linea con la pasarela simulada (webhook firmado, como en produccion): ahi nace el paciente.
    const enLinea = await pedirSinCuenta('Lina', 11);
    await llamar(null, 'POST', '/publico/reservas/medio', { reserva: enLinea.reserva, medio: 'PASARELA' });
    const cobro = await llamar(null, 'POST', '/publico/reservas/pasarela', { reserva: enLinea.reserva });
    await llamar(null, 'POST', '/publico/pasarela/simulada', { referencia: cobro.referencia, pagado: true });
    // Liberada: vencio el plazo de pago (como dueño se adelanta el plazo; el job es el que la libera).
    const vencida = await pedirSinCuenta('Victor', 12);
    await dueno.cita.update({ where: { id: vencida.citaId }, data: { pagoVenceEn: new Date(Date.now() - 60_000) } });
    await app.get(JobsService).liberarReservasVencidas();
  } finally {
    await app.close();
    await dueno.$disconnect();
  }
  // El logger de la app (pino, nivel warn) ya no esta: aviso final directo.
  process.stdout
    .write(`Centro demo cargado. Usuarios @${DOMINIO}, contraseña "${PASSWORD}"; el codigo del segundo paso llega a Mailpit (docs/pruebas/usuarios_demo.md)
`);
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
