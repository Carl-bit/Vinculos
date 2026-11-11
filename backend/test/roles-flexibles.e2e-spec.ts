/**
 * Correcciones 2026-11-11 (punto 4): la cuenta madre agrega o quita roles
 * adicionales a una cuenta del equipo (cuenta madre, gestion o profesional).
 * El practicante sigue exclusivo; nadie se quita un rol a si mismo. Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Roles flexibles del equipo', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let gestionAntes: boolean;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const roles = (id: string) => `/api/usuarios/${id}/roles`;
  const retiro = (id: string) => `/api/usuarios/${id}/roles/retiro`;
  const activos = (body: { rolesAdicionales: { rol: string; activo: boolean }[] }) => body.rolesAdicionales.filter((r) => r.activo).map((r) => r.rol);

  beforeAll(async () => {
    t = await crearApp();
    gestionAntes = (await t.dueno.configuracionCentro.findUniqueOrThrow({ where: { id: true } })).rolGestionHabilitado;
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    practicante = await t.datos.usuario('PRACTICANTE');
  });

  afterAll(async () => {
    try {
      await t.dueno.rolAdicional.updateMany({
        where: { usuarioId: profesional.id, activo: true },
        data: { activo: false, desactivadoEn: new Date() },
      });
      // Con usuarios GESTION activos la BD no deja apagar el rol (configuracion_centro_gestion_activos): se deja encendido.
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: gestionAntes } }).catch(() => undefined);
    } finally {
      await t.cerrar();
    }
  });

  it('la cuenta madre suma gestion y cuenta madre a un profesional; gestion y el propio profesional no (403)', async () => {
    for (const u of [gestion, profesional]) {
      expect(
        (
          await t
            .http()
            .post(roles(profesional.id))
            .set(await tk(u))
            .send({ rol: 'GESTION' })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await t
          .http()
          .post(roles(profesional.id))
          .set(await tk(admin))
          .send({ rol: 'PACIENTE' })
      ).status,
    ).toBe(400);
    const g = await t
      .http()
      .post(roles(profesional.id))
      .set(await tk(admin))
      .send({ rol: 'GESTION' });
    expect(g.status).toBe(201);
    expect(activos(g.body)).toContain('GESTION');
    const a = await t
      .http()
      .post(roles(profesional.id))
      .set(await tk(admin))
      .send({ rol: 'ADMIN' });
    expect(a.status).toBe(201);
    expect(activos(a.body)).toEqual(expect.arrayContaining(['GESTION', 'ADMIN']));
    // El principal no se suma como adicional; el practicante es exclusivo.
    expect(
      (
        await t
          .http()
          .post(roles(profesional.id))
          .set(await tk(admin))
          .send({ rol: 'PROFESIONAL' })
      ).status,
    ).toBe(422);
    expect(
      (
        await t
          .http()
          .post(roles(practicante.id))
          .set(await tk(admin))
          .send({ rol: 'GESTION' })
      ).status,
    ).toBe(422);
  });

  it('quitar gestion o cuenta madre es inmediato; el profesional va con fecha (422); el propio no (422)', async () => {
    expect(
      (
        await t
          .http()
          .post(retiro(profesional.id))
          .set(await tk(gestion))
          .send({ rol: 'GESTION' })
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post(retiro(profesional.id))
          .set(await tk(admin))
          .send({ rol: 'PROFESIONAL' })
      ).status,
    ).toBe(400);
    expect(
      (
        await t
          .http()
          .post(retiro(admin.id))
          .set(await tk(admin))
          .send({ rol: 'ADMIN' })
      ).status,
    ).toBe(422);
    const r = await t
      .http()
      .post(retiro(profesional.id))
      .set(await tk(admin))
      .send({ rol: 'GESTION' });
    expect(r.status).toBe(200);
    expect(activos(r.body)).not.toContain('GESTION');
    expect(
      (
        await t
          .http()
          .post(retiro(profesional.id))
          .set(await tk(admin))
          .send({ rol: 'GESTION' })
      ).status,
    ).toBe(404);
  });

  it('el maximo de cuentas madre es regla del centro: con el cupo lleno no se suma otra (422); no se baja bajo las activas (422)', async () => {
    const usadas = await t.dueno.$queryRaw<{ n: number }[]>`SELECT cuentas_madre_activas() AS n`;
    const n = usadas[0].n;
    try {
      const c = await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ maxCuentasMadre: n });
      expect(c.status).toBe(200);
      expect(c.body.maxCuentasMadre).toBe(n);
      const r = await t
        .http()
        .post(roles(gestion.id))
        .set(await tk(admin))
        .send({ rol: 'ADMIN' });
      expect(r.status).toBe(422);
      expect(r.body.restriccion).toBe('usuarios_maximo_cuentas_madre');
      if (n > 1) {
        expect(
          (
            await t
              .http()
              .patch('/api/configuracion')
              .set(await tk(admin))
              .send({ maxCuentasMadre: n - 1 })
          ).status,
        ).toBe(422);
      }
    } finally {
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { maxCuentasMadre: null } });
    }
  });
});
