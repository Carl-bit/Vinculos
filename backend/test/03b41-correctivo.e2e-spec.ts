/**
 * 03b-4.1: login por correo o RUT con error generico, verificacion en dos
 * pasos por correo (obligatoria para el equipo, opcional para pacientes;
 * vencimiento, intentos, reenvio con espera y codigos de respaldo), TOTP
 * apagado (rutas 404) y match con preferencia de pago por tramos.
 */
import { auth, CLAVE, crearApp, ultimoCodigo, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('03b-4.1 correctivo', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let prof: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const login = (cuerpo: Record<string, string>) => t.http().post('/api/auth/login').send(cuerpo);
  const verificar = (desafio: string, codigo: string) => t.http().post('/api/auth/segundo-factor').send({ desafio, codigo });

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    prof = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(() => t.cerrar());

  describe('login por correo o RUT', () => {
    it('paciente y profesional entran por RUT (con o sin puntos); el error es el mismo exista o no la cuenta', async () => {
      const paciente = await t.datos.usuarioPaciente(prof.id);
      const rutPaciente = '9.876.543-3';
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${paciente.pacienteId}`)
            .set(await tk(prof))
            .send({ rut: rutPaciente })
        ).status,
      ).toBe(200);
      const p = await login({ rut: '98765433', password: CLAVE });
      expect(p.status).toBe(200);
      expect(p.body.rol).toBe('PACIENTE');

      const rutProf = '7.654.321-6';
      expect(
        (
          await t
            .http()
            .put('/api/profesionales/yo/datos-privados')
            .set(await tk(prof))
            .send({ rut: rutProf })
        ).status,
      ).toBe(200);
      const r = await login({ rut: '7654321-6', password: CLAVE });
      expect(r.body).toEqual(expect.objectContaining({ requiereSegundoFactor: true, metodo: 'CORREO' }));

      const malaClave = await login({ rut: '7654321-6', password: 'otra-clave' });
      const rutSinCuenta = await login({ rut: '11.222.333-9', password: CLAVE });
      const correoMalo = await login({ email: prof.email, password: 'otra-clave' });
      const correoSinCuenta = await login({ email: 'nadie-03b41@test.cl', password: CLAVE });
      for (const e of [malaClave, rutSinCuenta, correoMalo, correoSinCuenta]) {
        expect(e.status).toBe(401);
        expect(e.body.mensaje).toBe(malaClave.body.mensaje);
      }
      // RUT con digito verificador invalido: 400 (validacion de formato, antes de buscar).
      expect((await login({ rut: '7654321-1', password: CLAVE })).status).toBe(400);
    });
  });

  describe('segundo factor por correo', () => {
    it('obligatorio para ADMIN, GESTION, PROFESIONAL y PRACTICANTE; el paciente entra directo', async () => {
      for (const rol of ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'] as const) {
        const u = await t.datos.usuario(rol);
        const r = await login({ email: u.email, password: CLAVE });
        expect(r.body).toEqual(expect.objectContaining({ requiereSegundoFactor: true, metodo: 'CORREO', enrolamiento: true }));
        expect(r.body.destino).toMatch(/•••@test\.cl$/);
        expect(r.body.accessToken).toBeUndefined();
      }
      const paciente = await t.datos.usuarioPaciente(prof.id);
      expect((await login({ email: paciente.email, password: CLAVE })).body.accessToken).toBeDefined();
    });

    it('primer ingreso: codigo del correo y 10 codigos de respaldo; un respaldo sirve una sola vez', async () => {
      const u = await t.datos.usuario('GESTION');
      const r = await login({ email: u.email, password: CLAVE });
      expect((await verificar(r.body.desafio, '000000')).body.mensaje).toBe('El código no es válido o venció. Puedes pedir uno nuevo.');
      const ok = await verificar(r.body.desafio, ultimoCodigo(t.app, u.email));
      expect(ok.status).toBe(200);
      expect(ok.body.codigosRespaldo).toHaveLength(10);
      expect(ok.body.codigosRespaldo[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
      // El codigo ya usado no sirve otra vez.
      expect((await verificar(r.body.desafio, ultimoCodigo(t.app, u.email))).status).toBe(401);

      const segundo = await login({ email: u.email, password: CLAVE });
      expect(segundo.body.enrolamiento).toBe(false);
      const respaldo = ok.body.codigosRespaldo[3] as string;
      const conRespaldo = await verificar(segundo.body.desafio, respaldo.toLowerCase().replace('-', ''));
      expect(conRespaldo.status).toBe(200);
      expect(conRespaldo.body.codigosRespaldo).toBeUndefined();
      const tercero = await login({ email: u.email, password: CLAVE });
      expect((await verificar(tercero.body.desafio, respaldo)).status).toBe(401);
      expect((await t.http().get('/api/usuarios/yo/segundo-factor').set(auth(conRespaldo.body.accessToken))).body).toEqual({
        activo: true,
        obligatorio: true,
        codigosRespaldoRestantes: 9,
      });
    });

    it('vence a los 10 minutos, maximo 5 intentos y reenvio con espera de 60 segundos', async () => {
      const u = await t.datos.usuario('PROFESIONAL');
      const r = await login({ email: u.email, password: CLAVE });
      const reenviar = () => t.http().post('/api/auth/segundo-factor/codigo').send({ desafio: r.body.desafio });
      const conflicto = await reenviar();
      expect(conflicto.status).toBe(409);
      expect(conflicto.body.mensaje).toBe('Espera 60 segundos antes de pedir otro código.');

      // Vencido: el mismo codigo ya no sirve.
      const vencido = ultimoCodigo(t.app, u.email);
      await t.dueno.codigoVerificacion.updateMany({
        where: { usuarioId: u.id },
        data: { creadoEn: new Date(Date.now() - 11 * 60_000), expiraEn: new Date(Date.now() - 60_000) },
      });
      expect((await verificar(r.body.desafio, vencido)).status).toBe(401);

      // Pasada la espera, el reenvio emite uno nuevo.
      expect((await reenviar()).status).toBe(204);
      const nuevo = ultimoCodigo(t.app, u.email);
      for (let i = 0; i < 5; i++) {
        const malo = String((Number(nuevo) + 1 + i) % 1_000_000).padStart(6, '0');
        expect((await verificar(r.body.desafio, malo)).status).toBe(401);
      }
      // Tras 5 intentos fallidos ni el correcto entra.
      expect((await verificar(r.body.desafio, nuevo)).status).toBe(401);
    });

    it('paciente: lo activa en Seguridad (codigos de respaldo) y desde ahi se le pide; el equipo no lo desactiva', async () => {
      const paciente = await t.datos.usuarioPaciente(prof.id);
      const h = auth((await login({ email: paciente.email, password: CLAVE })).body.accessToken);
      expect((await t.http().get('/api/usuarios/yo/segundo-factor').set(h)).body).toEqual({ activo: false, obligatorio: false, codigosRespaldoRestantes: 0 });
      expect((await t.http().post('/api/usuarios/yo/segundo-factor/codigos-respaldo').set(h)).status).toBe(422);
      const activar = await t.http().put('/api/usuarios/yo/segundo-factor').set(h).send({ activo: true });
      expect(activar.status).toBe(200);
      expect(activar.body.codigos).toHaveLength(10);
      const r = await login({ email: paciente.email, password: CLAVE });
      expect(r.body).toEqual(expect.objectContaining({ requiereSegundoFactor: true, enrolamiento: false }));
      const ok = await verificar(r.body.desafio, ultimoCodigo(t.app, paciente.email));
      expect(ok.status).toBe(200);
      expect(ok.body.codigosRespaldo).toBeUndefined();
      const h2 = auth(ok.body.accessToken);
      expect((await t.http().post('/api/usuarios/yo/segundo-factor/codigos-respaldo').set(h2)).body.codigos).toHaveLength(10);
      expect((await t.http().put('/api/usuarios/yo/segundo-factor').set(h2).send({ activo: false })).status).toBe(200);
      expect((await login({ email: paciente.email, password: CLAVE })).body.accessToken).toBeDefined();

      const equipo = await t
        .http()
        .put('/api/usuarios/yo/segundo-factor')
        .set(await tk(prof))
        .send({ activo: false });
      expect(equipo.status).toBe(422);
    });

    it('TOTP apagado: sus rutas responden 404', async () => {
      const u = await t.datos.usuario('PROFESIONAL');
      const r = await login({ email: u.email, password: CLAVE });
      expect((await t.http().post('/api/auth/totp/enrolamiento').send({ desafio: r.body.desafio })).status).toBe(404);
      expect((await t.http().post('/api/auth/totp').send({ desafio: r.body.desafio, codigo: '123456' })).status).toBe(404);
      expect(
        (
          await t
            .http()
            .post(`/api/usuarios/${u.id}/totp/reinicio`)
            .set(await tk(admin))
        ).status,
      ).toBe(404);
    });
  });

  describe('match con preferencia de pago', () => {
    it('tramos (dentro primero, luego por tope), tarifa visible y "prefiero no decirlo" sin tramos', async () => {
      const tipo = await t.datos.tipoAtencion();
      const crear = async (monto: number) => {
        const u = await t.datos.usuario('PROFESIONAL');
        const perfil = { especialidad: 'Psicologia clinica', modalidad: 'MIXTA', nombrePublico: `Ps. ${monto}`, enfoques: ['Ansiedad'] };
        await t
          .http()
          .put('/api/profesionales/yo/perfil')
          .set(await tk(u))
          .send(perfil);
        await t
          .http()
          .post('/api/profesionales/yo/tarifas')
          .set(await tk(u))
          .send({ monto });
        await t
          .http()
          .put('/api/profesionales/yo/perfil')
          .set(await tk(u))
          .send({ ...perfil, perfilPublico: true });
        await t
          .http()
          .put(`/api/profesionales/${u.id}/tipos-atencion`)
          .set(await tk(admin))
          .send({ tipoAtencionIds: [tipo.id] });
        return u.id;
      };
      const [barato, medio, caro] = [await crear(20000), await crear(40000), await crear(70000)];
      const base = {
        motivos: ['ansiedad'],
        quien: 'adulto',
        intensidad: '4',
        relato: 'Hace meses que duermo mal y me cuesta concentrarme',
        prevision: 'particular',
        modalidad: 'presencial',
      };
      // Pregunta obligatoria: sin respuesta, 400.
      expect((await t.http().post('/api/publico/match').send({ respuestas: base })).status).toBe(400);

      const m = await t
        .http()
        .post('/api/publico/match')
        .send({ respuestas: { ...base, presupuesto: 'hasta_35000' } });
      expect(m.status).toBe(200);
      const todos = [m.body.recomendado, ...m.body.otros] as { perfil: { id: string }; tarifa: number | null; tramo: { indice: number; titulo: string } }[];
      const indices = todos.map((x) => x.tramo.indice);
      expect(indices).toEqual([...indices].sort((a, b) => a - b));
      const de = (id: string) => todos.find((x) => x.perfil.id === id)!;
      expect(de(barato)).toEqual(expect.objectContaining({ tarifa: 20000, tramo: { indice: 0, titulo: 'Dentro de tu preferencia' } }));
      expect(de(medio)).toEqual(expect.objectContaining({ tarifa: 40000, tramo: { indice: 1, titulo: 'Hasta $10.000 más que tu preferencia' } }));
      expect(de(caro)).toEqual(expect.objectContaining({ tarifa: 70000, tramo: { indice: 3, titulo: 'Más de $25.000 sobre tu preferencia' } }));

      const sin = await t
        .http()
        .post('/api/publico/match')
        .send({ respuestas: { ...base, presupuesto: 'no_decir' } });
      expect([sin.body.recomendado, ...sin.body.otros].every((x: { tramo: unknown }) => x.tramo === null)).toBe(true);
    });

    it('ADMIN edita el tope de un rango; un tope no numerico es 422', async () => {
      const preguntas = (
        await t
          .http()
          .get('/api/match/preguntas')
          .set(await tk(admin))
      ).body as {
        clave: string;
        opciones: { id: string; valor: string }[];
      }[];
      const opcion = preguntas.find((q) => q.clave === 'presupuesto')!.opciones.find((o) => o.valor === 'hasta_60000')!;
      const h = await tk(admin);
      expect((await t.http().patch(`/api/match/opciones/${opcion.id}`).set(h).send({ etiqueta: 'Hasta $65.000', objetivo: '65000' })).status).toBe(200);
      expect((await t.http().patch(`/api/match/opciones/${opcion.id}`).set(h).send({ objetivo: 'mucho' })).status).toBe(422);
      expect((await t.http().patch(`/api/match/opciones/${opcion.id}`).set(h).send({ etiqueta: 'Hasta $60.000', objetivo: '60000' })).status).toBe(200);
    });
  });
});
