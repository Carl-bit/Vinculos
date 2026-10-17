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
  let boxProfesional: { id: string };
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true, margenTrasladoMin: 30 } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    otroProfesional = await t.datos.usuario('PROFESIONAL');
    boxProfesional = await t.datos.disponibleSiempre(profesional.id);
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
    ...extra,
  });

  describe('espacios', () => {
    it('todos leen; ADMIN/GESTION crean y editan; nombre repetido 409; sin DELETE', async () => {
      expect(
        (
          await t
            .http()
            .get('/api/espacios')
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(200);
      const r = await t
        .http()
        .post('/api/espacios')
        .set(await tk(gestion))
        .send({ nombre: `Box G ${Date.now()}` });
      expect(r.status).toBe(201);
      expect(
        (
          await t
            .http()
            .post('/api/espacios')
            .set(await tk(admin))
            .send({ nombre: r.body.nombre })
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .post('/api/espacios')
            .set(await tk(profesional))
            .send({ nombre: 'X' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .patch(`/api/espacios/${r.body.id}`)
            .set(await tk(admin))
            .send({ activo: false })
        ).body.activo,
      ).toBe(false);
      expect(
        (
          await t
            .http()
            .delete(`/api/espacios/${r.body.id}`)
            .set(await tk(admin))
        ).status,
      ).toBe(404);
    });
  });

  describe('disponibilidad y bloqueos', () => {
    it('minutos con hora legible; el propio y ADMIN/GESTION editan; otro profesional no', async () => {
      const nuevo = await t.datos.usuario('PROFESIONAL');
      const r = await t
        .http()
        .post(`/api/profesionales/${nuevo.id}/disponibilidad`)
        .set(await tk(nuevo))
        .send({ diaSemana: 1, inicioMin: 540, finMin: 1440, modalidad: 'PRESENCIAL' });
      expect(r.status).toBe(201);
      expect(r.body).toEqual(expect.objectContaining({ inicioMin: 540, finMin: 1440, horaInicio: '09:00', horaFin: '24:00' }));
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${nuevo.id}/disponibilidad`)
            .set(await tk(gestion))
            .send({ diaSemana: 2, inicioMin: 0, finMin: 60, modalidad: 'ONLINE' })
        ).status,
      ).toBe(201);
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${nuevo.id}/disponibilidad`)
            .set(await tk(otroProfesional))
            .send({ diaSemana: 3, inicioMin: 0, finMin: 60, modalidad: 'ONLINE' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${nuevo.id}/disponibilidad`)
            .set(await tk(nuevo))
            .send({ diaSemana: 3, inicioMin: 600, finMin: 600, modalidad: 'ONLINE' })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${nuevo.id}/disponibilidad`)
            .set(await tk(nuevo))
            .send({ diaSemana: 3, inicioMin: 0, finMin: 1441, modalidad: 'ONLINE' })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${nuevo.id}/disponibilidad`)
            .set(await tk(otroProfesional))
        ).body,
      ).toEqual([]);
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${nuevo.id}/disponibilidad`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
    });

    it('bloqueos: el propio; BAJA no se crea por la API (400)', async () => {
      const inicio = nuevoDia();
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${profesional.id}/bloqueos`)
            .set(await tk(profesional))
            .send({ inicio: iso(inicio), fin: iso(inicio + 2 * HORA), motivo: 'PERSONAL' })
        ).status,
      ).toBe(201);
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${profesional.id}/bloqueos`)
            .set(await tk(profesional))
            .send({ inicio: iso(inicio), motivo: 'BAJA' })
        ).status,
      ).toBe(400);
      // La cita en el bloqueo no se confirma: 409 con alternativas.
      const r = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(409);
      expect(r.body.restriccion).toBe('agenda_no_disponible');
      expect(r.body.alternativas.length).toBeGreaterThan(0);
    });
  });

  describe('bloques de box (03b)', () => {
    /** Fecha (YYYY-MM-DD, hora de Chile) del lunes que viene mas `semanas`. */
    const fechaLunes = (semanas: number) => {
      const hoy = new Date(`${new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' })}T00:00:00Z`);
      hoy.setUTCDate(hoy.getUTCDate() + ((8 - hoy.getUTCDay()) % 7 || 7) + 7 * semanas);
      return hoy.toISOString().slice(0, 10);
    };
    /** Instante de ese lunes a las `horas` de Chile (respeta el cambio de horario). */
    const lunes = (semanas: number, horas: number) => {
      const pared = Date.parse(`${fechaLunes(semanas)}T00:00:00Z`) + horas * HORA;
      const offset = (ms: number) => {
        const n = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Santiago', timeZoneName: 'longOffset' })
          .formatToParts(ms)
          .find((x) => x.type === 'timeZoneName')!.value;
        const m = /GMT([+-])(\d\d):(\d\d)/.exec(n);
        return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60_000 : 0;
      };
      return pared - offset(pared - offset(pared));
    };

    it('el propio aparta; ADMIN/GESTION por otro; otro profesional y PACIENTE no; sin choques de box (409)', async () => {
      const a = await t.datos.usuario('PROFESIONAL');
      const b = await t.datos.usuario('PROFESIONAL');
      const comun = await t.datos.espacio();
      const bloque = (dias: number, h: number, horas = 2) => ({
        espacioId: comun.id,
        inicio: iso(lunes(30, 24 * dias + h)),
        fin: iso(lunes(30, 24 * dias + h + horas)),
      });
      const propio = await t
        .http()
        .post(`/api/profesionales/${a.id}/bloques`)
        .set(await tk(a))
        .send({ bloques: [bloque(0, 9), bloque(7, 9)] });
      expect(propio.status).toBe(201);
      expect(propio.body).toHaveLength(2);
      expect(propio.body[0]).toEqual(expect.objectContaining({ profesionalId: a.id, espacioId: comun.id }));
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${a.id}/bloques`)
            .set(await tk(b))
            .send({ bloques: [bloque(1, 9)] })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${a.id}/bloques`)
            .set(await tk(usuarioPaciente))
            .send({ bloques: [bloque(1, 9)] })
        ).status,
      ).toBe(403);
      const choque = await t
        .http()
        .post(`/api/profesionales/${b.id}/bloques`)
        .set(await tk(gestion))
        .send({ bloques: [bloque(0, 10)] });
      expect(choque.status).toBe(409);
      expect(choque.body.restriccion).toBe('bloques_atencion_sin_choque_box');
      // Todas o ninguna: el segundo bloque choca y el primero tampoco queda.
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${b.id}/bloques`)
            .set(await tk(admin))
            .send({ bloques: [bloque(2, 9), bloque(7, 10)] })
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${b.id}/bloques`)
            .query({ desde: iso(lunes(30, 0)), hasta: iso(lunes(32, 0)) })
            .set(await tk(gestion))
        ).body,
      ).toEqual([]);
      // Otro profesional no ve los bloques ajenos; ve el box ocupado en las horas libres.
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${a.id}/bloques`)
            .query({ desde: iso(lunes(30, 0)), hasta: iso(lunes(32, 0)) })
            .set(await tk(b))
        ).body,
      ).toEqual([]);
      const libres = await t
        .http()
        .get('/api/espacios/disponibilidad')
        .query({ desde: iso(lunes(30, 0)), hasta: iso(lunes(30, 24)) })
        .set(await tk(b));
      expect(libres.status).toBe(200);
      const delComun = libres.body.filter((l: { espacioId: string }) => l.espacioId === comun.id);
      expect(delComun.some((l: { inicio: string; fin: string }) => l.inicio < iso(lunes(30, 11)) && l.fin > iso(lunes(30, 9)))).toBe(false);
      expect(Object.keys(delComun[0]).sort()).toEqual(['espacioId', 'fin', 'inicio']);
      expect(
        (
          await t
            .http()
            .get('/api/espacios/disponibilidad')
            .query({ desde: iso(lunes(30, 0)), hasta: iso(lunes(30, 24)) })
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
    });

    it('horario del box por periodo: fuera 422; cambiarlo dejando bloques fuera 409; liberar con cita dentro 409', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      const pac = await t.datos.paciente(p.id);
      const sala = await t.datos.espacio();
      // Lunes 09-13, solo durante las semanas 40 a 41.
      const horario = await t
        .http()
        .put(`/api/espacios/${sala.id}/horario`)
        .set(await tk(gestion))
        .send({ bloques: [{ diaSemana: 1, inicioMin: 540, finMin: 780, vigenteDesde: fechaLunes(40), vigenteHasta: fechaLunes(41) }] });
      expect(horario.status).toBe(200);
      expect(horario.body[0]).toEqual(expect.objectContaining({ diaSemana: 1, inicioMin: 540, finMin: 780 }));
      const apartarComo = async (semana: number, desde: number, hasta: number) =>
        t
          .http()
          .post(`/api/profesionales/${p.id}/bloques`)
          .set(await tk(p))
          .send({ bloques: [{ espacioId: sala.id, inicio: iso(lunes(semana, desde)), fin: iso(lunes(semana, hasta)) }] });
      const fuera = await apartarComo(40, 12, 14);
      expect(fuera.status).toBe(422);
      expect(fuera.body.restriccion).toBe('bloques_atencion_dentro_de_horario_espacio');
      expect((await apartarComo(42, 9, 10)).status).toBe(422);
      const ok = await apartarComo(40, 9, 12);
      expect(ok.status).toBe(201);
      const cambio = await t
        .http()
        .put(`/api/espacios/${sala.id}/horario`)
        .set(await tk(gestion))
        .send({ bloques: [{ diaSemana: 1, inicioMin: 600, finMin: 780 }] });
      expect(cambio.status).toBe(409);
      expect(cambio.body.restriccion).toBe('horarios_espacio_bloques_fuera');
      expect(
        (
          await t
            .http()
            .get(`/api/espacios/${sala.id}/horario`)
            .set(await tk(gestion))
        ).body,
      ).toHaveLength(1);
      // Una cita dentro del bloque impide liberarlo; cancelada, se libera.
      const c = await t
        .http()
        .post('/api/citas')
        .set(await tk(p))
        .send({ pacienteId: pac.id, profesionalId: p.id, modalidad: 'PRESENCIAL', inicio: iso(lunes(40, 9)), fin: iso(lunes(40, 10)) });
      expect(c.status).toBe(201);
      expect(c.body.espacioId).toBe(sala.id);
      const liberar = () => tk(p).then((h) => t.http().delete(`/api/profesionales/${p.id}/bloques/${ok.body[0].id}`).set(h));
      const conCita = await liberar();
      expect(conCita.status).toBe(409);
      expect(conCita.body.restriccion).toBe('bloques_atencion_con_citas');
      expect((await tk(p).then((h) => t.http().patch(`/api/citas/${c.body.id}/cancelacion`).set(h))).status).toBe(200);
      const libre = await liberar();
      expect(libre.status).toBe(200);
      expect(libre.body).toEqual({ eliminados: 1 });
    });
  });

  describe('citas', () => {
    it('GESTION confirma; PACIENTE no crea; profesional no agenda pacientes ajenos (404)', async () => {
      const inicio = nuevoDia();
      const eventos: unknown[] = [];
      t.app.get(EventEmitter2).once(EVENTOS.CITA_CONFIRMADA, (e) => eventos.push(e));
      const r = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(201);
      expect(r.body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', margenTrasladoMin: 30 }));
      expect(eventos).toEqual([expect.objectContaining({ citaId: r.body.id, conEnlace: false })]);
      expect(
        (
          await t
            .http()
            .post('/api/citas')
            .set(await tk(usuarioPaciente))
            .send(cita({ inicio: iso(inicio + 2 * HORA), fin: iso(inicio + 3 * HORA) }))
        ).status,
      ).toBe(403);
      const ajeno = await t
        .http()
        .post('/api/citas')
        .set(await tk(profesional))
        .send(cita({ pacienteId: pacienteOtro.id, inicio: iso(inicio + 4 * HORA), fin: iso(inicio + 5 * HORA) }));
      expect(ajeno.status).toBe(404);
      // El paciente ve su cita; otro profesional no.
      expect(
        (
          await t
            .http()
            .get(`/api/citas/${r.body.id}`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get(`/api/citas/${r.body.id}`)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(404);
    });

    it('03b: la presencial usa el box del bloque; horario ocupado: verificacion con alternativas, sin INSERT ni evento', async () => {
      const inicio = nuevoDia();
      const primera = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(primera.status).toBe(201);
      expect(primera.body.espacioId).toBe(boxProfesional.id);
      // Mandar el box ya no es parte del contrato: lo fija la BD.
      expect(
        (
          await t
            .http()
            .post('/api/citas/verificacion')
            .set(await tk(gestion))
            .send({ profesionalId: profesional.id, modalidad: 'PRESENCIAL', espacioId: box.id, inicio: iso(inicio), fin: iso(inicio + HORA) })
        ).status,
      ).toBe(400);
      const v = await t
        .http()
        .post('/api/citas/verificacion')
        .set(await tk(gestion))
        .send({ profesionalId: profesional.id, modalidad: 'PRESENCIAL', inicio: iso(inicio + 30 * 60_000), fin: iso(inicio + 90 * 60_000) });
      expect(v.status).toBe(200);
      expect(v.body.disponible).toBe(false);
      expect(v.body.motivos).toEqual(['PROFESIONAL_NO_DISPONIBLE']);
      expect(v.body.alternativas.length).toBe(3);
      const eventos: unknown[] = [];
      t.app.get(EventEmitter2).once(EVENTOS.CITA_CONFIRMADA, (e) => eventos.push(e));
      const r = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send(cita({ inicio: iso(inicio + 30 * 60_000), fin: iso(inicio + 90 * 60_000) }));
      expect(r.status).toBe(409);
      expect(r.body.restriccion).toBe('agenda_no_disponible');
      expect(eventos).toEqual([]);
    });

    it('margen de traslado: online pegada a una presencial del mismo profesional -> 409', async () => {
      const inicio = nuevoDia();
      expect(
        (
          await t
            .http()
            .post('/api/citas')
            .set(await tk(gestion))
            .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))
        ).status,
      ).toBe(201);
      const online = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send(cita({ modalidad: 'ONLINE', inicio: iso(inicio + HORA), fin: iso(inicio + 2 * HORA) }));
      expect(online.status).toBe(409);
      expect(online.body.alternativas[0].inicio >= iso(inicio + HORA + 30 * 60_000) || online.body.alternativas[0].fin <= iso(inicio - 30 * 60_000)).toBe(true);
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${profesional.id}/conflictos-margen`)
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${profesional.id}/conflictos-margen`)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(403);
    });

    it('menor sin adulto responsable -> 422 antes del INSERT; con adulto -> 201', async () => {
      const menor = await t.datos.paciente(profesional.id, { fechaNacimiento: new Date('2016-03-03') });
      const inicio = nuevoDia();
      const r = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send(cita({ pacienteId: menor.id, inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(422);
      expect(r.body.restriccion).toBe('citas_menor_requiere_adulto_responsable');
      await t
        .http()
        .post(`/api/pacientes/${menor.id}/adultos-responsables`)
        .set(await tk(gestion))
        .send({ nombre: 'Madre' });
      expect(
        (
          await t
            .http()
            .post('/api/citas')
            .set(await tk(gestion))
            .send(cita({ pacienteId: menor.id, inicio: iso(inicio), fin: iso(inicio + HORA) }))
        ).status,
      ).toBe(201);
    });

    it('online: enlace cifrado con expiracion; lo leen el paciente y su profesional; vencido -> 410', async () => {
      const inicio = nuevoDia();
      const eventos: { conEnlace: boolean }[] = [];
      t.app.get(EventEmitter2).once(EVENTOS.CITA_CONFIRMADA, (e: { conEnlace: boolean }) => eventos.push(e));
      const r = await t
        .http()
        .post('/api/citas')
        .set(await tk(profesional))
        .send(cita({ modalidad: 'ONLINE', inicio: iso(inicio), fin: iso(inicio + HORA) }));
      expect(r.status).toBe(201);
      expect(eventos[0].conEnlace).toBe(true);
      const e = await t
        .http()
        .get(`/api/citas/${r.body.id}/enlace`)
        .set(await tk(usuarioPaciente));
      expect(e.status).toBe(200);
      expect(e.body.url).toMatch(/^https:\/\/videollamada\.simulada\.local\/sala\//);
      expect(new Date(e.body.expiraEn).getTime()).toBe(inicio + 3 * HORA);
      const fila = await t.dueno.cita.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(Buffer.from(fila.enlaceOnline!).toString('latin1')).not.toContain('videollamada');
      expect(
        (
          await t
            .http()
            .get(`/api/citas/${r.body.id}/enlace`)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(404);
      // Vencido.
      const llavero = await llaveroPrueba(t.dueno);
      const vencido = llavero.cifrar(
        JSON.stringify({ url: 'https://x', expiraEn: '2020-01-01T00:00:00Z' }),
        'CLINICO',
        aad('citas', 'enlace_online', r.body.id),
      );
      await t.dueno.cita.update({ where: { id: r.body.id }, data: { enlaceOnline: new Uint8Array(vencido) } });
      expect(
        (
          await t
            .http()
            .get(`/api/citas/${r.body.id}/enlace`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(410);
    });

    it('cancelar y reprogramar: UPDATE de estado; PACIENTE no; cancelada no se reprograma', async () => {
      const inicio = nuevoDia();
      const c = (
        await t
          .http()
          .post('/api/citas')
          .set(await tk(profesional))
          .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))
      ).body;
      const r = await t
        .http()
        .patch(`/api/citas/${c.id}/reprogramacion`)
        .set(await tk(profesional))
        .send({ inicio: iso(inicio + 30 * 60_000), fin: iso(inicio + 90 * 60_000) });
      expect(r.status).toBe(200);
      expect(r.body.inicio).toBe(iso(inicio + 30 * 60_000));
      // Ocupar otro horario y tratar de mover alli -> 409, la cita queda como estaba.
      const otra = (
        await t
          .http()
          .post('/api/citas')
          .set(await tk(gestion))
          .send(cita({ inicio: iso(inicio + 3 * HORA), fin: iso(inicio + 4 * HORA) }))
      ).body;
      const choque = await t
        .http()
        .patch(`/api/citas/${c.id}/reprogramacion`)
        .set(await tk(profesional))
        .send({ inicio: iso(inicio + 3 * HORA), fin: iso(inicio + 4 * HORA) });
      expect(choque.status).toBe(409);
      expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: c.id } })).estado).toBe('CONFIRMADA');
      expect(
        (
          await t
            .http()
            .patch(`/api/citas/${otra.id}/cancelacion`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
      const cancelada = await t
        .http()
        .patch(`/api/citas/${otra.id}/cancelacion`)
        .set(await tk(gestion));
      expect(cancelada.body.estado).toBe('CANCELADA');
      expect(
        (
          await t
            .http()
            .patch(`/api/citas/${otra.id}/cancelacion`)
            .set(await tk(gestion))
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .patch(`/api/citas/${otra.id}/reprogramacion`)
            .set(await tk(gestion))
            .send({ inicio: iso(inicio + 5 * HORA), fin: iso(inicio + 6 * HORA) })
        ).status,
      ).toBe(409);
      expect(await t.dueno.cita.count({ where: { id: otra.id } })).toBe(1);
    });

    it('POR_REPROGRAMAR: lista para el equipo y vuelve a CONFIRMADA al reprogramar', async () => {
      const inicio = nuevoDia();
      const c = (
        await t
          .http()
          .post('/api/citas')
          .set(await tk(gestion))
          .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))
      ).body;
      await t.dueno.cita.update({ where: { id: c.id }, data: { estado: 'POR_REPROGRAMAR' } });
      const lista = await t
        .http()
        .get('/api/citas/por-reprogramar')
        .set(await tk(gestion));
      expect(lista.body.map((x: { id: string }) => x.id)).toContain(c.id);
      expect(
        (
          await t
            .http()
            .get('/api/citas/por-reprogramar')
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
      const r = await t
        .http()
        .patch(`/api/citas/${c.id}/reprogramacion`)
        .set(await tk(gestion))
        .send({ inicio: iso(inicio + 2 * HORA), fin: iso(inicio + 3 * HORA) });
      expect(r.body.estado).toBe('CONFIRMADA');
    });

    it('soft-lock: retiene el horario para otros (verificacion) y quien lo tomo lo confirma', async () => {
      const inicio = nuevoDia();
      const hold = await t
        .http()
        .post('/api/agenda/horarios-tomados')
        .set(await tk(gestion))
        .send({ profesionalId: profesional.id, modalidad: 'PRESENCIAL', inicio: iso(inicio), fin: iso(inicio + HORA) });
      expect(hold.body.espacioId).toBe(boxProfesional.id);
      expect(hold.status).toBe(201);
      const v = await t
        .http()
        .post('/api/citas/verificacion')
        .set(await tk(admin))
        .send({ profesionalId: profesional.id, modalidad: 'PRESENCIAL', inicio: iso(inicio), fin: iso(inicio + HORA) });
      expect(v.body.disponible).toBe(false);
      expect(
        (
          await t
            .http()
            .get('/api/agenda/horarios-tomados')
            .set(await tk(admin))
        ).body,
      ).toEqual([]);
      expect(
        (
          await t
            .http()
            .post('/api/citas')
            .set(await tk(gestion))
            .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) }))
        ).status,
      ).toBe(201);
      expect(await t.dueno.bloqueoTemporal.count({ where: { id: hold.body.id } })).toBe(0);
    });
  });

  describe('concurrencia (EXCLUDE)', () => {
    it('citas simultaneas al mismo profesional y horario: exactamente una 201, el resto 409; sin duplicados', async () => {
      for (let ronda = 0; ronda < 5; ronda++) {
        const inicio = nuevoDia();
        const pedidos = await Promise.all(
          Array.from({ length: 8 }, async () =>
            t
              .http()
              .post('/api/citas')
              .set(await tk(gestion))
              .send(cita({ inicio: iso(inicio), fin: iso(inicio + HORA) })),
          ),
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

    it('03b: dos profesionales apartan el mismo box y horario a la vez: exactamente uno queda; sin bloques solapados', async () => {
      const comun = await t.datos.espacio();
      const equipo = await Promise.all(Array.from({ length: 4 }, () => t.datos.usuario('PROFESIONAL')));
      for (let ronda = 0; ronda < 5; ronda++) {
        const inicio = nuevoDia();
        const pedidos = await Promise.all(
          Array.from({ length: 8 }, async (_v, i) => {
            const p = equipo[i % equipo.length];
            return t
              .http()
              .post(`/api/profesionales/${p.id}/bloques`)
              .set(await tk(gestion))
              .send({ bloques: [{ espacioId: comun.id, inicio: iso(inicio), fin: iso(inicio + HORA) }] });
          }),
        );
        const estados = pedidos.map((r) => r.status).sort();
        expect(estados.filter((s) => s === 201)).toHaveLength(1);
        expect(estados.filter((s) => s !== 201).every((s) => s === 409)).toBe(true);
      }
      const solapados = await t.dueno.$queryRaw<unknown[]>`
        SELECT a.id FROM bloques_atencion a JOIN bloques_atencion b ON a.id < b.id AND a.espacio_id = b.espacio_id
          AND tstzrange(a.inicio, a.fin, '[)') && tstzrange(b.inicio, b.fin, '[)')`;
      expect(solapados).toEqual([]);
    });
  });
});
