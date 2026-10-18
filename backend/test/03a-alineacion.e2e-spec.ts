/**
 * 03a-1: alineacion con el diseño. Por rol, cada endpoint nuevo: cuentas
 * (roles por cuenta, TOTP, recuperacion, enlace de acceso, invitaciones),
 * centro (modulos, contenido, politicas, horario, dashboard), match por
 * reglas, solicitud de hora sin cuenta, lista de espera, acceso temporal,
 * borradores, alta, reseñas, portal (menores y adulto responsable) y cobros.
 */
import { randomUUID } from 'node:crypto';

import sharp = require('sharp');

import { codigoTotp } from '../src/core/auth/totp';
import { ModulosGuard } from '../src/core/modulos/modulos';
import { type Correo, ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { auth, binario, CLAVE, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;

describe('03a alineacion con el diseño', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let otroProf: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string; fichaId: string };
  let tipoId: string;
  let tipoNombre: string;
  let politicaId: string;
  let terminosId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correos = (): Correo[] => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo).enviados;
  const tokenDe = (c: Correo | undefined) => /token=([A-Za-z0-9_-]+)/.exec(c?.texto ?? '')?.[1] ?? '';
  const ultimoA = (para: string) => [...correos()].reverse().find((c) => c.para === para);
  let hora = 0;
  /** Hora redonda futura distinta por llamada (sin choques). */
  const horario = (dias: number) => {
    const inicio = new Date(Math.ceil((Date.now() + dias * DIA) / HORA) * HORA + (hora++ % 20) * HORA);
    return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + HORA).toISOString() };
  };

  const publicar = async (u: UsuarioPrueba, extra: Record<string, unknown> = {}) => {
    const perfil = { especialidad: 'Psicologia clinica', modalidad: 'MIXTA', nombrePublico: `Ps. ${u.id.slice(0, 6)}`, enfoques: ['Ansiedad'], ...extra };
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
    const r = await t
      .http()
      .put('/api/profesionales/yo/perfil')
      .set(await tk(u))
      .send({ ...perfil, perfilPublico: true });
    expect(r.status).toBe(200);
    await t
      .http()
      .put(`/api/profesionales/${u.id}/tipos-atencion`)
      .set(await tk(admin))
      .send({ tipoAtencionIds: [tipoId] });
    await t.datos.disponibleSiempre(u.id);
  };

  /** Cita CONFIRMADA ya terminada (sesion realizada), como dueño; una hora distinta por llamada. */
  let pasadas = 0;
  const citaPasada = async (pacienteId: string, profesionalId: string) => {
    const inicio = new Date(Math.floor(Date.now() / HORA) * HORA - (50 + 2 * pasadas++) * HORA);
    return t.dueno.cita.create({ data: { pacienteId, profesionalId, modalidad: 'ONLINE', inicio, fin: new Date(inicio.getTime() + HORA) } });
  };

  const solicitud = (profesionalId: string, email: string, extra: Record<string, unknown> = {}) => ({
    profesionalId,
    modalidad: 'PRESENCIAL',
    ...horario(10),
    nombre: 'Ema',
    apellido: 'Portal',
    fechaNacimiento: '1990-03-03',
    email,
    telefono: '+56911112222',
    respuestas: { motivos: ['ansiedad'], relato: 'Duermo mal hace meses y me cuesta concentrarme' },
    politicaId,
    terminosId,
    ...extra,
  });

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    await t.dueno.horarioCentro.deleteMany({});
    // Box libre para las solicitudes presenciales del portal.
    await t.datos.espacio();
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
    otroProf = await t.datos.usuario('PROFESIONAL');
    paciente = await t.datos.usuarioPaciente(prof.id);
    const tipo = await t.datos.tipoAtencion();
    tipoId = tipo.id;
    tipoNombre = tipo.nombre;
    await t.datos.disponibleSiempre(prof.id);
    await t.datos.disponibleSiempre(otroProf.id);
    politicaId = (await t.http().get('/api/publico/politicas/POLITICA_DATOS')).body.id;
    terminosId = (await t.http().get('/api/publico/politicas/TERMINOS_AGENDAMIENTO')).body.id;
  });

  afterAll(() => t.cerrar());

  describe('cuentas', () => {
    it('TOTP obligatorio para roles clinicos: desafio, enrolamiento y codigo; opcional para el resto', async () => {
      const u = await t.datos.usuario('PROFESIONAL');
      const r = await t.http().post('/api/auth/login').send({ email: u.email, password: CLAVE });
      expect(r.body).toEqual(expect.objectContaining({ requiereTotp: true, enrolamiento: true }));
      expect(r.body.accessToken).toBeUndefined();
      const e = await t.http().post('/api/auth/totp/enrolamiento').send({ desafio: r.body.desafio });
      expect(e.body.uri).toMatch(/^otpauth:\/\/totp\//);
      expect((await t.http().post('/api/auth/totp').send({ desafio: r.body.desafio, codigo: '000000' })).status).toBe(401);
      const ok = await t
        .http()
        .post('/api/auth/totp')
        .send({ desafio: r.body.desafio, codigo: codigoTotp(e.body.secreto) });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual(expect.objectContaining({ rol: 'PROFESIONAL', roles: ['PROFESIONAL'] }));
      const segundo = await t.http().post('/api/auth/login').send({ email: u.email, password: CLAVE });
      expect(segundo.body.enrolamiento).toBe(false);
      expect((await t.http().post('/api/auth/totp/enrolamiento').send({ desafio: segundo.body.desafio })).status).toBe(409);
      // El paciente entra sin TOTP.
      const p = await t.http().post('/api/auth/login').send({ email: paciente.email, password: CLAVE });
      expect(p.body.accessToken).toBeDefined();
      // Solo ADMIN reinicia el segundo factor de otro.
      expect(
        (
          await t
            .http()
            .post(`/api/usuarios/${u.id}/totp/reinicio`)
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/usuarios/${u.id}/totp/reinicio`)
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      expect((await t.http().post('/api/auth/login').send({ email: u.email, password: CLAVE })).body.enrolamiento).toBe(true);
    });

    it('login del paciente por RUT', async () => {
      const rut = '11.111.111-1';
      const conRut = await t.datos.usuarioPaciente(prof.id);
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${conRut.pacienteId}`)
            .set(await tk(gestion))
            .send({ rut })
        ).status,
      ).toBe(200);
      const r = await t.http().post('/api/auth/login').send({ rut: '11111111-1', password: CLAVE });
      expect(r.status).toBe(200);
      expect(r.body.rol).toBe('PACIENTE');
      expect((await t.http().post('/api/auth/login').send({ rut: '11111111-2', password: CLAVE })).status).toBe(400);
    });

    it('varios roles por cuenta (C-1): ADMIN + PROFESIONAL, rol al entrar y cambio de rol con token nuevo', async () => {
      const directora = await t.datos.usuario('ADMIN');
      expect(
        (
          await t
            .http()
            .post(`/api/usuarios/${directora.id}/roles`)
            .set(await tk(gestion))
            .send({ rol: 'PROFESIONAL' })
        ).status,
      ).toBe(403);
      const r = await t
        .http()
        .post(`/api/usuarios/${directora.id}/roles`)
        .set(await tk(admin))
        .send({ rol: 'PROFESIONAL' });
      expect(r.status).toBe(201);
      expect(r.body.rolesAdicionales).toEqual([expect.objectContaining({ rol: 'PROFESIONAL', activo: true })]);
      expect(
        (
          await t
            .http()
            .post(`/api/usuarios/${prof.id}/roles`)
            .set(await tk(admin))
            .send({ rol: 'PROFESIONAL' })
        ).status,
      ).toBe(422);
      // Con un rol clinico, la cuenta pide TOTP aunque entre como ADMIN.
      const comoAdmin = await t.login(directora);
      expect(comoAdmin).toEqual(expect.objectContaining({ rol: 'ADMIN', roles: ['ADMIN', 'PROFESIONAL'] }));
      expect((await t.http().get('/api/usuarios').set(auth(comoAdmin.accessToken))).status).toBe(200);
      const cambio = await t.http().post('/api/auth/cambio-rol').send({ refreshToken: comoAdmin.refreshToken, rol: 'PROFESIONAL' });
      expect(cambio.status).toBe(200);
      expect(cambio.body.rol).toBe('PROFESIONAL');
      expect((await t.http().get('/api/usuarios').set(auth(cambio.body.accessToken))).status).toBe(403);
      expect((await t.http().get('/api/pacientes').set(auth(cambio.body.accessToken))).body).toEqual([]);
      // El refresh anterior quedo revocado; un rol ajeno no se da.
      expect((await t.http().post('/api/auth/refresh').send({ refreshToken: comoAdmin.refreshToken })).status).toBe(401);
      expect((await t.http().post('/api/auth/cambio-rol').send({ refreshToken: cambio.body.refreshToken, rol: 'GESTION' })).status).toBe(401);
      // Directorio: filtro por rol (incluye el adicional).
      const dir = await t
        .http()
        .get('/api/directorio')
        .query({ rol: 'PROFESIONAL' })
        .set(await tk(gestion));
      expect(dir.body.map((d: { id: string }) => d.id)).toContain(directora.id);
      // Baja del rol adicional.
      const baja = await t
        .http()
        .post(`/api/usuarios/${directora.id}/roles/PROFESIONAL/baja`)
        .set(await tk(admin))
        .send({ fechaEfectiva: new Date(Date.now() + DIA).toISOString() });
      expect(baja.status).toBe(201);
    });

    it('recuperar contraseña: misma respuesta exista o no la cuenta; enlace de un solo uso', async () => {
      const u = await t.datos.usuario('GESTION');
      correos().length = 0;
      expect((await t.http().post('/api/auth/recuperacion').send({ email: 'nadie@test.cl' })).status).toBe(204);
      expect((await t.http().post('/api/auth/recuperacion').send({ email: u.email })).status).toBe(204);
      await new Promise((r) => setTimeout(r, 50));
      expect(correos().map((c) => c.para)).toEqual([u.email]);
      const token = tokenDe(ultimoA(u.email));
      expect((await t.http().post('/api/auth/recuperacion/confirmacion').send({ token, password: 'nueva-clave-segura' })).status).toBe(204);
      expect((await t.http().post('/api/auth/recuperacion/confirmacion').send({ token, password: 'otra-clave-segura' })).status).toBe(409);
      expect((await t.http().post('/api/auth/login').send({ email: u.email, password: 'nueva-clave-segura' })).status).toBe(200);
    });

    it('enlace de acceso (C-6): solo pacientes; un solo uso', async () => {
      correos().length = 0;
      expect((await t.http().post('/api/auth/enlace-acceso').send({ email: prof.email })).status).toBe(204);
      expect((await t.http().post('/api/auth/enlace-acceso').send({ email: paciente.email })).status).toBe(204);
      expect(correos().map((c) => c.para)).toEqual([paciente.email]);
      const token = tokenDe(ultimoA(paciente.email));
      const r = await t.http().post('/api/auth/enlace-acceso/confirmacion').send({ token });
      expect(r.status).toBe(200);
      expect(r.body.rol).toBe('PACIENTE');
      expect((await t.http().post('/api/auth/enlace-acceso/confirmacion').send({ token })).status).toBe(409);
    });

    it('alta de equipo con invitacion (ADMIN) y de paciente con invitacion (ADMIN/GESTION)', async () => {
      correos().length = 0;
      const email = `invitado-${randomUUID().slice(0, 8)}@test.cl`;
      const nuevo = await t
        .http()
        .post('/api/usuarios')
        .set(await tk(admin))
        .send({ email, nombre: 'Daniela Contreras', rol: 'GESTION' });
      expect(nuevo.status).toBe(201);
      await new Promise((r) => setTimeout(r, 50));
      const token = tokenDe(ultimoA(email));
      expect(token).not.toBe('');
      expect((await t.http().post('/api/auth/login').send({ email, password: 'cualquier-clave' })).status).toBe(401);
      const activa = await t.http().post('/api/auth/activacion').send({ token, password: 'clave-elegida-123' });
      expect(activa.status).toBe(200);
      expect(activa.body.rol).toBe('GESTION');

      const p = await t.datos.paciente(prof.id);
      const emailP = `paciente-${randomUUID().slice(0, 8)}@test.cl`;
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${p.id}/invitacion`)
            .set(await tk(prof))
            .send({ email: emailP })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${p.id}/invitacion`)
            .set(await tk(gestion))
            .send({ email: emailP })
        ).status,
      ).toBe(201);
      await new Promise((r) => setTimeout(r, 50));
      const r = await t
        .http()
        .post('/api/auth/activacion')
        .send({ token: tokenDe(ultimoA(emailP)), password: 'clave-paciente-1' });
      expect(r.body.rol).toBe('PACIENTE');
      // Menor de 14: la invitacion es del adulto responsable.
      const nino = await t.datos.paciente(prof.id, { fechaNacimiento: new Date(Date.now() - 10 * 365 * DIA) });
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${nino.id}/invitacion`)
            .set(await tk(gestion))
            .send({ email: 'nino@test.cl' })
        ).status,
      ).toBe(400);
    });
  });

  describe('centro', () => {
    it('modulos: el front los consulta; la API responde 403 en un modulo no contratado', async () => {
      const r = await t
        .http()
        .get('/api/modulos')
        .set(await tk(paciente));
      expect(r.body.activos).toEqual(expect.arrayContaining(['FICHAS', 'AGENDA', 'COBROS']));
      await t.dueno.$executeRaw`UPDATE configuracion_centro SET modulos_activos = ARRAY['PAGINA_PUBLICA','FICHAS','AGENDA','EQUIPO','MATCH']::modulo_centro[]`;
      t.app.get(ModulosGuard).olvidar();
      try {
        const c = await t
          .http()
          .get('/api/cobros/citas')
          .set(await tk(admin));
        expect(c.status).toBe(403);
        expect(c.body.restriccion).toBe('modulo_inactivo');
        expect(
          (
            await t
              .http()
              .get('/api/pacientes')
              .set(await tk(admin))
          ).status,
        ).toBe(200);
      } finally {
        await t.dueno
          .$executeRaw`UPDATE configuracion_centro SET modulos_activos = ARRAY['PAGINA_PUBLICA','FICHAS','AGENDA','EQUIPO','MATCH','COBROS']::modulo_centro[]`;
        t.app.get(ModulosGuard).olvidar();
      }
    });

    it('contenido publico (ADMIN), politicas versionadas, horario del centro y logo sin metadatos', async () => {
      const contenido = {
        heroTitulo: 'Acompañamiento psicologico',
        servicios: [{ titulo: 'Terapia individual', texto: 'Sesiones de 50 minutos.' }],
        colorMarca: '#B5532D',
      };
      expect(
        (
          await t
            .http()
            .patch('/api/configuracion/contenido-publico')
            .set(await tk(gestion))
            .send(contenido)
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .patch('/api/configuracion/contenido-publico')
            .set(await tk(admin))
            .send(contenido)
        ).status,
      ).toBe(200);
      const centro = await t.http().get('/api/publico/centro');
      expect(centro.body).toEqual(expect.objectContaining({ hero_titulo: 'Acompañamiento psicologico', color_marca: '#B5532D' }));
      expect(centro.body.modulos).toContain('MATCH');

      const antes = (await t.http().get('/api/publico/politicas/CONSENTIMIENTO_ATENCION')).body.version;
      expect(
        (
          await t
            .http()
            .post('/api/politicas')
            .set(await tk(gestion))
            .send({ tipo: 'CONSENTIMIENTO_ATENCION', texto: 'Nuevo texto del consentimiento informado de atencion.' })
        ).status,
      ).toBe(403);
      const nueva = await t
        .http()
        .post('/api/politicas')
        .set(await tk(admin))
        .send({ tipo: 'CONSENTIMIENTO_ATENCION', texto: 'Nuevo texto del consentimiento informado de atencion.' });
      expect(nueva.body.version).toBe(antes + 1);

      expect(
        (
          await t
            .http()
            .put('/api/configuracion/horario')
            .set(await tk(gestion))
            .send({ bloques: [] })
        ).status,
      ).toBe(403);
      const h = await t
        .http()
        .put('/api/configuracion/horario')
        .set(await tk(admin))
        .send({ bloques: [{ diaSemana: 1, inicioMin: 540, finMin: 1200 }] });
      expect(h.body).toHaveLength(1);
      await t
        .http()
        .put('/api/configuracion/horario')
        .set(await tk(admin))
        .send({ bloques: [] });

      // Imagen con EXIF: se publica como WebP, redimensionada y sin metadatos.
      const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#aa5500' } })
        .jpeg()
        .withMetadata({ exif: { IFD0: { Copyright: 'secreto-exif' } } })
        .toBuffer();
      const logo = await t
        .http()
        .post('/api/configuracion/logo')
        .set(await tk(admin))
        .attach('imagen', png, 'logo.jpg');
      expect(logo.status).toBe(201);
      const img = await t.http().get(logo.body.url).buffer(true).parse(binario);
      expect(img.headers['content-type']).toBe('image/webp');
      const meta = await sharp(img.body as Buffer).metadata();
      expect(meta.width).toBe(1024);
      expect(meta.exif).toBeUndefined();
      expect((img.body as Buffer).toString('latin1')).not.toContain('secreto-exif');
      expect(
        (
          await t
            .http()
            .post('/api/configuracion/logo')
            .set(await tk(admin))
            .attach('imagen', Buffer.from('%PDF-1.4 no es imagen'), 'x.jpg')
        ).status,
      ).toBe(422);
    });

    it('dashboard por rol: agregados para ADMIN/GESTION, los suyos para el profesional; el paciente no', async () => {
      const a = await t
        .http()
        .get('/api/reportes/dashboard')
        .set(await tk(gestion));
      expect(a.body).toEqual(expect.objectContaining({ rol: 'GESTION', pendientes: expect.any(Object) }));
      expect(JSON.stringify(a.body)).not.toMatch(/notas|motivo|diagnostico/);
      const p = await t
        .http()
        .get('/api/reportes/dashboard')
        .set(await tk(prof));
      expect(p.body).toEqual(expect.objectContaining({ rol: 'PROFESIONAL', fichas_sin_cerrar: expect.any(Number) }));
      expect(
        (
          await t
            .http()
            .get('/api/reportes/dashboard')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
    });
  });

  describe('portal publico y match', () => {
    it('perfil extendido, foto publica y match por reglas explicable (sin guardar respuestas)', async () => {
      const publico = await t.datos.usuario('PROFESIONAL');
      await publicar(publico, { convenios: ['FONASA'], idiomas: ['Español'], citaDestacada: 'Procesos con objetivos claros.' });
      const foto = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#335577' } })
        .png()
        .toBuffer();
      expect(
        (
          await t
            .http()
            .post('/api/profesionales/yo/foto')
            .set(await tk(gestion))
            .attach('imagen', foto, 'f.png')
        ).status,
      ).toBe(403);
      const f = await t
        .http()
        .post('/api/profesionales/yo/foto')
        .set(await tk(publico))
        .attach('imagen', foto, 'f.png');
      expect(f.status).toBe(201);
      const perfiles = await t.http().get('/api/publico/profesionales').query({ tipoAtencion: tipoNombre });
      const p = perfiles.body.find((x: { id: string }) => x.id === publico.id);
      expect(p).toEqual(expect.objectContaining({ foto_url: f.body.fotoUrl, convenios: ['FONASA'], idiomas: ['Español'], resenas: 0 }));

      const cuestionario = await t.http().get('/api/publico/cuestionario');
      expect(cuestionario.body.preguntas.map((q: { clave: string }) => q.clave)).toEqual(
        expect.arrayContaining(['motivos', 'quien', 'relato', 'prevision', 'modalidad']),
      );
      expect(
        (
          await t
            .http()
            .post('/api/publico/match')
            .send({ respuestas: { motivos: ['ansiedad'] } })
        ).status,
      ).toBe(400);
      const respuestas = {
        motivos: ['ansiedad'],
        quien: 'adulto',
        intensidad: '10',
        relato: 'Hace meses que duermo mal y me cuesta concentrarme',
        prevision: 'fonasa',
        modalidad: 'online',
      };
      const m = await t.http().post('/api/publico/match').send({ respuestas });
      expect(m.status).toBe(200);
      expect(m.body.avisos).toEqual([expect.stringContaining('Salud Responde')]);
      const todos = [m.body.recomendado, ...m.body.otros];
      const suyo = todos.find((x: { perfil: { id: string } }) => x.perfil.id === publico.id);
      expect(suyo?.razones).toEqual(expect.arrayContaining(['trabaja ansiedad', 'tiene convenio FONASA', 'atiende online']));
      expect(m.body.recomendado.advertencia === null || typeof m.body.recomendado.advertencia === 'string').toBe(true);

      // Configuracion y metricas: solo ADMIN.
      expect(
        (
          await t
            .http()
            .get('/api/match/metricas')
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
      const met = await t
        .http()
        .get('/api/match/metricas')
        .set(await tk(admin));
      expect(met.body.completados).toBeGreaterThan(0);
      const pregunta = await t
        .http()
        .post('/api/match/preguntas')
        .set(await tk(admin))
        .send({ clave: `p${Date.now()}`, texto: '¿Tienes seguro complementario?', tipo: 'UNICA', orden: 20, obligatoria: false });
      expect(pregunta.status).toBe(201);
      expect(
        (
          await t
            .http()
            .post(`/api/match/preguntas/${pregunta.body.id}/opciones`)
            .set(await tk(admin))
            .send({ valor: 'si', etiqueta: 'Si', orden: 1, criterio: 'PREVISION', objetivo: 'ISAPRE', peso: 2 })
        ).status,
      ).toBe(201);
      await t
        .http()
        .patch(`/api/match/preguntas/${pregunta.body.id}`)
        .set(await tk(admin))
        .send({ activa: false });
    });

    it('solicitud de hora sin cuenta: retiene, verifica el correo, concreta e invita; respuestas solo para el tratante', async () => {
      const publico = await t.datos.usuario('PROFESIONAL');
      await publicar(publico);
      correos().length = 0;
      // Trampa para bots: misma respuesta, sin efectos.
      const bot = await t
        .http()
        .post('/api/publico/solicitudes')
        .send(solicitud(publico.id, 'bot@test.cl', { sitioWeb: 'http://spam' }));
      expect(bot.status).toBe(202);
      const email = `ema-${randomUUID().slice(0, 8)}@test.cl`;
      const dto = solicitud(publico.id, email);
      const r = await t.http().post('/api/publico/solicitudes').send(dto);
      expect(r.status).toBe(202);
      expect(correos().map((c) => c.para)).toEqual([email]);
      expect(
        (
          await t
            .http()
            .post('/api/publico/solicitudes')
            .send(solicitud(publico.id, 'otro@test.cl', { inicio: dto.inicio, fin: dto.fin }))
        ).status,
      ).toBe(409);
      const v = await t
        .http()
        .post('/api/publico/solicitudes/verificacion')
        .send({ token: tokenDe(ultimoA(email)) });
      expect(v.status).toBe(200);
      expect(v.body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', invitacionEnviada: true }));
      expect(
        (
          await t
            .http()
            .post('/api/publico/solicitudes/verificacion')
            .send({ token: tokenDe(ultimoA(email)) })
        ).status,
      ).toBe(404);
      const pac = await t.dueno.paciente.findFirstOrThrow({ where: { citas: { some: { id: v.body.citaId } } } });
      const resp = await t
        .http()
        .get(`/api/pacientes/${pac.id}/respuestas-match`)
        .set(await tk(publico));
      expect(resp.body[0].respuestas.relato).toContain('Duermo mal');
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${pac.id}/respuestas-match`)
            .set(await tk(admin))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${pac.id}/respuestas-match`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(404);
      // La invitacion crea la cuenta del paciente.
      const inv = correos().find((c) => c.para === email && c.asunto.startsWith('Active'));
      const cuenta = await t
        .http()
        .post('/api/auth/activacion')
        .send({ token: tokenDe(inv), password: 'clave-de-ema-1' });
      expect(cuenta.body.rol).toBe('PACIENTE');
    });

    it('profesional que aprueba pacientes nuevos: SOLICITADA, aprobacion del tratante e invitacion', async () => {
      const publico = await t.datos.usuario('PROFESIONAL');
      await publicar(publico, { requiereAprobacionNuevos: true });
      correos().length = 0;
      const email = `nuevo-${randomUUID().slice(0, 8)}@test.cl`;
      await t.http().post('/api/publico/solicitudes').send(solicitud(publico.id, email));
      const v = await t
        .http()
        .post('/api/publico/solicitudes/verificacion')
        .send({ token: tokenDe(ultimoA(email)) });
      expect(v.body).toEqual(expect.objectContaining({ estado: 'SOLICITADA', invitacionEnviada: false }));
      expect(
        (
          await t
            .http()
            .post(`/api/citas/${v.body.citaId}/aprobacion`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(404);
      const a = await t
        .http()
        .post(`/api/citas/${v.body.citaId}/aprobacion`)
        .set(await tk(publico));
      expect(a.status).toBe(200);
      expect(a.body).toEqual(expect.objectContaining({ estado: 'CONFIRMADA', invitacion: expect.objectContaining({ rol: 'PACIENTE' }) }));
    });
  });

  describe('clinica y agenda', () => {
    it('acceso clinico temporal y "cubrir sesion" (C-4, C-5)', async () => {
      const cita = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send({ pacienteId: paciente.pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', ...horario(5) });
      expect(cita.status).toBe(201);
      expect(
        (
          await t
            .http()
            .patch(`/api/citas/${cita.body.id}/profesional`)
            .set(await tk(gestion))
            .send({ profesionalId: otroProf.id })
        ).status,
      ).toBe(422);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${paciente.pacienteId}`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${paciente.pacienteId}/accesos-temporales`)
            .set(await tk(gestion))
            .send({ profesionalId: otroProf.id, motivo: 'REEMPLAZO', alcance: 'LECTURA', hasta: new Date(Date.now() + 10 * DIA) })
        ).status,
      ).toBe(403);
      const acceso = await t
        .http()
        .post(`/api/pacientes/${paciente.pacienteId}/accesos-temporales`)
        .set(await tk(prof))
        .send({ profesionalId: otroProf.id, motivo: 'REEMPLAZO', alcance: 'LECTURA_ESCRITURA', hasta: new Date(Date.now() + 10 * DIA) });
      expect(acceso.status).toBe(201);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${paciente.pacienteId}`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(200);
      const cubierta = await t
        .http()
        .patch(`/api/citas/${cita.body.id}/profesional`)
        .set(await tk(gestion))
        .send({ profesionalId: otroProf.id });
      expect(cubierta.status).toBe(200);
      expect(cubierta.body.profesionalId).toBe(otroProf.id);
      expect(
        (
          await t
            .http()
            .get('/api/accesos-temporales')
            .set(await tk(otroProf))
        ).body.map((a: { id: string }) => a.id),
      ).toContain(acceso.body.id);
    });

    it('"cubrir sesion" otorgando el acceso en el mismo paso: atomico, solo ADMIN', async () => {
      const reemplazo = await t.datos.usuario('PROFESIONAL');
      await t.datos.disponibleSiempre(reemplazo.id);
      const otroPaciente = await t.datos.usuarioPaciente(prof.id);
      const pacienteDelReemplazo = await t.datos.usuarioPaciente(reemplazo.id);
      const accesosDe = () => t.dueno.accesoClinicoTemporal.count({ where: { pacienteId: otroPaciente.pacienteId, profesionalId: reemplazo.id } });
      const hasta = new Date(Date.now() + 10 * DIA);
      const enHorario = async (pacienteId: string, profesionalId: string, h: { inicio: string; fin: string }) => {
        const r = await t
          .http()
          .post('/api/citas')
          .set(await tk(gestion))
          .send({ pacienteId, profesionalId, modalidad: 'ONLINE', ...h });
        expect(r.status).toBe(201);
        return r.body.id as string;
      };

      // El reemplazo ya tiene otra cita a esa hora: mover la cita choca (409) y el acceso no queda otorgado.
      const h = horario(6);
      const chocada = await enHorario(otroPaciente.pacienteId, prof.id, h);
      await enHorario(pacienteDelReemplazo.pacienteId, reemplazo.id, h);
      expect(
        (
          await t
            .http()
            .patch(`/api/citas/${chocada}/profesional`)
            .set(await tk(admin))
            .send({ profesionalId: reemplazo.id, otorgarAccesoHasta: hasta })
        ).status,
      ).toBe(409);
      expect(await accesosDe()).toBe(0);

      // GESTION no otorga accesos clinicos.
      const libre = await enHorario(otroPaciente.pacienteId, prof.id, horario(6));
      expect(
        (
          await t
            .http()
            .patch(`/api/citas/${libre}/profesional`)
            .set(await tk(gestion))
            .send({ profesionalId: reemplazo.id, otorgarAccesoHasta: hasta })
        ).status,
      ).toBe(403);
      expect(await accesosDe()).toBe(0);

      const cubierta = await t
        .http()
        .patch(`/api/citas/${libre}/profesional`)
        .set(await tk(admin))
        .send({ profesionalId: reemplazo.id, otorgarAccesoHasta: hasta });
      expect(cubierta.status).toBe(200);
      expect(cubierta.body.profesionalId).toBe(reemplazo.id);
      expect(await accesosDe()).toBe(1);
    });

    it('borradores (C-8): autoguardado, solo el autor, confirmar crea la evolucion (con la sesion) y elimina el borrador', async () => {
      const tipoSesion = await t.datos.tipoSesionAprobado();
      const cita = await citaPasada(paciente.pacienteId, prof.id);
      const b = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/borradores`)
        .set(await tk(prof))
        .send({ contenido: 'Primer borrador', citaId: cita.id });
      expect(b.status).toBe(201);
      expect(
        (
          await t
            .http()
            .put(`/api/borradores/${b.body.id}`)
            .set(await tk(prof))
            .send({ contenido: 'Borrador corregido', citaId: cita.id })
        ).body.contenido,
      ).toBe('Borrador corregido');
      expect(
        (
          await t
            .http()
            .put(`/api/borradores/${b.body.id}`)
            .set(await tk(otroProf))
            .send({ contenido: 'x' })
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .get('/api/borradores')
            .set(await tk(admin))
        ).status,
      ).toBe(403);
      const ok = await t
        .http()
        .post(`/api/borradores/${b.body.id}/confirmacion`)
        .set(await tk(prof))
        .send({ tipoSesionId: tipoSesion.id, nivelRiesgo: 'NINGUNO' });
      expect(ok.status).toBe(201);
      expect(ok.body.evolucion).toEqual(expect.objectContaining({ notas: 'Borrador corregido', citaId: cita.id }));
      expect(
        (
          await t
            .http()
            .get('/api/borradores')
            .set(await tk(prof))
        ).body.find((x: { id: string }) => x.id === b.body.id),
      ).toBeUndefined();
      const estado = await t
        .http()
        .get(`/api/profesionales/${prof.id}/estado-fichas`)
        .set(await tk(gestion));
      expect(estado.body.find((e: { paciente_id: string }) => e.paciente_id === paciente.pacienteId)).toBeDefined();
    });

    it('lista de espera, alta y contacto de emergencia', async () => {
      const otro = await t.datos.usuarioPaciente(prof.id);
      const le = await t
        .http()
        .post('/api/lista-espera')
        .set(await tk(otro))
        .send({ pacienteId: otro.pacienteId, profesionalId: prof.id, preferencias: 'Martes en la tarde' });
      expect(le.status).toBe(201);
      expect(
        (
          await t
            .http()
            .post('/api/lista-espera')
            .set(await tk(otro))
            .send({ pacienteId: paciente.pacienteId, profesionalId: prof.id })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .get('/api/lista-espera')
            .query({ profesionalId: prof.id })
            .set(await tk(gestion))
        ).body.map((x: { id: string }) => x.id),
      ).toContain(le.body.id);
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${otro.pacienteId}`)
            .set(await tk(gestion))
            .send({ contactoEmergencia: 'Rodrigo, padre, +56977441122' })
        ).body.contactoEmergencia,
      ).toBe('Rodrigo, padre, +56977441122');
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${otro.pacienteId}/alta`)
            .set(await tk(admin))
            .send({ fecha: new Date().toISOString(), motivo: 'objetivos cumplidos' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${otro.pacienteId}/alta`)
            .set(await tk(prof))
            .send({ fecha: new Date().toISOString(), motivo: 'objetivos cumplidos' })
        ).status,
      ).toBe(201);
      const altas = await t
        .http()
        .get(`/api/pacientes/${otro.pacienteId}/altas`)
        .set(await tk(prof));
      expect(altas.body[0].motivo).toBe('objetivos cumplidos');
      expect((await t.dueno.listaEspera.findUniqueOrThrow({ where: { id: le.body.id } })).estado).toBe('CANCELADA');
    });
  });

  describe('portal del paciente', () => {
    it('reseñas (D-1): con sesion realizada, moderacion de ADMIN, publicas con nombre + inicial, feedback privado solo del profesional', async () => {
      const p = await t.datos.usuarioPaciente(prof.id);
      expect(
        (
          await t
            .http()
            .post('/api/portal/resenas')
            .set(await tk(p))
            .send({ profesionalId: prof.id, calificacion: 5 })
        ).status,
      ).toBe(422);
      await citaPasada(p.pacienteId, prof.id);
      const r = await t
        .http()
        .post('/api/portal/resenas')
        .set(await tk(p))
        .send({ profesionalId: prof.id, calificacion: 5, texto: 'Clara y ordenada', feedbackPrivado: 'Puntualidad', mostrarComo: 'NOMBRE_INICIAL' });
      expect(r.status).toBe(201);
      expect(r.body.estado).toBe('PENDIENTE');
      expect(
        (
          await t
            .http()
            .post('/api/portal/resenas')
            .set(await tk(p))
            .send({ profesionalId: prof.id, calificacion: 4 })
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .get('/api/resenas')
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
      const cola = await t
        .http()
        .get('/api/resenas')
        .set(await tk(admin));
      const enCola = cola.body.find((x: { id: string }) => x.id === r.body.id);
      expect(enCola.texto).toBe('Clara y ordenada');
      expect(JSON.stringify(enCola)).not.toContain('Puntualidad');
      expect(
        (
          await t
            .http()
            .post(`/api/resenas/${r.body.id}/moderacion`)
            .set(await tk(admin))
            .send({ publicar: false })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .post(`/api/resenas/${r.body.id}/moderacion`)
            .set(await tk(admin))
            .send({ publicar: true })
        ).status,
      ).toBe(200);
      const publicas = await t.http().get(`/api/publico/profesionales/${prof.id}/resenas`);
      expect(publicas.body).toEqual([expect.objectContaining({ texto: 'Clara y ordenada', calificacion: 5, autor: expect.stringMatching(/^Paciente \w\.$/) })]);
      expect((await t.http().post(`/api/publico/resenas/${r.body.id}/reporte`).send({ motivo: 'contenido ofensivo' })).status).toBe(204);
      const mias = await t
        .http()
        .get('/api/profesionales/yo/resenas')
        .set(await tk(prof));
      expect(mias.body.find((x: { id: string }) => x.id === r.body.id).feedbackPrivado).toBe('Puntualidad');
      const editada = await t
        .http()
        .put(`/api/portal/resenas/${r.body.id}`)
        .set(await tk(p))
        .send({ calificacion: 4, texto: 'Editada' });
      expect(editada.body.estado).toBe('PENDIENTE');
      expect(
        (
          await t
            .http()
            .post(`/api/portal/resenas/${r.body.id}/retiro`)
            .set(await tk(p))
        ).body.estado,
      ).toBe('RETIRADA');
    });

    it('mis datos (C-9): telefono y correo verificado; consentimiento de atencion en el portal y por enlace', async () => {
      const p = await t.datos.usuarioPaciente(prof.id);
      expect(
        (
          await t
            .http()
            .patch('/api/portal/mis-datos')
            .set(await tk(p))
            .send({ telefono: '+56933334444' })
        ).body.telefonoActualizado,
      ).toBe(true);
      expect(
        (
          await t
            .http()
            .patch('/api/portal/mis-datos')
            .set(await tk(p))
            .send({ fechaNacimiento: '2015-01-01' })
        ).status,
      ).toBe(400);
      correos().length = 0;
      const nuevo = `nuevo-${randomUUID().slice(0, 8)}@test.cl`;
      await t
        .http()
        .patch('/api/portal/mis-datos')
        .set(await tk(p))
        .send({ email: nuevo });
      await new Promise((r) => setTimeout(r, 50));
      expect(
        (
          await t
            .http()
            .post('/api/auth/correo/verificacion')
            .send({ token: tokenDe(ultimoA(nuevo)) })
        ).status,
      ).toBe(204);
      const datos = await t
        .http()
        .get('/api/portal/mis-datos')
        .set(await tk(p));
      expect(datos.body).toEqual(expect.objectContaining({ email: nuevo, telefono: '+56933334444' }));
      expect(
        (
          await t
            .http()
            .post('/api/portal/consentimiento-atencion')
            .set(await tk(p))
            .send({})
        ).status,
      ).toBe(201);
      // Por enlace (GESTION lo envia al correo del paciente).
      correos().length = 0;
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${p.pacienteId}/consentimiento-atencion/enlace`)
            .set(await tk(gestion))
        ).status,
      ).toBe(201);
      await new Promise((r) => setTimeout(r, 50));
      const token = tokenDe(ultimoA(nuevo));
      const consulta = await t.http().post('/api/publico/consentimientos/consulta').send({ token });
      expect(consulta.body.tipo).toBe('ATENCION');
      expect(
        (
          await t
            .http()
            .post('/api/publico/consentimientos/respuesta')
            .send({ token, acepta: true, version: String(consulta.body.politica_version) })
        ).status,
      ).toBe(200);
      const aceptaciones = await t
        .http()
        .get(`/api/pacientes/${p.pacienteId}/aceptaciones`)
        .set(await tk(gestion));
      expect(aceptaciones.body.map((a: { canal: string }) => a.canal)).toEqual(expect.arrayContaining(['PORTAL', 'TOKEN']));
    });

    it('menores (D-4): el adolescente no ve montos; el adulto responsable ve citas y estado de pago de su menor, no sus mensajes', async () => {
      const teen = await t.datos.usuarioPaciente(prof.id, { fechaNacimiento: new Date(Date.now() - 15.5 * 365.25 * DIA) });
      const adulto = await t.dueno.adultoResponsable.create({
        data: { id: randomUUID(), pacienteId: teen.pacienteId, nombre: 'Paula', email: 'paula@test.cl' },
      });
      const responsable = await t.datos.usuario('RESPONSABLE');
      await t.dueno.adultoResponsable.update({ where: { id: adulto.id }, data: { usuarioId: responsable.id } });
      const cita = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send({ pacienteId: teen.pacienteId, profesionalId: prof.id, modalidad: 'ONLINE', ...horario(6) });
      expect(cita.status).toBe(201);
      expect(
        (
          await t
            .http()
            .get('/api/portal/citas')
            .set(await tk(teen))
        ).body.map((c: { id: string }) => c.id),
      ).toContain(cita.body.id);
      // Cuenta restringida: la ruta responde, pero la RLS no le muestra montos.
      expect(
        (
          await t
            .http()
            .get('/api/cobros/citas')
            .set(await tk(teen))
        ).body,
      ).toEqual([]);
      await t
        .http()
        .post('/api/portal/mensajes')
        .set(await tk(teen))
        .send({ profesionalId: prof.id, contenido: 'Mensaje del adolescente' });
      expect(
        (
          await t
            .http()
            .get('/api/portal/pacientes')
            .set(await tk(responsable))
        ).body.map((p: { id: string }) => p.id),
      ).toEqual([teen.pacienteId]);
      expect(
        (
          await t
            .http()
            .get('/api/portal/citas')
            .query({ pacienteId: teen.pacienteId })
            .set(await tk(responsable))
        ).body.map((c: { id: string }) => c.id),
      ).toContain(cita.body.id);
      expect(
        (
          await t
            .http()
            .get('/api/cobros/citas')
            .set(await tk(responsable))
        ).body.map((c: { cita_id: string }) => c.cita_id),
      ).toContain(cita.body.id);
      expect(
        (
          await t
            .http()
            .get('/api/mensajes')
            .set(await tk(responsable))
        ).body,
      ).toEqual([]);
      expect(
        (
          await t
            .http()
            .post('/api/portal/mensajes')
            .set(await tk(responsable))
            .send({ profesionalId: prof.id, contenido: 'Sin indicar el menor' })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .post('/api/portal/mensajes')
            .set(await tk(responsable))
            .send({ profesionalId: prof.id, contenido: 'Del adulto', pacienteId: teen.pacienteId })
        ).status,
      ).toBe(201);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${teen.pacienteId}/ficha`)
            .set(await tk(responsable))
        ).status,
      ).toBe(403);
    });
  });

  describe('cobros', () => {
    it('reporte por profesional y PDF (sin datos clinicos); PDF de liquidacion', async () => {
      const desde = new Date(Date.now() - 30 * DIA).toISOString().slice(0, 10);
      const hasta = new Date(Date.now() + 30 * DIA).toISOString().slice(0, 10);
      const r = await t
        .http()
        .get('/api/cobros/reporte')
        .query({ desde, hasta })
        .set(await tk(gestion));
      expect(r.status).toBe(200);
      expect(r.body).toEqual(expect.objectContaining({ profesionales: expect.any(Array), medios: expect.any(Array) }));
      const propio = await t
        .http()
        .get('/api/cobros/reporte')
        .query({ desde, hasta })
        .set(await tk(prof));
      expect(propio.body.profesionales.every((p: { profesional_id: string }) => p.profesional_id === prof.id)).toBe(true);
      expect(
        (
          await t
            .http()
            .get('/api/cobros/reporte')
            .query({ desde, hasta })
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
      const pdf = await t
        .http()
        .get('/api/cobros/reporte/pdf')
        .query({ desde, hasta })
        .set(await tk(gestion))
        .buffer(true)
        .parse(binario);
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      const liq = await t
        .http()
        .post('/api/cobros/liquidaciones')
        .set(await tk(gestion))
        .send({
          profesionalId: otroProf.id,
          desde: new Date(Date.now() - 400 * DIA).toISOString().slice(0, 10),
          hasta: new Date(Date.now() - 390 * DIA).toISOString().slice(0, 10),
        });
      expect(liq.status).toBe(201);
      const lp = await t
        .http()
        .get(`/api/cobros/liquidaciones/${liq.body.id}/pdf`)
        .set(await tk(gestion))
        .buffer(true)
        .parse(binario);
      expect(lp.headers['content-type']).toBe('application/pdf');
    });
  });
});
