/**
 * Generador de un centro de demostracion a medida (Vinculos Control, demos
 * desde la consola): N cuentas madre, N profesionales y N pacientes, con
 * perfiles publicos validados, boxes, disponibilidad, horas pasadas (cerradas
 * con evoluciones ficticias) y futuras. Va compilado en la imagen comun
 * (dist/demo/generador-demo.js) para que corra en un silo aprovisionado por
 * el plano de control, igual que en uno de prueba.
 *
 * Solo en un silo marcado como demo (identidad_silo.es_demo, que pone el dueno
 * con ES_DEMO=true): en un silo real se niega, aunque la imagen sea la misma.
 * Idempotente: si la primera cuenta madre del demo ya existe, no hace nada.
 *
 * Corre en el servicio backend del silo (trae la KEK y la configuracion), con
 * la URL de dueno agregada para lo que la API no permite por diseno (primera
 * cuenta, catalogos, contrato aceptado y horas pasadas):
 *   docker compose ... run --rm --no-deps \
 *     -e MIGRATION_DATABASE_URL=... -e SEED_PASSWORD=... \
 *     -e DEMO_CUENTAS_MADRE=1 -e DEMO_PROFESIONALES=4 -e DEMO_PACIENTES=40 \
 *     backend node dist/demo/generador-demo.js
 * Todo pasa por la API real (RLS, cifrado, reglas de la BD). Datos ficticios
 * evidentes. La contrasena la pone quien lo llama y nunca se imprime: la
 * salida es una linea DEMO_RESULTADO {json} con correos, roles y conteos.
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';
import { type Correo, ProveedorCorreo } from '../core/notificaciones/correo';
import { dvRut } from '../core/validacion/validadores';

type Cuerpo = Record<string, unknown>;
const logger = new Logger('GeneradorDemo');
const DIA = 86_400_000;
const ZONA = 'America/Santiago';
const PDF = Buffer.from('%PDF-1.4\n% Respaldo de titulo de demostracion\n%%EOF\n');
const NOMBRES = [
  'Camila',
  'Diego',
  'Sofia',
  'Tomas',
  'Valentina',
  'Matias',
  'Isidora',
  'Benjamin',
  'Antonia',
  'Vicente',
  'Florencia',
  'Joaquin',
  'Martina',
  'Agustin',
  'Josefa',
  'Lucas',
];
const APELLIDOS = ['Rojas', 'Munoz', 'Soto', 'Contreras', 'Silva', 'Martinez', 'Sepulveda', 'Morales', 'Rodriguez', 'Lopez', 'Fuentes', 'Hernandez'];
const ESPECIALIDADES = ['Psicologia clinica adultos', 'Psicologia infanto-juvenil', 'Terapia de pareja y familia', 'Psicologia clinica adultos'];
const ENFOQUES = [
  ['Cognitivo-conductual', 'Ansiedad', 'Estrés'],
  ['Sistémico', 'Familia', 'Conducta'],
  ['Humanista', 'Duelo', 'Ánimo'],
  ['Psicodinámico', 'Autoestima', 'Trabajo'],
];
const NOTAS = [
  ['Evaluacion inicial', 'Motivo de consulta y acuerdos del proceso'],
  ['Seguimiento', 'Revision de lo trabajado desde la sesion anterior'],
  ['Avance', 'Se observan cambios en lo acordado'],
];

/** Linea para quien lo llama (el ejecutor la lee): correos, roles y conteos; nunca la contrasena. */
const resultado = (datos: unknown) =>
  process.stdout.write(`DEMO_RESULTADO ${JSON.stringify(datos)}
`);
const rut = (cuerpo: number) => `${cuerpo}-${dvRut(String(cuerpo))}`;
const entero = (v: string | undefined, min: number, max: number, nombre: string) => {
  const n = Number(v ?? '');
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nombre} debe ser un entero entre ${min} y ${max}`);
  return n;
};

/** Fecha (AAAA-MM-DD) de Chile a n dias habiles de hoy (negativo = pasado). */
function diaHabil(n: number): string {
  const paso = n < 0 ? -1 : 1;
  let d = new Date();
  let restantes = Math.abs(n);
  while (restantes > 0) {
    d = new Date(d.getTime() + paso * DIA);
    const dow = new Date(d.toLocaleDateString('sv-SE', { timeZone: ZONA })).getUTCDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  return d.toLocaleDateString('sv-SE', { timeZone: ZONA });
}

/** Instante de una hora de Chile (HH:MM) en una fecha, con el offset vigente ese dia. */
function enChile(fecha: string, hora: string): Date {
  const aprox = new Date(`${fecha}T${hora}:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, timeZoneName: 'longOffset' })
    .formatToParts(aprox)
    .find((p) => p.type === 'timeZoneName')!
    .value.replace('GMT', '');
  return new Date(`${fecha}T${hora}:00${offset || '+00:00'}`);
}
const diaSemana = (fecha: string) => new Date(`${fecha}T12:00:00Z`).getUTCDay();

