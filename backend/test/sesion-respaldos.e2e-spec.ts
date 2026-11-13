/**
 * 2026-11-07: sesion unica con registro de conexiones (docs/api/sesion_unica_conexiones.md)
 * y respaldo de titulos como archivo (docs/api/respaldo_titulos.md). Por rol.
 */
import { JwtService } from '@nestjs/jwt';

import { auth, CLAVE, crearApp, ultimoCodigo, type AppPrueba, type UsuarioPrueba } from './apoyo';

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const PDF = Buffer.from('%PDF-1.4 respaldo de prueba');

describe('sesion unica, conexiones y respaldo de titulos', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otroProfesional: UsuarioPrueba;
  let usuarioPaciente: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    otroProfesional = await t.datos.usuario('PROFESIONAL');
    usuarioPaciente = await t.datos.usuarioPaciente(profesional.id);
  });

  afterAll(() => t.cerrar());

  /** Login completo (con segundo factor) desde un navegador dado. */
  async function entrar(u: UsuarioPrueba, ua: string) {
    const r = await t.http().post('/api/auth/login').set('User-Agent', ua).send({ email: u.email, password: CLAVE });
    const s = await t
      .http()
      .post('/api/auth/segundo-factor')
      .set('User-Agent', ua)
      .send({ desafio: r.body.desafio, codigo: ultimoCodigo(t.app, u.email) });
    expect(s.status).toBe(200);
    return s.body as { accessToken: string; refreshToken: string };
  }

  describe('sesion unica', () => {
    it('entrar en otro navegador cierra la sesion anterior de inmediato; el refresh dice por que', async () => {
      const u = await t.datos.usuario('PROFESIONAL');
      const primera = await entrar(u, CHROME_WIN);
      expect((await t.http().get('/api/usuarios/yo').set(auth(primera.accessToken))).status).toBe(200);

      const segunda = await entrar(u, SAFARI_IOS);
      // El access token anterior no ha vencido, pero su sesion se cerro: 401 en la siguiente request.
      expect((await t.http().get('/api/usuarios/yo').set(auth(primera.accessToken))).status).toBe(401);
      const refresh = await t.http().post('/api/auth/refresh').send({ refreshToken: primera.refreshToken });
      expect(refresh.status).toBe(401);
      expect(refresh.body.motivo).toBe('NUEVA_SESION');
      expect((await t.http().get('/api/usuarios/yo').set(auth(segunda.accessToken))).status).toBe(200);

      // Registro de conexiones: solo las propias, la actual marcada, la anterior con su motivo y navegador.
      const c = await t.http().get('/api/usuarios/yo/conexiones').set(auth(segunda.accessToken));
      expect(c.status).toBe(200);
      expect(c.body).toHaveLength(2);
      expect(c.body[0]).toEqual(
        expect.objectContaining({ dispositivo: 'Safari en iOS', rol: 'PROFESIONAL', activa: true, actual: true, fin: null, motivo: null }),
      );
      expect(c.body[1]).toEqual(expect.objectContaining({ dispositivo: 'Chrome en Windows', activa: false, actual: false, motivo: 'NUEVA_SESION' }));

      // Cerrar sesion: el access token deja de servir y la conexion queda como LOGOUT.
      expect((await t.http().post('/api/auth/logout').send({ refreshToken: segunda.refreshToken })).status).toBe(204);
      expect((await t.http().get('/api/usuarios/yo').set(auth(segunda.accessToken))).status).toBe(401);
      const tercera = await entrar(u, CHROME_WIN);
      const despues = await t.http().get('/api/usuarios/yo/conexiones').set(auth(tercera.accessToken));
      expect(despues.body.map((x: { motivo: string | null }) => x.motivo)).toEqual([null, 'LOGOUT', 'NUEVA_SESION']);
    });

    it('conexiones: solo el equipo (paciente 403) y cada uno ve las suyas', async () => {
      expect(
        (
          await t
            .http()
            .get('/api/usuarios/yo/conexiones')
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
      for (const u of [admin, gestion, otroProfesional]) {
        const r = await t
          .http()
          .get('/api/usuarios/yo/conexiones')
          .set(await tk(u));
        expect(r.status).toBe(200);
        expect(r.body.filter((x: { actual: boolean }) => x.actual)).toHaveLength(1);
      }
    });

    it('un access token sin sid (anterior al cambio) se rechaza', async () => {
      const jwt = t.app.get(JwtService);
      const viejo = await jwt.signAsync({ sub: admin.id, rol: 'ADMIN', tipo: 'acceso' }, { expiresIn: 60, algorithm: 'HS256' });
      expect((await t.http().get('/api/usuarios/yo').set(auth(viejo))).status).toBe(401);
    });
  });

  describe('respaldo de titulos', () => {
    it('solo el propio sube; tipo por contenido; leen el propio y ADMIN/GESTION; version nueva vuelve a revision', async () => {
      const titulo = await t
        .http()
        .post('/api/trayectoria')
        .set(await tk(profesional))
        .send({ tipo: 'MAGISTER', titulo: 'Magister de prueba', institucion: 'U. de Prueba', anio: 2020 });
      expect(titulo.status).toBe(201);
      expect(titulo.body.respaldos).toEqual([]);
      const ruta = `/api/trayectoria/${titulo.body.id}/respaldos`;

      expect(
        (
          await t
            .http()
            .post(ruta)
            .set(await tk(profesional))
            .attach('archivo', Buffer.from('MZ ejecutable'), 'x.pdf')
        ).status,
      ).toBe(422);
      expect(
        (
          await t
            .http()
            .post(ruta)
            .set(await tk(otroProfesional))
            .attach('archivo', PDF, 'x.pdf')
        ).status,
      ).toBe(404);
      for (const u of [admin, gestion, usuarioPaciente]) {
        expect(
          (
            await t
              .http()
              .post(ruta)
              .set(await tk(u))
              .attach('archivo', PDF, 'x.pdf')
          ).status,
        ).toBe(403);
      }
      const subido = await t
        .http()
        .post(ruta)
        .set(await tk(profesional))
        .attach('archivo', PDF, 'magister.pdf');
      expect(subido.status).toBe(201);
      expect(subido.body.respaldos).toEqual([expect.objectContaining({ nombreArchivo: 'magister.pdf', tipoMime: 'application/pdf', tamanoBytes: PDF.length })]);
      const respaldoId = subido.body.respaldos[0].id as string;

      // Cifrado en reposo: la columna no trae el contenido en claro.
      const [fila] = await t.dueno.$queryRaw<{ contenido: Buffer }[]>`SELECT contenido FROM trayectoria_respaldos WHERE id = ${respaldoId}::uuid`;
      expect(fila.contenido.includes(Buffer.from('respaldo de prueba'))).toBe(false);

      // Descarga: propio, ADMIN y GESTION; otro profesional 404; paciente 403. Queda en registro_exportaciones.
      for (const u of [profesional, admin, gestion]) {
        const d = await t
          .http()
          .get(`/api/trayectoria/respaldos/${respaldoId}`)
          .set(await tk(u))
          .buffer(true);
        expect(d.status).toBe(200);
        expect(Buffer.from(d.body as Buffer).equals(PDF)).toBe(true);
      }
      expect(
        (
          await t
            .http()
            .get(`/api/trayectoria/respaldos/${respaldoId}`)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .get(`/api/trayectoria/respaldos/${respaldoId}`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
      expect(await t.dueno.registroExportacion.count({ where: { recurso: 'trayectoria_respaldos', referenciaId: respaldoId } })).toBe(3);

      const v = await t
        .http()
        .post(`/api/trayectoria/${titulo.body.id}/verificacion`)
        .set(await tk(admin))
        .send({ verificado: true });
      expect(v.status).toBe(201);
      expect(v.body.verificado).toBe(true);

      const v2 = await t
        .http()
        .post(ruta)
        .set(await tk(profesional))
        .attach('archivo', PDF, 'magister-v2.pdf');
      expect(v2.body.verificado).toBe(false);
      expect(v2.body.respaldos.map((r: { nombreArchivo: string }) => r.nombreArchivo)).toEqual(['magister-v2.pdf', 'magister.pdf']);

      // Eliminar el titulo se lleva sus respaldos.
      expect(
        (
          await t
            .http()
            .delete(`/api/trayectoria/${titulo.body.id}`)
            .set(await tk(profesional))
        ).status,
      ).toBe(200);
      expect(await t.dueno.trayectoriaRespaldo.count({ where: { trayectoriaId: titulo.body.id } })).toBe(0);
    });
  });
});
