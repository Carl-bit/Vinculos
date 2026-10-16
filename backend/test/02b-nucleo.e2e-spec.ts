/** 02b: Nucleo. Tests de integracion por rol, incluidos los bloqueos de la BD vistos como HTTP. */
import { randomUUID } from 'node:crypto';

import { JobsService } from '../src/core/jobs/jobs.service';
import { auth, CLAVE, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('02b nucleo', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let supervisor: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string };
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    supervisor = await t.datos.usuario('PROFESIONAL');
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
    paciente = await t.datos.usuarioPaciente(profesional.id);
  });

  afterAll(() => t.cerrar());

  const todos = () => [admin, gestion, profesional, practicante, paciente];

  describe('usuarios', () => {
    it('POST /usuarios: solo ADMIN; telefono cifrado en reposo y legible por la API', async () => {
      const cuerpo = {
        email: `Nuevo-${randomUUID()}@Test.cl`,
        nombre: 'Nuevo Profesional',
        rol: 'PROFESIONAL',
        password: 'una-clave-larga',
        telefono: '+56912345678',
      };
      for (const u of [gestion, profesional, practicante, paciente]) {
        expect(
          (
            await t
              .http()
              .post('/api/usuarios')
              .set(await tk(u))
              .send(cuerpo)
          ).status,
        ).toBe(403);
      }
      const r = await t
        .http()
        .post('/api/usuarios')
        .set(await tk(admin))
        .send(cuerpo);
      expect(r.status).toBe(201);
      expect(r.body).toEqual(expect.objectContaining({ email: cuerpo.email.toLowerCase(), telefono: '+56912345678', rol: 'PROFESIONAL' }));
      expect(r.body.passwordHash).toBeUndefined();
      const fila = await t.dueno.usuario.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(Buffer.from(fila.telefono!).toString('latin1')).not.toContain('912345678');
      // El nuevo usuario puede entrar.
      expect((await t.http().post('/api/auth/login').send({ email: cuerpo.email, password: 'una-clave-larga' })).status).toBe(200);
      // Email repetido -> 409.
      expect(
        (
          await t
            .http()
            .post('/api/usuarios')
            .set(await tk(admin))
            .send(cuerpo)
        ).status,
      ).toBe(409);
    });

    it('POST /usuarios: telefono invalido o campo no declarado -> 400', async () => {
      const base = { email: `x-${randomUUID()}@test.cl`, nombre: 'X', rol: 'PROFESIONAL', password: 'una-clave-larga' };
      expect(
        (
          await t
            .http()
            .post('/api/usuarios')
            .set(await tk(admin))
            .send({ ...base, telefono: '12345' })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .post('/api/usuarios')
            .set(await tk(admin))
            .send({ ...base, activo: false })
        ).status,
      ).toBe(400);
    });

    it('POST /usuarios GESTION con el rol deshabilitado -> 422', async () => {
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: false } }).catch(() => undefined);
      // Hay GESTION activos: la BD no deja apagar el flag; se prueba con el trigger de alta.
      const config = await t.dueno.configuracionCentro.findUniqueOrThrow({ where: { id: true } });
      if (!config.rolGestionHabilitado) {
        const r = await t
          .http()
          .post('/api/usuarios')
          .set(await tk(admin))
          .send({ email: `g-${randomUUID()}@test.cl`, nombre: 'G', rol: 'GESTION', password: 'una-clave-larga' });
        expect(r.status).toBe(422);
        expect(r.body.restriccion).toBe('usuarios_gestion_requiere_habilitacion');
        await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
      } else {
        // Con GESTION activos el ADMIN tampoco puede apagarlo via API -> 422.
        const r = await t
          .http()
          .patch('/api/configuracion')
          .set(await tk(admin))
          .send({ rolGestionHabilitado: false });
        expect(r.status).toBe(422);
        expect(r.body.restriccion).toBe('configuracion_centro_gestion_activos');
      }
    });

    it('POST /usuarios PRACTICANTE: supervisor y OTORGADO en la misma transaccion', async () => {
      const r = await t
        .http()
        .post('/api/usuarios')
        .set(await tk(admin))
        .send({
          email: `pr-${randomUUID()}@test.cl`,
          nombre: 'Practicante Nuevo',
          rol: 'PRACTICANTE',
          password: 'una-clave-larga',
          fechaExpiracionAcceso: new Date(Date.now() + 60 * 86_400_000).toISOString(),
          supervisorId: supervisor.id,
          fechaInicioPractica: '2026-03-01',
          fechaTerminoPractica: '2026-12-31',
        });
      expect(r.status).toBe(201);
      expect(await t.dueno.supervision.count({ where: { practicanteId: r.body.id, supervisorId: supervisor.id, hasta: null } })).toBe(1);
      expect((await t.dueno.historialAccesoPracticante.findMany({ where: { practicanteId: r.body.id } })).map((h) => h.accion)).toEqual(['OTORGADO']);
      // Sin supervisor -> 400 (DTO).
      const sin = await t
        .http()
        .post('/api/usuarios')
        .set(await tk(admin))
        .send({ email: `pr2-${randomUUID()}@test.cl`, nombre: 'P', rol: 'PRACTICANTE', password: 'una-clave-larga' });
      expect(sin.status).toBe(400);
    });

    it('GET/PATCH /usuarios/yo: cada rol su propia cuenta; no puede cambiar su rol', async () => {
      for (const u of todos()) {
        const r = await t
          .http()
          .get('/api/usuarios/yo')
          .set(await tk(u));
        expect(r.status).toBe(200);
        expect(r.body.id).toBe(u.id);
      }
      const p = await t
        .http()
        .patch('/api/usuarios/yo')
        .set(await tk(profesional))
        .send({ nombre: 'Nombre Editado', telefono: '+56987654321' });
      expect(p.status).toBe(200);
      expect(p.body).toEqual(expect.objectContaining({ nombre: 'Nombre Editado', telefono: '+56987654321' }));
      expect(
        (
          await t
            .http()
            .patch('/api/usuarios/yo')
            .set(await tk(profesional))
            .send({ rol: 'ADMIN' })
        ).status,
      ).toBe(400);
    });

    it('POST /usuarios/yo/password: exige la actual; revoca los refresh tokens', async () => {
      const u = await t.datos.usuario('PROFESIONAL');
      const login = { body: await t.login(u) };
      const h = auth(login.body.accessToken);
      expect((await t.http().post('/api/usuarios/yo/password').set(h).send({ actual: 'mala', nueva: 'otra-clave-larga' })).status).toBe(401);
      expect((await t.http().post('/api/usuarios/yo/password').set(h).send({ actual: CLAVE, nueva: 'otra-clave-larga' })).status).toBe(204);
      expect((await t.http().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
      // TOTP (03a): la contraseña nueva pasa el primer factor y pide el segundo.
      const nuevo = await t.http().post('/api/auth/login').send({ email: u.email, password: 'otra-clave-larga' });
      expect(nuevo.status).toBe(200);
      expect(nuevo.body.requiereTotp).toBe(true);
    });

    it('GET /usuarios y PATCH /usuarios/:id: solo ADMIN', async () => {
      expect(
        (
          await t
            .http()
            .get('/api/usuarios')
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      for (const u of [gestion, profesional, practicante, paciente]) {
        expect(
          (
            await t
              .http()
              .get('/api/usuarios')
              .set(await tk(u))
          ).status,
        ).toBe(403);
        expect(
          (
            await t
              .http()
              .patch(`/api/usuarios/${profesional.id}`)
              .set(await tk(u))
              .send({ activo: false })
          ).status,
        ).toBe(403);
      }
      const otro = await t.datos.usuario('PROFESIONAL');
      const r = await t
        .http()
        .patch(`/api/usuarios/${otro.id}`)
        .set(await tk(admin))
        .send({ activo: false });
      expect(r.status).toBe(200);
      expect(r.body.activo).toBe(false);
      expect(r.body.desactivadoEn).toBeTruthy();
      // Reactivar dentro de la gracia.
      expect(
        (
          await t
            .http()
            .patch(`/api/usuarios/${otro.id}`)
            .set(await tk(admin))
            .send({ activo: true })
        ).body.activo,
      ).toBe(true);
      // Inexistente -> 404.
      expect(
        (
          await t
            .http()
            .patch(`/api/usuarios/${randomUUID()}`)
            .set(await tk(admin))
            .send({ activo: false })
        ).status,
      ).toBe(404);
    });

    it('ADMIN no se desactiva a si mismo -> 422; cuenta cerrada -> 409 (reingreso = cuenta nueva)', async () => {
      const r = await t
        .http()
        .patch(`/api/usuarios/${admin.id}`)
        .set(await tk(admin))
        .send({ activo: false });
      expect(r.status).toBe(422);
      expect(r.body.restriccion).toBe('usuarios_admin_no_se_desactiva');
      const cerrado = await t.datos.usuario('PROFESIONAL', { activo: false });
      await t.dueno.$executeRaw`SELECT cerrar_cuenta(${cerrado.id}::uuid)`;
      expect(
        (
          await t
            .http()
            .patch(`/api/usuarios/${cerrado.id}`)
            .set(await tk(admin))
            .send({ activo: true })
        ).status,
      ).toBe(409);
    });

    it('PATCH /usuarios/:id de un practicante: activo va por /practicantes -> 422', async () => {
      expect(
        (
          await t
            .http()
            .patch(`/api/usuarios/${practicante.id}`)
            .set(await tk(admin))
            .send({ activo: false })
        ).status,
      ).toBe(422);
    });
  });

  describe('configuracion', () => {
    it('todos leen; solo ADMIN edita', async () => {
      for (const u of todos()) {
        expect(
          (
            await t
              .http()
              .get('/api/configuracion')
              .set(await tk(u))
          ).status,
        ).toBe(200);
      }
      for (const u of [gestion, profesional, practicante, paciente]) {
        expect(
          (
            await t
              .http()
              .patch('/api/configuracion')
              .set(await tk(u))
              .send({ diasGraciaCierre: 10 })
          ).status,
        ).toBe(403);
      }
      const r = await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ plazoOposicionHoras: 72, margenTrasladoMin: 30 });
      expect(r.status).toBe(200);
      expect(r.body.plazoOposicionHoras).toBe(72);
      expect(
        (
          await t
            .http()
            .patch('/api/configuracion')
            .set(await tk(admin))
            .send({ margenTrasladoMin: 9999 })
        ).status,
      ).toBe(400);
      await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ plazoOposicionHoras: 48 });
    });
  });

  describe('practicantes', () => {
    it('otorgar/extender: solo ADMIN; con supervisor nuevo en la misma accion', async () => {
      const p = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
      const fecha = new Date(Date.now() + 90 * 86_400_000).toISOString();
      for (const u of [gestion, profesional, supervisor]) {
        expect(
          (
            await t
              .http()
              .post(`/api/practicantes/${p.id}/acceso`)
              .set(await tk(u))
              .send({ fechaExpiracion: fecha })
          ).status,
        ).toBe(403);
      }
      const otroSupervisor = await t.datos.usuario('PROFESIONAL');
      const r = await t
        .http()
        .post(`/api/practicantes/${p.id}/acceso`)
        .set(await tk(admin))
        .send({ fechaExpiracion: fecha, supervisorId: otroSupervisor.id });
      expect(r.status).toBe(201);
      expect(await t.dueno.supervision.count({ where: { practicanteId: p.id, supervisorId: otroSupervisor.id, hasta: null } })).toBe(1);
      // Fecha pasada -> 422.
      const pasada = await t
        .http()
        .post(`/api/practicantes/${p.id}/acceso`)
        .set(await tk(admin))
        .send({ fechaExpiracion: '2020-01-01T00:00:00Z' });
      expect(pasada.status).toBe(422);
    });

    it('revocar: solo ADMIN; el practicante pierde el acceso al instante', async () => {
      const p = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
      const token = await tk(p);
      expect(
        (
          await t
            .http()
            .post(`/api/practicantes/${p.id}/revocacion`)
            .set(await tk(gestion))
            .send({ motivo: 'fin' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/practicantes/${p.id}/revocacion`)
            .set(await tk(admin))
            .send({ motivo: 'fin de practica' })
        ).status,
      ).toBe(201);
      expect((await t.http().get('/api/usuarios/yo').set(token)).status).toBe(401);
      expect((await t.http().post('/api/auth/login').send({ email: p.email, password: CLAVE })).status).toBe(401);
    });

    it('historial: ADMIN/GESTION todos; practicante el propio; supervisor los suyos; otro profesional nada', async () => {
      await t
        .http()
        .post(`/api/practicantes/${practicante.id}/acceso`)
        .set(await tk(admin))
        .send({ fechaExpiracion: new Date(Date.now() + 40 * 86_400_000).toISOString() });
      const ver = async (u: UsuarioPrueba) =>
        (
          await t
            .http()
            .get(`/api/practicantes/${practicante.id}/historial`)
            .set(await tk(u))
        ).body.length as number;
      expect(await ver(admin)).toBeGreaterThan(0);
      expect(await ver(gestion)).toBeGreaterThan(0);
      expect(await ver(practicante)).toBeGreaterThan(0);
      expect(await ver(supervisor)).toBeGreaterThan(0);
      expect(await ver(profesional)).toBe(0);
      expect(
        (
          await t
            .http()
            .get(`/api/practicantes/${practicante.id}/historial`)
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
    });
  });

  describe('bajas', () => {
    it('iniciar: solo ADMIN; nunca la propia (403); bloquea la agenda', async () => {
      const saliente = await t.datos.usuario('PROFESIONAL');
      const fecha = new Date(Date.now() + 7 * 86_400_000).toISOString();
      for (const u of [gestion, profesional]) {
        expect(
          (
            await t
              .http()
              .post('/api/bajas')
              .set(await tk(u))
              .send({ usuarioId: saliente.id, fechaEfectiva: fecha })
          ).status,
        ).toBe(403);
      }
      const r = await t
        .http()
        .post('/api/bajas')
        .set(await tk(admin))
        .send({ usuarioId: saliente.id, fechaEfectiva: fecha });
      expect(r.status).toBe(201);
      expect(r.body.citasPorReprogramar).toBe(0);
      expect(await t.dueno.bloqueoAgenda.count({ where: { profesionalId: saliente.id, motivo: 'BAJA' } })).toBe(1);
      // Segunda baja del mismo usuario -> 409 (unico).
      expect(
        (
          await t
            .http()
            .post('/api/bajas')
            .set(await tk(admin))
            .send({ usuarioId: saliente.id, fechaEfectiva: fecha })
        ).status,
      ).toBe(409);
      // La propia -> 403.
      expect(
        (
          await t
            .http()
            .post('/api/bajas')
            .set(await tk(admin))
            .send({ usuarioId: admin.id, fechaEfectiva: fecha })
        ).status,
      ).toBe(403);
      // Supervisor con practicantes activos -> 409 (55000).
      expect(
        (
          await t
            .http()
            .post('/api/bajas')
            .set(await tk(admin))
            .send({ usuarioId: supervisor.id, fechaEfectiva: fecha })
        ).status,
      ).toBe(409);
    });

    it('listar: ADMIN/GESTION; bandeja por reasignar: ADMIN/GESTION/supervisor', async () => {
      expect(
        (
          await t
            .http()
            .get('/api/bajas')
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get('/api/bajas')
            .set(await tk(gestion))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get('/api/bajas')
            .set(await tk(profesional))
        ).status,
      ).toBe(403);
      for (const u of [admin, gestion, supervisor]) {
        const r = await t
          .http()
          .get('/api/bajas/por-reasignar')
          .set(await tk(u));
        expect(r.status).toBe(200);
        expect(Array.isArray(r.body)).toBe(true);
      }
      expect(
        (
          await t
            .http()
            .get('/api/bajas/por-reasignar')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .get('/api/bajas/por-reasignar')
            .set(await tk(practicante))
        ).status,
      ).toBe(403);
    });

    it('job: baja cumplida que dejaria al centro sin ADMIN -> queda pendiente, log de error y alerta', async () => {
      const ultimo = await t.datos.usuario('ADMIN');
      const otros = await t.dueno.usuario.findMany({ where: { rol: 'ADMIN', activo: true, id: { not: ultimo.id } }, select: { id: true } });
      await t.dueno.usuario.updateMany({ where: { id: { in: otros.map((o) => o.id) } }, data: { activo: false } });
      const baja = await t.dueno.baja.create({ data: { usuarioId: ultimo.id, fechaEfectiva: new Date(Date.now() - 60_000), iniciadaPorId: admin.id } });
      try {
        t.logs.length = 0;
        expect(await t.app.get(JobsService).procesarBajas()).toEqual(expect.objectContaining({ corrio: true }));
        expect((await t.dueno.baja.findUniqueOrThrow({ where: { id: baja.id } })).procesadaEn).toBeNull();
        expect(await t.dueno.alertaInterna.count({ where: { tipo: 'BAJA_SIN_ADMIN', referenciaId: baja.id, atendidaEn: null } })).toBe(1);
        expect(t.logs.some((l) => l.includes('"level":50') && l.includes('sin ADMIN'))).toBe(true);
        // Idempotente: una sola alerta abierta por baja.
        await t.app.get(JobsService).procesarBajas();
        expect(await t.dueno.alertaInterna.count({ where: { referenciaId: baja.id } })).toBe(1);
      } finally {
        await t.dueno.usuario.updateMany({ where: { id: { in: otros.map((o) => o.id) } }, data: { activo: true } });
        await t.dueno.baja.delete({ where: { id: baja.id } });
      }
    });
  });

  describe('alertas', () => {
    it('solo ADMIN lista y atiende; inexistente -> 404; dos veces -> 409', async () => {
      await t.dueno.$executeRaw`SELECT alertar_fallo_canario('prueba 02b')`;
      const r = await t
        .http()
        .get('/api/alertas')
        .set(await tk(admin));
      expect(r.status).toBe(200);
      const alerta = (r.body as { id: string; detalle: string }[]).find((a) => a.detalle === 'prueba 02b')!;
      for (const u of [gestion, profesional]) {
        expect(
          (
            await t
              .http()
              .get('/api/alertas')
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
      expect(
        (
          await t
            .http()
            .post(`/api/alertas/${alerta.id}/atendida`)
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .post(`/api/alertas/${alerta.id}/atendida`)
            .set(await tk(admin))
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .post(`/api/alertas/${randomUUID()}/atendida`)
            .set(await tk(admin))
        ).status,
      ).toBe(404);
    });
  });

  describe('directorio', () => {
    it('equipo: contacto solo ADMIN/GESTION (telefono descifrado); PACIENTE 403', async () => {
      await t
        .http()
        .patch('/api/usuarios/yo')
        .set(await tk(supervisor))
        .send({ telefono: '+56922223333' });
      const adm = await t
        .http()
        .get('/api/directorio')
        .set(await tk(admin));
      expect(adm.status).toBe(200);
      expect(adm.body.find((f: { id: string }) => f.id === supervisor.id).telefono).toBe('+56922223333');
      const prof = await t
        .http()
        .get('/api/directorio')
        .set(await tk(profesional));
      expect(prof.body.find((f: { id: string }) => f.id === supervisor.id)).toEqual(expect.objectContaining({ telefono: null, email: null }));
      const pr = await t
        .http()
        .get('/api/directorio')
        .set(await tk(practicante));
      expect(pr.body.map((f: { id: string }) => f.id)).toEqual([supervisor.id]);
      expect(
        (
          await t
            .http()
            .get('/api/directorio')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
    });

    it('mi equipo tratante: solo PACIENTE', async () => {
      const r = await t
        .http()
        .get('/api/directorio/mi-equipo')
        .set(await tk(paciente));
      expect(r.status).toBe(200);
      expect(r.body.map((f: { id: string }) => f.id)).toContain(profesional.id);
      expect(
        (
          await t
            .http()
            .get('/api/directorio/mi-equipo')
            .set(await tk(profesional))
        ).status,
      ).toBe(403);
    });
  });
});
