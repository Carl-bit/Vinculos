/** 02d: Agenda y espacios. Por rol + concurrencia sobre el EXCLUDE (una 201, el resto 409). */
import { EventEmitter2 } from '@nestjs/event-emitter';

import { aad } from '../src/common/crypto/cifrado';
import { EVENTOS } from '../src/core/eventos/eventos';
import { auth, crearApp, llaveroPrueba, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;
const DIA = 24 * HORA;
let dias = 3;
/** Un dia futuro distinto por test (14:00 UTC = mañana en Chile): sin choques entre tests. */
const nuevoDia = () => {
  const d = new Date(Date.now() + dias++ * DIA);
  d.setUTCHours(14, 0, 0, 0);
  return d.getTime();
};
const iso = (ms: number) => new Date(ms).toISOString();

describe('02d agenda y espacios', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otroProfesional: UsuarioPrueba;
  let usuarioPaciente: UsuarioPrueba & { pacienteId: string };
  let pacienteOtro: { id: string };
  let box: { id: string };
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true, margenTrasladoMin: 30 } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    otroProfesional = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(profesional.id);
    await t.datos.disponibleSiempre(otroProfesional.id);
    usuarioPaciente = await t.datos.usuarioPaciente(profesional.id);
    pacienteOtro = await t.datos.paciente(otroProfesional.id);
    box = await t.datos.espacio();
  });

  afterAll(() => t.cerrar());

  const cita = (extra: Record<string, unknown>) => ({
    pacienteId: usuarioPaciente.pacienteId,
    profesionalId: profesional.id,
    modalidad: 'PRESENCIAL',
    espacioId: box.id,
    ...extra,
  });

  describe('espacios', () => {
    it('todos leen; ADMIN/GESTION crean y editan; nombre repetido 409; sin DELETE', async () => {
      expect((await t.http().get('/api/espacios').set(await tk(usuarioPaciente))).status).toBe(200);
      const r = await t.http().post('/api/espacios').set(await tk(gestion)).send({ nombre: `Box G ${Date.now()}` });
      expect(r.status).toBe(201);
      expect((await t.http().post('/api/espacios').set(await tk(admin)).send({ nombre: r.body.nombre })).status).toBe(409);
      expect((await t.http().post('/api/espacios').set(await tk(profesional)).send({ nombre: 'X' })).status).toBe(403);
      expect((await t.http().patch(`/api/espacios/${r.body.id}`).set(await tk(admin)).send({ activo: false })).body.activo).toBe(false);
      expect((await t.http().delete(`/api/espacios/${r.body.id}`).set(await tk(admin))).status).toBe(404);
    });
  });

  describe('disponibilidad y bloqueos', () => {
    it('minutos con hora legible; el propio y ADMIN/GESTION editan; otro profesional no', async () => {
      const nuevo = await t.datos.usuario('PROFESIONAL');
      const r = await t.http().post(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(nuevo)).send({ diaSemana: 1, inicioMin: 540, finMin: 1440, modalidad: 'PRESENCIAL' });
      expect(r.status).toBe(201);
      expect(r.body).toEqual(expect.objectContaining({ inicioMin: 540, finMin: 1440, horaInicio: '09:00', horaFin: '24:00' }));
      expect((await t.http().post(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(gestion)).send({ diaSemana: 2, inicioMin: 0, finMin: 60, modalidad: 'ONLINE' })).status).toBe(201);
      expect((await t.http().post(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(otroProfesional)).send({ diaSemana: 3, inicioMin: 0, finMin: 60, modalidad: 'ONLINE' })).status).toBe(403);
      expect((await t.http().post(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(nuevo)).send({ diaSemana: 3, inicioMin: 600, finMin: 600, modalidad: 'ONLINE' })).status).toBe(400);
      expect((await t.http().post(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(nuevo)).send({ diaSemana: 3, inicioMin: 0, finMin: 1441, modalidad: 'ONLINE' })).status).toBe(400);
      expect((await t.http().get(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(otroProfesional))).body).toEqual([]);
      expect((await t.http().get(`/api/profesionales/${nuevo.id}/disponibilidad`).set(await tk(usuarioPaciente))).status).toBe(403);
    });

    it('bloqueos: el propio; BAJA no se crea por la API (400)', async () => {
      const inicio = nuevoDia();
      expect((await t.http().post(`/api/profesionales/${profesional.id}/bloqueos`).set(await tk(profesional)).send({ inicio: iso(inicio), fin: iso(inicio + 2 * HORA), motivo: 'PERSONAL' })).status).toBe(201);
      expect((await t.http().post(`/api/profesionales/${profesional.id}/bloqueos`).set(await tk(profesional)).send({ inicio: iso(inicio), motivo: 'BAJA' })).status).toBe(400);
      // La cita en el bloqueo no se confirma: 409 con alternativas.
      const r = await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(409);
      expect(r.body.restriccion).toBe('agenda_no_disponible');
      expect(r.body.alternativas.length).toBeGreaterThan(0);
    });
  });

  describe('citas', () => {
    it('GESTION confirma; PACIENTE no crea; profesional no agenda pacientes ajenos (404)', async () => {
      const inicio = nuevoDia();
      const eventos: unknown[] = [];
      t.app.get(EventEmitter2).once(EVENTOS.CITA_CONFIRMADA, (e) => eventos.push(e));
      const r = await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(201);
      expect(r.body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', margenTrasladoMin: 30 }));
      expect(eventos).toEqual([expect.objectContaining({ citaId: r.body.id, conEnlace: false })]);
      expect((await t.http().post('/api/citas').set(await tk(usuarioPaciente)).send(cita({ inicio: iso(inicio + 2 * HORA), fin: iso(inicio + 3 * HORA) }))).status).toBe(403);
      const ajeno = await t.http().post('/api/citas').set(await tk(profesional)).send(cita({ pacienteId: pacienteOtro.id, inicio: iso(inicio + 4 * HORA), fin: iso(inicio + 5 * HORA) }));
      expect(ajeno.status).toBe(404);
      // El paciente ve su cita; otro profesional no.
      expect((await t.http().get(`/api/citas/${r.body.id}`).set(await tk(usuarioPaciente))).status).toBe(200);
      expect((await t.http().get(`/api/citas/${r.body.id}`).set(await tk(otroProfesional))).status).toBe(404);
    });

    it('box ocupado: verificacion previa con alternativas, sin INSERT; ningun evento', async () => {
      const inicio = nuevoDia();
      await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }));
      const v = await t.http().post('/api/citas/verificacion').set(await tk(gestion)).send({ profesionalId: otroProfesional.id, modalidad: 'PRESENCIAL', espacioId: box.id, inicio: iso(inicio + 30 * 60_000), fin: iso(inicio + 90 * 60_000) });
      expect(v.status).toBe(200);
      expect(v.body.disponible).toBe(false);
      expect(v.body.motivos).toEqual(['BOX_OCUPADO']);
      expect(v.body.alternativas.length).toBe(3);
      const eventos: unknown[] = [];
      t.app.get(EventEmitter2).once(EVENTOS.CITA_CONFIRMADA, (e) => eventos.push(e));
      const r = await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ pacienteId: pacienteOtro.id, profesionalId: otroProfesional.id, inicio: iso(inicio + 30 * 60_000), fin: iso(inicio + 90 * 60_000) }));
      expect(r.status).toBe(409);
      expect(r.body.restriccion).toBe('citas_no_solapamiento_espacio');
      expect(eventos).toEqual([]);
    });

    it('margen de traslado: online pegada a una presencial del mismo profesional -> 409', async () => {
      const inicio = nuevoDia();
      expect((await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))).status).toBe(201);
      const online = await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ modalidad: 'ONLINE', espacioId: undefined, inicio: iso(inicio + HORA), fin: iso(inicio + 2 * HORA) }));
      expect(online.status).toBe(409);
      expect(online.body.alternativas[0].inicio >= iso(inicio + HORA + 30 * 60_000) || online.body.alternativas[0].fin <= iso(inicio - 30 * 60_000)).toBe(true);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/conflictos-margen`).set(await tk(admin))).status).toBe(200);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/conflictos-margen`).set(await tk(otroProfesional))).status).toBe(403);
    });

    it('menor sin adulto responsable -> 422 antes del INSERT; con adulto -> 201', async () => {
      const menor = await t.datos.paciente(profesional.id, { fechaNacimiento: new Date('2016-03-03') });
      const inicio = nuevoDia();
      const r = await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ pacienteId: menor.id, inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(422);
      expect(r.body.restriccion).toBe('citas_menor_requiere_adulto_responsable');
      await t.http().post(`/api/pacientes/${menor.id}/adultos-responsables`).set(await tk(gestion)).send({ nombre: 'Madre' });
      expect((await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ pacienteId: menor.id, inicio: iso(inicio), fin: iso(inicio + HORA) }))).status).toBe(201);
    });

    it('online: enlace cifrado con expiracion; lo leen el paciente y su profesional; vencido -> 410', async () => {
      const inicio = nuevoDia();
      const eventos: { conEnlace: boolean }[] = [];
      t.app.get(EventEmitter2).once(EVENTOS.CITA_CONFIRMADA, (e: { conEnlace: boolean }) => eventos.push(e));
      const r = await t.http().post('/api/citas').set(await tk(profesional)).send(cita({ modalidad: 'ONLINE', espacioId: undefined, inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(201);
      expect(eventos[0].conEnlace).toBe(true);
      const e = await t.http().get(`/api/citas/${r.body.id}/enlace`).set(await tk(usuarioPaciente));
      expect(e.status).toBe(200);
      expect(e.body.url).toMatch(/^https:\/\/videollamada\.simulada\.local\/sala\//);
      expect(new Date(e.body.expiraEn).getTime()).toBe(inicio + 3 * HORA);
      const fila = await t.dueno.cita.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(Buffer.from(fila.enlaceOnline!).toString('latin1')).not.toContain('videollamada');
      expect((await t.http().get(`/api/citas/${r.body.id}/enlace`).set(await tk(otroProfesional))).status).toBe(404);
      // Vencido.
      const llavero = await llaveroPrueba(t.dueno);
      const vencido = llavero.cifrar(JSON.stringify({ url: 'https://x', expiraEn: '2020-01-01T00:00:00Z' }), 'CLINICO', aad('citas', 'enlace_online', r.body.id));
      await t.dueno.cita.update({ where: { id: r.body.id }, data: { enlaceOnline: new Uint8Array(vencido) } });
      expect((await t.http().get(`/api/citas/${r.body.id}/enlace`).set(await tk(usuarioPaciente))).status).toBe(410);
    });

    it('cancelar y reprogramar: UPDATE de estado; PACIENTE no; cancelada no se reprograma', async () => {
      const inicio = nuevoDia();
      const c = (await t.http().post('/api/citas').set(await tk(profesional)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))).body;
      const r = await t.http().patch(`/api/citas/${c.id}/reprogramacion`).set(await tk(profesional)).send({ inicio: iso(inicio + 30 * 60_000), fin: iso(inicio + 90 * 60_000) });
      expect(r.status).toBe(200);
      expect(r.body.inicio).toBe(iso(inicio + 30 * 60_000));
      // Ocupar otro horario y tratar de mover alli -> 409, la cita queda como estaba.
      const otra = (await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio + 3 * HORA), fin: iso(inicio + 4 * HORA) }))).body;
      const choque = await t.http().patch(`/api/citas/${c.id}/reprogramacion`).set(await tk(profesional)).send({ inicio: iso(inicio + 3 * HORA), fin: iso(inicio + 4 * HORA) });
      expect(choque.status).toBe(409);
      expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('CONFIRMADA');
      expect((await t.http().patch(`/api/citas/${otra.id}/cancelacion`).set(await tk(usuarioPaciente))).status).toBe(403);
      const cancelada = await t.http().patch(`/api/citas/${otra.id}/cancelacion`).set(await tk(gestion));
      expect(cancelada.body.estado).toBe('CANCELADA');
      expect((await t.http().patch(`/api/citas/${otra.id}/cancelacion`).set(await tk(gestion))).status).toBe(409);
      expect((await t.http().patch(`/api/citas/${otra.id}/reprogramacion`).set(await tk(gestion)).send({ inicio: iso(inicio + 5 * HORA), fin: iso(inicio + 6 * HORA) })).status).toBe(409);
      expect((await t.dueno.cita.count({ where: { id: otra.id } }))).toBe(1);
    });

    it('POR_REPROGRAMAR: lista para el equipo y vuelve a CONFIRMADA al reprogramar', async () => {
      const inicio = nuevoDia();
      const c = (await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))).body;
      await t.dueno.cita.update({ where: { id: c.id }, data: { estado: 'POR_REPROGRAMAR' } });
      const lista = await t.http().get('/api/citas/por-reprogramar').set(await tk(gestion));
      expect(lista.body.map((x: { id: string }) => x.id)).toContain(c.id);
      expect((await t.http().get('/api/citas/por-reprogramar').set(await tk(usuarioPaciente))).status).toBe(403);
      const r = await t.http().patch(`/api/citas/${c.id}/reprogramacion`).set(await tk(gestion)).send({ inicio: iso(inicio + 2 * HORA), fin: iso(inicio + 3 * HORA) });
      expect(r.body.estado).toBe('CONFIRMADA');
    });

    it('soft-lock: retiene el horario para otros (verificacion) y quien lo tomo lo confirma', async () => {
      const inicio = nuevoDia();
      const hold = await t.http().post('/api/agenda/horarios-tomados').set(await tk(gestion)).send({ profesionalId: profesional.id, modalidad: 'PRESENCIAL', espacioId: box.id, inicio: iso(inicio), fin: iso(inicio + HORA) });
      expect(hold.status).toBe(201);
      const v = await t.http().post('/api/citas/verificacion').set(await tk(admin)).send({ profesionalId: profesional.id, modalidad: 'PRESENCIAL', espacioId: box.id, inicio: iso(inicio), fin: iso(inicio + HORA) });
      expect(v.body.disponible).toBe(false);
      expect((await t.http().get('/api/agenda/horarios-tomados').set(await tk(admin))).body).toEqual([]);
      expect((await t.http().post('/api/citas').set(await tk(gestion)).send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))).status).toBe(201);
      expect(await t.dueno.bloqueoTemporal.count({ where: { id: hold.body.id } })).toBe(0);
    });
  });

  describe('concurrencia (EXCLUDE)', () => {
    it('reservas simultaneas al mismo box y horario: exactamente una 201, el resto 409; sin duplicados', async () => {
      const profesionales = [profesional, otroProfesional];
      for (let ronda = 0; ronda < 5; ronda++) {
        const inicio = nuevoDia();
        const pedidos = await Promise.all(
          Array.from({ length: 8 }, async (_v, i) => {
            const p = profesionales[i % 2];
            const pacienteId = p === profesional ? usuarioPaciente.pacienteId : pacienteOtro.id;
            return t.http().post('/api/citas').set(await tk(gestion)).send(cita({ pacienteId, profesionalId: p.id, inicio: iso(inicio), fin: iso(inicio + HORA) }));
          }),
        );
        const estados = pedidos.map((r) => r.status).sort();
        expect(estados.filter((s) => s === 201)).toHaveLength(1);
        expect(estados.filter((s) => s !== 201).every((s) => s === 409)).toBe(true);
      }
      const duplicados = await t.dueno.$queryRaw<unknown[]>`
        SELECT a.id FROM citas a JOIN citas b ON a.id < b.id AND a.espacio_id = b.espacio_id
          AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')
        WHERE a.estado = 'CONFIRMADA' AND b.estado = 'CONFIRMADA'`;
      expect(duplicados).toEqual([]);
    });
  });
});
