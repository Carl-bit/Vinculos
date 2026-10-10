/**
 * 02a: infraestructura de la API (auth, contexto RLS, errores, cifrado al
 * arrancar, logs, jobs, salud). Usa un modulo solo de prueba con rutas que
 * tocan las tablas del schema `prueba` (test/bd/levantar.sh).
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Body, Controller, Get, Logger, Module, Post } from '@nestjs/common';
import { IsString } from 'class-validator';

import { ErrorCifrado } from '../src/common/crypto/cifrado';
import { Roles } from '../src/core/auth/decoradores';
import { ContextoBd } from '../src/core/bd/contexto-bd.service';
import { JobsService } from '../src/core/jobs/jobs.service';
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

class EcoDto {
  @IsString() rut!: string;
  @IsString() telefono!: string;
}

@Controller('prueba')
class PruebaController {
  private readonly logger = new Logger('Prueba');
  constructor(private readonly bd: ContextoBd) {}

  /** Identidad vista por la BD dentro de la transaccion de la request. */
  @Get('contexto')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
  async contexto() {
    const [fila] = await this.bd.tx().$queryRaw<{ id: string; rol: string }[]>`
      SELECT pg_sleep(random() * 0.05)::text AS _, current_setting('app.current_usuario_id') AS id,
             current_setting('app.current_rol') AS rol`;
    return { id: fila.id, rol: fila.rol };
  }

  @Get('solo-admin')
  @Roles('ADMIN')
  soloAdmin() {
    return { ok: true };
  }

  @Get('sin-roles')
  sinRoles() {
    return { ok: true };
  }

  @Post('choque')
  @Roles('ADMIN')
  async choque() {
    const tx = this.bd.tx();
    await tx.$executeRaw`INSERT INTO prueba.rangos (r) VALUES (tstzrange('2030-01-01 10:00Z', '2030-01-01 11:00Z'))`;
    await tx.$executeRaw`INSERT INTO prueba.rangos (r) VALUES (tstzrange('2030-01-01 10:30Z', '2030-01-01 11:30Z'))`;
    return { ok: true };
  }

  @Post('commit')
  @Roles('ADMIN')
  async commit() {
    await this.bd.tx().$executeRaw`INSERT INTO prueba.commit_diferido (valor) VALUES (1)`;
    return { ok: true };
  }

  @Post('eco')
  @Roles('ADMIN')
  eco(@Body() dto: EcoDto) {
    this.logger.log({ msg: 'eco recibido', datos: dto });
    return { ok: true };
  }
}

@Module({ controllers: [PruebaController] })
class PruebaModule {}

