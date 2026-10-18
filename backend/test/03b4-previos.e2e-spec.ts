/**
 * Antes de 03b-4 (pendientes de 03b-3): reserva desde la cuenta del paciente
 * (solo con su tratante; el adolescente no reserva; el adulto responsable por
 * su menor; aprobacion de pacientes nuevos; politica vigente; EXCLUDE) y
 * descarga del documento desde el portal con sesion.
 */
import { randomUUID } from 'node:crypto';

import { auth, binario, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;

describe('03b-4 previos: reserva y descarga desde el portal', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let tratante: UsuarioPrueba;
  let politicaId: string;
  let terminosId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  let siguiente = 0;
  /** Horas distintas por prueba (en punto, a varios dias): sin choques entre casos. */
  const hora = () => {
    siguiente += 2;
    const inicio = new Date(Math.ceil((Date.now() + 3 * 24 * HORA) / HORA) * HORA + siguiente * HORA);
    return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 50 * 60_000).toISOString() };
  };
  const reservar = async (u: UsuarioPrueba, cuerpo: Record<string, unknown>) =>
    t
      .http()
      .post('/api/portal/citas')
      .set(await tk(u))
      .send({ modalidad: 'PRESENCIAL', politicaId, terminosId, ...cuerpo });

  beforeAll(async () => {
    t = await crearApp();
    admin = await t.datos.usuario('ADMIN');
    tratante = await t.datos.usuario('PROFESIONAL', { nombre: 'Tratante Portal' });
    await t.datos.disponibleSiempre(tratante.id);
    for (const [tipo, texto] of [
      ['POLITICA_DATOS', 'Politica 03b-4'],
      ['TERMINOS_AGENDAMIENTO', 'Terminos 03b-4'],
    ]) {
      await t
        .http()
        .post('/api/politicas')
        .set(await tk(admin))
        .send({ tipo, texto });
    }
    politicaId = (await t.http().get('/api/publico/politicas/POLITICA_DATOS')).body.id;
    terminosId = (await t.http().get('/api/publico/politicas/TERMINOS_AGENDAMIENTO')).body.id;
  });

  afterAll(() => t.cerrar());

  it('paciente adulto: hora con su tratante, una sola vez (EXCLUDE), politica vigente registrada', async () => {
    const paciente = await t.datos.usuarioPaciente(tratante.id);
    const h = hora();
    // Horas de su tratante con su contexto (el tratante no tiene perfil publico).
    const libres = await t
      .http()
      .get('/api/portal/disponibilidad')
      .query({ desde: new Date().toISOString(), hasta: new Date(Date.now() + 10 * 24 * HORA).toISOString() })
      .set(await tk(paciente));
    expect(libres.status).toBe(200);
    expect((libres.body as { inicio: string; fin: string }[]).some((x) => x.inicio <= h.inicio && x.fin >= h.fin)).toBe(true);
    const r = await reservar(paciente, h);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ citaId: expect.any(String), estado: 'CONFIRMADA', profesionalId: tratante.id });
    const cita = await t.dueno.cita.findUniqueOrThrow({ where: { id: r.body.citaId } });
    expect(cita).toEqual(expect.objectContaining({ pacienteId: paciente.pacienteId, estado: 'CONFIRMADA' }));
    expect(cita.espacioId).not.toBeNull();
    expect(await t.dueno.aceptacionPolitica.count({ where: { pacienteId: paciente.pacienteId, canal: 'PORTAL' } })).toBe(2);

    // Mismo horario: ya no esta disponible (409, sin segunda cita).
    const otro = await t.datos.usuarioPaciente(tratante.id);
    const choque = await reservar(otro, h);
    expect(choque.status).toBe(409);
    expect(await t.dueno.cita.count({ where: { profesionalId: tratante.id, inicio: new Date(h.inicio), estado: 'CONFIRMADA' } })).toBe(1);

    // Otra hora: no repite las aceptaciones de la misma version.
    expect((await reservar(paciente, hora())).status).toBe(201);
    expect(await t.dueno.aceptacionPolitica.count({ where: { pacienteId: paciente.pacienteId, canal: 'PORTAL' } })).toBe(2);
  });

  it('reglas: politica vieja 422; hora pasada 422; online con enlace; sin tratante con agenda 409', async () => {
    const paciente = await t.datos.usuarioPaciente(tratante.id);
    expect((await reservar(paciente, { ...hora(), politicaId: randomUUID() })).status).toBe(422);
    const pasado = new Date(Date.now() - 2 * HORA);
    expect((await reservar(paciente, { inicio: pasado, fin: new Date(pasado.getTime() + HORA) })).status).toBe(422);

    await t
      .http()
      .put('/api/profesionales/yo/videollamada')
      .set(await tk(tratante))
      .send({ modo: 'JITSI' });
    const online = await reservar(paciente, { ...hora(), modalidad: 'ONLINE' });
    expect(online.status).toBe(201);
    const enlace = await t
      .http()
      .get(`/api/citas/${online.body.citaId}/enlace`)
      .set(await tk(paciente));
    expect(enlace.status).toBe(200);
    expect(enlace.body.url).toMatch(/^https:\/\//);

    // Tratante sin bloques de box: la hora no esta disponible.
    const sinAgenda = await t.datos.usuario('PROFESIONAL');
    const deOtro = await t.datos.usuarioPaciente(sinAgenda.id);
    expect((await reservar(deOtro, hora())).status).toBe(409);
  });

  it('adolescente no reserva (422); el adulto responsable reserva por su menor; equipo 403', async () => {
    const adolescente = await t.datos.usuarioPaciente(tratante.id, { fechaNacimiento: new Date(new Date().getFullYear() - 16, 0, 15) });
    await t.dueno.adultoResponsable.create({ data: { id: randomUUID(), pacienteId: adolescente.pacienteId, nombre: 'Padre', parentesco: 'Padre' } });
    const r = await reservar(adolescente, hora());
    expect(r.status).toBe(422);
    expect(r.body.mensaje).toMatch(/adulto responsable/);

    const responsable = await t.datos.usuario('RESPONSABLE');
    await t.dueno.adultoResponsable.create({
      data: { id: randomUUID(), pacienteId: adolescente.pacienteId, nombre: 'Madre', parentesco: 'Madre', usuarioId: responsable.id },
    });
    const porMenor = await reservar(responsable, { ...hora(), pacienteId: adolescente.pacienteId });
    expect(porMenor.status).toBe(201);
    expect(await t.dueno.aceptacionPolitica.findFirst({ where: { pacienteId: adolescente.pacienteId, canal: 'PORTAL' } })).toEqual(
      expect.objectContaining({ otorgadoPor: 'ADULTO_RESPONSABLE' }),
    );
    // Un menor que no esta a su cargo: 404.
    const ajeno = await t.datos.paciente(tratante.id, { fechaNacimiento: new Date('2015-01-01') });
    expect((await reservar(responsable, { ...hora(), pacienteId: ajeno.id })).status).toBe(404);
    expect((await reservar(tratante, { ...hora(), pacienteId: ajeno.id })).status).toBe(403);
  });

  it('profesional que aprueba pacientes nuevos: SOLICITADA si aun no tiene cita confirmada con el', async () => {
    const aprueba = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(aprueba.id);
    await t
      .http()
      .put('/api/profesionales/yo/perfil')
      .set(await tk(aprueba))
      .send({ especialidad: 'Psicologia', modalidad: 'MIXTA', requiereAprobacionNuevos: true });
    const paciente = await t.datos.usuarioPaciente(aprueba.id);
    const r = await reservar(paciente, hora());
    expect(r.body.estado).toBe('SOLICITADA');
    await t.dueno.cita.update({ where: { id: r.body.citaId }, data: { estado: 'CONFIRMADA' } });
    expect((await reservar(paciente, hora())).body.estado).toBe('CONFIRMADA');
  });

  it('descarga desde el portal: el PDF del paciente queda registrado; otro paciente 404 y el equipo 403', async () => {
    const paciente = await t.datos.usuarioPaciente(tratante.id);
    const tipo = await t
      .http()
      .post('/api/tipos-documento-clinico')
      .set(await tk(admin))
      .send({ nombre: `Certificado ${randomUUID().slice(0, 6)}` });
    const doc = await t
      .http()
      .post('/api/documentos-clinicos')
      .set(await tk(tratante))
      .send({ pacienteId: paciente.pacienteId, tipoDocumentoId: tipo.body.id, contenido: 'Certificado de prueba 03b-4' });
    expect(doc.status).toBe(201);

    const pdf = await t
      .http()
      .get(`/api/documentos-clinicos/${doc.body.id}/pdf`)
      .set(await tk(paciente))
      .buffer(true)
      .parse(binario);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect(await t.dueno.descargaDocumento.count({ where: { documentoId: doc.body.id, envioId: null } })).toBe(1);
    expect(await t.dueno.accesoFicha.count({ where: { pacienteId: paciente.pacienteId, accion: 'DESCARGA' } })).toBe(1);

    const otro = await t.datos.usuarioPaciente(tratante.id);
    expect(
      (
        await t
          .http()
          .get(`/api/documentos-clinicos/${doc.body.id}/pdf`)
          .set(await tk(otro))
      ).status,
    ).toBe(404);
    expect(
      (
        await t
          .http()
          .get(`/api/documentos-clinicos/${doc.body.id}/pdf`)
          .set(await tk(tratante))
      ).status,
    ).toBe(403);
  });
});
