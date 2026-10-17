/**
 * 03b: la agenda sale de los bloques de box. Disponibilidad publica solo
 * dentro de los bloques del profesional; lista de espera publica sin cuenta
 * (verificacion por correo, misma respuesta si ya estaba inscrito, aviso por
 * job al liberarse una hora y baja con enlace); sesion de 30 minutos sin
 * actividad.
 */
import { ListaEsperaPublicaService } from '../src/modulos/agenda/lista-espera-publica.service';
import { type Correo, ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { auth, CLAVE, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;

describe('03b agenda publica', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let sinBloques: UsuarioPrueba;
  let tipoId: string;
  let politicaId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correos = (): Correo[] => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo).enviados;
  const tokenDe = (c: Correo | undefined) => /token=([A-Za-z0-9_-]+)/.exec(c?.texto ?? '')?.[1] ?? '';
  const ultimoA = (para: string) => [...correos()].reverse().find((c) => c.para === para);

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
    await t
      .http()
      .put(`/api/profesionales/${u.id}/tipos-atencion`)
      .set(await tk(admin))
      .send({ tipoAtencionIds: [tipoId] });
  };

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.horarioCentro.deleteMany({});
    admin = await t.datos.usuario('ADMIN');
    prof = await t.datos.usuario('PROFESIONAL');
    sinBloques = await t.datos.usuario('PROFESIONAL');
    tipoId = (await t.datos.tipoAtencion()).id;
    await publicar(prof);
    await publicar(sinBloques);
    politicaId = (await t.http().get('/api/publico/politicas/POLITICA_DATOS')).body.id;
  });

  afterAll(() => t.cerrar());

  it('disponibilidad publica: solo dentro de los bloques de box del profesional (ambas modalidades)', async () => {
    const box = await t.datos.espacio();
    const inicio = new Date(Math.ceil((Date.now() + 5 * DIA) / HORA) * HORA);
    const rango = { desde: new Date(inicio.getTime() - DIA).toISOString(), hasta: new Date(inicio.getTime() + DIA).toISOString() };
    expect((await t.http().get(`/api/publico/profesionales/${prof.id}/disponibilidad`).query(rango)).body).toEqual([]);
    const r = await t
      .http()
      .post(`/api/profesionales/${prof.id}/bloques`)
      .set(await tk(prof))
      .send({ bloques: [{ espacioId: box.id, inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 3 * HORA).toISOString() }] });
    expect(r.status).toBe(201);
    const huecos = (await t.http().get(`/api/publico/profesionales/${prof.id}/disponibilidad`).query(rango)).body as {
      modalidad: string;
      inicio: string;
      fin: string;
    }[];
    expect(huecos.map((h) => h.modalidad).sort()).toEqual(['ONLINE', 'PRESENCIAL']);
    expect(huecos.every((h) => h.inicio === inicio.toISOString() && h.fin === new Date(inicio.getTime() + 3 * HORA).toISOString())).toBe(true);
  });

  it('lista de espera publica: verificacion, misma respuesta si ya estaba, aviso al liberarse una hora y baja', async () => {
    const email = `espera-${prof.id.slice(0, 6)}@x.cl`;
    const inscribir = (extra: Record<string, unknown> = {}) =>
      t
        .http()
        .post('/api/publico/lista-espera')
        .send({ profesionalId: prof.id, nombre: 'Lia', email, telefono: '+56911112222', politicaId, ...extra });
    const primera = await inscribir();
    expect(primera.status).toBe(202);
    expect(Object.keys(primera.body).sort()).toEqual(['expiraEn', 'verificacionEnviada']);
    const verificacion = ultimoA(email);
    expect(verificacion?.asunto).toMatch(/^Confirme su inscripción en la lista de espera/);
    expect(verificacion?.texto).toContain('/lista-espera/verificar?token=');
    // Mismo correo y destino: igual respuesta (no revela que ya estaba).
    const segunda = await inscribir({ nombre: 'Otro nombre' });
    expect(segunda.status).toBe(202);
    expect(segunda.body.verificacionEnviada).toBe(true);
    // Bot (trampa) y datos invalidos.
    const antes = correos().length;
    expect((await inscribir({ sitioWeb: 'http://spam' })).status).toBe(202);
    expect(correos().length).toBe(antes);
    expect((await inscribir({ profesionalId: undefined })).status).toBe(400);
    // Por tipo de atencion queda pendiente: el campo no existe.
    expect((await inscribir({ tipoAtencionId: tipoId })).status).toBe(400);
    expect((await inscribir({ politicaId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);

    const enlace = tokenDe(ultimoA(email));
    const v = await t.http().post('/api/publico/lista-espera/verificacion').send({ token: enlace });
    expect(v.status).toBe(200);
    expect(v.body).toEqual(expect.objectContaining({ profesionalId: prof.id }));
    expect(new Date(v.body.expiraEn).getTime()).toBeGreaterThan(Date.now() + 59 * DIA);
    const alta = ultimoA(email);
    expect(alta?.asunto).toMatch(/^Quedó inscrito en la lista de espera/);
    expect(alta?.texto).toContain('/lista-espera/baja?token=');
    expect((await t.http().post('/api/publico/lista-espera/verificacion').send({ token: enlace })).status).toBe(409);
    const fila = await t.dueno.listaEsperaPublica.findFirstOrThrow({ where: { email } });
    expect(fila.nombre).toBe('Lia');
    expect(Buffer.from(fila.telefono!).toString('utf8')).not.toContain('56911112222');

    // Hora liberada: el job manda un aviso con el enlace para pedir hora y uno de baja nuevo.
    const pac = await t.datos.paciente(prof.id);
    const inicio = new Date(Math.ceil((Date.now() + 5 * DIA) / HORA) * HORA);
    const c = await t
      .http()
      .post('/api/citas')
      .set(await tk(admin))
      .send({
        pacienteId: pac.id,
        profesionalId: prof.id,
        modalidad: 'ONLINE',
        inicio: inicio.toISOString(),
        fin: new Date(inicio.getTime() + HORA).toISOString(),
      });
    expect(c.status).toBe(201);
    expect(
      (
        await t
          .http()
          .patch(`/api/citas/${c.body.id}/cancelacion`)
          .set(await tk(admin))
      ).status,
    ).toBe(200);
    const servicio = t.app.get(ListaEsperaPublicaService);
    expect(await servicio.avisar()).toEqual({ corrio: true, total: 1 });
    const aviso = ultimoA(email);
    expect(aviso?.asunto).toMatch(/^Hay horas disponibles/);
    expect(aviso?.texto).toContain(`/pedir-hora/${prof.id}`);
    expect(await servicio.avisar()).toEqual({ corrio: true, total: 0 });

    // Baja: borra la inscripcion; el enlace no sirve dos veces.
    const baja = tokenDe(aviso);
    expect((await t.http().post('/api/publico/lista-espera/baja').send({ token: baja })).status).toBe(204);
    expect(await t.dueno.listaEsperaPublica.count({ where: { email } })).toBe(0);
    expect((await t.http().post('/api/publico/lista-espera/baja').send({ token: baja })).status).toBe(409);
  });

  it('el equipo lee la lista de espera publica por RLS; un bloque nuevo deja aviso pendiente', async () => {
    const email = `espera-bloque-${sinBloques.id.slice(0, 6)}@x.cl`;
    expect((await t.http().post('/api/publico/lista-espera').send({ profesionalId: sinBloques.id, nombre: 'Tomas', email, politicaId })).status).toBe(202);
    await t
      .http()
      .post('/api/publico/lista-espera/verificacion')
      .send({ token: tokenDe(ultimoA(email)) });
    const box = await t.datos.espacio();
    const inicio = new Date(Math.ceil((Date.now() + 9 * DIA) / HORA) * HORA);
    expect(
      (
        await t
          .http()
          .post(`/api/profesionales/${sinBloques.id}/bloques`)
          .set(await tk(sinBloques))
          .send({ bloques: [{ espacioId: box.id, inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 2 * HORA).toISOString() }] })
      ).status,
    ).toBe(201);
    const fila = await t.dueno.listaEsperaPublica.findFirstOrThrow({ where: { email } });
    expect(fila.avisoPendienteEn).not.toBeNull();
    expect(await t.app.get(ListaEsperaPublicaService).avisar()).toEqual({ corrio: true, total: 1 });
    expect(ultimoA(email)?.texto).toContain(`/pedir-hora/${sinBloques.id}`);
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
