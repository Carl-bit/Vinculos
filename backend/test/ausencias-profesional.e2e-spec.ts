/**
 * Punto 9 y 24 (2026-11-11): ausencias del profesional. El bloqueo reprograma
 * las citas del rango; el equipo avisa en lote; el paciente cancela o pide
 * atencion temporal (aparece en por reasignar). Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;

describe('Ausencias del profesional', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId?: string };
  let otro: UsuarioPrueba;
  let citaId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    admin = await t.datos.usuario('ADMIN');
    prof = await t.datos.usuario('PROFESIONAL');
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: prof.id });
    await t.datos.disponibleSiempre(prof.id);
    paciente = await t.datos.usuarioPaciente(prof.id);
    otro = await t.datos.usuarioPaciente((await t.datos.usuario('PROFESIONAL')).id);
  });

  afterAll(() => t.cerrar());

  it('el bloqueo reprograma la cita del rango y el equipo avisa en lote (el practicante no)', async () => {
    const inicio = new Date(Math.ceil((Date.now() + 30 * 24 * HORA) / HORA) * HORA);
    const cita = await t
      .http()
      .post('/api/citas')
      .set(await tk(admin))
      .send({ pacienteId: paciente.pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA) });
    expect(cita.status).toBe(201);
    citaId = cita.body.id;
    const bloqueo = await t
      .http()
      .post(`/api/profesionales/${prof.id}/bloqueos`)
      .set(await tk(admin))
      .send({ motivo: 'LICENCIA', inicio: new Date(inicio.getTime() - 2 * HORA), fin: new Date(inicio.getTime() + 4 * HORA) });
    expect(bloqueo.status).toBe(201);
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: citaId } })).estado).toBe('POR_REPROGRAMAR');

    expect(
      (
        await t
          .http()
          .post('/api/citas/por-reprogramar/aviso')
          .set(await tk(practicante))
          .send({ citas: [citaId] })
      ).status,
    ).toBe(403);
    const aviso = await t
      .http()
      .post('/api/citas/por-reprogramar/aviso')
      .set(await tk(admin))
      .send({ citas: [citaId] });
    expect(aviso.status).toBe(200);
    expect(aviso.body.avisadas).toBe(1);
  });

  it('el paciente pide atencion temporal (queda por reasignar) y cancela; otro paciente no', async () => {
    const ruta = `/api/portal/citas/${citaId}/ausencia`;
    expect(
      (
        await t
          .http()
          .post(ruta)
          .set(await tk(otro))
          .send({ opcion: 'CANCELAR' })
      ).status,
    ).toBe(404);
    expect(
      (
        await t
          .http()
          .post(ruta)
          .set(await tk(paciente))
          .send({ opcion: 'OTRA' })
      ).status,
    ).toBe(400);
    const temporal = await t
      .http()
      .post(ruta)
      .set(await tk(paciente))
      .send({ opcion: 'ATENCION_TEMPORAL' });
    expect(temporal.status).toBe(200);
    const lista = await t
      .http()
      .get('/api/bajas/por-reasignar')
      .set(await tk(admin));
    expect(lista.body).toEqual(expect.arrayContaining([expect.objectContaining({ paciente_id: paciente.pacienteId, motivo: 'ATENCION_TEMPORAL' })]));
    const cancelar = await t
      .http()
      .post(ruta)
      .set(await tk(paciente))
      .send({ opcion: 'CANCELAR' });
    expect(cancelar.status).toBe(200);
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: citaId } })).estado).toBe('CANCELADA');
    expect(
      (
        await t
          .http()
          .post(ruta)
          .set(await tk(paciente))
          .send({ opcion: 'CANCELAR' })
      ).status,
    ).toBe(409);
  });

  it('vuelta al principal: el paciente ve si esta disponible y pide volver; la cuenta madre lo deja ("se queda")', async () => {
    // El bloqueo de la prueba anterior es futuro: hoy el principal esta disponible.
    const r = await t
      .http()
      .get('/api/portal/retorno')
      .set(await tk(paciente));
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expect.objectContaining({ profesionalPrincipalId: prof.id, principalDisponible: true, pideVolver: false }));
    expect(
      (
        await t
          .http()
          .post('/api/portal/retorno')
          .set(await tk(paciente))
          .send({})
      ).status,
    ).toBe(204);
    const equipo = await t
      .http()
      .get(`/api/pacientes/${paciente.pacienteId}/retorno`)
      .set(await tk(prof));
    expect(equipo.body).toEqual(expect.objectContaining({ pideVolver: true }));
    expect(
      (
        await t
          .http()
          .get('/api/derivaciones/retornos')
          .set(await tk(prof))
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post(`/api/derivaciones/retornos/${paciente.pacienteId}/mantener`)
          .set(await tk(admin))
      ).status,
    ).toBe(204);
    const despues = await t
      .http()
      .get('/api/portal/retorno')
      .set(await tk(paciente));
    // Sin atencion temporal abierta la API responde null (cuerpo vacio).
    expect(despues.body.principalDisponible).toBeUndefined();
  });

  it('tratante desactivado: el portal lo sabe, pide otro profesional y cancela sus horas; disponible no cancela en bloque', async () => {
    const estado = () => tk(paciente).then((h) => t.http().get('/api/portal/estado-tratante').set(h));
    const antes = await estado();
    expect(antes.status).toBe(200);
    expect(antes.body).toEqual(expect.objectContaining({ tratanteId: prof.id, disponible: true }));
    expect(
      (
        await t
          .http()
          .post('/api/portal/horas-tratante/cancelacion')
          .set(await tk(paciente))
          .send({})
      ).status,
    ).toBe(422);
    await t.dueno.usuario.update({ where: { id: prof.id }, data: { activo: false } });
    expect((await estado()).body.disponible).toBe(false);
    expect(
      (
        await t
          .http()
          .post('/api/portal/otro-profesional')
          .set(await tk(paciente))
          .send({})
      ).status,
    ).toBe(204);
    expect((await estado()).body.solicitudPendiente).toBe(true);
    const cancelar = await t
      .http()
      .post('/api/portal/horas-tratante/cancelacion')
      .set(await tk(paciente))
      .send({});
    expect(cancelar.status).toBe(200);
    expect(typeof cancelar.body.canceladas).toBe('number');
    expect(
      (
        await t
          .http()
          .get('/api/portal/estado-tratante')
          .set(await tk(admin))
      ).status,
    ).toBe(403);
  });
});
