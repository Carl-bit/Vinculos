/**
 * 03b-3.4: la deuda (sesion realizada con saldo) se paga en linea con los
 * medios del centro, desde la cuenta o con el enlace de pago que llega por
 * correo a quien no tiene cuenta (varios usos, solo esa cita). El profesional
 * de la cita registra el pago presencial de sus citas.
 */
import { JobsService } from '../src/core/jobs/jobs.service';
import { auth, crearApp, procesarMensajes, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;
const enlaceDe = (texto: string | undefined) => /\/pagar\?t=([A-Za-z0-9_-]+)/.exec(texto ?? '')?.[1] ?? '';

describe('03b-3.4 deuda en linea y enlace de pago', () => {
  let t: AppPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let otroProf: UsuarioPrueba;
  let pasadas = 0;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  /** Sesion ya realizada sin pago (la crea el dueño), una hora distinta cada vez. */
  const sesionImpaga = (pacienteId: string) => {
    const inicio = new Date(Math.floor((Date.now() - 2 * DIA) / HORA) * HORA - pasadas++ * HORA);
    return t.dueno.cita.create({ data: { profesionalId: prof.id, pacienteId, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA) } });
  };
  const simular = (referencia: string) => t.http().post('/api/publico/pasarela/simulada').send({ referencia, pagado: true });

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: {
        rolGestionHabilitado: true,
        morosidadDesde: new Date(Date.now() - 30 * DIA),
        mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'PASARELA'],
        porcentajePagoConfirmacion: 100,
      },
    });
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
    otroProf = await t.datos.usuario('PROFESIONAL');
    await t
      .http()
      .post('/api/profesionales/yo/tarifas')
      .set(await tk(prof))
      .send({ monto: 30000 });
    await t.datos.disponibleSiempre(prof.id);
  });

  afterAll(async () => {
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { morosidadDesde: new Date(), mediosPagoHabilitados: ['PAGO_EN_CENTRO'], porcentajePagoConfirmacion: 100 },
    });
    await t.cerrar();
  });

  it('con cuenta: la sesion realizada con saldo se paga en linea desde el portal; otro paciente no la ve', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    const otro = await t.datos.usuarioPaciente(prof.id);
    const cita = await sesionImpaga(p.pacienteId);
    const estado = (u: UsuarioPrueba) => tk(u).then((h) => t.http().get(`/api/portal/citas/${cita.id}/pago`).set(h));
    expect((await estado(p)).body).toEqual(
      expect.objectContaining({ estado: 'SALDO_PENDIENTE', siguiente: 'ELEGIR_MEDIO', medios: ['PASARELA'], monto: 30000, venceEn: null }),
    );
    expect((await estado(otro)).status).toBe(404);
    const enCentro = await t
      .http()
      .post(`/api/portal/citas/${cita.id}/medio`)
      .set(await tk(p))
      .send({ medio: 'PAGO_EN_CENTRO' });
    expect([enCentro.status, enCentro.body.restriccion]).toEqual([422, 'citas_medio_no_habilitado']);
    expect(
      (
        await t
          .http()
          .post(`/api/portal/citas/${cita.id}/medio`)
          .set(await tk(p))
          .send({ medio: 'PASARELA' })
      ).body.siguiente,
    ).toBe('PAGAR_EN_LINEA');
    const cobro = await t
      .http()
      .post(`/api/portal/citas/${cita.id}/pasarela`)
      .set(await tk(p));
    expect(cobro.status).toBe(200);
    expect((await simular(cobro.body.referencia)).body).toEqual({ estado: 'PAGADO' });
    expect((await estado(p)).body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', siguiente: 'NINGUNO' }));
    const deudas = await t
      .http()
      .get('/api/cobros/deudas')
      .set(await tk(gestion));
    expect(deudas.body.some((d: { paciente_id: string }) => d.paciente_id === p.pacienteId)).toBe(false);
  });

  it('sin cuenta: el correo de deuda trae el enlace de pago (varios usos) y se paga sin iniciar sesion; con cuenta, el portal', async () => {
    const sinCuenta = await t.datos.paciente(prof.id);
    await t.dueno.paciente.update({ where: { id: sinCuenta.id }, data: { email: 'sin-cuenta-03b34@test.cl' } });
    const cita = await sesionImpaga(sinCuenta.id);
    const conCuenta = await t.datos.usuarioPaciente(prof.id);
    await sesionImpaga(conCuenta.pacienteId);
    await procesarMensajes(t);
    await t.app.get(JobsService).avisarDeudas();
    const enviados = await procesarMensajes(t);
    const correo = enviados.find((c) => c.para === 'sin-cuenta-03b34@test.cl');
    const enlace = enlaceDe(correo?.texto);
    expect(correo?.asunto).toBe('Sesión con pago pendiente');
    expect(correo?.texto).toContain('Puede pagarlo en línea');
    expect(enlace).not.toBe('');
    const correoCuenta = enviados.find((c) => c.para === conCuenta.email);
    expect(enlaceDe(correoCuenta?.texto)).toBe('');
    expect(correoCuenta?.texto).toContain('/portal');

    const resumen = await t.http().post('/api/publico/pagos/resumen').send({ enlace });
    expect(resumen.status).toBe(200);
    expect(resumen.body).toEqual(expect.objectContaining({ modalidad: 'ONLINE', inicio: cita.inicio.toISOString() }));
    expect(Object.keys(resumen.body).sort()).toEqual(['fin', 'inicio', 'modalidad', 'profesional']);
    const estado = () => t.http().post('/api/publico/pagos/estado').send({ enlace });
    expect((await estado()).body).toEqual(expect.objectContaining({ estado: 'SALDO_PENDIENTE', monto: 30000 }));
    expect((await t.http().post('/api/publico/pagos/medio').send({ enlace, medio: 'PASARELA' })).body.siguiente).toBe('PAGAR_EN_LINEA');
    const cobro = await t.http().post('/api/publico/pagos/pasarela').send({ enlace });
    expect(cobro.status).toBe(200);
    await simular(cobro.body.referencia);
    expect((await estado()).body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', siguiente: 'NINGUNO' }));
    expect(await t.dueno.pago.count({ where: { citaId: cita.id, medioPago: 'PASARELA' } })).toBe(1);
    expect(
      (
        await t
          .http()
          .post('/api/publico/pagos/estado')
          .send({ enlace: 'x'.repeat(43) })
      ).status,
    ).toBe(404);
  });

  it('pago presencial: el profesional de la cita lo registra (cobro del centro); otro profesional no', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    const cita = await sesionImpaga(p.pacienteId);
    const pagar = async (u: UsuarioPrueba) =>
      t
        .http()
        .post(`/api/cobros/citas/${cita.id}/pagos`)
        .set(await tk(u))
        .send({ monto: 30000, medioPago: 'EFECTIVO' });
    expect((await pagar(otroProf)).status).toBe(403);
    const r = await pagar(prof);
    expect(r.status).toBe(201);
    expect(r.body.pagos[0]).toEqual(expect.objectContaining({ cobradoPor: 'CENTRO', monto: 30000 }));
  });
});