async function main(): Promise<void> {
  const madres = entero(process.env.DEMO_CUENTAS_MADRE ?? '1', 1, 3, 'DEMO_CUENTAS_MADRE');
  const nProf = entero(process.env.DEMO_PROFESIONALES ?? '4', 1, 20, 'DEMO_PROFESIONALES');
  const nPac = entero(process.env.DEMO_PACIENTES ?? '40', 0, 300, 'DEMO_PACIENTES');
  const password = process.env.SEED_PASSWORD ?? '';
  if (password.length < 12) throw new Error('SEED_PASSWORD es obligatoria (12 caracteres o mas)');
  const dominio = (process.env.DEMO_DOMINIO_CORREO ?? 'demo.vinculos.cl').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(dominio)) throw new Error('DEMO_DOMINIO_CORREO invalido');
  const nombreCentro = (process.env.DEMO_NOMBRE_CENTRO ?? 'Centro de demostracion').slice(0, 80);
  const urlDueno = process.env.MIGRATION_DATABASE_URL;
  if (!urlDueno) throw new Error('MIGRATION_DATABASE_URL es obligatoria (dueno del silo)');

  const dueno = new PrismaClient({ datasourceUrl: urlDueno });
  const cuentas: { email: string; rol: string }[] = [];
  const correo1 = `direccion1@${dominio}`;
  try {
    const [id] = await dueno.$queryRaw<{ slug: string; es_demo: boolean }[]>`SELECT slug, es_demo FROM identidad_silo`;
    if (!id?.es_demo) throw new Error(`El silo ${id?.slug ?? '?'} no esta marcado como demo (identidad_silo.es_demo): no se generan datos`);
    if (await dueno.usuario.findUnique({ where: { email: correo1 } })) {
      const ya = await dueno.usuario.findMany({
        where: { email: { endsWith: `@${dominio}` }, activo: true },
        select: { email: true, rol: true },
        orderBy: { email: 'asc' },
      });
      resultado({ yaCargado: true, cuentas: ya.map((u) => ({ email: u.email, rol: u.rol })) });
      return;
    }

    // --- Como dueno: lo que la API no permite por diseno --------------------------
    const hash = await bcrypt.hash(password, 10);
    const direccion1 = await dueno.usuario.create({
      data: { id: randomUUID(), email: correo1, nombre: 'Direccion 1 (Demo)', rol: 'ADMIN', passwordHash: hash },
    });
    cuentas.push({ email: correo1, rol: 'ADMIN' });
    for (const nombre of ['Psicoterapia individual adultos', 'Psicoterapia infanto-juvenil', 'Evaluacion psicologica', 'Terapia de pareja']) {
      await dueno.tipoAtencion.upsert({ where: { nombre }, update: {}, create: { nombre } });
    }
    for (const nombre of ['Individual', 'Evaluacion inicial', 'Familiar']) {
      await dueno.tipoSesion.upsert({
        where: { nombre },
        update: {},
        create: { nombre, estado: 'APROBADO', propuestoPorId: direccion1.id, revisadoPorId: direccion1.id, revisadoEn: new Date() },
      });
    }
    for (const nombre of ['Psicoeducacion', 'Reestructuracion cognitiva', 'Entrevista motivacional']) {
      await dueno.intervencion.upsert({ where: { nombre }, update: {}, create: { nombre } });
    }
    for (const nombre of ['Inicio', 'En proceso', 'Mantencion', 'Alta']) {
      await dueno.estadoAvance.upsert({ where: { nombre }, update: {}, create: { nombre } });
    }
    // Contrato con Vinculos aceptado (como en el seed demo): el aviso no tapa el panel de la demostracion.
    for (const tipo of ['TERMINOS_SERVICIO', 'DPA'] as const) {
      const politica =
        (await dueno.politica.findFirst({ where: { tipo }, orderBy: { version: 'desc' } })) ??
        (await dueno.politica.create({ data: { tipo, version: 0, texto: `Documento de demostracion (${tipo}). Sin valor contractual.` } }));
      await dueno.aceptacionContrato.create({ data: { politicaId: politica.id, usuarioId: direccion1.id } });
    }
    const tipoSesion = await dueno.tipoSesion.findFirstOrThrow({ where: { estado: 'APROBADO' }, orderBy: { nombre: 'asc' } });

    // --- Por la API real -----------------------------------------------------------
    Object.assign(process.env, { JOBS_HABILITADOS: 'false', LOGIN_LIMITE_POR_MINUTO: '1000', LOG_LEVEL: 'warn' });
    delete process.env.MIGRATION_DATABASE_URL;
    const app = await NestFactory.create<NestExpressApplication>(AppModule.crear(), { logger: ['warn', 'error'] });
    configurarApp(app);
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    // Los codigos de verificacion se capturan aqui y no salen; ningun otro correo se envia.
    const codigos = new Map<string, string>();
    const proveedor = app.get(ProveedorCorreo);
    proveedor.enviar = async (c: Correo) => {
      const codigo = /(\d{6})/.exec(c.texto)?.[1];
      if (c.asunto.startsWith('Tu código de verificación') && codigo) codigos.set(c.para, codigo);
    };

    const vigente = new Map<string, string>();
    const credencial = new Map<string, { email: string; rol?: string }>();
    const llamar = async (
      token: string | null,
      metodo: string,
      ruta: string,
      cuerpo?: Cuerpo | FormData,
      reintento = true,
    ): Promise<Cuerpo & { id: string }> => {
      const multipart = cuerpo instanceof FormData;
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { ...(multipart ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${vigente.get(token) ?? token}` } : {}) },
        body: multipart ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
      const texto = await r.text();
      const c = token ? credencial.get(token) : undefined;
      if (r.status === 401 && c && reintento) {
        vigente.set(token!, await entrar(c.email, c.rol));
        return llamar(token, metodo, ruta, cuerpo, false);
      }
      // Sin datos del cuerpo en el error: solo metodo, ruta y estado.
      if (!r.ok) throw new Error(`${metodo} ${ruta.replace(/[0-9a-f-]{36}/g, ':id')} -> ${r.status}`);
      return (texto ? JSON.parse(texto) : {}) as Cuerpo & { id: string };
    };
    const entrar = async (email: string, rol?: string): Promise<string> => {
      const r = await llamar(null, 'POST', '/auth/login', { email, password });
      const t = r.requiereSegundoFactor ? await llamar(null, 'POST', '/auth/segundo-factor', { desafio: r.desafio, codigo: codigos.get(email) }) : r;
      return (rol ? await llamar(null, 'POST', '/auth/cambio-rol', { refreshToken: t.refreshToken, rol }) : t).accessToken as string;
    };
    const login = async (email: string) => {
      const token = await entrar(email);
      credencial.set(token, { email });
      return token;
    };

    try {
      const admin = await login(correo1);
      const activos = ((await llamar(admin, 'GET', '/modulos')).activos as string[]) ?? [];
      const con = (m: string) => activos.includes(m);
      await llamar(admin, 'PATCH', '/configuracion', {
        nombreCentro,
        plazoAvisoCancelacionHoras: 24,
        recordatorioHorasAntes: 48,
        ...(madres > 1 ? { maxCuentasMadre: madres } : {}),
      });
      await llamar(admin, 'PUT', '/configuracion/horario', {
        bloques: [...[1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, inicioMin: 8 * 60, finMin: 21 * 60 })), { diaSemana: 6, inicioMin: 9 * 60, finMin: 14 * 60 }],
      });
      const crearUsuario = (cuerpo: Cuerpo) => llamar(admin, 'POST', '/usuarios', { password, ...cuerpo });
      for (let i = 2; i <= madres; i++) {
        await crearUsuario({ email: `direccion${i}@${dominio}`, nombre: `Direccion ${i} (Demo)`, rol: 'ADMIN' });
        cuentas.push({ email: `direccion${i}@${dominio}`, rol: 'ADMIN' });
      }

      const tipos = (await llamar(admin, 'GET', '/tipos-atencion')) as unknown as { id: string; nombre: string }[];
      const tipo = (nombre: string) => tipos.find((t) => t.nombre === nombre)!.id;
      const adultos = tipo('Psicoterapia individual adultos');
      const extras = [tipo('Psicoterapia infanto-juvenil'), tipo('Terapia de pareja'), tipo('Evaluacion psicologica')];

      // Fechas habiles de 3 semanas atras a 3 adelante: bloques de box y horas.
      const fechas = [...new Set(Array.from({ length: 31 }, (_v, i) => diaHabil(i - 15)))].filter((f) => diaSemana(f) >= 1 && diaSemana(f) <= 5);
      const profesionales: { id: string; token: string; box: string | null }[] = [];
      for (let i = 1; i <= nProf; i++) {
        const email = `profesional${i}@${dominio}`;
        const id = (await crearUsuario({ email, nombre: `Profesional ${i} (Demo)`, rol: 'PROFESIONAL' })).id;
        cuentas.push({ email, rol: 'PROFESIONAL' });
        const token = await login(email);
        for (const tipoAtencionId of [adultos, extras[i % extras.length]]) {
          await llamar(token, 'POST', '/profesionales/yo/tipos-atencion', { tipoAtencionId });
          await llamar(admin, 'PATCH', `/profesionales/${id}/tipos-atencion/${tipoAtencionId}`, { estado: 'APROBADO' });
        }
        await llamar(token, 'POST', '/profesionales/yo/tarifas', { monto: 30000 + (i % 4) * 5000 });
        await llamar(token, 'PUT', '/profesionales/yo/perfil', {
          especialidad: ESPECIALIDADES[i % ESPECIALIDADES.length],
          modalidad: 'MIXTA',
          nombrePublico: `Ps. Profesional ${i} (Demo)`,
          bio: 'Perfil ficticio del centro de demostracion.',
          enfoques: ENFOQUES[i % ENFOQUES.length],
          perfilPublico: true,
        });
        await llamar(token, 'PUT', '/profesionales/yo/videollamada', { modo: 'ENLACE_PROPIO', enlace: `https://meet.jit.si/vinculos-demo-${id.slice(0, 8)}` });
        // Validacion para el sitio publico: registro SIS y titulo verificados por la cuenta madre.
        await llamar(token, 'PUT', '/profesionales/yo/registro-sis', { numero: String(200000 + i) });
        await llamar(admin, 'POST', `/profesionales/${id}/registro-sis/verificacion-manual`, {
          coincide: true,
          tituloHabilitante: 'Psicólogo(a) (Demo)',
          institucion: 'Universidad Ficticia',
        });
        const titulo = await llamar(token, 'POST', '/trayectoria', {
          tipo: 'TITULO',
          titulo: 'Psicologo(a) (Demo)',
          institucion: 'Universidad Ficticia',
          anio: 2010 + (i % 12),
        });
        const respaldo = new FormData();
        respaldo.append('archivo', new Blob([PDF], { type: 'application/pdf' }), `respaldo-${i}.pdf`);
        await llamar(token, 'POST', `/trayectoria/${titulo.id}/respaldos`, respaldo);
        await llamar(admin, 'POST', `/trayectoria/${titulo.id}/verificacion`, { verificado: true });

        let box: string | null = null;
        if (con('AGENDA')) {
          for (let d = 1; d <= 5; d++) {
            for (const modalidad of ['PRESENCIAL', 'ONLINE']) {
              await llamar(admin, 'POST', `/profesionales/${id}/disponibilidad`, { diaSemana: d, inicioMin: 9 * 60, finMin: 19 * 60, modalidad });
            }
          }
          box = (await llamar(admin, 'POST', '/espacios', { nombre: `Box ${i} (Demo)` })).id;
          await llamar(admin, 'PUT', `/espacios/${box}/horario`, {
            bloques: [1, 2, 3, 4, 5].map((d) => ({ diaSemana: d, inicioMin: 9 * 60, finMin: 19 * 60 })),
          });
          await llamar(token, 'POST', `/profesionales/${id}/bloques`, {
            bloques: fechas.map((f) => ({ espacioId: box, inicio: enChile(f, '09:00').toISOString(), fin: enChile(f, '19:00').toISOString() })),
          });
        }
        profesionales.push({ id, token, box });
      }

      // Pacientes repartidos entre los profesionales; los tres primeros con cuenta en el portal.
      let horas = 0;
      let evoluciones = 0;
      const porProfesional = new Map<string, number>();
      for (let j = 0; j < nPac; j++) {
        const p = profesionales[j % profesionales.length];
        const k = porProfesional.get(p.id) ?? 0;
        porProfesional.set(p.id, k + 1);
        const nombre = NOMBRES[j % NOMBRES.length];
        const apellido = `${APELLIDOS[(j * 5) % APELLIDOS.length]} Demo`;
        const nuevo = await llamar(p.token, 'POST', '/pacientes', {
          nombre,
          apellido,
          rut: rut(30_000_000 + j),
          fechaNacimiento: `${1965 + ((j * 3) % 40)}-0${(j % 9) + 1}-1${j % 9}`,
          telefono: `+569${70_000_000 + j}`,
          tipoAtencionId: adultos,
        });
        if (j < 3) {
          const email = `paciente${j + 1}@${dominio}`;
          await crearUsuario({ email, nombre: `${nombre} ${apellido}`, rol: 'PACIENTE', pacienteId: nuevo.id });
          cuentas.push({ email, rol: 'PACIENTE' });
        }
        if (!con('AGENDA')) continue;
        // Una hora semanal fija: dia y hora segun su lugar en la carga del profesional (hasta 50 por profesional).
        const dia = 1 + (k % 5);
        const hora = 9 + Math.floor(k / 5);
        if (hora > 18) continue;
        const online = k % 3 === 0 || !p.box;
        for (const fecha of fechas.filter((f) => diaSemana(f) === dia)) {
          const inicio = enChile(fecha, `${String(hora).padStart(2, '0')}:00`);
          const cita = await dueno.cita
            .create({
              data: {
                pacienteId: nuevo.id,
                profesionalId: p.id,
                modalidad: online ? 'ONLINE' : 'PRESENCIAL',
                espacioId: online ? null : p.box,
                inicio,
                fin: new Date(inicio.getTime() + 50 * 60_000),
              },
              select: { id: true, fin: true },
            })
            .catch(() => null); // La BD manda (EXCLUDE con pausa, disponibilidad): esa semana no se agenda.
          if (!cita) continue;
          horas++;
          // Las pasadas quedan cerradas con una evolucion ficticia, salvo la mas reciente de cada tanto ("por cerrar").
          if (con('FICHAS') && cita.fin.getTime() < Date.now() - 2 * DIA && (j + horas) % 5 !== 0) {
            const [t, texto] = NOTAS[horas % NOTAS.length];
            await llamar(p.token, 'POST', `/fichas/${String(nuevo.fichaId)}/evoluciones`, {
              notas: `# ${t}\n\n${texto} (texto ficticio).`,
              tipoSesionId: tipoSesion.id,
              nivelRiesgo: 'NINGUNO',
              citaId: cita.id,
            });
            evoluciones++;
          }
        }
      }
      const conteos = {
        cuentasMadre: madres,
        profesionales: nProf,
        pacientes: nPac,
        cuentasPortal: Math.min(3, nPac),
        horas,
        evoluciones,
      };
      resultado({ yaCargado: false, cuentas, conteos });
      logger.log(`Demo generado: ${JSON.stringify(conteos)}`);
    } finally {
      await app.close();
    }
  } finally {
    await dueno.$disconnect();
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
