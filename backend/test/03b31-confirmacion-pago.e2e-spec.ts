/**
 * 03b-3.1 / 03b-3.2: la hora se confirma con el pago. La reserva sin cuenta es
 * una cita RETENIDA sin paciente, consultable por token opaco (desde
 * cualquier sesion: no hay sesion); el pago registrado (transferencia validada
 * o webhook) crea al paciente y confirma; pago en el centro: el gatillo es el
 * enlace del correo (verificacion tardia con la hora libre y tomada). Quien
 * valida segun el modelo de cobro; la hora que agenda el equipo queda
 * pendiente de pago hasta 12 h antes; el vencimiento lo decide el job (nunca
 * el cliente); webhook idempotente con firma.
 */
import { randomUUID } from 'node:crypto';

import { type Correo, ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { PasarelaSimulada, ProveedorPasarela } from '../src/core/integraciones/pasarela';
import { JobsService } from '../src/core/jobs/jobs.service';
import { BANCOS } from '../src/modulos/equipo/dto/equipo.dto';
import { auth, crearApp, procesarMensajes, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64, 32)]);
const horaChile = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hourCycle: 'h23' }).format(d));

/** Inicio en punto a `desde`..`hasta` horas de ahora, sin cruzar la medianoche de Chile (la agenda no cruza de dia). */
const horaEntre = (desde: number, hasta: number) => {
  for (let h = desde; h <= hasta; h++) {
    const inicio = new Date(Math.ceil(Date.now() / HORA) * HORA + h * HORA);
    if (horaChile(inicio) >= 1 && horaChile(inicio) <= 21) return inicio;
  }
  throw new Error('sin hora disponible en la ventana');
};

