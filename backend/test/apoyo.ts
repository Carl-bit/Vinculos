/**
 * Apoyo de los tests de integracion: app Nest real contra la BD efimera
 * (test/bd/levantar.sh), cliente dueño para preparar datos (BYPASSRLS, como
 * el seed) y tokens por rol via el login real.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { DynamicModule, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient, type Rol } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request = require('supertest');

import { AppModule } from '../src/app.module';
import { Llavero, type FilaLlave } from '../src/common/crypto/cifrado';
import { configurarApp } from '../src/configurar-app';
import { type Correo, ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { NotificacionesService } from '../src/core/notificaciones/notificaciones.service';
import { leerEntorno } from './bd/global';

export const CLAVE = 'clave-de-prueba-123';
const HASH = bcrypt.hashSync(CLAVE, 4);

export function prepararEntorno(extra: Record<string, string> = {}) {
  const e = leerEntorno();
  Object.assign(process.env, {
    DATABASE_URL: e.appUrl,
    JWT_SECRET: 'secreto-de-prueba-de-al-menos-32-caracteres',
    KEK_PATH: e.kek,
    RECUPERACION_PUBLICA_PATH: e.publica,
    JOBS_HABILITADOS: 'false',
    LOGIN_LIMITE_POR_MINUTO: '10000',
    PUBLICO_LIMITE_POR_MINUTO: '10000',
    LOG_LEVEL: 'info',
    FRONTEND_URL: 'http://localhost:3000',
    // Integraciones simuladas por defecto en tests (02h).
    VIDEOLLAMADA_SIMULADA: 'true',
    SMTP_URL: '',
    ...extra,
  });
  delete process.env.MIGRATION_DATABASE_URL;
  return e;
}

export interface AppPrueba {
  app: NestExpressApplication;
  http: () => ReturnType<typeof request>;
  logs: string[];
  dueno: PrismaClient;
  datos: Fixtures;
  token: (u: UsuarioPrueba) => Promise<string>;
  cerrar: () => Promise<void>;
}

export async function crearApp(extra: Record<string, string> = {}, modulosExtra: (Type | DynamicModule)[] = []): Promise<AppPrueba> {
  const e = prepararEntorno(extra);
  const logs: string[] = [];
  const ref = await Test.createTestingModule({
    imports: [AppModule.crear({ destinoLogs: { write: (l: string) => void logs.push(l) } }), ...modulosExtra],
  }).compile();
  const app = ref.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configurarApp(app);
  // Servidor ya escuchando: supertest lo reutiliza (sin abrir y cerrar uno por request).
  await app.listen(0, '127.0.0.1');
  const dueno = new PrismaClient({ datasourceUrl: e.ownerUrl });
  const http = () => request(app.getHttpServer());
  const tokens = new Map<string, string>();
  return {
    app,
    http,
    logs,
    dueno,
    datos: new Fixtures(dueno),
    token: async (u) => {
      const guardado = tokens.get(u.id);
      if (guardado) {
        return guardado;
      }
      const r = await http().post('/api/auth/login').send({ email: u.email, password: CLAVE });
      if (r.status !== 200) {
        throw new Error(`login de prueba fallo (${r.status}) para ${u.rol}`);
      }
      tokens.set(u.id, r.body.accessToken as string);
      return r.body.accessToken as string;
    },
    cerrar: async () => {
      await app.close();
      await dueno.$disconnect();
    },
  };
}

/** Llavero con la KEK de prueba, para preparar datos cifrados como dueño. */
export async function llaveroPrueba(dueno: PrismaClient): Promise<Llavero> {
  const filas = await dueno.llaveDatos.findMany();
  return Llavero.cargar(
    readFileSync(leerEntorno().kek),
    filas.map((f): FilaLlave => ({
      id: f.id,
      categoria: f.categoria,
      version: f.version,
      activa: f.activa,
      dekPorKek: Buffer.from(f.dekPorKek),
      huellaKek: f.huellaKek,
      canario: Buffer.from(f.canario),
    })),
  );
}

export interface UsuarioPrueba {
  id: string;
  email: string;
  rol: Rol;
  pacienteId?: string;
}

let contador = 0;
const unico = () => `${Date.now().toString(36)}${(contador++).toString(36)}`;

/** Datos de prueba como dueño (sin RLS). Cada test crea los suyos. */
export class Fixtures {
  constructor(private readonly dueno: PrismaClient) {}

  async usuario(
    rol: Rol,
    opciones: { activo?: boolean; expira?: Date; pacienteId?: string; supervisorId?: string; nombre?: string } = {},
  ): Promise<UsuarioPrueba> {
    const id = randomUUID();
    const email = `${rol.toLowerCase()}-${unico()}@test.cl`;
    await this.dueno.$transaction(async (tx) => {
      await tx.usuario.create({
        data: {
          id,
          email,
          passwordHash: HASH,
          nombre: opciones.nombre ?? `${rol} ${email}`,
          rol,
          fechaExpiracionAcceso: rol === 'PRACTICANTE' ? (opciones.expira ?? new Date(Date.now() + 30 * 86_400_000)) : null,
          pacienteId: opciones.pacienteId ?? null,
        },
      });
      if (rol === 'PRACTICANTE') {
        await tx.practicante.create({
          data: { usuarioId: id, fechaInicio: new Date('2026-01-01'), fechaTerminoPractica: new Date('2027-12-31') },
        });
        const supervisor = opciones.supervisorId ?? (await this.usuarioEn(tx, 'PROFESIONAL')).id;
        await tx.supervision.create({ data: { practicanteId: id, supervisorId: supervisor, desde: new Date(Date.now() - 86_400_000) } });
      }
      if (opciones.activo === false) {
        await tx.usuario.update({ where: { id }, data: { activo: false } });
      }
    });
    return { id, email, rol, pacienteId: opciones.pacienteId };
  }

