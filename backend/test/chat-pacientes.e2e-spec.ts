/**
 * Puntos 40/44 (2026-11-11): el tratante responde en la plataforma al
 * paciente; otro profesional y la cuenta madre no; el paciente lee y marca
 * leida la respuesta. Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Chat profesional <-> paciente', () => {
  let t: AppPrueba;
  let tratante: UsuarioPrueba;
  let otro: UsuarioPrueba;
  let admin: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId?: string };
  let mensajeId: string;
  let respuestaId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    tratante = await t.datos.usuario('PROFESIONAL');
    otro = await t.datos.usuario('PROFESIONAL');
    admin = await t.datos.usuario('ADMIN');
    paciente = await t.datos.usuarioPaciente(tratante.id);
  });

  afterAll(() => t.cerrar());

  it('el paciente escribe y su tratante responde; otro profesional y la cuenta madre no', async () => {
    const m = await t
      .http()
      .post('/api/portal/mensajes')
      .set(await tk(paciente))
      .send({ profesionalId: tratante.id, contenido: 'Hola, ¿puedo cambiar la hora del jueves?' });
    expect(m.status).toBe(201);
    mensajeId = m.body.id;
    const ajeno = await t
      .http()
      .post('/api/mensajes/respuesta')
      .set(await tk(otro))
      .send({ mensajeId, contenido: 'No soy su tratante' });
    expect(ajeno.status).toBe(404);
    expect(
      (
        await t
          .http()
          .post('/api/mensajes/respuesta')
          .set(await tk(admin))
          .send({ mensajeId, contenido: 'Cuenta madre' })
      ).status,
    ).toBe(403);
    const r = await t
      .http()
      .post('/api/mensajes/respuesta')
      .set(await tk(tratante))
      .send({ mensajeId, contenido: 'Sí, te propongo el viernes a las 10.' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual(expect.objectContaining({ deProfesional: true, destinatarioId: paciente.id }));
    respuestaId = r.body.id;
  });

  it('el paciente ve la respuesta y la marca leida; el tratante no la marca por el', async () => {
    const lista = await t
      .http()
      .get('/api/mensajes')
      .set(await tk(paciente));
    expect(lista.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: respuestaId, deProfesional: true, contenido: 'Sí, te propongo el viernes a las 10.' })]),
    );
    expect(
      (
        await t
          .http()
          .post(`/api/mensajes/${respuestaId}/leido`)
          .set(await tk(tratante))
      ).status,
    ).toBe(404);
    expect(
      (
        await t
          .http()
          .post(`/api/mensajes/${respuestaId}/leido`)
          .set(await tk(paciente))
      ).status,
    ).toBe(200);
    const aviso = await t.dueno.notificacion.count({ where: { referenciaId: respuestaId, tipo: 'MENSAJE_PROFESIONAL' } });
    expect(aviso).toBeGreaterThan(0);
  });
});
