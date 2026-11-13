/**
 * Punto 38 (2026-11-11): contactos de emergencia. Los agrega el paciente; el
 * tratante ve que existen y el parentesco, abre los datos solo con motivo de
 * emergencia y puede pedirle al paciente que agregue uno. ADMIN no tiene ruta.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Contactos de emergencia', () => {
  let t: AppPrueba;
  let tratante: UsuarioPrueba;
  let otro: UsuarioPrueba;
  let admin: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId?: string };
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const contacto = { nombre: 'Rosa Perez', parentesco: 'Madre', telefono: '+56911112222' };

  beforeAll(async () => {
    t = await crearApp();
    tratante = await t.datos.usuario('PROFESIONAL');
    otro = await t.datos.usuario('PROFESIONAL');
    admin = await t.datos.usuario('ADMIN');
    paciente = await t.datos.usuarioPaciente(tratante.id);
  });

  afterAll(() => t.cerrar());

  it('el paciente agrega, edita y ve sus contactos; nadie del equipo los agrega', async () => {
    const r = await t
      .http()
      .post('/api/portal/contactos-emergencia')
      .set(await tk(paciente))
      .send(contacto);
    expect(r.status).toBe(201);
    expect(r.body).toEqual([expect.objectContaining(contacto)]);
    const id = r.body[0].id as string;
    const e = await t
      .http()
      .patch(`/api/portal/contactos-emergencia/${id}`)
      .set(await tk(paciente))
      .send({ ...contacto, parentesco: 'Hermana' });
    expect(e.status).toBe(200);
    expect(e.body[0].parentesco).toBe('Hermana');
    expect(
      (
        await t
          .http()
          .post('/api/portal/contactos-emergencia')
          .set(await tk(tratante))
          .send(contacto)
      ).status,
    ).toBe(403);
  });

  it('el tratante ve existencia y parentesco; los datos solo con motivo; otro profesional y la cuenta madre no', async () => {
    const pac = paciente.pacienteId!;
    const resumen = await t
      .http()
      .get(`/api/pacientes/${pac}/contactos-emergencia`)
      .set(await tk(tratante));
    expect(resumen.status).toBe(200);
    expect(resumen.body).toEqual([{ id: expect.any(String), parentesco: 'Hermana' }]);
    const ajeno = await t
      .http()
      .get(`/api/pacientes/${pac}/contactos-emergencia`)
      .set(await tk(otro));
    expect(ajeno.body).toEqual([]);
    expect(
      (
        await t
          .http()
          .get(`/api/pacientes/${pac}/contactos-emergencia`)
          .set(await tk(admin))
      ).status,
    ).toBe(403);
    const sinMotivo = await t
      .http()
      .post(`/api/pacientes/${pac}/contactos-emergencia/emergencia`)
      .set(await tk(tratante))
      .send({ motivo: 'x' });
    expect(sinMotivo.status).toBe(400);
    const abierto = await t
      .http()
      .post(`/api/pacientes/${pac}/contactos-emergencia/emergencia`)
      .set(await tk(tratante))
      .send({ motivo: 'Crisis durante la sesion' });
    expect(abierto.status).toBe(200);
    expect(abierto.body[0]).toEqual(expect.objectContaining({ nombre: 'Rosa Perez', telefono: '+56911112222' }));
    expect(
      (
        await t
          .http()
          .post(`/api/pacientes/${pac}/contactos-emergencia/emergencia`)
          .set(await tk(otro))
          .send({ motivo: 'Crisis durante la sesion' })
      ).status,
    ).toBe(404);
    expect(await t.dueno.accesoFicha.count({ where: { pacienteId: pac, recurso: 'contactos_emergencia', accion: 'EMERGENCIA', usuarioId: tratante.id } })).toBe(
      1,
    );
  });

  it('pedir que agregue uno: solo sin contactos y una vez por semana', async () => {
    const pac = paciente.pacienteId!;
    const aviso = () => tk(tratante).then((h) => t.http().post(`/api/pacientes/${pac}/contactos-emergencia/aviso`).set(h));
    expect((await aviso()).status).toBe(422);
    const lista = await t
      .http()
      .get('/api/portal/contactos-emergencia')
      .set(await tk(paciente));
    expect(
      (
        await t
          .http()
          .delete(`/api/portal/contactos-emergencia/${lista.body[0].id}`)
          .set(await tk(paciente))
      ).status,
    ).toBe(204);
    expect((await aviso()).status).toBe(204);
    expect((await aviso()).status).toBe(422);
  });
});
