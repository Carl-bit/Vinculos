/**
 * Punto 36 (2026-11-11): perfiles de rol. ADMIN los crea, edita, asigna y
 * elimina; un perfil solo restringe modulos de su rol base (la API responde
 * 403 en esos modulos y /api/modulos los informa). Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Perfiles de rol', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let perfilId: string;
  let gestionAntes: boolean;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    gestionAntes = (await t.dueno.configuracionCentro.findUniqueOrThrow({ where: { id: true } })).rolGestionHabilitado;
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
  });

  afterAll(async () => {
    try {
      await t.dueno.usuarioPerfil.deleteMany({ where: { usuarioId: gestion.id } });
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: gestionAntes } }).catch(() => undefined);
    } finally {
      await t.cerrar();
    }
  });

  it('ADMIN crea "Recepcion" sobre Gestion (no acepta modulos fuera del MVP); GESTION no crea', async () => {
    expect(
      (
        await t
          .http()
          .post('/api/perfiles')
          .set(await tk(gestion))
          .send({ nombre: 'X', rolBase: 'GESTION', restricciones: [] })
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post('/api/perfiles')
          .set(await tk(admin))
          .send({ nombre: 'Mensajeria', rolBase: 'GESTION', restricciones: ['WHATSAPP'] })
      ).status,
    ).toBe(400);
    const p = await t
      .http()
      .post('/api/perfiles')
      .set(await tk(admin))
      .send({ nombre: `Recepcion ${Date.now()}`, descripcion: 'Agenda y recepcion', rolBase: 'GESTION', restricciones: ['AGENDA'] });
    expect(p.status).toBe(201);
    perfilId = p.body.id;
  });

  it('asignado, restringe el modulo en la API y /api/modulos lo informa; con asignados no se elimina', async () => {
    const a = await t
      .http()
      .post(`/api/perfiles/${perfilId}/asignaciones`)
      .set(await tk(admin))
      .send({ usuarioId: gestion.id });
    expect(a.status).toBe(201);
    expect(a.body.asignados).toContain(gestion.id);
    const modulos = await t
      .http()
      .get('/api/modulos')
      .set(await tk(gestion));
    expect(modulos.body.restringidos).toEqual(['AGENDA']);
    const agenda = await t
      .http()
      .get('/api/espacios')
      .set(await tk(gestion));
    expect(agenda.status).toBe(403);
    expect(agenda.body.restriccion).toBe('modulo_restringido_por_perfil');
    expect(
      (
        await t
          .http()
          .delete(`/api/perfiles/${perfilId}`)
          .set(await tk(admin))
      ).status,
    ).toBe(409);
    expect(
      (
        await t
          .http()
          .delete(`/api/perfiles/${perfilId}/asignaciones/${gestion.id}`)
          .set(await tk(admin))
      ).status,
    ).toBe(200);
    expect(
      (
        await t
          .http()
          .delete(`/api/perfiles/${perfilId}`)
          .set(await tk(admin))
      ).status,
    ).toBe(204);
  });
});
