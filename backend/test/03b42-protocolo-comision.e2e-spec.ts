/**
 * 03b-4.2: protocolo del centro (interno del equipo con "leido" y registro
 * para la direccion; de pacientes con acuse en el portal) y comision por
 * paciente traido por el centro (regla del centro: GENERAL, PORCENTAJE o
 * MONTO_FIJO por sesion; origen del paciente solo lo corrige ADMIN/GESTION).
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;
const fechaChile = (n = 0) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

describe('03b-4.2 protocolo del centro y comision por derivacion', () => {
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
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { comisionCentroPorcentaje: 0, comisionDerivacionTipo: 'GENERAL', comisionDerivacionValor: 0 },
    });
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

  it('origen del paciente: lo fija la BD (alta del profesional = propio); solo ADMIN/GESTION lo corrigen', async () => {
    const creado = await t
      .http()
      .post('/api/pacientes')
      .set(await tk(prof))
      .send({ nombre: 'Origen', apellido: 'Propio', fechaNacimiento: '1990-02-02' });
    expect(creado.status).toBe(201);
    expect(creado.body.traidoPorCentro).toBe(false);
    const origen = (u: UsuarioPrueba, traidoPorCentro: boolean) =>
      tk(u).then((h) => t.http().put(`/api/pacientes/${creado.body.id}/origen`).set(h).send({ traidoPorCentro }));
    expect((await origen(prof, true)).status).toBe(403);
    const marcado = await origen(gestion, true);
    expect(marcado.status).toBe(200);
    expect(marcado.body.traidoPorCentro).toBe(true);
  });

  it('regla de comision: solo ADMIN; porcentaje hasta 100 y monto fijo entero (422)', async () => {
    const patch = (u: UsuarioPrueba, body: object) => tk(u).then((h) => t.http().patch('/api/configuracion').set(h).send(body));
    expect((await patch(gestion, { comisionDerivacionTipo: 'MONTO_FIJO', comisionDerivacionValor: 5000 })).status).toBe(403);
    expect((await patch(admin, { comisionDerivacionTipo: 'PORCENTAJE', comisionDerivacionValor: 150 })).status).toBe(422);
    expect((await patch(admin, { comisionDerivacionTipo: 'MONTO_FIJO', comisionDerivacionValor: 1000.5 })).status).toBe(422);
    expect((await patch(admin, { comisionDerivacionTipo: 'NINGUNA' })).status).toBe(400);
  });

  it('liquidacion: el porcentaje general para pacientes propios y el monto fijo (con tope en lo cobrado) para los traidos por el centro', async () => {
    const p = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(p.id);
    await t
      .http()
      .post('/api/profesionales/yo/tarifas')
      .set(await tk(p))
      .send({ monto: 50000 });
    const propio = await t.datos.paciente(p.id);
    const delCentro = await t.datos.paciente(p.id);
    expect(
      (
        await t
          .http()
          .put(`/api/pacientes/${delCentro.id}/origen`)
          .set(await tk(gestion))
          .send({ traidoPorCentro: true })
      ).status,
    ).toBe(200);
    const pasada = (pacienteId: string, horasAtras: number) =>
      t.dueno.cita.create({
        data: {
          pacienteId,
          profesionalId: p.id,
          modalidad: 'ONLINE',
          inicio: new Date(Math.floor(Date.now() / HORA) * HORA - horasAtras * HORA),
          fin: new Date(Math.floor(Date.now() / HORA) * HORA - (horasAtras - 1) * HORA),
        },
      });
    const a = await pasada(propio.id, 3);
    const b = await pasada(delCentro.id, 5);
    const c = await pasada(delCentro.id, 7);
    const pagar = async (citaId: string, monto: number) =>
      expect(
        (
          await t
            .http()
            .post(`/api/cobros/citas/${citaId}/pagos`)
            .set(await tk(gestion))
            .send({ monto, medioPago: 'EFECTIVO' })
        ).status,
      ).toBe(201);
    await pagar(a.id, 50000);
    await pagar(b.id, 50000);
    await pagar(c.id, 3000);
    await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ comisionCentroPorcentaje: 10, comisionDerivacionTipo: 'MONTO_FIJO', comisionDerivacionValor: 5000 });

    const periodo = { profesionalId: p.id, desde: fechaChile(-1), hasta: fechaChile(1) };
    const liq = await t
      .http()
      .post('/api/cobros/liquidaciones')
      .set(await tk(gestion))
      .send(periodo);
    expect(liq.status).toBe(201);
    // Propio: 10% de 50.000 = 5.000. Del centro: 5.000 + 3.000 (tope: lo cobrado) = 8.000.
    expect(liq.body).toEqual(expect.objectContaining({ totalCobrado: 103000, comision: 13000, comisionDerivacion: 8000, sesionesDerivadas: 2, total: 90000 }));

    // Con GENERAL, el mismo periodo da el 10% de todo (como antes de la regla).
    await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ comisionDerivacionTipo: 'GENERAL' });
    const general = await t
      .http()
      .post('/api/cobros/liquidaciones')
      .set(await tk(gestion))
      .send(periodo);
    expect(general.body).toEqual(expect.objectContaining({ id: liq.body.id, comision: 10300, comisionDerivacion: 0, sesionesDerivadas: 0 }));
  });
});
