/**
 * Tarea 31 / R2-R3 (Vinculos Control, 2026-11-13): el ADMIN pide un modulo en
 * Configuracion > Modulos; el plano de control lo lee y responde por
 * /api/internal/* solo con el token del silo. Por rol y por token.
 */
import type { ModuloCentro } from '@prisma/client';

import { auth, crearApp, TOKEN_INTERNO, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Solicitudes de modulos (tarea 31) y /api/internal (R2, R3)', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let modulosAntes: ModuloCentro[];
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const interno = (token = TOKEN_INTERNO) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await crearApp();
    admin = await t.datos.usuario('ADMIN');
    profesional = await t.datos.usuario('PROFESIONAL');
    const [c] = await t.dueno.$queryRaw<[{ m: ModuloCentro[] }]>`SELECT modulos_activos::text[] AS m FROM configuracion_centro`;
    modulosAntes = c.m;
    await t.dueno.$executeRaw`UPDATE configuracion_centro SET modulos_activos = ARRAY['FICHAS','AGENDA','EQUIPO']::modulo_centro[]`;
    await t.dueno.$executeRaw`DELETE FROM solicitudes_modulo`;
  });

  afterAll(async () => {
    await t.dueno.$executeRaw`DELETE FROM solicitudes_modulo`;
    await t.dueno.$executeRaw`UPDATE configuracion_centro SET modulos_activos = ${modulosAntes}::modulo_centro[]`;
    await t.cerrar();
  });

  it('solo ADMIN pide y lista; reglas de la BD como 422 y 409', async () => {
    expect(
      (
        await t
          .http()
          .get('/api/configuracion/solicitudes-modulo')
          .set(await tk(profesional))
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post('/api/configuracion/solicitudes-modulo')
          .set(await tk(profesional))
          .send({ modulo: 'MATCH', accion: 'ACTIVAR' })
      ).status,
    ).toBe(403);

    const yaActivo = await t
      .http()
      .post('/api/configuracion/solicitudes-modulo')
      .set(await tk(admin))
      .send({ modulo: 'AGENDA', accion: 'ACTIVAR' });
    expect(yaActivo.status).toBe(422);
    const whatsapp = await t
      .http()
      .post('/api/configuracion/solicitudes-modulo')
      .set(await tk(admin))
      .send({ modulo: 'WHATSAPP', accion: 'ACTIVAR' });
    expect(whatsapp.status).toBe(422);
    // Mensaje propio de la regla (core/errores/sqlstate.ts), no el generico.
    expect(whatsapp.body.mensaje).toMatch(/no está disponible/);
    expect(yaActivo.body.mensaje).toMatch(/ya está en ese estado/);

    const ok = await t
      .http()
      .post('/api/configuracion/solicitudes-modulo')
      .set(await tk(admin))
      .send({ modulo: 'MATCH', accion: 'ACTIVAR', motivo: 'Queremos ofrecer el match en el sitio' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ modulo: 'MATCH', accion: 'ACTIVAR', estado: 'PENDIENTE', respuesta: null });

    const otra = await t
      .http()
      .post('/api/configuracion/solicitudes-modulo')
      .set(await tk(admin))
      .send({ modulo: 'MATCH', accion: 'ACTIVAR' });
    expect(otra.status).toBe(409);
    expect(otra.body.mensaje).toMatch(/solicitud abierta/);

    const lista = await t
      .http()
      .get('/api/configuracion/solicitudes-modulo')
      .set(await tk(admin));
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
  });

  it('R2/R3: sin token o con otro token 401; nunca con el JWT de una cuenta; sale sin motivo ni quien la pidio', async () => {
    expect((await t.http().get('/api/internal/solicitudes')).status).toBe(401);
    expect((await t.http().get('/api/internal/solicitudes').set(interno('otro-token-que-no-es-el-del-silo-0123456789'))).status).toBe(401);
    expect(
      (
        await t
          .http()
          .get('/api/internal/solicitudes')
          .set(await tk(admin))
      ).status,
    ).toBe(401);

    const r2 = await t.http().get('/api/internal/solicitudes').set(interno());
    expect(r2.status).toBe(200);
    expect(r2.body.solicitudes).toHaveLength(1);
    const [s] = r2.body.solicitudes as Record<string, unknown>[];
    expect(s).toMatchObject({ modulo: 'MATCH', accion: 'ACTIVAR', pedidaPorRol: 'ADMIN', estado: 'PENDIENTE' });
    expect(Object.keys(s).sort()).toEqual(['accion', 'actualizadaEn', 'estado', 'id', 'modulo', 'pedidaEn', 'pedidaPorRol', 'respondidaEn']);

    const futuro = await t
      .http()
      .get('/api/internal/solicitudes')
      .query({ desde: new Date(Date.now() + 60_000).toISOString() })
      .set(interno());
    expect(futuro.body.solicitudes).toHaveLength(0);

    const sinPermiso = await t
      .http()
      .post(`/api/internal/solicitudes/${String(s.id)}/respuesta`)
      .set(interno('otro-token-que-no-es-el-del-silo-0123456789'))
      .send({ estado: 'APROBADA' });
    expect(sinPermiso.status).toBe(401);
    const saltoInvalido = await t
      .http()
      .post(`/api/internal/solicitudes/${String(s.id)}/respuesta`)
      .set(interno())
      .send({ estado: 'APLICADA' });
    expect(saltoInvalido.status).toBe(422);
    const aprobada = await t
      .http()
      .post(`/api/internal/solicitudes/${String(s.id)}/respuesta`)
      .set(interno())
      .send({ estado: 'APROBADA', respuesta: 'Se activa esta semana' });
    expect(aprobada.status).toBe(201);
    expect(aprobada.body).toEqual({ estado: 'APROBADA' });
    // Reintento del agente: mismo estado, sin error.
    expect(
      (
        await t
          .http()
          .post(`/api/internal/solicitudes/${String(s.id)}/respuesta`)
          .set(interno())
          .send({ estado: 'APROBADA' })
      ).status,
    ).toBe(201);

    const vista = await t
      .http()
      .get('/api/configuracion/solicitudes-modulo')
      .set(await tk(admin));
    expect(vista.body[0]).toMatchObject({ estado: 'APROBADA', respuesta: 'Se activa esta semana' });
  });

  it('R5 admin inicial: sin token 401; datos invalidos 400; con cuenta madre activa 409 (el camino feliz lo prueba el caso 177 de la BD)', async () => {
    await t.datos.usuario('ADMIN');
    const cuerpo = { email: 'nueva-admin@centro.cl', nombre: 'Nueva Admin' };
    expect((await t.http().post('/api/internal/admin-inicial').send(cuerpo)).status).toBe(401);
    expect((await t.http().post('/api/internal/admin-inicial').set(interno()).send({ email: 'no-es-correo', nombre: 'X' })).status).toBe(400);
    const r = await t.http().post('/api/internal/admin-inicial').set(interno()).send(cuerpo);
    expect(r.status).toBe(409);
    expect(r.body.mensaje).toMatch(/ya tiene una cuenta madre activa/);
    expect(await t.dueno.usuario.count({ where: { email: cuerpo.email } })).toBe(0);
  });

  it('R4 config interna: sin token 401; formato invalido 400; aplica, es idempotente, no vuelve atras y el guard de modulos lo ve al tiro', async () => {
    const cuerpo = {
      revision: 1,
      hash: 'c'.repeat(64),
      modulos: ['FICHAS', 'AGENDA', 'EQUIPO', 'MATCH'],
      reglas: { plazo_aviso_cancelacion_horas: 12, recordatorio_horas_antes: 24 },
    };
    expect((await t.http().post('/api/internal/config').send(cuerpo)).status).toBe(401);
    expect(
      (
        await t
          .http()
          .post('/api/internal/config')
          .set(interno())
          .send({ ...cuerpo, hash: 'x' })
      ).status,
    ).toBe(400);
    const regla = await t
      .http()
      .post('/api/internal/config')
      .set(interno())
      .send({ ...cuerpo, reglas: { nombre_centro: 'Otro' } });
    expect(regla.status).toBe(422);
    expect(regla.body.mensaje).toMatch(/regla que el silo no conoce/);

    const r1 = await t.http().post('/api/internal/config').set(interno()).send(cuerpo);
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ resultado: 'APLICADA', revision: 1, hash: 'c'.repeat(64) });
    expect((await t.http().post('/api/internal/config').set(interno()).send(cuerpo)).body.resultado).toBe('SIN_CAMBIOS');
    const leido = await t.http().get('/api/internal/config').set(interno());
    expect(leido.body).toMatchObject({ revision: 1, hash: 'c'.repeat(64) });
    expect([...leido.body.modulos].sort()).toEqual(['AGENDA', 'EQUIPO', 'FICHAS', 'MATCH']);
    // La cache del guard se olvida: la ruta de MATCH responde (sin 403 de modulo inactivo).
    const modulos = await t
      .http()
      .get('/api/modulos')
      .set(await tk(admin));
    expect(modulos.body.activos).toContain('MATCH');

    const atras = await t
      .http()
      .post('/api/internal/config')
      .set(interno())
      .send({ ...cuerpo, hash: 'd'.repeat(64) });
    expect(atras.status).toBe(409);
    expect(atras.body.mensaje).toMatch(/no es posterior/);
  });

  it('R13 exportaciones internas: sin token 401; con el JWT de una cuenta 401; solo metadatos', async () => {
    expect((await t.http().get('/api/internal/exportaciones')).status).toBe(401);
    expect(
      (
        await t
          .http()
          .get('/api/internal/exportaciones')
          .set(await tk(admin))
      ).status,
    ).toBe(401);
    const r = await t.http().get('/api/internal/exportaciones').set(interno());
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.exportaciones)).toBe(true);
    for (const e of r.body.exportaciones) {
      expect(Object.keys(e).sort()).toEqual(['bytes', 'creadaEn', 'estado', 'huella', 'id', 'terminadaEn', 'venceEn']);
    }
  });
});