describe('02a infraestructura', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let profesional: UsuarioPrueba;

  beforeAll(async () => {
    t = await crearApp({}, [PruebaModule]);
    admin = await t.datos.usuario('ADMIN');
    profesional = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(() => t.cerrar());

  describe('login', () => {
    it('valido: 200 con access y refresh token', async () => {
      const r = await t.http().post('/api/auth/login').send({ email: admin.email, password: 'clave-de-prueba-123' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual(expect.objectContaining({ rol: 'ADMIN', expiraEn: 900 }));
      expect(typeof r.body.accessToken).toBe('string');
      expect(typeof r.body.refreshToken).toBe('string');
    });

    it('contraseña invalida o email inexistente: 401 con el mismo mensaje', async () => {
      const mala = await t.http().post('/api/auth/login').send({ email: admin.email, password: 'otra' });
      const nadie = await t.http().post('/api/auth/login').send({ email: 'nadie@test.cl', password: 'otra' });
      expect(mala.status).toBe(401);
      expect(nadie.status).toBe(401);
      expect(mala.body.mensaje).toBe(nadie.body.mensaje);
    });

    it('cuenta inactiva: 401', async () => {
      const inactivo = await t.datos.usuario('PROFESIONAL', { activo: false });
      const r = await t.http().post('/api/auth/login').send({ email: inactivo.email, password: 'clave-de-prueba-123' });
      expect(r.status).toBe(401);
    });

    it('practicante expirado: 401; vigente: 200', async () => {
      const expirado = await t.datos.usuario('PRACTICANTE', { expira: new Date(Date.now() - 60_000) });
      const vigente = await t.datos.usuario('PRACTICANTE');
      const r1 = await t.http().post('/api/auth/login').send({ email: expirado.email, password: 'clave-de-prueba-123' });
      const r2 = await t.http().post('/api/auth/login').send({ email: vigente.email, password: 'clave-de-prueba-123' });
      expect(r1.status).toBe(401);
      expect(r2.status).toBe(200);
    });

    it('DTO: email invalido o campo extra -> 400', async () => {
      expect((await t.http().post('/api/auth/login').send({ email: 'x', password: 'y' })).status).toBe(400);
      expect((await t.http().post('/api/auth/login').send({ email: admin.email, password: 'y', rol: 'ADMIN' })).status).toBe(400);
    });
  });

  describe('refresh token', () => {
    it('rota; reusar el anterior revoca la familia', async () => {
      const login = await t.http().post('/api/auth/login').send({ email: profesional.email, password: 'clave-de-prueba-123' });
      const r1 = await t.http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
      expect(r1.status).toBe(200);
      expect(r1.body.refreshToken).not.toBe(login.body.refreshToken);
      // Reuso del token ya rotado: 401 y la familia queda revocada.
      expect((await t.http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
      expect((await t.http().post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
    });

    it('logout revoca; desactivar al usuario revoca sus sesiones (trigger)', async () => {
      const u = await t.datos.usuario('PROFESIONAL');
      const a = await t.http().post('/api/auth/login').send({ email: u.email, password: 'clave-de-prueba-123' });
      const b = await t.http().post('/api/auth/login').send({ email: u.email, password: 'clave-de-prueba-123' });
      expect((await t.http().post('/api/auth/logout').send({ refreshToken: a.body.refreshToken })).status).toBe(204);
      expect((await t.http().post('/api/auth/refresh').send({ refreshToken: a.body.refreshToken })).status).toBe(401);
      await t.dueno.usuario.update({ where: { id: u.id }, data: { activo: false } });
      expect((await t.http().post('/api/auth/refresh').send({ refreshToken: b.body.refreshToken })).status).toBe(401);
      // El access token aun no vence, pero acceso_vigente() lo deja fuera.
      expect((await t.http().get('/api/prueba/contexto').set(auth(b.body.accessToken))).status).toBe(401);
    });
  });

  describe('autorizacion', () => {
    it('sin token: 401; token alterado: 401', async () => {
      expect((await t.http().get('/api/prueba/contexto')).status).toBe(401);
      const token = await t.token(admin);
      expect((await t.http().get('/api/prueba/contexto').set(auth(token + 'x'))).status).toBe(401);
    });

    it('rol incorrecto: 403; ruta sin @Roles: 403 para todos', async () => {
      expect((await t.http().get('/api/prueba/solo-admin').set(auth(await t.token(profesional)))).status).toBe(403);
      expect((await t.http().get('/api/prueba/solo-admin').set(auth(await t.token(admin)))).status).toBe(200);
      expect((await t.http().get('/api/prueba/sin-roles').set(auth(await t.token(admin)))).status).toBe(403);
    });

    it('contexto aislado entre requests concurrentes', async () => {
      const usuarios: UsuarioPrueba[] = [admin, profesional, await t.datos.usuarioPaciente(profesional.id)];
      const tokens = await Promise.all(usuarios.map((u) => t.token(u)));
      const respuestas = await Promise.all(
        Array.from({ length: 30 }, (_v, i) => {
          const k = i % usuarios.length;
          return t.http().get('/api/prueba/contexto').set(auth(tokens[k])).then((r) => ({ r, u: usuarios[k] }));
        }),
      );
      for (const { r, u } of respuestas) {
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ id: u.id, rol: u.rol });
      }
    });
  });

  describe('errores de la BD', () => {
    it('23P01 (EXCLUDE) -> 409 sin mensaje de Postgres', async () => {
      const r = await t.http().post('/api/prueba/choque').set(auth(await t.token(admin)));
      expect(r.status).toBe(409);
      expect(r.body.sqlstate).toBe('23P01');
      expect(r.body.restriccion).toBe('prueba_rangos_sin_solape');
      expect(JSON.stringify(r.body)).not.toMatch(/conflicting key|exclusion constraint|tstzrange/);
      // La transaccion completa se revirtio.
      expect(await t.dueno.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM prueba.rangos`).toEqual([{ n: 0n }]);
    });

    it('error al COMMIT (trigger diferido 23514) -> 422', async () => {
      const r = await t.http().post('/api/prueba/commit').set(auth(await t.token(admin)));
      expect(r.status).toBe(422);
      expect(r.body.sqlstate).toBe('23514');
      expect(JSON.stringify(r.body)).not.toMatch(/Regla diferida de prueba/);
      expect(await t.dueno.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM prueba.commit_diferido`).toEqual([{ n: 0n }]);
    });
  });

  describe('logs', () => {
    it('sin campos sensibles ni credenciales; con request id', async () => {
      const token = await t.token(admin);
      t.logs.length = 0;
      const r = await t
        .http()
        .post('/api/prueba/eco?rut=11111111-1')
        .set(auth(token))
        .set('X-Request-Id', '7f1d9c2e-1111-4a5b-8c6d-0123456789ab')
        .send({ rut: '11.111.111-1', telefono: '+56911112222' });
      expect(r.status).toBe(201);
      await t.http().post('/api/auth/login').send({ email: admin.email, password: 'clave-de-prueba-123' });
      await t.http().post('/api/prueba/choque').set(auth(token));
      const todo = t.logs.join('\n');
      expect(todo).toContain('7f1d9c2e-1111-4a5b-8c6d-0123456789ab');
      expect(todo).toContain('[redactado]');
      for (const sensible of ['11.111.111-1', '11111111-1', '+56911112222', 'clave-de-prueba-123', token, 'conflicting key']) {
        expect(todo).not.toContain(sensible);
      }
    });
  });

  describe('jobs', () => {
    it('con el lock tomado por otra instancia no corre; libre si', async () => {
      const jobs = t.app.get(JobsService);
      await t.dueno.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('vinculos:job:procesar_bajas'))`;
        expect(await jobs.procesarBajas()).toEqual({ corrio: false });
      });
      expect(await jobs.procesarBajas()).toEqual(expect.objectContaining({ corrio: true }));
    });

    it('dos corridas simultaneas: solo una corre', async () => {
      const jobs = t.app.get(JobsService);
      const r = await Promise.all([jobs.expirarOfertas(), jobs.expirarOfertas(), jobs.expirarOfertas()]);
      expect(r.filter((x) => x.corrio).length).toBeGreaterThanOrEqual(1);
      expect(r.length).toBe(3);
    });

    it('verificacion de canarios registra VERIFICACION', async () => {
      const jobs = t.app.get(JobsService);
      expect(await jobs.verificarCanarios()).toEqual({ corrio: true, total: 1 });
      const [ultimo] = await t.dueno.eventoLlaves.findMany({ where: { actor: 'api' }, orderBy: { ocurridoEn: 'desc' }, take: 1 });
      expect(ultimo.tipo).toBe('VERIFICACION');
    });
  });

  describe('salud', () => {
    it('GET /salud: 200 con BD y canarios OK, sin datos', async () => {
      const r = await t.http().get('/api/salud');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ estado: 'ok', bd: true, canarios: true });
    });
  });
});

describe('02a la API no arranca sin llaves validas', () => {
  const kekFalsa = () => {
    const dir = mkdtempSync(join(tmpdir(), 'kek-'));
    writeFileSync(join(dir, 'kek'), randomBytes(32));
    return join(dir, 'kek');
  };

  it('KEK con huella incorrecta', async () => {
    await expect(crearApp({ KEK_PATH: kekFalsa() })).rejects.toThrow(ErrorCifrado);
  });

  it('KEK inexistente o de largo invalido', async () => {
    await expect(crearApp({ KEK_PATH: join(tmpdir(), 'no-existe-kek') })).rejects.toThrow(ErrorCifrado);
    const corta = join(mkdtempSync(join(tmpdir(), 'kek-')), 'kek');
    writeFileSync(corta, randomBytes(16));
    await expect(crearApp({ KEK_PATH: corta })).rejects.toThrow(ErrorCifrado);
  });

  it('rate limit de login por IP -> 429 con Retry-After', async () => {
    const limitada = await crearApp({ LOGIN_LIMITE_POR_MINUTO: '2' });
    try {
      const intento = () => limitada.http().post('/api/auth/login').send({ email: 'nadie@test.cl', password: 'x' });
      expect([(await intento()).status, (await intento()).status]).toEqual([401, 401]);
      const bloqueado = await intento();
      expect(bloqueado.status).toBe(429);
      expect(bloqueado.headers['retry-after']).toBeDefined();
    } finally {
      await limitada.cerrar();
    }
  });

  it('variable obligatoria ausente', async () => {
    await expect(crearApp({ JWT_SECRET: 'corto' })).rejects.toThrow(/JWT_SECRET/);
  });

  it('canario alterado (y registra FALLO_CANARIO)', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { leerEntorno } = await import('./bd/global');
    const dueno = new PrismaClient({ datasourceUrl: leerEntorno().ownerUrl });
    const [llave] = await dueno.llaveDatos.findMany({ where: { categoria: 'CLINICO', activa: true } });
    // llaves_datos es inmutable incluso para el dueño: solo en esta BD de
    // prueba se apaga el trigger para simular un canario alterado.
    await dueno.$executeRawUnsafe('ALTER TABLE llaves_datos DISABLE TRIGGER llaves_datos_protegidas');
    try {
      const alterado = Buffer.from(llave.canario);
      alterado[alterado.length - 1] ^= 0xff;
      await dueno.llaveDatos.update({ where: { id: llave.id }, data: { canario: alterado } });
      await expect(crearApp()).rejects.toThrow(/Canario invalido/);
      const [ultimo] = await dueno.eventoLlaves.findMany({ where: { actor: 'api' }, orderBy: { ocurridoEn: 'desc' }, take: 1 });
      expect(ultimo.tipo).toBe('FALLO_CANARIO');
    } finally {
      await dueno.llaveDatos.update({ where: { id: llave.id }, data: { canario: llave.canario } });
      await dueno.$executeRawUnsafe('ALTER TABLE llaves_datos ENABLE TRIGGER llaves_datos_protegidas');
      await dueno.$disconnect();
    }
  });
});
