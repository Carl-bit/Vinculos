/**
 * 02f: derivaciones, consentimientos, avisos y notificaciones. Flujos
 * completos: aceptar, rechazar, vencer, agotar lista; consentimiento
 * aceptado / rechazado / vencido; revocacion con citas POR_REPROGRAMAR.
 */
import { JobsService } from '../src/core/jobs/jobs.service';
import { NotificacionesService } from '../src/core/notificaciones/notificaciones.service';
import { auth, crearApp, procesarMensajes, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('02f derivaciones y consentimientos', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let origen: UsuarioPrueba;
  let candidatoB: UsuarioPrueba;
  let candidatoC: UsuarioPrueba;
  let supervisor: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let tipoAtencionId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    origen = await t.datos.usuario('PROFESIONAL');
    candidatoB = await t.datos.usuario('PROFESIONAL');
    candidatoC = await t.datos.usuario('PROFESIONAL');
    supervisor = await t.datos.usuario('PROFESIONAL');
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
    await t.datos.disponibleSiempre(practicante.id);
    tipoAtencionId = (await t.datos.tipoAtencion()).id;
  });

  afterAll(() => t.cerrar());

  const derivar = async (fichaId: string, candidatos: string[]) => {
    const r = await t.http().post('/api/derivaciones').set(await tk(origen)).send({ fichaId, motivo: 'Motivo clinico de prueba', detalle: 'Detalle', tipoAtencionId, candidatos });
    expect(r.status).toBe(201);
    return r.body.id as string;
  };
  const estadoDerivacion = async (id: string) => (await t.dueno.derivacion.findUniqueOrThrow({ where: { id } })).estado;
  const candidatos = async (id: string) =>
    Object.fromEntries((await t.dueno.derivacionCandidato.findMany({ where: { derivacionId: id } })).map((c) => [c.profesionalId, c.estado]));

  /** Paciente (con usuario PACIENTE) derivado al practicante, con la solicitud de consentimiento abierta. */
  const hastaSolicitud = async () => {
    const paciente = await t.datos.usuarioPaciente(origen.id);
    const id = await derivar(paciente.fichaId, []);
    expect((await t.http().post(`/api/derivaciones/${id}/practicantes`).set(await tk(supervisor)).send({ practicanteId: practicante.id })).status).toBe(200);
    expect((await t.http().post(`/api/derivaciones/${id}/respuesta`).set(await tk(practicante)).send({ acepta: true })).status).toBe(200);
    expect(await estadoDerivacion(id)).toBe('ESPERANDO_CONSENTIMIENTO');
    const consentimiento = await t.dueno.consentimiento.findFirstOrThrow({ where: { derivacionId: id, estado: 'SOLICITADO' } });
    return { paciente, derivacionId: id, consentimientoId: consentimiento.id };
  };

  it('crear (motivo cifrado): oferta al primero; solo el ofrecido la ve; rechazo -> siguiente; aceptar traspasa', async () => {
    const paciente = await t.datos.usuarioPaciente(origen.id);
    expect((await t.http().post('/api/derivaciones').set(await tk(gestion)).send({ fichaId: paciente.fichaId, motivo: 'x', tipoAtencionId, candidatos: [] })).status).toBe(403);
    expect((await t.http().post('/api/derivaciones').set(await tk(candidatoB)).send({ fichaId: paciente.fichaId, motivo: 'x', tipoAtencionId, candidatos: [] })).status).toBe(403);
    expect((await t.http().post('/api/derivaciones').set(await tk(origen)).send({ fichaId: paciente.fichaId, motivo: '   ', tipoAtencionId, candidatos: [] })).status).toBe(400);
    const id = await derivar(paciente.fichaId, [candidatoB.id, candidatoC.id]);
    const fila = await t.dueno.derivacion.findUniqueOrThrow({ where: { id } });
    expect(Buffer.from(fila.motivo).toString('latin1')).not.toContain('Motivo clinico');
    // El origen ve la derivacion descifrada; una segunda abierta para la misma ficha -> 409.
    expect((await t.http().get(`/api/derivaciones/${id}`).set(await tk(origen))).body.motivo).toBe('Motivo clinico de prueba');
    expect((await t.http().post('/api/derivaciones').set(await tk(origen)).send({ fichaId: paciente.fichaId, motivo: 'otra', tipoAtencionId, candidatos: [candidatoC.id] })).status).toBe(409);

    const oferta = await t.http().get(`/api/derivaciones/${id}/oferta`).set(await tk(candidatoB));
    expect(oferta.status).toBe(200);
    expect(oferta.body).toEqual(expect.objectContaining({ motivo: 'Motivo clinico de prueba', detalle: 'Detalle', edadPaciente: expect.any(Number) }));
    expect(JSON.stringify(oferta.body)).not.toContain(paciente.pacienteId);
    expect((await t.http().get(`/api/derivaciones/${id}/oferta`).set(await tk(candidatoC))).status).toBe(404);
    expect(await t.dueno.notificacion.count({ where: { tipo: 'DERIVACION_OFRECIDA', canal: 'BANDEJA', usuarioId: candidatoB.id, referenciaId: id } })).toBe(1);

    expect((await t.http().post(`/api/derivaciones/${id}/respuesta`).set(await tk(candidatoB)).send({ acepta: false })).status).toBe(200);
    expect(await candidatos(id)).toEqual({ [candidatoB.id]: 'RECHAZADA', [candidatoC.id]: 'OFRECIDA' });
    expect((await t.http().post(`/api/derivaciones/${id}/respuesta`).set(await tk(candidatoB)).send({ acepta: true })).status).toBe(403);

    expect((await t.http().post(`/api/derivaciones/${id}/respuesta`).set(await tk(candidatoC)).send({ acepta: true })).status).toBe(200);
    expect(await estadoDerivacion(id)).toBe('ACEPTADA');
    expect((await t.dueno.paciente.findUniqueOrThrow({ where: { id: paciente.pacienteId } })).profesionalId).toBe(candidatoC.id);
    expect((await t.http().get(`/api/pacientes/${paciente.pacienteId}`).set(await tk(origen))).status).toBe(404);
    expect((await t.http().get(`/api/pacientes/${paciente.pacienteId}`).set(await tk(candidatoC))).status).toBe(200);
  });

  it('oferta vencida (job) y lista agotada -> SIN_ASIGNAR; el origen la cierra', async () => {
    const p1 = await t.datos.paciente(origen.id);
    const id = await derivar(p1.fichaId, [candidatoB.id]);
    await t.dueno.derivacionCandidato.updateMany({ where: { derivacionId: id, estado: 'OFRECIDA' }, data: { ofrecidaEn: new Date(Date.now() - 2 * 86_400_000), venceEn: new Date(Date.now() - 1000) } });
    expect(await t.app.get(JobsService).expirarOfertas()).toEqual(expect.objectContaining({ corrio: true }));
    expect(await candidatos(id)).toEqual({ [candidatoB.id]: 'EXPIRADA' });
    expect(await estadoDerivacion(id)).toBe('SIN_ASIGNAR');
    expect((await t.http().get(`/api/derivaciones/${id}/oferta`).set(await tk(candidatoB))).status).toBe(404);
    const cerrada = await t.http().post(`/api/derivaciones/${id}/cancelacion`).set(await tk(origen)).send({ motivo: 'sin cupo' });
    expect(cerrada.body.estado).toBe('CERRADA');
    expect((await t.http().post(`/api/derivaciones/${id}/cancelacion`).set(await tk(origen)).send({ motivo: 'otra vez' })).status).toBe(409);

    // Agotar la lista por rechazo.
    const p2 = await t.datos.paciente(origen.id);
    const id2 = await derivar(p2.fichaId, [candidatoB.id]);
    await t.http().post(`/api/derivaciones/${id2}/respuesta`).set(await tk(candidatoB)).send({ acepta: false });
    expect(await estadoDerivacion(id2)).toBe('SIN_ASIGNAR');
    // ADMIN reintegra al candidato: vuelve a recibir la oferta.
    expect((await t.http().post(`/api/derivaciones/${id2}/candidatos/${candidatoB.id}/reintegro`).set(await tk(admin))).status).toBe(200);
    expect((await t.http().get(`/api/derivaciones/${id2}/oferta`).set(await tk(candidatoB))).status).toBe(200);
  });

  it('practicante: bandeja del supervisor, propuesta, aceptacion y consentimiento ACEPTADO por el paciente', async () => {
    const pendientes = await t.http().get('/api/derivaciones/pendientes').set(await tk(supervisor));
    expect(pendientes.status).toBe(200);
    expect((await t.http().get('/api/derivaciones/pendientes').set(await tk(candidatoB))).status).toBe(403);

    const { paciente, derivacionId, consentimientoId } = await hastaSolicitud();
    expect(await t.dueno.notificacion.count({ where: { tipo: 'CONSENTIMIENTO_SOLICITADO', canal: 'BANDEJA', pacienteId: paciente.pacienteId } })).toBe(1);
    const propios = await t.http().get('/api/consentimientos').set(await tk(paciente));
    expect(propios.body.map((c: { id: string }) => c.id)).toEqual([consentimientoId]);
    // El supervisor solicita pero nunca registra la respuesta.
    expect((await t.http().post(`/api/consentimientos/${consentimientoId}/respuesta`).set(await tk(supervisor)).send({ acepta: true, versionDocumento: 'v1', otorgadoPorTipo: 'PACIENTE' })).status).toBe(403);
    expect((await t.http().post(`/api/consentimientos/${consentimientoId}/respuesta`).set(await tk(paciente)).send({ acepta: true, otorgadoPorTipo: 'PACIENTE' })).status).toBe(400);
    const r = await t.http().post(`/api/consentimientos/${consentimientoId}/respuesta`).set(await tk(paciente)).send({ acepta: true, versionDocumento: 'v1', otorgadoPorTipo: 'PACIENTE' });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('ACEPTADO');
    expect(await estadoDerivacion(derivacionId)).toBe('ACEPTADA');
    expect((await t.http().get(`/api/pacientes/${paciente.pacienteId}`).set(await tk(practicante))).status).toBe(200);

    // Revocacion: corte inmediato y citas futuras POR_REPROGRAMAR.
    const inicio = new Date(Date.now() + 5 * 86_400_000);
    inicio.setUTCHours(15, 0, 0, 0);
    const cita = await t.http().post('/api/citas').set(await tk(gestion)).send({ pacienteId: paciente.pacienteId, profesionalId: practicante.id, modalidad: 'ONLINE', inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 3_600_000).toISOString() });
    expect(cita.status).toBe(201);
    const rev = await t.http().post(`/api/consentimientos/${consentimientoId}/revocacion`).set(await tk(paciente)).send({ otorgadoPorTipo: 'PACIENTE' });
    expect(rev.body.estado).toBe('REVOCADO');
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: cita.body.id } })).estado).toBe('POR_REPROGRAMAR');
    expect((await t.http().get(`/api/pacientes/${paciente.pacienteId}`).set(await tk(practicante))).status).toBe(404);
    const bandeja = await t.http().get('/api/bajas/por-reasignar').set(await tk(admin));
    expect(bandeja.body.find((b: { paciente_id: string }) => b.paciente_id === paciente.pacienteId)?.motivo).toBe('CONSENTIMIENTO');
  });

  it('consentimiento RECHAZADO (GESTION con respaldo) -> candidato RECHAZADO_POR_PACIENTE; sin mas candidatos SIN_ASIGNAR', async () => {
    const { derivacionId, consentimientoId } = await hastaSolicitud();
    const sinRespaldo = await t.http().post(`/api/consentimientos/${consentimientoId}/respuesta`).set(await tk(gestion)).send({ acepta: false, otorgadoPorTipo: 'PACIENTE' });
    expect(sinRespaldo.status).toBe(422);
    expect(sinRespaldo.body.restriccion).toBe('consentimientos_respaldo_obligatorio');
    const r = await t.http().post(`/api/consentimientos/${consentimientoId}/respuesta`).set(await tk(gestion)).send({ acepta: false, otorgadoPorTipo: 'PACIENTE', respaldoDocumentoRef: 'scan-001.pdf' });
    expect(r.body.estado).toBe('RECHAZADO');
    expect(await candidatos(derivacionId)).toEqual({ [practicante.id]: 'RECHAZADO_POR_PACIENTE' });
    expect(await estadoDerivacion(derivacionId)).toBe('SIN_ASIGNAR');
  });

  it('consentimiento vencido (job) -> VENCIDO y candidato RECHAZADO_POR_PACIENTE', async () => {
    const { derivacionId, consentimientoId } = await hastaSolicitud();
    await t.dueno.consentimiento.update({ where: { id: consentimientoId }, data: { solicitadoEn: new Date(Date.now() - 3 * 86_400_000), venceEn: new Date(Date.now() - 1000) } });
    await t.app.get(JobsService).expirarOfertas();
    expect((await t.dueno.consentimiento.findUniqueOrThrow({ where: { id: consentimientoId } })).estado).toBe('VENCIDO');
    expect(await candidatos(derivacionId)).toEqual({ [practicante.id]: 'RECHAZADO_POR_PACIENTE' });
  });

  it('menor: responde un adulto responsable (422 si no)', async () => {
    const menor = await t.datos.paciente(origen.id, { fechaNacimiento: new Date('2014-01-01') });
    const adulto = (await t.http().post(`/api/pacientes/${menor.id}/adultos-responsables`).set(await tk(gestion)).send({ nombre: 'Madre' })).body;
    const id = await derivar(menor.fichaId, []);
    await t.http().post(`/api/derivaciones/${id}/practicantes`).set(await tk(admin)).send({ practicanteId: practicante.id });
    await t.http().post(`/api/derivaciones/${id}/respuesta`).set(await tk(practicante)).send({ acepta: true });
    const c = await t.dueno.consentimiento.findFirstOrThrow({ where: { derivacionId: id } });
    const comoPaciente = await t.http().post(`/api/consentimientos/${c.id}/respuesta`).set(await tk(gestion)).send({ acepta: true, versionDocumento: 'v1', otorgadoPorTipo: 'PACIENTE', respaldoDocumentoRef: 'doc' });
    expect(comoPaciente.status).toBe(422);
    expect(comoPaciente.body.restriccion).toBe('consentimientos_menor_requiere_adulto_responsable');
    const ok = await t.http().post(`/api/consentimientos/${c.id}/respuesta`).set(await tk(gestion)).send({ acepta: true, versionDocumento: 'v1', otorgadoPorTipo: 'ADULTO_RESPONSABLE', adultoResponsableId: adulto.id, respaldoDocumentoRef: 'doc' });
    expect(ok.body.estado).toBe('ACEPTADO');
  });

  it('cambio de supervisor: aviso notificado; el paciente se opone -> revocado', async () => {
    const p = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
    const caso = await t.datos.pacienteDePracticante(p.id, supervisor.id);
    const usuarioPaciente = await t.datos.usuario('PACIENTE', { pacienteId: caso.id });
    const nuevo = await t.datos.usuario('PROFESIONAL');
    expect((await t.http().post(`/api/practicantes/${p.id}/supervisor`).set(await tk(admin)).send({ supervisorId: nuevo.id })).body.avisosCreados).toBe(1);
    const avisos = await t.http().get('/api/avisos-consentimiento').set(await tk(usuarioPaciente));
    expect(avisos.body).toHaveLength(1);
    expect(await t.dueno.notificacion.count({ where: { tipo: 'AVISO_CAMBIO_SUPERVISOR', canal: 'BANDEJA', pacienteId: caso.id } })).toBe(1);
    const r = await t.http().post(`/api/avisos-consentimiento/${avisos.body[0].id}/respuesta`).set(await tk(usuarioPaciente)).send({ respuesta: 'OPOSICION', otorgadoPorTipo: 'PACIENTE' });
    expect(r.body.respuesta).toBe('OPOSICION');
    expect((await t.dueno.consentimiento.findFirstOrThrow({ where: { pacienteId: caso.id } })).estado).toBe('REVOCADO');
    expect((await t.http().post(`/api/avisos-consentimiento/${avisos.body[0].id}/respuesta`).set(await tk(usuarioPaciente)).send({ respuesta: 'CONFORME', otorgadoPorTipo: 'PACIENTE' })).status).toBe(409);
  });

  it('notificaciones: registradas por accion; el job las envia (o marca FALLIDO sin email); cada uno ve las suyas', async () => {
    const enviados = await procesarMensajes(t);
    expect((await t.app.get(NotificacionesService).enviarPendientes()).corrio).toBe(true);
    expect(await t.dueno.notificacion.count({ where: { estado: 'PENDIENTE', proximoIntento: { lte: new Date() } } })).toBe(0);
    expect(await t.dueno.notificacion.count({ where: { estado: 'ENVIADO' } })).toBeGreaterThan(0);
    expect(enviados.some((c) => c.para === candidatoB.email && c.asunto === 'Nueva oferta de derivación')).toBe(true);
    // Nunca contenido clinico en el correo.
    expect(enviados.every((c) => !c.texto.includes('Motivo clinico'))).toBe(true);
    const deB = await t.http().get('/api/notificaciones').set(await tk(candidatoB));
    expect(deB.body.length).toBeGreaterThan(0);
    expect(deB.body.every((n: { usuarioId: string }) => n.usuarioId === candidatoB.id)).toBe(true);
    expect((await t.http().get('/api/notificaciones').set(await tk(gestion))).body.length).toBeGreaterThan(deB.body.length);
  });
});
