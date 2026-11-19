/**
 * 03b: la agenda sale de los bloques de box. Disponibilidad publica solo
 * dentro de los bloques del profesional; sesion de 30 minutos sin actividad.
 * (La lista de espera publica se retiro: implementacion futura.)
 */
import { auth, CLAVE, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;

describe('03b agenda publica', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let tipoId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

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
    expect(
      (
        await t
          .http()
          .put('/api/profesionales/yo/perfil')
          .set(await tk(u))
          .send({ ...perfil, perfilPublico: true })
      ).status,
    ).toBe(200);
    await t.datos.validar(u.id);
    await t
      .http()
      .put(`/api/profesionales/${u.id}/tipos-atencion`)
      .set(await tk(admin))
      .send({ tipoAtencionIds: [tipoId] });
  };

  beforeAll(async () => {
    t = await crearApp();
    await t.datos.centroAbierto();
    admin = await t.datos.usuario('ADMIN');
    prof = await t.datos.usuario('PROFESIONAL');
    tipoId = (await t.datos.tipoAtencion()).id;
    await publicar(prof);
  });

  afterAll(() => t.cerrar());

  it('disponibilidad publica: presencial en los bloques de box; online en el horario online del profesional, sin box', async () => {
    const box = await t.datos.espacio();
    // 10:00 de Chile (13:00 UTC) en 5 dias: un bloque de 3 h que nunca cruza la medianoche.
    const inicio = new Date(Date.now() + 5 * DIA);
    inicio.setUTCHours(13, 0, 0, 0);
    const fin = new Date(inicio.getTime() + 3 * HORA);
    const rango = { desde: new Date(inicio.getTime() - DIA).toISOString(), hasta: new Date(inicio.getTime() + DIA).toISOString() };
    type Hueco = { modalidad: string; inicio: string; fin: string };
    const huecos = async () => (await t.http().get(`/api/publico/profesionales/${prof.id}/disponibilidad`).query(rango)).body as Hueco[];
    expect(await huecos()).toEqual([]);
    const r = await t
      .http()
      .post(`/api/profesionales/${prof.id}/bloques`)
      .set(await tk(prof))
      .send({ bloques: [{ espacioId: box.id, inicio: inicio.toISOString(), fin: fin.toISOString() }] });
    expect(r.status).toBe(201);
    // 2026-11-18: el bloque de box solo ofrece presencial (sin horario online, no atiende online).
    expect(await huecos()).toEqual([{ modalidad: 'PRESENCIAL', inicio: inicio.toISOString(), fin: fin.toISOString() }]);
    const dia =
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
        new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Santiago' }).format(inicio),
      ) + 1;
    const h = await t
      .http()
      .post(`/api/profesionales/${prof.id}/disponibilidad`)
      .set(await tk(prof))
      .send({ diaSemana: dia, inicioMin: 0, finMin: 1440, modalidad: 'ONLINE' });
    expect(h.status).toBe(201);
    const online = (await huecos()).filter((x) => x.modalidad === 'ONLINE');
    expect(online.some((x) => x.inicio <= inicio.toISOString() && x.fin >= fin.toISOString())).toBe(true);
  });

  it('sesion: el refresh vence a los 30 minutos sin actividad y se renueva al rotar', async () => {
    const p = await t.datos.usuarioPaciente(prof.id);
    const login = await t.http().post('/api/auth/login').send({ email: p.email, password: CLAVE });
    expect(login.status).toBe(200);
    expect(login.body.inactividadMinutos).toBe(30);
    const ultima = await t.dueno.sesion.findFirstOrThrow({ where: { usuarioId: p.id }, orderBy: { creadaEn: 'desc' } });
    const minutos = (ultima.expiraEn.getTime() - Date.now()) / 60_000;
    expect(minutos).toBeGreaterThan(29);
    expect(minutos).toBeLessThanOrEqual(30);
  });
});
