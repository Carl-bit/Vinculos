/**
 * 03b-3: lo que el portal del paciente y las paginas por enlace necesitan de
 * la API. Nombres en el enlace de consentimiento y supervisores del portal;
 * box de la cita; contacto de emergencia (solo lectura); bandeja con el texto
 * ya descifrado; el recordatorio apunta a la pagina publica /recordatorio.
 */
import { randomUUID } from 'node:crypto';

import { ProveedorCorreo, type Correo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { RecordatoriosService } from '../src/modulos/agenda/recordatorios.service';
import { auth, crearApp, procesarMensajes, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;

describe('03b-3 portal del paciente', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let origen: UsuarioPrueba;
  let supervisor: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correos = (): Correo[] => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo).enviados;
  const tokenDe = (c: Correo | undefined) => /token=([A-Za-z0-9_-]+)/.exec(c?.texto ?? '')?.[1] ?? '';
  const ultimoA = (para: string) => [...correos()].reverse().find((c) => c.para === para);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    origen = await t.datos.usuario('PROFESIONAL', { nombre: 'Origen Portal' });
    supervisor = await t.datos.usuario('PROFESIONAL', { nombre: 'Supervisora Portal' });
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id, nombre: 'Practicante Portal' });
    await t.datos.disponibleSiempre(origen.id);
    await t.datos.disponibleSiempre(practicante.id);
  });

  afterAll(() => t.cerrar());

  it('consentimiento de practicante: la pagina del enlace y el portal muestran quien atiende y quien supervisa', async () => {
    const paciente = await t.datos.usuarioPaciente(origen.id);
    const tipoAtencionId = (await t.datos.tipoAtencion()).id;
    const d = await t
      .http()
      .post('/api/derivaciones')
      .set(await tk(origen))
      .send({ fichaId: paciente.fichaId, motivo: 'Motivo de prueba', tipoAtencionId, candidatos: [] });
    expect(d.status).toBe(201);
    await t
      .http()
      .post(`/api/derivaciones/${d.body.id}/practicantes`)
      .set(await tk(supervisor))
      .send({ practicanteId: practicante.id });
    await t
      .http()
      .post(`/api/derivaciones/${d.body.id}/respuesta`)
      .set(await tk(practicante))
      .send({ acepta: true });
    const c = await t.dueno.consentimiento.findFirstOrThrow({ where: { derivacionId: d.body.id, estado: 'SOLICITADO' } });

    // Enlace por correo (GESTION) -> pagina sin sesion: no consume el token.
    correos().length = 0;
    expect(
      (
        await t
          .http()
          .post(`/api/consentimientos/${c.id}/enlace`)
          .set(await tk(gestion))
      ).status,
    ).toBe(201);
    const token = tokenDe(ultimoA(paciente.email));
    expect(ultimoA(paciente.email)?.texto).toContain('/consentimiento?token=');
    const consulta = await t.http().post('/api/publico/consentimientos/consulta').send({ token });
    expect(consulta.status).toBe(200);
    expect(consulta.body).toEqual(
      expect.objectContaining({
        tipo: 'PRACTICANTE',
        menor: false,
        practicante: 'Practicante Portal',
        supervisor: 'Supervisora Portal',
        supervisor_anterior: null,
      }),
    );
    // 03b-5: el texto y la version son los del consentimiento de practicante (no el de atencion).
    const politica = await t.http().get('/api/publico/politicas/CONSENTIMIENTO_PRACTICANTE');
    expect(consulta.body.politica_version).toBe(politica.body.version);
    expect(consulta.body.politica_texto).toBe(politica.body.texto);
    expect((await t.http().post('/api/publico/consentimientos/consulta').send({ token })).status).toBe(200);

    // Portal: el supervisor (no es tratante) sale de supervisores_portal; nadie mas.
    const sup = await t
      .http()
      .get('/api/portal/supervisores')
      .set(await tk(paciente));
    expect(sup.status).toBe(200);
    expect(sup.body).toEqual([{ id: supervisor.id, nombre: 'Supervisora Portal' }]);
    expect(
      (
        await t
          .http()
          .get('/api/portal/supervisores')
          .set(await tk(origen))
      ).status,
    ).toBe(403);
    const otro = await t.datos.usuarioPaciente(origen.id);
    expect(
      (
        await t
          .http()
          .get('/api/portal/supervisores')
          .set(await tk(otro))
      ).body,
    ).toEqual([]);

    // Responde por el enlace: un solo uso.
    // Una version que no es la vigente se rechaza (422) y el enlace sigue sirviendo.
    const vieja = await t.http().post('/api/publico/consentimientos/respuesta').send({ token, acepta: true, version: 'practicante-v1' });
    expect(vieja.status).toBe(422);
    expect(vieja.body.restriccion).toBe('aceptaciones_politica_version_vigente');
    const r = await t
      .http()
      .post('/api/publico/consentimientos/respuesta')
      .send({ token, acepta: true, version: String(consulta.body.politica_version) });
    expect(r.body).toEqual({ tipo: 'PRACTICANTE', acepta: true });
    expect((await t.http().post('/api/publico/consentimientos/consulta').send({ token })).status).toBe(404);
  });

  it('citas con el nombre del box; mis datos con el contacto de emergencia (solo lectura); bandeja descifrada', async () => {
    const paciente = await t.datos.usuarioPaciente(origen.id);
    await t
      .http()
      .patch(`/api/pacientes/${paciente.pacienteId}`)
      .set(await tk(origen))
      .send({ contactoEmergencia: 'Ana Perez (hermana) +56911112222' });
    const inicio = new Date(Math.ceil((Date.now() + 6 * 24 * HORA) / HORA) * HORA);
    const cita = await t
      .http()
      .post('/api/citas')
      .set(await tk(admin))
      .send({ pacienteId: paciente.pacienteId, profesionalId: origen.id, modalidad: 'PRESENCIAL', inicio, fin: new Date(inicio.getTime() + HORA) });
    expect(cita.status).toBe(201);

    const citas = await t
      .http()
      .get('/api/portal/citas')
      .set(await tk(paciente));
    const espacio = await t.dueno.espacio.findUniqueOrThrow({ where: { id: cita.body.espacioId } });
    expect(citas.body).toEqual([expect.objectContaining({ id: cita.body.id, espacioNombre: espacio.nombre, realizada: false })]);

    const datos = await t
      .http()
      .get('/api/portal/mis-datos')
      .set(await tk(paciente));
    expect(datos.body.contactoEmergencia).toBe('Ana Perez (hermana) +56911112222');
    // El portal no lo edita (C-9): campo no declarado -> 400.
    expect(
      (
        await t
          .http()
          .patch('/api/portal/mis-datos')
          .set(await tk(paciente))
          .send({ contactoEmergencia: 'otro' })
      ).status,
    ).toBe(400);

    await procesarMensajes(t);
    const bandeja = await t
      .http()
      .get('/api/notificaciones/bandeja')
      .set(await tk(paciente));
    const confirmada = (bandeja.body as { tipo: string; asunto: unknown; cuerpo: unknown }[]).find((m) => m.tipo === 'CITA_CONFIRMADA');
    expect(typeof confirmada?.asunto).toBe('string');
    expect(typeof confirmada?.cuerpo).toBe('string');
  });

  it('consentimiento de atencion: version vigente y la ultima aceptada; el adulto responsable reconoce su registro', async () => {
    const paciente = await t.datos.usuarioPaciente(origen.id);
    const estado = async (u: UsuarioPrueba, pacienteId?: string) =>
      t
        .http()
        .get('/api/portal/consentimiento-atencion')
        .query(pacienteId ? { pacienteId } : {})
        .set(await tk(u));
    await t
      .http()
      .post('/api/politicas')
      .set(await tk(admin))
      .send({ tipo: 'CONSENTIMIENTO_ATENCION', texto: 'Consentimiento de prueba 03b-3.' });
    const antes = await estado(paciente);
    expect(antes.status).toBe(200);
    expect(antes.body).toEqual(expect.objectContaining({ pacienteId: paciente.pacienteId, aceptada: null }));
    expect(antes.body.vigente.texto).toBe('Consentimiento de prueba 03b-3.');
    expect(
      (
        await t
          .http()
          .post('/api/portal/consentimiento-atencion')
          .set(await tk(paciente))
          .send({})
      ).status,
    ).toBe(201);
    const despues = await estado(paciente);
    expect(despues.body.aceptada).toEqual(expect.objectContaining({ version: antes.body.vigente.version, canal: 'PORTAL' }));

    // Adulto responsable de un menor: ve el estado del menor y su propio registro marcado (esMiCuenta).
    const menor = await t.datos.paciente(origen.id, { fechaNacimiento: new Date('2014-05-05') });
    const responsable = await t.datos.usuario('RESPONSABLE');
    await t.dueno.adultoResponsable.create({
      data: { id: randomUUID(), pacienteId: menor.id, nombre: 'Adulto Portal', parentesco: 'Madre', usuarioId: responsable.id },
    });
    await t.dueno.adultoResponsable.create({ data: { id: randomUUID(), pacienteId: menor.id, nombre: 'Otro Adulto', parentesco: 'Padre' } });
    const datos = await t
      .http()
      .get('/api/portal/mis-datos')
      .query({ pacienteId: menor.id })
      .set(await tk(responsable));
    expect(datos.status).toBe(200);
    // La RLS le muestra solo su propio registro de adulto responsable (no el del otro adulto del menor).
    expect((datos.body.adultosResponsables as { nombre: string; esMiCuenta: boolean }[]).map((a) => [a.nombre, a.esMiCuenta])).toEqual([
      ['Adulto Portal', true],
    ]);
    expect((await estado(responsable, menor.id)).body).toEqual(expect.objectContaining({ pacienteId: menor.id, aceptada: null }));
  });

  it('el recordatorio lleva a la pagina publica /recordatorio (sin sesion)', async () => {
    await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ recordatorioHorasAntes: 72, plazoAvisoCancelacionHoras: 24 });
    const paciente = await t.datos.usuarioPaciente(origen.id);
    const inicio = new Date(Math.ceil((Date.now() + 30 * HORA) / HORA) * HORA);
    expect(
      (
        await t
          .http()
          .post('/api/citas')
          .set(await tk(admin))
          .send({ pacienteId: paciente.pacienteId, profesionalId: origen.id, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA) })
      ).status,
    ).toBe(201);
    await t.app.get(RecordatoriosService).enviarRecordatorios();
    const [m] = (await procesarMensajes(t)).filter((x) => x.para === paciente.email && x.asunto === 'Recordatorio de su cita');
    expect(m.texto).toMatch(/\/recordatorio\?token=[\w-]+/);
    expect(m.texto).not.toContain('/portal/');
    const consulta = await t.http().get(`/api/recordatorios/${/token=([\w-]+)/.exec(m.texto)![1]}`);
    expect(consulta.body).toEqual(expect.objectContaining({ vigente: true, modalidad: 'ONLINE', profesional: 'Origen Portal' }));
  });
});
