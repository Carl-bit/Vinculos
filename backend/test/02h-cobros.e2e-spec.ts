/** 02h parte B: cobros (monto, pagos, boleta, politica de cancelacion, liquidacion). Por rol. */
import { randomInt } from 'node:crypto';

import { dvRut } from '../src/core/validacion/validadores';
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;
/** Fecha de Chile (AAAA-MM-DD) desplazada n dias. */
const fechaChile = (n = 0) => new Date(Date.now() + n * DIA).toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });

describe('02h cobros', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string };
  let otroPaciente: UsuarioPrueba & { pacienteId: string };
  let boxId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  /** Hora redonda futura (o pasada) distinta por llamada: sin choques entre citas del mismo profesional. */
  let siguiente = 0;
  const horario = (horasDesdeAhora: number) => {
    const inicio = new Date(Math.ceil((Date.now() + horasDesdeAhora * HORA) / HORA) * HORA + (siguiente++ % 4) * 5 * 60_000);
    return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 15 * 60_000).toISOString() };
  };
  const cita = async (u: UsuarioPrueba, pacienteId: string, horas: number, modalidad: 'PRESENCIAL' | 'ONLINE' = 'PRESENCIAL') => {
    const r = await t.http().post('/api/citas').set(await tk(gestion)).send({
      pacienteId,
      profesionalId: u.id,
      modalidad,
      espacioId: modalidad === 'PRESENCIAL' ? boxId : undefined,
      ...horario(horas),
    });
    expect(r.status).toBe(201);
    return r.body as { id: string; monto: number };
  };
  const pagar = async (citaId: string, monto: number, quien: UsuarioPrueba = gestion) =>
    t.http().post(`/api/cobros/citas/${citaId}/pagos`).set(await tk(quien)).send({ monto, medioPago: 'TRANSFERENCIA' });
  const estado = async (citaId: string, quien: UsuarioPrueba = gestion) => (await t.http().get(`/api/cobros/citas/${citaId}`).set(await tk(quien))).body;
  const cancelar = async (citaId: string) => expect((await t.http().patch(`/api/citas/${citaId}/cancelacion`).set(await tk(gestion))).status).toBe(200);
  const resolver = async (citaId: string, cuerpo: object, quien: UsuarioPrueba = gestion) =>
    t.http().post(`/api/cobros/citas/${citaId}/resolucion`).set(await tk(quien)).send(cuerpo);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true, modeloCobro: 'CENTRO' } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    practicante = await t.datos.usuario('PRACTICANTE');
    prof = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(prof.id);
    paciente = await t.datos.usuarioPaciente(prof.id);
    otroPaciente = await t.datos.usuarioPaciente((await t.datos.usuario('PROFESIONAL')).id);
    boxId = (await t.datos.espacio()).id;
    await t.http().post('/api/profesionales/yo/tarifas').set(await tk(prof)).send({ monto: 40000 });
    await t.http().post('/api/profesionales/yo/tarifas').set(await tk(prof)).send({ monto: 30000, modalidad: 'ONLINE' });
  });

  afterAll(async () => {
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { modeloCobro: 'CENTRO', penalizacionCancelacionPorcentaje: 0, cobroInasistenciaPorcentaje: 0, comisionCentroPorcentaje: 0 },
    });
    await t.cerrar();
  });

  it('el monto se fija al confirmar con la tarifa mas especifica vigente; una tarifa nueva solo afecta citas posteriores; reprogramar lo conserva', async () => {
    const presencial = await cita(prof, paciente.pacienteId, 48);
    const online = await cita(prof, paciente.pacienteId, 49, 'ONLINE');
    expect([presencial.monto, online.monto]).toEqual([40000, 30000]);
    await t.http().post('/api/profesionales/yo/tarifas').set(await tk(prof)).send({ monto: 45000 });
    const nueva = await cita(prof, paciente.pacienteId, 50);
    expect(nueva.monto).toBe(45000);
    expect((await t.http().get(`/api/citas/${presencial.id}`).set(await tk(gestion))).body.monto).toBe(40000);
    const reprogramada = await t.http().patch(`/api/citas/${presencial.id}/reprogramacion`).set(await tk(gestion)).send(horario(72));
    expect(reprogramada.body.monto).toBe(40000);
    await expect(t.dueno.cita.update({ where: { id: presencial.id }, data: { monto: 1 } })).rejects.toThrow(/inmutable/);
  });

  it('pagos: sobrepago rechazado, pago parcial, anulacion con motivo (nunca borrado) y boleta unica solo al completar', async () => {
    const c = await cita(prof, paciente.pacienteId, 51);
    const sobrepago = await pagar(c.id, c.monto + 1);
    expect([sobrepago.status, sobrepago.body.restriccion]).toEqual([422, 'pagos_sin_sobrepago']);
    const parcial = await pagar(c.id, 15000);
    expect(parcial.status).toBe(201);
    expect(parcial.body).toEqual(expect.objectContaining({ estado_pago: 'PARCIAL', pagado: 15000, saldo: c.monto - 15000, boleta: null }));
    const pagoId = parcial.body.pagos[0].id as string;

    expect((await t.http().post(`/api/cobros/pagos/${pagoId}/anulacion`).set(await tk(gestion)).send({})).status).toBe(400);
    for (const u of [prof, paciente]) {
      expect((await t.http().post(`/api/cobros/pagos/${pagoId}/anulacion`).set(await tk(u)).send({ motivo: 'error' })).status).toBe(403);
    }
    const anulado = await t.http().post(`/api/cobros/pagos/${pagoId}/anulacion`).set(await tk(gestion)).send({ motivo: 'Monto mal digitado' });
    expect(anulado.body).toEqual(expect.objectContaining({ estado: 'ANULADO', anuladoPorId: gestion.id, motivoAnulacion: 'Monto mal digitado' }));
    expect((await t.http().post(`/api/cobros/pagos/${pagoId}/anulacion`).set(await tk(gestion)).send({ motivo: 'otra vez' })).status).toBe(409);
    expect((await estado(c.id)).saldo).toBe(c.monto);
    expect(await t.dueno.pago.count({ where: { id: pagoId } })).toBe(1);

    await pagar(c.id, c.monto - 10000);
    const completo = await pagar(c.id, 10000, admin);
    expect(completo.body).toEqual(expect.objectContaining({ estado_pago: 'PAGADO', saldo: 0 }));
    expect(completo.body.boleta).toEqual(expect.objectContaining({ numero: expect.stringMatching(/^SIM-\d{8}$/), monto: c.monto, emisorNombre: expect.any(String) }));
    expect(await t.dueno.boleta.count({ where: { citaId: c.id } })).toBe(1);
    const fila = await t.dueno.boleta.findUniqueOrThrow({ where: { citaId: c.id } });
    expect(Buffer.from(fila.emisorNombre).toString('latin1')).not.toContain(completo.body.boleta.emisorNombre);
    expect((await pagar(c.id, 1)).status).toBe(422);
    const conBoleta = completo.body.pagos.find((p: { estado: string }) => p.estado === 'REGISTRADO').id;
    expect((await t.http().post(`/api/cobros/pagos/${conBoleta}/anulacion`).set(await tk(gestion)).send({ motivo: 'tarde' })).status).toBe(409);

    // Por rol: el profesional sin cobro directo no registra; el paciente ve lo suyo; practicante nada.
    const otra = await cita(prof, paciente.pacienteId, 52);
    expect((await pagar(otra.id, 1000, prof)).status).toBe(403);
    expect((await pagar(otra.id, 1000, paciente)).status).toBe(403);
    expect((await estado(c.id, paciente)).boleta.numero).toBe(completo.body.boleta.numero);
    expect((await estado(c.id, prof)).estado_pago).toBe('PAGADO');
    expect((await t.http().get(`/api/cobros/citas/${c.id}`).set(await tk(otroPaciente))).status).toBe(404);
    expect((await t.http().get('/api/cobros/citas').set(await tk(practicante))).status).toBe(403);
    const lista = await t.http().get('/api/cobros/citas').set(await tk(paciente));
    expect(lista.body.every((e: { paciente_id: string }) => e.paciente_id === paciente.pacienteId)).toBe(true);
  });

  it('cobro directo: el profesional registra; la boleta lleva su nombre y RUT; los datos de pago solo con saldo', async () => {
    const directo = await t.datos.usuario('PROFESIONAL', { nombre: 'Ps. Directo' });
    await t.datos.disponibleSiempre(directo.id);
    const pac = await t.datos.usuarioPaciente(directo.id);
    const cuerpo = String(randomInt(10_000_000, 20_000_000));
    await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(directo)).send({ rut: `${cuerpo}-${dvRut(cuerpo)}`, banco: 'BCI', tipoCuenta: 'CORRIENTE', numeroCuenta: '123123', titular: 'Directo' });
    await t.http().put('/api/profesionales/yo/perfil').set(await tk(directo)).send({ especialidad: 'Psicologia', modalidad: 'MIXTA' });
    await t.http().post('/api/profesionales/yo/tarifas').set(await tk(directo)).send({ monto: 20000 });
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'MIXTO' } });
    await t.dueno.profesional.update({ where: { usuarioId: directo.id }, data: { cobroDirecto: true } });
    try {
      const c = await cita(directo, pac.pacienteId, 53);
      expect((await t.http().get(`/api/portal/citas/${c.id}/datos-pago`).set(await tk(pac))).body.aplica).toBe(true);
      const r = await pagar(c.id, 20000, directo);
      expect(r.status).toBe(201);
      expect(r.body.pagos[0].cobradoPor).toBe('PROFESIONAL');
      expect(r.body.boleta).toEqual(expect.objectContaining({ emisorNombre: 'Ps. Directo', emisorRut: `${cuerpo}${dvRut(cuerpo)}` }));
      expect((await t.http().get(`/api/portal/citas/${c.id}/datos-pago`).set(await tk(pac))).body).toEqual({ aplica: false });
    } finally {
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'CENTRO' } });
    }
  });

  it('politica de cancelacion: a tiempo sin cobro; tardia con reprogramacion (traslado) o devolucion menos la penalizacion; inasistencia con el porcentaje configurado', async () => {
    const conf = await t.http().patch('/api/configuracion').set(await tk(admin)).send({
      plazoAvisoCancelacionHoras: 24,
      penalizacionCancelacionPorcentaje: 40,
      cobroInasistenciaPorcentaje: 60,
    });
    expect(conf.status).toBe(200);
    expect((await t.http().patch('/api/configuracion').set(await tk(gestion)).send({ cobroInasistenciaPorcentaje: 0 })).status).toBe(403);
    expect((await t.http().patch('/api/configuracion').set(await tk(admin)).send({ penalizacionCancelacionPorcentaje: 101 })).status).toBe(400);

    // A tiempo (aviso >= 24 h): devolucion total, sin cobro.
    const aTiempo = await cita(prof, paciente.pacienteId, 120);
    await pagar(aTiempo.id, 10000);
    await cancelar(aTiempo.id);
    const r1 = await resolver(aTiempo.id, { decision: 'DEVOLUCION', motivo: 'Aviso con tiempo' });
    expect(r1.body.resolucion).toEqual(expect.objectContaining({ aTiempo: true, montoExigible: 0, montoDevolucion: 10000, decididoPorId: gestion.id }));
    expect(r1.body.estado_pago).toBe('SIN_COBRO');
    expect((await resolver(aTiempo.id, { decision: 'DEVOLUCION' })).status).toBe(409);

    // Tardia con devolucion: se devuelve lo pagado menos el 40 %.
    const tardia = await cita(prof, paciente.pacienteId, 3);
    await pagar(tardia.id, tardia.monto);
    await cancelar(tardia.id);
    const r2 = await resolver(tardia.id, { decision: 'DEVOLUCION' });
    const penalizacion = Math.round(tardia.monto * 0.4);
    expect(r2.body.resolucion).toEqual(expect.objectContaining({ aTiempo: false, montoExigible: penalizacion, montoDevolucion: tardia.monto - penalizacion }));
    expect(r2.body.estado_pago).toBe('PAGADO');

    // Tardia con reprogramacion: el pago se traslada a la cita nueva (sin penalizacion).
    const reprog = await cita(prof, paciente.pacienteId, 4);
    await pagar(reprog.id, 12000);
    await cancelar(reprog.id);
    const nueva = await cita(prof, paciente.pacienteId, 150);
    expect((await resolver(reprog.id, { decision: 'TRASLADO' })).status).toBe(400);
    const r3 = await resolver(reprog.id, { decision: 'TRASLADO', citaNuevaId: nueva.id });
    expect(r3.body).toEqual(expect.objectContaining({ estado_pago: 'SIN_COBRO', pagado: 0 }));
    expect(r3.body.pagos).toEqual([expect.objectContaining({ estado: 'ANULADO', motivoAnulacion: expect.stringContaining(nueva.id) })]);
    const destino = await estado(nueva.id);
    expect(destino).toEqual(expect.objectContaining({ estado_pago: 'PARCIAL', pagado: 12000 }));
    expect(destino.pagos[0]).toEqual(expect.objectContaining({ origen: 'TRASLADO', trasladoDeId: r3.body.pagos[0].id }));

    // Inasistencia sin aviso: cita ya terminada; se cobra el 60 %.
    const pasada = await t.dueno.cita.create({
      data: { profesionalId: prof.id, pacienteId: paciente.pacienteId, espacioId: boxId, inicio: new Date(Date.now() - 5 * HORA), fin: new Date(Date.now() - 4 * HORA) },
    });
    expect((await resolver(nueva.id, { decision: 'INASISTENCIA' })).status).toBe(409);
    const r4 = await resolver(pasada.id, { decision: 'INASISTENCIA', motivo: 'No se presento' });
    const cobro = Math.round(pasada.monto! * 0.6);
    expect(r4.body).toEqual(expect.objectContaining({ estado_pago: 'PENDIENTE', saldo: cobro }));
    expect(r4.body.resolucion).toEqual(expect.objectContaining({ decision: 'INASISTENCIA', porcentaje: '60', montoExigible: cobro }));
    expect((await pagar(pasada.id, cobro)).body).toEqual(expect.objectContaining({ estado_pago: 'PAGADO', boleta: expect.objectContaining({ monto: cobro }) }));

    // Solo ADMIN/GESTION deciden; el profesional y el paciente ven la decision.
    const otra = await cita(prof, paciente.pacienteId, 160);
    await cancelar(otra.id);
    for (const u of [prof, paciente, practicante]) {
      expect((await resolver(otra.id, { decision: 'DEVOLUCION' }, u)).status).toBe(403);
    }
    expect((await estado(aTiempo.id, prof)).resolucion.decision).toBe('DEVOLUCION');
    expect((await estado(aTiempo.id, paciente)).resolucion.montoDevolucion).toBe(10000);
  });

  it('liquidacion: cobrado por el centro - comision - arriendos; BORRADOR -> EMITIDA -> PAGADA solo ADMIN/GESTION; el profesional ve las suyas', async () => {
    await t.http().patch('/api/configuracion').set(await tk(admin)).send({ comisionCentroPorcentaje: 10 });
    const p2 = await t.datos.usuario('PROFESIONAL');
    const otroProf = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(p2.id);
    const pac = await t.datos.usuarioPaciente(p2.id);
    await t.http().post('/api/profesionales/yo/tarifas').set(await tk(p2)).send({ monto: 50000 });
    const a = await cita(p2, pac.pacienteId, 200);
    const b = await cita(p2, pac.pacienteId, 201);
    await pagar(a.id, 50000);
    await pagar(b.id, 20000);

    const arriendo = { profesionalId: p2.id, espacioId: boxId, desde: fechaChile(0), hasta: fechaChile(30), monto: 15000 };
    expect((await t.http().post('/api/cobros/arriendos').set(await tk(p2)).send(arriendo)).status).toBe(403);
    expect((await t.http().post('/api/cobros/arriendos').set(await tk(gestion)).send(arriendo)).status).toBe(201);
    expect((await t.http().get('/api/cobros/arriendos').set(await tk(p2))).body).toHaveLength(1);
    expect((await t.http().get('/api/cobros/arriendos').set(await tk(otroProf))).body).toEqual([]);

    const periodo = { profesionalId: p2.id, desde: fechaChile(-1), hasta: fechaChile(1) };
    expect((await t.http().post('/api/cobros/liquidaciones').set(await tk(p2)).send(periodo)).status).toBe(403);
    const liq = await t.http().post('/api/cobros/liquidaciones').set(await tk(gestion)).send(periodo);
    expect(liq.status).toBe(201);
    expect(liq.body).toEqual(expect.objectContaining({ totalCobrado: 70000, comisionPorcentaje: '10', comision: 7000, arriendos: 15000, total: 48000, estado: 'BORRADOR' }));
    expect((await t.http().get('/api/cobros/liquidaciones').set(await tk(p2))).body).toEqual([]);

    const emitida = await t.http().post(`/api/cobros/liquidaciones/${liq.body.id}/emision`).set(await tk(admin));
    expect(emitida.body.estado).toBe('EMITIDA');
    expect((await t.http().post(`/api/cobros/liquidaciones/${liq.body.id}/emision`).set(await tk(admin))).status).toBe(409);
    expect((await t.http().post('/api/cobros/liquidaciones').set(await tk(gestion)).send(periodo)).status).toBe(409);
    expect((await t.http().post('/api/cobros/liquidaciones').set(await tk(gestion)).send({ ...periodo, desde: fechaChile(0), hasta: fechaChile(2) })).status).toBe(409);
    expect((await t.http().get('/api/cobros/liquidaciones').set(await tk(p2))).body.map((l: { id: string }) => l.id)).toEqual([liq.body.id]);
    expect((await t.http().get('/api/cobros/liquidaciones').set(await tk(otroProf))).body).toEqual([]);
    expect((await t.http().get('/api/cobros/liquidaciones').set(await tk(pac))).status).toBe(403);
    expect((await t.http().post(`/api/cobros/liquidaciones/${liq.body.id}/pago`).set(await tk(p2))).status).toBe(403);
    expect((await t.http().post(`/api/cobros/liquidaciones/${liq.body.id}/pago`).set(await tk(gestion))).body.estado).toBe('PAGADA');

    // Un pago ya liquidado no se anula.
    const pagoB = (await estado(b.id)).pagos[0].id;
    expect((await t.http().post(`/api/cobros/pagos/${pagoB}/anulacion`).set(await tk(gestion)).send({ motivo: 'tarde' })).status).toBe(409);
  });
});
