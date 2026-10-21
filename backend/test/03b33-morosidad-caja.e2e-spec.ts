/**
 * 03b-3.3: pago tardio, morosidad y caja de la hora retenida. Un paciente con
 * una sesion terminada impaga no agenda (equipo ni portal) salvo que
 * ADMIN/GESTION lo autoricen con motivo; la lista de deudas va por rol y el
 * job avisa una vez por sesion. La inasistencia justificada se resuelve como
 * cancelacion tardia (con motivo). La hora retenida presencial se cobra en
 * caja (concreta la reserva) y se libera a mano con motivo.
 */
import { randomUUID } from 'node:crypto';

import { type Correo, ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { JobsService } from '../src/core/jobs/jobs.service';
import { auth, crearApp, procesarMensajes, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;

describe('03b-3.3 morosidad y caja de la hora retenida', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let otroProf: UsuarioPrueba;
  let politicaId: string;
  let terminosId: string;
  let dia = 5;
  let pasadas = 0;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correos = (): Correo[] => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo).enviados;
  const ultimoA = (para: string) => [...correos()].reverse().find((c) => c.para === para);
  const proxima = () => new Date(Math.ceil((Date.now() + dia++ * DIA) / HORA) * HORA);

  const publicar = async (u: UsuarioPrueba) => {
    const perfil = { especialidad: 'Psicologia clinica', modalidad: 'MIXTA', nombrePublico: `Ps. ${u.id.slice(0, 6)}` };
    await t
      .http()
      .put('/api/profesionales/yo/perfil')
      .set(await tk(u))
      .send(perfil);
    await t
      .http()
      .post('/api/profesionales/yo/tarifas')
      .set(await tk(u))
      .send({ monto: 30000 });
    await t
      .http()
      .put('/api/profesionales/yo/perfil')
      .set(await tk(u))
      .send({ ...perfil, perfilPublico: true });
    await t
      .http()
      .put('/api/profesionales/yo/videollamada')
      .set(await tk(u))
      .send({ modo: 'JITSI' });
    await t.datos.disponibleSiempre(u.id);
  };

  /** Sesion ya realizada sin pago (la crea el dueño: no pasa por el bloqueo). */
  const sesionImpaga = (pacienteId: string, haceDias = 2) => {
    // Una hora distinta cada vez: el profesional no puede tener dos sesiones a la misma hora.
    const inicio = new Date(Math.floor((Date.now() - haceDias * DIA) / HORA) * HORA - pasadas++ * HORA);
    return t.dueno.cita.create({ data: { profesionalId: prof.id, pacienteId, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA) } });
  };

  const agendar = async (u: UsuarioPrueba, pacienteId: string, extra: Record<string, unknown> = {}) => {
    const inicio = proxima();
    return t
      .http()
      .post('/api/citas')
      .set(await tk(u))
      .send({ pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA), ...extra });
  };

  const pedir = async (modalidad: 'PRESENCIAL' | 'ONLINE') => {
    const inicio = proxima();
    const email = `caja-${randomUUID().slice(0, 8)}@test.cl`;
    const r = await t
      .http()
      .post('/api/publico/solicitudes')
      .send({
        profesionalId: prof.id,
        modalidad,
        inicio: inicio.toISOString(),
        fin: new Date(inicio.getTime() + HORA).toISOString(),
        nombre: 'Carla',
        apellido: 'Caja',
        fechaNacimiento: '1990-03-03',
        email,
        politicaId,
        terminosId,
      });
    expect(r.status).toBe(202);
    const { citaId } = await t.dueno.solicitudHora.findFirstOrThrow({ where: { email }, select: { citaId: true } });
    return { reserva: r.body.reserva as string, citaId: citaId!, email };
  };

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.horarioCentro.deleteMany({});
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { rolGestionHabilitado: true, morosidadDesde: new Date(Date.now() - 30 * DIA), mediosPagoHabilitados: ['PAGO_EN_CENTRO'] },
    });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
    otroProf = await t.datos.usuario('PROFESIONAL');
    politicaId = (await t.http().get('/api/publico/politicas/POLITICA_DATOS')).body.id;
    terminosId = (await t.http().get('/api/publico/politicas/TERMINOS_AGENDAMIENTO')).body.id;
    await publicar(prof);
  });

  afterAll(async () => {
    // BD compartida: configuracion por defecto (la morosidad vuelve a contar desde ahora).
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: {
        morosidadDesde: new Date(),
        mediosPagoHabilitados: ['PAGO_EN_CENTRO'],
        porcentajePagoConfirmacion: 100,
        horasPlazoPagoEquipo: 12,
        diasGraciaMorosidad: 0,
        bloquearAgendaMorosos: true,
      },
    });
    await t.cerrar();
  });

  it('paciente con deuda: ni el profesional ni GESTION agendan sin autorizacion; GESTION autoriza con motivo; el profesional no', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    await sesionImpaga(p.pacienteId);
    const bloqueada = await agendar(prof, p.pacienteId);
    expect([bloqueada.status, bloqueada.body.restriccion]).toEqual([422, 'citas_paciente_moroso']);
    expect(bloqueada.body.mensaje).toContain('pago pendiente');
    expect((await agendar(gestion, p.pacienteId)).status).toBe(422);
    expect((await agendar(prof, p.pacienteId, { motivoAutorizacionDeuda: 'Urgencia clinica' })).status).toBe(403);
    expect((await agendar(gestion, p.pacienteId, { motivoAutorizacionDeuda: 'x' })).status).toBe(400);
    const autorizada = await agendar(gestion, p.pacienteId, { motivoAutorizacionDeuda: 'Urgencia clinica: se regulariza en la sesion' });
    expect(autorizada.status).toBe(201);
    const excepcion = await t.dueno.excepcionMorosidad.findFirstOrThrow({ where: { pacienteId: p.pacienteId } });
    expect(excepcion).toEqual(expect.objectContaining({ citaId: autorizada.body.id, saldo: 30000, otorgadaPorId: gestion.id }));
  });

  it('el paciente tampoco agenda desde su cuenta mientras tenga deuda', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    await sesionImpaga(p.pacienteId);
    const inicio = proxima();
    const r = await t
      .http()
      .post('/api/portal/citas')
      .set(await tk(p))
      .send({ modalidad: 'ONLINE', inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + HORA).toISOString(), politicaId, terminosId });
    expect([r.status, r.body.restriccion]).toEqual([422, 'citas_paciente_moroso']);
  });

  it('deudas por rol; el pago regulariza; aviso de deuda una vez por sesion al paciente y al profesional', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    const cita = await sesionImpaga(p.pacienteId);
    const deudas = (u: UsuarioPrueba) => tk(u).then((h) => t.http().get('/api/cobros/deudas').set(h));
    expect((await deudas(gestion)).body).toContainEqual(expect.objectContaining({ paciente_id: p.pacienteId, sesiones: 1, saldo: 30000, citas: [cita.id] }));
    expect((await deudas(prof)).body.some((d: { paciente_id: string }) => d.paciente_id === p.pacienteId)).toBe(true);
    expect((await deudas(otroProf)).body.some((d: { paciente_id: string }) => d.paciente_id === p.pacienteId)).toBe(false);
    expect((await deudas(p)).status).toBe(403);

    await procesarMensajes(t);
    const jobs = t.app.get(JobsService);
    expect(await jobs.avisarDeudas()).toEqual(expect.objectContaining({ corrio: true }));
    expect(await jobs.avisarDeudas()).toEqual({ corrio: true, total: 0 });
    const enviados = await procesarMensajes(t);
    expect(enviados.filter((c) => c.para === p.email).map((c) => c.asunto)).toEqual(['Sesión con pago pendiente']);

    const pago = await t
      .http()
      .post(`/api/cobros/citas/${cita.id}/pagos`)
      .set(await tk(gestion))
      .send({ monto: 30000, medioPago: 'EFECTIVO' });
    expect(pago.status).toBe(201);
    expect((await deudas(gestion)).body.some((d: { paciente_id: string }) => d.paciente_id === p.pacienteId)).toBe(false);
    expect((await agendar(prof, p.pacienteId)).status).toBe(201);
  });

  it('inasistencia justificada: devolucion con la penalizacion de la cancelacion tardia (exige motivo)', async () => {
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { penalizacionCancelacionPorcentaje: 50 } });
    const p = await t.datos.usuarioPaciente(prof.id);
    const cita = await sesionImpaga(p.pacienteId);
    await t
      .http()
      .post(`/api/cobros/citas/${cita.id}/pagos`)
      .set(await tk(gestion))
      .send({ monto: 30000, medioPago: 'EFECTIVO' });
    const resolver = async (motivo?: string) =>
      t
        .http()
        .post(`/api/cobros/citas/${cita.id}/resolucion`)
        .set(await tk(gestion))
        .send({ decision: 'DEVOLUCION', motivo });
    const sinMotivo = await resolver();
    expect([sinMotivo.status, sinMotivo.body.restriccion]).toEqual([422, 'resoluciones_cita_justificada']);
    const r = await resolver('Enfermedad con certificado');
    expect(r.status).toBe(200);
    expect(r.body.resolucion).toEqual(expect.objectContaining({ inasistenciaJustificada: true, aTiempo: false, montoExigible: 15000, montoDevolucion: 15000 }));
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { penalizacionCancelacionPorcentaje: 0 } });
  });

  it('hora retenida presencial: se cobra en caja (GESTION o su profesional; otro profesional no) y queda confirmada con paciente; la online no', async () => {
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'PASARELA'], porcentajePagoConfirmacion: 50 },
    });
    const presencial = await pedir('PRESENCIAL');
    const online = await pedir('ONLINE');
    const caja = async (u: UsuarioPrueba, citaId: string, monto: number) =>
      t
        .http()
        .post(`/api/cobros/citas/${citaId}/caja`)
        .set(await tk(u))
        .send({ monto, medioPago: 'EFECTIVO' });
    expect((await caja(otroProf, presencial.citaId, 30000)).status).toBe(403);
    const enLinea = await caja(gestion, online.citaId, 30000);
    expect([enLinea.status, enLinea.body.restriccion]).toEqual([422, 'citas_caja_solo_presencial']);
    const corto = await caja(gestion, presencial.citaId, 1000);
    expect([corto.status, corto.body.restriccion]).toEqual([422, 'pagos_caja_monto']);
    const ok = await caja(gestion, presencial.citaId, 30000);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(expect.objectContaining({ citaId: presencial.citaId, estado: 'CONFIRMADA' }));
    expect(ok.body.pacienteId).toEqual(expect.any(String));
    expect(await t.dueno.cita.findUniqueOrThrow({ where: { id: presencial.citaId } })).toEqual(
      expect.objectContaining({ estado: 'CONFIRMADA', medioConfirmacion: 'PAGO_EN_CENTRO', pacienteId: ok.body.pacienteId }),
    );
    expect(ultimoA(presencial.email)?.asunto).toContain('Active su cuenta');
  });

  it('liberar la hora retenida: solo ADMIN/GESTION con motivo; la reserva queda liberada', async () => {
    const r = await pedir('PRESENCIAL');
    const liberar = async (u: UsuarioPrueba, motivo?: string) =>
      t
        .http()
        .patch(`/api/citas/${r.citaId}/liberacion`)
        .set(await tk(u))
        .send({ motivo });
    expect((await liberar(prof, 'La persona llamo')).status).toBe(403);
    expect((await liberar(gestion)).status).toBe(400);
    const ok = await liberar(gestion, 'La persona llamo para anular');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(expect.objectContaining({ estado: 'LIBERADA', motivoLiberacion: 'La persona llamo para anular' }));
    expect((await liberar(admin, 'otra vez')).status).toBe(409);
    expect((await t.http().post('/api/publico/reservas/estado').send({ reserva: r.reserva })).body).toEqual(
      expect.objectContaining({ estado: 'LIBERADA', siguiente: 'ELEGIR_OTRA_HORA' }),
    );
  });

  it('configuracion: ADMIN ajusta plazo del equipo, gracia y bloqueo; el plazo de la cita lo sigue', async () => {
    const patch = async (u: UsuarioPrueba, data: Record<string, unknown>) =>
      t
        .http()
        .patch('/api/configuracion')
        .set(await tk(u))
        .send(data);
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'PASARELA'], porcentajePagoConfirmacion: 50 },
    });
    expect((await patch(gestion, { horasPlazoPagoEquipo: 24 })).status).toBe(403);
    expect((await patch(admin, { horasPlazoPagoEquipo: 500 })).status).toBe(400);
    const r = await patch(admin, { horasPlazoPagoEquipo: 24, diasGraciaMorosidad: 2, bloquearAgendaMorosos: true });
    expect(r.status).toBe(200);
    expect(r.body).toEqual(expect.objectContaining({ horasPlazoPagoEquipo: 24, diasGraciaMorosidad: 2, bloquearAgendaMorosos: true }));
    const p = await t.datos.usuarioPaciente(prof.id);
    const cita = await agendar(gestion, p.pacienteId);
    expect(cita.body.estado).toBe('PENDIENTE_PAGO');
    expect(new Date(cita.body.pagoVenceEn).getTime()).toBe(new Date(cita.body.inicio).getTime() - 24 * HORA);
    // Dentro de los dias de gracia la sesion impaga todavia no bloquea.
    await sesionImpaga(p.pacienteId, 1);
    expect((await agendar(gestion, p.pacienteId)).status).toBe(201);
    await patch(admin, { horasPlazoPagoEquipo: 12, diasGraciaMorosidad: 0 });
  });
});