describe('03b-3.1 / 03b-3.2 la hora se confirma con el pago', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let directo: UsuarioPrueba;
  let tipoId: string;
  let politicaId: string;
  let terminosId: string;
  let dia = 3;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correos = (): Correo[] => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo).enviados;
  const tokenDe = (c: Correo | undefined) => /token=([A-Za-z0-9_-]+)/.exec(c?.texto ?? '')?.[1] ?? '';
  const ultimoA = (para: string) => [...correos()].reverse().find((c) => c.para === para);

  const publicar = async (u: UsuarioPrueba, extra: Record<string, unknown> = {}) => {
    const perfil = { especialidad: 'Psicologia clinica', modalidad: 'MIXTA', nombrePublico: `Ps. ${u.id.slice(0, 6)}`, ...extra };
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
    expect(
      (
        await t
          .http()
          .put('/api/profesionales/yo/perfil')
          .set(await tk(u))
          .send({ ...perfil, perfilPublico: true })
      ).status,
    ).toBe(200);
    await t
      .http()
      .put(`/api/profesionales/${u.id}/tipos-atencion`)
      .set(await tk(admin))
      .send({ tipoAtencionIds: [tipoId] });
    await t.datos.disponibleSiempre(u.id);
  };

  /** Pide hora sin cuenta (dia distinto cada vez): token de la reserva, cita retenida y enlace del correo si lo hubo. */
  const pedir = async (u: UsuarioPrueba) => {
    const inicio = new Date(Math.ceil((Date.now() + dia++ * DIA) / HORA) * HORA);
    const email = `pago-${randomUUID().slice(0, 8)}@test.cl`;
    const r = await t
      .http()
      .post('/api/publico/solicitudes')
      .send({
        profesionalId: u.id,
        modalidad: 'PRESENCIAL',
        inicio: inicio.toISOString(),
        fin: new Date(inicio.getTime() + HORA).toISOString(),
        nombre: 'Pia',
        apellido: 'Pago',
        fechaNacimiento: '1990-03-03',
        email,
        politicaId,
        terminosId,
      });
    expect(r.status).toBe(202);
    expect(typeof r.body.reserva).toBe('string');
    const { citaId } = await t.dueno.solicitudHora.findFirstOrThrow({ where: { email }, select: { citaId: true } });
    return { reserva: r.body.reserva as string, verificacionEnviada: r.body.verificacionEnviada as boolean, citaId: citaId!, email, inicio };
  };
  const estado = (reserva: string) => t.http().post('/api/publico/reservas/estado').send({ reserva });
  const medio = (reserva: string, m: string) => t.http().post('/api/publico/reservas/medio').send({ reserva, medio: m });
  const verificar = (enlace: string) => t.http().post('/api/publico/solicitudes/verificacion').send({ token: enlace });
  const configurar = async (data: Record<string, unknown>) =>
    expect(
      (
        await t
          .http()
          .patch('/api/configuracion')
          .set(await tk(admin))
          .send(data)
      ).status,
    ).toBe(200);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.horarioCentro.deleteMany({});
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
    directo = await t.datos.usuario('PROFESIONAL');
    tipoId = (await t.datos.tipoAtencion()).id;
    politicaId = (await t.http().get('/api/publico/politicas/POLITICA_DATOS')).body.id;
    terminosId = (await t.http().get('/api/publico/politicas/TERMINOS_AGENDAMIENTO')).body.id;
    await publicar(prof);
    await publicar(directo);
  });

  afterAll(async () => {
    // La BD de tests es compartida: se deja la configuracion por defecto.
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { mediosPagoHabilitados: ['PAGO_EN_CENTRO'], porcentajePagoConfirmacion: 100, modeloCobro: 'CENTRO' },
    });
    await t.cerrar();
  });

  it('solo pago en el centro (por defecto): hora retenida sin paciente; el enlace del correo la confirma, como antes', async () => {
    const r = await pedir(prof);
    expect(r.verificacionEnviada).toBe(true);
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: r.citaId } })).pacienteId).toBeNull();
    const e = await estado(r.reserva);
    expect(e.status).toBe(200);
    expect(e.body).toEqual(expect.objectContaining({ estado: 'RETENIDA', siguiente: 'VERIFICAR_CORREO' }));
    expect(Object.keys(e.body).sort()).toEqual([
      'comprobanteRecibido',
      'estado',
      'medio',
      'medios',
      'monto',
      'motivoRechazo',
      'pasarelaSimulada',
      'siguiente',
      'venceEn',
    ]);
    expect(ultimoA(r.email)?.asunto).toContain('Confirme su correo para reservar la hora');
    expect((await verificar(tokenDe(ultimoA(r.email)))).body.estado).toBe('CONFIRMADA');
    expect((await estado(r.reserva)).body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', siguiente: 'NINGUNO' }));
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: r.citaId } })).pacienteId).not.toBeNull();
    expect((await estado('x'.repeat(43))).status).toBe(404);
  });

  it('configuracion: transferencia exige la cuenta del centro; la cuenta la registra ADMIN y la lee GESTION', async () => {
    const r = await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'TRANSFERENCIA'] });
    expect(r.status).toBe(422);
    expect(r.body.restriccion).toBe('configuracion_centro_transferencia_sin_cuenta');
    const cuenta = { rut: '11.111.111-1', banco: 'Banco Demo', tipoCuenta: 'Corriente', numeroCuenta: '000-123456', titular: 'Centro de Prueba SpA' };
    expect(
      (
        await t
          .http()
          .put('/api/cobros/cuenta-centro')
          .set(await tk(gestion))
          .send(cuenta)
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .put('/api/cobros/cuenta-centro')
          .set(await tk(admin))
          .send(cuenta)
      ).status,
    ).toBe(200);
    expect(
      (
        await t
          .http()
          .get('/api/cobros/cuenta-centro')
          .set(await tk(gestion))
          .send()
      ).body.numeroCuenta,
    ).toBe('000-123456');
    const fila = await t.dueno.cuentaBancariaCentro.findFirstOrThrow();
    expect(Buffer.from(fila.numeroCuenta).toString('utf8')).not.toContain('123456');
    await configurar({ mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'TRANSFERENCIA', 'PASARELA'], porcentajePagoConfirmacion: 50 });
  });

  it('transferencia (cobro del centro): sin correo previo; comprobante mantiene la hora; rechazo y validacion de GESTION crean al paciente', async () => {
    const r = await pedir(prof);
    expect(r.verificacionEnviada).toBe(false);
    expect(ultimoA(r.email)).toBeUndefined();
    const e = (await estado(r.reserva)).body;
    expect(e).toEqual(expect.objectContaining({ estado: 'RETENIDA', siguiente: 'ELEGIR_MEDIO', monto: 15000, pasarelaSimulada: true }));
    expect(e.medios).toEqual(['PAGO_EN_CENTRO', 'TRANSFERENCIA', 'PASARELA']);
    expect(new Date(e.venceEn).getTime()).toBeLessThanOrEqual(Date.now() + 31 * 60_000);

    expect((await medio(r.reserva, 'TRANSFERENCIA')).body.siguiente).toBe('ESPERAR_VALIDACION');
    const datos = (await t.http().post('/api/publico/reservas/transferencia').send({ reserva: r.reserva })).body;
    expect(datos).toEqual(expect.objectContaining({ origen: 'CENTRO', numeroCuenta: '000-123456', monto: 15000 }));
    const malo = await t.http().post('/api/publico/reservas/comprobante').field('reserva', r.reserva).attach('archivo', Buffer.from('hola'), 'x.pdf');
    expect(malo.status).toBe(422);
    const subido = await t.http().post('/api/publico/reservas/comprobante').field('reserva', r.reserva).attach('archivo', PDF, 'comprobante.pdf');
    expect(subido.body.comprobanteRecibido).toBe(true);
    expect(new Date(subido.body.venceEn).getTime()).toBeGreaterThan(Date.now() + 23 * HORA);

    const pendientes = (
      await t
        .http()
        .get('/api/cobros/transferencias')
        .query({ estado: 'POR_VALIDAR' })
        .set(await tk(gestion))
    ).body;
    const trf = pendientes.find((x: { citaId: string }) => x.citaId === r.citaId);
    expect(trf).toEqual(expect.objectContaining({ comprobanteRecibido: true, monto: 30000, pacienteId: null }));
    const archivo = await t
      .http()
      .get(`/api/cobros/transferencias/${trf.id}/comprobante`)
      .set(await tk(gestion));
    expect(archivo.headers['content-type']).toContain('application/pdf');

    // Con cobro del centro no valida el profesional.
    expect(
      (
        await t
          .http()
          .post(`/api/cobros/citas/${r.citaId}/transferencia/validacion`)
          .set(await tk(prof))
      ).status,
    ).toBe(403);
    const rechazo = await t
      .http()
      .post(`/api/cobros/citas/${r.citaId}/transferencia/rechazo`)
      .set(await tk(gestion))
      .send({ motivo: 'El monto no coincide' });
    expect(rechazo.body).toEqual(expect.objectContaining({ estado: 'RECHAZADA', motivoRechazo: 'El monto no coincide' }));
    expect((await estado(r.reserva)).body.siguiente).toBe('TRANSFERENCIA_RECHAZADA');
    await t.http().post('/api/publico/reservas/comprobante').field('reserva', r.reserva).attach('archivo', PDF, 'otro.pdf');
    const ok = await t
      .http()
      .post(`/api/cobros/citas/${r.citaId}/transferencia/validacion`)
      .set(await tk(gestion));
    expect(ok.body).toEqual(expect.objectContaining({ estado: 'VALIDADA', pacienteId: expect.any(String) }));
    expect((await estado(r.reserva)).body.estado).toBe('CONFIRMADA');
    const cita = await t.dueno.cita.findUniqueOrThrow({ where: { id: r.citaId }, include: { paciente: true } });
    expect(cita.paciente).toEqual(expect.objectContaining({ creadoPorSolicitud: true, email: r.email }));
    const pago = await t.dueno.pago.findFirstOrThrow({ where: { citaId: r.citaId } });
    expect(pago).toEqual(expect.objectContaining({ monto: 15000, medioPago: 'TRANSFERENCIA', cobradoPor: 'CENTRO' }));
    // La invitacion a la cuenta sale despues del COMMIT, al correo de la reserva.
    expect(ultimoA(r.email)?.asunto).toContain('Active su cuenta');
    const enviados = await procesarMensajes(t);
    const asuntos = enviados.filter((c) => c.para === r.email).map((c) => c.asunto);
    expect(asuntos).toEqual(expect.arrayContaining(['Pago validado']));
  });

  it('cobro directo: valida el profesional de la cita (no GESTION), con los datos de su cuenta', async () => {
    await configurar({ modeloCobro: 'MIXTO' });
    await t
      .http()
      .patch(`/api/profesionales/${directo.id}/perfil`)
      .set(await tk(admin))
      .send({ cobroDirecto: true });
    await t
      .http()
      .put('/api/profesionales/yo/datos-privados')
      .set(await tk(directo))
      .send({ rut: '22.222.222-2', banco: BANCOS[0], tipoCuenta: 'CORRIENTE', numeroCuenta: '99887766', titular: 'Ps. Directo' });
    const r = await pedir(directo);
    await medio(r.reserva, 'TRANSFERENCIA');
    expect((await t.http().post('/api/publico/reservas/transferencia').send({ reserva: r.reserva })).body).toEqual(
      expect.objectContaining({ origen: 'PROFESIONAL', numeroCuenta: '99887766' }),
    );
    expect(
      (
        await t
          .http()
          .post(`/api/cobros/citas/${r.citaId}/transferencia/validacion`)
          .set(await tk(gestion))
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post(`/api/cobros/citas/${r.citaId}/transferencia/validacion`)
          .set(await tk(directo))
      ).status,
    ).toBe(200);
    expect((await t.dueno.pago.findFirstOrThrow({ where: { citaId: r.citaId } })).cobradoPor).toBe('PROFESIONAL');
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: r.citaId } })).estado).toBe('CONFIRMADA');
    await configurar({ modeloCobro: 'CENTRO' });
  });

  it('pasarela simulada: modo demostracion; el webhook registra el pago una vez, con firma valida, y crea al paciente', async () => {
    const r = await pedir(prof);
    await medio(r.reserva, 'PASARELA');
    const cobro = (await t.http().post('/api/publico/reservas/pasarela').send({ reserva: r.reserva })).body;
    expect(cobro).toEqual(expect.objectContaining({ simulada: true }));
    expect(cobro.urlPago).toContain('/pago-simulado?');
    // Firma invalida: 401, sin efectos.
    expect(
      (
        await t
          .http()
          .post('/api/publico/pasarela/webhook')
          .set('x-pasarela-firma', 'mala')
          .send({ eventoId: 'e1', referencia: cobro.referencia, pagado: true })
      ).status,
    ).toBe(401);
    // El webhook firmado (como lo manda la pasarela) confirma; repetirlo no duplica el pago.
    const { cuerpo, firma } = t.app.get<ProveedorPasarela, PasarelaSimulada>(ProveedorPasarela).simular(cobro.referencia, true);
    for (let i = 0; i < 2; i++) {
      const w = await t.http().post('/api/publico/pasarela/webhook').set('x-pasarela-firma', firma).send(cuerpo);
      expect(w.body).toEqual({ estado: 'PAGADO' });
    }
    expect(await t.dueno.pago.count({ where: { citaId: r.citaId, medioPago: 'PASARELA' } })).toBe(1);
    expect((await estado(r.reserva)).body.estado).toBe('CONFIRMADA');
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: r.citaId } })).pacienteId).not.toBeNull();
    expect(ultimoA(r.email)?.asunto).toContain('Active su cuenta');
    // La pantalla de demostracion usa el atajo simulado: otro intento, pago rechazado.
    const r2 = await pedir(prof);
    await medio(r2.reserva, 'PASARELA');
    const c2 = (await t.http().post('/api/publico/reservas/pasarela').send({ reserva: r2.reserva })).body;
    expect((await t.http().post('/api/publico/pasarela/simulada').send({ referencia: c2.referencia, pagado: false })).body).toEqual({ estado: 'FALLIDO' });
    expect((await estado(r2.reserva)).body).toEqual(expect.objectContaining({ estado: 'RETENIDA', siguiente: 'PAGAR_EN_LINEA' }));
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: r2.citaId } })).pacienteId).toBeNull();
  });

  it('pago en el centro elegido en la reserva: sale el enlace al correo y al abrirlo se confirma', async () => {
    const r = await pedir(prof);
    const e = await medio(r.reserva, 'PAGO_EN_CENTRO');
    expect(e.body).toEqual(expect.objectContaining({ estado: 'RETENIDA', siguiente: 'VERIFICAR_CORREO', medio: 'PAGO_EN_CENTRO' }));
    const enlace = tokenDe(ultimoA(r.email));
    expect(enlace).not.toBe('');
    expect((await verificar(enlace)).body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', invitacionEnviada: true }));
    expect((await estado(r.reserva)).body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', medio: 'PAGO_EN_CENTRO' }));
  });

  it('el vencimiento lo decide el job: verificacion tardia (hora libre y tomada); la hora que agenda el equipo con el pago vencido se mantiene', async () => {
    const jobs = t.app.get(JobsService);
    // Retencion vencida (pago en el centro elegido) y hora libre: la verificacion tardia continua.
    const libre = await pedir(prof);
    await medio(libre.reserva, 'PAGO_EN_CENTRO');
    const enlaceLibre = tokenDe(ultimoA(libre.email));
    const tomada = await pedir(prof);
    await medio(tomada.reserva, 'PAGO_EN_CENTRO');
    const enlaceTomada = tokenDe(ultimoA(tomada.email));
    await t.dueno.cita.updateMany({ where: { id: { in: [libre.citaId, tomada.citaId] } }, data: { pagoVenceEn: new Date(Date.now() - 60_000) } });
    // El cliente no decide: hasta que corre el job la reserva figura vencida por hora del servidor.
    expect((await estado(libre.reserva)).body).toEqual(expect.objectContaining({ estado: 'LIBERADA', siguiente: 'ELEGIR_OTRA_HORA' }));
    expect(await jobs.liberarReservasVencidas()).toEqual({ corrio: true, total: 2 });
    expect((await verificar(enlaceLibre)).body.estado).toBe('CONFIRMADA');
    // Hora tomada por otro: 409 con alternativas.
    const pac = await t.datos.paciente(prof.id);
    await t.dueno.cita.create({
      data: { profesionalId: prof.id, pacienteId: pac.id, modalidad: 'ONLINE', inicio: tomada.inicio, fin: new Date(tomada.inicio.getTime() + HORA) },
    });
    const conflicto = await verificar(enlaceTomada);
    expect(conflicto.status).toBe(409);
    expect(conflicto.body.restriccion).toBe('solicitudes_hora_tomada');
    expect(conflicto.body.alternativas.length).toBeGreaterThan(0);

    // Pago vencido de la hora que agenda el equipo (03b-3.3): la hora se mantiene con pago en el centro (queda el saldo).
    const p = await t.datos.usuarioPaciente(prof.id);
    const inicio = new Date(Math.ceil((Date.now() + dia++ * DIA) / HORA) * HORA);
    const cita = await t
      .http()
      .post('/api/citas')
      .set(await tk(gestion))
      .send({ pacienteId: p.pacienteId, profesionalId: prof.id, modalidad: 'PRESENCIAL', inicio, fin: new Date(inicio.getTime() + HORA) });
    expect(cita.body.estado).toBe('PENDIENTE_PAGO');
    await t.dueno.cita.update({ where: { id: cita.body.id }, data: { pagoVenceEn: new Date(Date.now() - 60_000) } });
    expect(await jobs.liberarReservasVencidas()).toEqual({ corrio: true, total: 1 });
    expect(await t.dueno.cita.findUniqueOrThrow({ where: { id: cita.body.id } })).toEqual(
      expect.objectContaining({ estado: 'CONFIRMADA', medioConfirmacion: 'PAGO_EN_CENTRO' }),
    );
    const enviados = await procesarMensajes(t);
    expect(enviados.filter((c) => c.para === p.email).map((c) => c.asunto)).not.toContain('Su hora se libero');
    const huecos = (
      await t
        .http()
        .get(`/api/publico/profesionales/${prof.id}/disponibilidad`)
        .query({ desde: new Date(inicio.getTime() - HORA).toISOString(), hasta: new Date(inicio.getTime() + 2 * HORA).toISOString() })
    ).body as { modalidad: string; inicio: string; fin: string }[];
    expect(huecos.some((h) => h.modalidad === 'PRESENCIAL' && new Date(h.inicio) <= inicio && new Date(h.fin) > inicio)).toBe(false);
  });

  it('hora que agenda el equipo: pendiente de pago hasta 12 h antes con aviso; el paciente la ve en su cuenta; el pago en caja la confirma; a menos de 12 h, pago en el centro', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    const inicio = new Date(Math.ceil((Date.now() + dia++ * DIA) / HORA) * HORA);
    const r = await t
      .http()
      .post('/api/citas')
      .set(await tk(gestion))
      .send({ pacienteId: p.pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA) });
    expect(r.status).toBe(201);
    expect(r.body).toEqual(expect.objectContaining({ estado: 'PENDIENTE_PAGO', pagoVenceEn: new Date(inicio.getTime() - 12 * HORA).toISOString() }));
    expect((await procesarMensajes(t)).find((c) => c.para === p.email)?.asunto).toBe('Hora pendiente de pago');
    const pago = await t
      .http()
      .get(`/api/portal/citas/${r.body.id}/pago`)
      .set(await tk(p));
    expect(pago.body).toEqual(expect.objectContaining({ estado: 'PENDIENTE_PAGO', siguiente: 'ELEGIR_MEDIO', monto: 15000 }));
    expect(
      (
        await t
          .http()
          .post(`/api/cobros/citas/${r.body.id}/pagos`)
          .set(await tk(gestion))
          .send({ monto: 15000, medioPago: 'EFECTIVO' })
      ).status,
    ).toBe(201);
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: r.body.id } })).estado).toBe('CONFIRMADA');

    // Recordatorio 48 h antes (agendada antes de ese hito).
    const recordar = horaEntre(30, 46);
    const r48 = await t
      .http()
      .post('/api/citas')
      .set(await tk(gestion))
      .send({ pacienteId: p.pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', inicio: recordar, fin: new Date(recordar.getTime() + HORA) });
    expect(r48.body.estado).toBe('PENDIENTE_PAGO');
    await t.dueno.cita.update({ where: { id: r48.body.id }, data: { createdAt: new Date(Date.now() - 3 * DIA) } });
    await procesarMensajes(t);
    expect(await t.app.get(JobsService).avisarPagosPendientes()).toEqual({ corrio: true, total: 1 });
    expect((await procesarMensajes(t)).filter((c) => c.para === p.email).map((c) => c.asunto)).toEqual(['Hora pendiente de pago']);

    // A menos de 12 h no hay plazo para el pago previo: confirmada con pago en el centro.
    const pronto = horaEntre(2, 10);
    const r2 = await t
      .http()
      .post('/api/citas')
      .set(await tk(gestion))
      .send({ pacienteId: p.pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', inicio: pronto, fin: new Date(pronto.getTime() + HORA) });
    expect(r2.body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', medioConfirmacion: 'PAGO_EN_CENTRO' }));
  });

  it('portal: paciente con cuenta pasa directo al pago (plazo corto); elige medio y ve su estado; otro paciente no', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    const otro = await t.datos.usuarioPaciente(prof.id);
    const inicio = new Date(Math.ceil((Date.now() + dia++ * DIA) / HORA) * HORA);
    const reserva = await t
      .http()
      .post('/api/portal/citas')
      .set(await tk(p))
      .send({ modalidad: 'PRESENCIAL', inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + HORA).toISOString(), politicaId, terminosId });
    expect(reserva.body.estado).toBe('PENDIENTE_PAGO');
    const citaId = reserva.body.citaId as string;
    const lista = (
      await t
        .http()
        .get('/api/portal/citas')
        .set(await tk(p))
    ).body;
    const enLista = lista.find((c: { id: string }) => c.id === citaId);
    expect(enLista).toEqual(expect.objectContaining({ estado: 'PENDIENTE_PAGO' }));
    expect(new Date(enLista.pagoVenceEn).getTime()).toBeLessThanOrEqual(Date.now() + 31 * 60_000);
    expect(
      (
        await t
          .http()
          .get(`/api/portal/citas/${citaId}/pago`)
          .set(await tk(otro))
      ).status,
    ).toBe(404);
    await t
      .http()
      .post(`/api/portal/citas/${citaId}/medio`)
      .set(await tk(p))
      .send({ medio: 'TRANSFERENCIA' });
    expect(
      (
        await t
          .http()
          .get(`/api/portal/citas/${citaId}/transferencia`)
          .set(await tk(p))
      ).body.origen,
    ).toBe('CENTRO');
    const subido = await t
      .http()
      .post(`/api/portal/citas/${citaId}/comprobante`)
      .set(await tk(p))
      .attach('archivo', PDF, 'c.pdf');
    expect(subido.body.comprobanteRecibido).toBe(true);
    expect(await t.dueno.accesoFicha.count({ where: { pacienteId: p.pacienteId, recurso: 'datos_transferencia' } })).toBe(1);
  });
});
