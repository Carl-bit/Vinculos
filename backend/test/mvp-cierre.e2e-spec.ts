/**
 * Cierre hacia el MVP: revocar un acceso temporal, avisos del equipo por
 * correo, bloques del centro para administracion y regla C-11 de cargos. Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const rango = () => ({ desde: new Date(Date.now() - DIA).toISOString(), hasta: new Date(Date.now() + 7 * DIA).toISOString() });

describe('MVP cierre', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let tratante: UsuarioPrueba;
  let otro: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    tratante = await t.datos.usuario('PROFESIONAL');
    otro = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(async () => {
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { liquidarCargosAProfesional: false } });
    await t.cerrar();
  });

  it('revocar acceso temporal: ADMIN o el tratante; el receptor y GESTION no; deja de ver la ficha y la vista lo informa', async () => {
    const paciente = await t.datos.usuarioPaciente(tratante.id);
    const otorgado = await t
      .http()
      .post(`/api/pacientes/${paciente.pacienteId}/accesos-temporales`)
      .set(await tk(tratante))
      .send({ profesionalId: otro.id, motivo: 'INTERCONSULTA', alcance: 'LECTURA', hasta: new Date(Date.now() + DIA).toISOString() });
    expect(otorgado.status).toBe(201);
    expect(otorgado.body.revocadoEn).toBeNull();
    const ruta = `/api/accesos-temporales/${otorgado.body.id}/revocacion`;

    const recibe = await tk(otro);
    expect((await t.http().get(`/api/pacientes/${paciente.pacienteId}/ficha`).set(recibe)).status).toBe(200);
    expect((await t.http().post(ruta).set(recibe).send({ motivo: 'ERROR' })).status).toBe(404);
    expect(
      (
        await t
          .http()
          .post(ruta)
          .set(await tk(gestion))
          .send({ motivo: 'ERROR' })
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post(ruta)
          .set(await tk(tratante))
          .send({ motivo: 'INVENTADO' })
      ).status,
    ).toBe(400);

    const revocado = await t
      .http()
      .post(ruta)
      .set(await tk(tratante))
      .send({ motivo: 'TERMINO_ANTICIPADO' });
    expect(revocado.status).toBe(200);
    expect(revocado.body).toEqual(expect.objectContaining({ motivoRevocacion: 'TERMINO_ANTICIPADO', revocadoEn: expect.any(String) }));
    expect(revocado.body.revocacion).toBeUndefined();

    expect((await t.http().get(`/api/pacientes/${paciente.pacienteId}/ficha`).set(recibe)).status).toBe(404);
    const repetido = await t
      .http()
      .post(ruta)
      .set(await tk(admin))
      .send({ motivo: 'ERROR' });
    expect(repetido.status).toBe(409);
  });

  it('avisos del equipo: cada integrante los suyos; sin fila, todo activo; el paciente no entra', async () => {
    const h = await tk(tratante);
    expect((await t.http().get('/api/notificaciones/preferencias-equipo').set(h)).body).toEqual({
      agenda: true,
      cobros: true,
      derivaciones: true,
      mensajes: true,
    });
    const r = await t.http().put('/api/notificaciones/preferencias-equipo').set(h).send({ cobros: false });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ agenda: true, cobros: false, derivaciones: true, mensajes: true });
    expect((await t.http().put('/api/notificaciones/preferencias-equipo').set(h).send({ legales: false })).status).toBe(400);
    const ajeno = await t
      .http()
      .get('/api/notificaciones/preferencias-equipo')
      .set(await tk(otro));
    expect(ajeno.body.cobros).toBe(true);

    const paciente = await t.datos.usuarioPaciente(tratante.id);
    expect(
      (
        await t
          .http()
          .get('/api/notificaciones/preferencias-equipo')
          .set(await tk(paciente))
      ).status,
    ).toBe(403);
  });

  it('bloques del centro: ADMIN y GESTION; entre profesionales sigue sin quien', async () => {
    for (const [u, status] of [
      [admin, 200],
      [gestion, 200],
      [tratante, 403],
    ] as const) {
      const r = await t
        .http()
        .get('/api/espacios/bloques')
        .query(rango())
        .set(await tk(u));
      expect(r.status).toBe(status);
    }
    const ocupacion = await t
      .http()
      .get('/api/espacios/ocupacion')
      .query(rango())
      .set(await tk(tratante));
    expect(ocupacion.status).toBe(200);
    for (const o of ocupacion.body as Record<string, unknown>[]) expect(o).not.toHaveProperty('profesional_id');
  });

  it('C-11: la regla de cargos la cambia ADMIN, GESTION no; apagada por defecto', async () => {
    const cambio = { liquidarCargosAProfesional: true };
    const h = await tk(admin);
    expect((await t.http().get('/api/configuracion').set(h)).body.liquidarCargosAProfesional).toBe(false);
    expect(
      (
        await t
          .http()
          .patch('/api/configuracion')
          .set(await tk(gestion))
          .send(cambio)
      ).status,
    ).toBe(403);
    const r = await t.http().patch('/api/configuracion').set(h).send(cambio);
    expect(r.status).toBe(200);
    expect(r.body.liquidarCargosAProfesional).toBe(true);
  });
});
