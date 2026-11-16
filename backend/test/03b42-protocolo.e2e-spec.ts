/**
 * 03b-4.2: protocolo del centro (interno del equipo con "leido" y registro
 * para la direccion; de pacientes con acuse en el portal).
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('03b-4.2 protocolo del centro', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(async () => {
    await t.cerrar();
  });

  it('protocolo interno: el equipo lo lee y lo marca (idempotente); la direccion ve quien; el paciente y el sitio publico no lo ven; una version nueva vuelve a quedar pendiente', async () => {
    const h = await tk(prof);
    const antes = await t.http().get('/api/protocolo').set(h);
    expect(antes.status).toBe(200);
    expect(antes.body.vigente).toEqual(expect.objectContaining({ version: expect.any(Number), texto: expect.any(String) }));
    expect(antes.body.leidoEn).toBeNull();

    const leido = await t.http().post('/api/protocolo/lectura').set(h);
    expect(leido.status).toBe(201);
    const otraVez = await t.http().post('/api/protocolo/lectura').set(h);
    expect(otraVez.body.leidoEn).toBe(leido.body.leidoEn);
    expect((await t.http().get('/api/protocolo').set(h)).body.leidoEn).toBe(leido.body.leidoEn);

    expect((await t.http().get('/api/protocolo/lecturas').set(h)).status).toBe(403);
    const lecturas = await t
      .http()
      .get('/api/protocolo/lecturas')
      .set(await tk(gestion));
    expect(lecturas.body).toContainEqual(expect.objectContaining({ usuarioId: prof.id, rol: 'PROFESIONAL' }));

    const paciente = await t.datos.usuarioPaciente(prof.id);
    expect(
      (
        await t
          .http()
          .get('/api/protocolo')
          .set(await tk(paciente))
      ).status,
    ).toBe(403);
    expect((await t.http().get('/api/publico/politicas/PROTOCOLO_EQUIPO')).status).toBe(404);
    expect((await t.http().get('/api/publico/politicas/PROTOCOLO_PACIENTE')).status).toBe(200);

    // Solo ADMIN publica; la version nueva deja la lectura pendiente.
    const nueva = { tipo: 'PROTOCOLO_EQUIPO', texto: 'Protocolo interno, version de prueba con un texto suficientemente largo.' };
    expect((await t.http().post('/api/politicas').set(h).send(nueva)).status).toBe(403);
    expect(
      (
        await t
          .http()
          .post('/api/politicas')
          .set(await tk(admin))
          .send(nueva)
      ).status,
    ).toBe(201);
    const despues = await t.http().get('/api/protocolo').set(h);
    expect(despues.body.vigente.version).toBe(antes.body.vigente.version + 1);
    expect(despues.body.leidoEn).toBeNull();
  });

  it('protocolo de pacientes: el paciente adulto lo acusa en el portal; el tratante lo ve en las aceptaciones', async () => {
    const paciente = await t.datos.usuarioPaciente(prof.id);
    const h = await tk(paciente);
    const estado = await t.http().get('/api/portal/protocolo').set(h);
    expect(estado.status).toBe(200);
    expect(estado.body.vigente).toEqual(expect.objectContaining({ version: expect.any(Number) }));
    expect(estado.body.aceptada).toBeNull();
    expect((await t.http().post('/api/portal/protocolo').set(h).send({})).status).toBe(201);
    expect((await t.http().get('/api/portal/protocolo').set(h)).body.aceptada).toEqual(
      expect.objectContaining({ version: estado.body.vigente.version, canal: 'PORTAL' }),
    );
    const aceptaciones = await t
      .http()
      .get(`/api/pacientes/${paciente.pacienteId}/aceptaciones`)
      .set(await tk(prof));
    expect(aceptaciones.body.some((a: { politica: { tipo: string } }) => a.politica.tipo === 'PROTOCOLO_PACIENTE')).toBe(true);
  });
});