  private async usuarioEn(tx: Prisma.TransactionClient, rol: Rol) {
    const id = randomUUID();
    await tx.usuario.create({ data: { id, email: `${rol.toLowerCase()}-${unico()}@test.cl`, passwordHash: HASH, nombre: 'Supervisor', rol } });
    return { id };
  }

  /** Paciente (con ficha) de un PROFESIONAL. */
  async paciente(profesionalId: string, opciones: { fechaNacimiento?: Date; nombre?: string } = {}) {
    const id = randomUUID();
    await this.dueno.paciente.create({
      data: {
        id,
        nombre: opciones.nombre ?? 'Paciente',
        apellido: unico(),
        fechaNacimiento: opciones.fechaNacimiento ?? new Date('1990-01-01'),
        profesionalId,
      },
    });
    const ficha = await this.dueno.fichaClinica.create({ data: { pacienteId: id } });
    return { id, fichaId: ficha.id };
  }

  /**
   * Paciente de un PRACTICANTE: solo existe con consentimiento ACEPTADO que
   * lo nombre (trigger diferido), asi que va en una transaccion.
   */
  async pacienteDePracticante(practicanteId: string, supervisorId: string, opciones: { fechaNacimiento?: Date } = {}) {
    const id = randomUUID();
    let fichaId = '';
    await this.dueno.$transaction(async (tx) => {
      await tx.paciente.create({
        data: { id, nombre: 'Paciente', apellido: unico(), fechaNacimiento: opciones.fechaNacimiento ?? new Date('1992-01-01'), profesionalId: practicanteId },
      });
      await tx.consentimiento.create({
        data: {
          pacienteId: id,
          tipo: 'ATENCION_CON_PRACTICANTE_SUPERVISADO',
          practicanteId,
          supervisorId,
          estado: 'ACEPTADO',
          solicitadoPorId: supervisorId,
          venceEn: new Date(Date.now() + 86_400_000),
          versionDocumento: 'v1',
          otorgadoPorTipo: 'PACIENTE',
          respondidoPorId: supervisorId,
          respondidoEn: new Date(),
        },
      });
      fichaId = (await tx.fichaClinica.create({ data: { pacienteId: id } })).id;
    });
    return { id, fichaId };
  }

  /** Usuario PACIENTE vinculado a un paciente nuevo del profesional. */
  async usuarioPaciente(profesionalId: string, opciones: { fechaNacimiento?: Date } = {}) {
    const p = await this.paciente(profesionalId, opciones);
    const u = await this.usuario('PACIENTE', { pacienteId: p.id });
    return { ...u, pacienteId: p.id, fichaId: p.fichaId };
  }

  /** Disponibilidad 24x7 en ambas modalidades (como en seguridad_bd.sql). */
  async disponibleSiempre(profesionalId: string) {
    await this.dueno.disponibilidadProfesional.createMany({
      data: [1, 2, 3, 4, 5, 6, 7].flatMap((dia) =>
        (['PRESENCIAL', 'ONLINE'] as const).map((modalidad) => ({ profesionalId, diaSemana: dia, inicioMin: 0, finMin: 1440, modalidad })),
      ),
    });
  }

  async espacio() {
    return this.dueno.espacio.create({ data: { nombre: `Box ${unico()}` } });
  }

  async tipoSesionAprobado() {
    const admin = await this.dueno.usuario.findFirstOrThrow({ where: { rol: 'ADMIN', activo: true } });
    return this.dueno.tipoSesion.create({
      data: { nombre: `Tipo ${unico()}`, estado: 'APROBADO', propuestoPorId: admin.id, revisadoPorId: admin.id, revisadoEn: new Date() },
    });
  }

  async tipoAtencion() {
    return this.dueno.tipoAtencion.create({ data: { nombre: `Atencion ${unico()}` } });
  }
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Corre el job de mensajes hasta que no queden pendientes ya vencidos (la BD
 * es compartida entre archivos de test) y devuelve los correos enviados en
 * esa corrida.
 */
export async function procesarMensajes(t: AppPrueba): Promise<Correo[]> {
  const correo = t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo);
  correo.enviados.length = 0;
  while ((await t.dueno.notificacion.count({ where: { estado: 'PENDIENTE', proximoIntento: { lte: new Date() } } })) > 0) {
    await t.app.get(NotificacionesService).enviarPendientes();
  }
  return [...correo.enviados];
}

/** Supertest: cuerpo binario (PDF, imagenes) como Buffer. */
export const binario = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const flujo = res as unknown as NodeJS.ReadableStream;
  const partes: Buffer[] = [];
  flujo.on('data', (p: Buffer) => partes.push(p));
  flujo.on('end', () => cb(null, Buffer.concat(partes)));
};

/** Texto de un PDF de generarPdfDocumento (sin compresion, fuentes estandar WinAnsi): una linea por renglon. */
export function textoPdf(pdf: Buffer): string {
  return [...pdf.toString('latin1').matchAll(/\[(.*?)\] TJ/g)]
    .map(([, arr]) => [...arr.matchAll(/<([0-9a-f]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''))
    .join('\n');
}
