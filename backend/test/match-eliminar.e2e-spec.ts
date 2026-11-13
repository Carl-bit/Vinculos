/**
 * Puntos 27/28 (2026-11-11): la pregunta propia se crea con sus opciones y se
 * elimina; las del sistema no; una opcion se elimina salvo la ultima. Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Match: crear con opciones y eliminar', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(() => t.cerrar());

  it('crea la pregunta con sus opciones; elimina opciones (no la ultima) y la pregunta propia; las del sistema no', async () => {
    const p = await t
      .http()
      .post('/api/match/preguntas')
      .set(await tk(admin))
      .send({
        clave: `centro_t${Date.now()}`,
        texto: '¿Prefieres sesiones en la mañana?',
        tipo: 'UNICA',
        orden: 99,
        opciones: [
          { valor: 'si', etiqueta: 'Sí', orden: 1 },
          { valor: 'no', etiqueta: 'No', orden: 2 },
        ],
      });
    expect(p.status).toBe(201);
    expect(p.body.opciones.map((o: { etiqueta: string }) => o.etiqueta)).toEqual(['Sí', 'No']);
    const [si, no] = p.body.opciones as { id: string }[];
    // El editor limpia campos con null (sin criterio, sin descripcion).
    const limpia = await t
      .http()
      .patch(`/api/match/opciones/${no.id}`)
      .set(await tk(admin))
      .send({ criterio: 'MODALIDAD', objetivo: 'ONLINE', nota: 'x' });
    expect(limpia.status).toBe(200);
    const sinCriterio = await t
      .http()
      .patch(`/api/match/opciones/${no.id}`)
      .set(await tk(admin))
      .send({ criterio: null, objetivo: null, nota: null });
    expect(sinCriterio.status).toBe(200);
    expect([sinCriterio.body.criterio, sinCriterio.body.objetivo, sinCriterio.body.nota]).toEqual([null, null, null]);
    expect(
      (
        await t
          .http()
          .delete(`/api/match/opciones/${si.id}`)
          .set(await tk(gestion))
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .delete(`/api/match/opciones/${si.id}`)
          .set(await tk(admin))
      ).status,
    ).toBe(204);
    expect(
      (
        await t
          .http()
          .delete(`/api/match/opciones/${no.id}`)
          .set(await tk(admin))
      ).status,
    ).toBe(422);
    const sistema = await t.dueno.matchPregunta.findFirst({ where: { propiaCentro: false }, select: { id: true } });
    if (sistema) {
      expect(
        (
          await t
            .http()
            .delete(`/api/match/preguntas/${sistema.id}`)
            .set(await tk(admin))
        ).status,
      ).toBe(422);
    }
    expect(
      (
        await t
          .http()
          .delete(`/api/match/preguntas/${p.body.id}`)
          .set(await tk(admin))
      ).status,
    ).toBe(204);
    expect(await t.dueno.matchPregunta.count({ where: { id: p.body.id } })).toBe(0);
  });
});
