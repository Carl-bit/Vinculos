/**
 * Configuracion (2026-11-05): centro cerrado sin dias de atencion.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Horario cerrado', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    admin = await t.datos.usuario('ADMIN');
  });

  afterAll(async () => {
    await t.datos.centroAbierto();
    await t.cerrar();
  });

  it('sin dias de atencion el centro esta cerrado: no se aparta box (422) y no hay horas libres', async () => {
    const p = await t.datos.usuario('PROFESIONAL');
    const box = await t.datos.espacio();
    await t.dueno.horarioCentro.deleteMany({});
    const manana = new Date(Date.now() + 2 * 86_400_000);
    manana.setUTCHours(14, 0, 0, 0);
    const bloque = await t
      .http()
      .post(`/api/profesionales/${p.id}/bloques`)
      .set(await tk(admin))
      .send({ bloques: [{ espacioId: box.id, inicio: manana.toISOString(), fin: new Date(manana.getTime() + 3_600_000).toISOString() }] });
    expect(bloque.status).toBe(422);
    expect(bloque.body.mensaje).toMatch(/horario de atención del centro/);
    await t.datos.centroAbierto();
  });
});
