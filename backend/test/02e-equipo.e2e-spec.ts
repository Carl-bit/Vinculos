/** 02e: Equipo y practicantes. Por rol; el supervisor nunca recibe identificadores; datos privados solo propio y ADMIN/GESTION. */
import { randomInt } from 'node:crypto';

import { recalcularRutHmac } from '../src/common/crypto/recalculo-hmac';
import { dvRut } from '../src/core/validacion/validadores';
import { auth, crearApp, llaveroPrueba, type AppPrueba, type UsuarioPrueba } from './apoyo';

const rutNuevo = () => {
  const cuerpo = String(randomInt(5_000_000, 9_999_999));
  return `${cuerpo}-${dvRut(cuerpo)}`;
};

describe('02e equipo y practicantes', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otroProfesional: UsuarioPrueba;
  let supervisor: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let usuarioPaciente: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    otroProfesional = await t.datos.usuario('PROFESIONAL');
    supervisor = await t.datos.usuario('PROFESIONAL');
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
    usuarioPaciente = await t.datos.usuarioPaciente(profesional.id);
  });

  afterAll(() => t.cerrar());

  describe('perfil y tarifas', () => {
    it('el propio crea su perfil; publicar exige tarifa general (422) y solo lo hace el propio', async () => {
      const perfil = { especialidad: 'Psicologia clinica', modalidad: 'MIXTA', nombrePublico: 'Ps. Prueba', enfoques: ['TCC'] };
      expect((await t.http().put('/api/profesionales/yo/perfil').set(await tk(profesional)).send(perfil)).status).toBe(200);
      const sinTarifa = await t.http().put('/api/profesionales/yo/perfil').set(await tk(profesional)).send({ ...perfil, perfilPublico: true });
      expect(sinTarifa.status).toBe(422);
      expect(sinTarifa.body.restriccion).toBe('profesionales_publicar_requiere_tarifa');
      expect((await t.http().post('/api/profesionales/yo/tarifas').set(await tk(profesional)).send({ monto: 35000 })).status).toBe(201);
      expect((await t.http().post('/api/profesionales/yo/tarifas').set(await tk(admin)).send({ monto: 1 })).status).toBe(403);
      const publicado = await t.http().put('/api/profesionales/yo/perfil').set(await tk(profesional)).send({ ...perfil, perfilPublico: true });
      expect(publicado.status).toBe(200);
      expect(publicado.body.perfilPublicoConsentidoEn).toBeTruthy();
      // Otro (GESTION) no publica el perfil de nadie.
      await t.http().put('/api/profesionales/yo/perfil').set(await tk(otroProfesional)).send(perfil);
      expect((await t.http().patch(`/api/profesionales/${otroProfesional.id}/perfil`).set(await tk(gestion)).send({ perfilPublico: true })).status).toBe(403);
      expect((await t.http().patch(`/api/profesionales/${otroProfesional.id}/perfil`).set(await tk(gestion)).send({ bio: 'Corregida' })).status).toBe(200);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/perfil`).set(await tk(otroProfesional))).status).toBe(404);
      expect((await t.http().put('/api/profesionales/yo/perfil').set(await tk(practicante)).send(perfil)).status).toBe(403);
      // Tarifas: historial visible para el propio y ADMIN/GESTION.
      expect((await t.http().get(`/api/profesionales/${profesional.id}/tarifas`).set(await tk(gestion))).body).toHaveLength(1);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/tarifas`).set(await tk(otroProfesional))).body).toEqual([]);
    });

    it('margen de traslado: el propio y ADMIN/GESTION; otro profesional 404', async () => {
      expect((await t.http().patch(`/api/profesionales/${profesional.id}/margen`).set(await tk(profesional)).send({ margenTrasladoMin: 45 })).body.margenTrasladoMin).toBe(45);
      expect((await t.http().patch(`/api/profesionales/${profesional.id}/margen`).set(await tk(admin)).send({ margenTrasladoMin: null })).body.margenTrasladoMin).toBeNull();
      expect((await t.http().patch(`/api/profesionales/${profesional.id}/margen`).set(await tk(otroProfesional)).send({ margenTrasladoMin: 10 })).status).toBe(404);
      expect((await t.http().patch(`/api/profesionales/${profesional.id}/margen`).set(await tk(admin)).send({ margenTrasladoMin: 601 })).status).toBe(400);
    });
  });

  describe('trayectoria', () => {
    it('el propio carga; solo ADMIN verifica; editar des-verifica', async () => {
      const r = await t.http().post('/api/trayectoria').set(await tk(profesional)).send({ tipo: 'TITULO', titulo: 'Psicologo', institucion: 'U. de Prueba', anio: 2015, registroSuperintendencia: '123456' });
      expect(r.status).toBe(201);
      expect(r.body.verificado).toBe(false);
      expect((await t.http().post(`/api/trayectoria/${r.body.id}/verificacion`).set(await tk(gestion)).send({ verificado: true })).status).toBe(403);
      const v = await t.http().post(`/api/trayectoria/${r.body.id}/verificacion`).set(await tk(admin)).send({ verificado: true });
      expect(v.body).toEqual(expect.objectContaining({ verificado: true, verificadoPorId: admin.id }));
      const e = await t.http().put(`/api/trayectoria/${r.body.id}`).set(await tk(profesional)).send({ tipo: 'TITULO', titulo: 'Psicologo clinico', institucion: 'U. de Prueba', anio: 2015 });
      expect(e.body.verificado).toBe(false);
      expect((await t.http().put(`/api/trayectoria/${r.body.id}`).set(await tk(otroProfesional)).send({ tipo: 'TITULO', titulo: 'Otro titulo', institucion: 'Otra U', anio: 2015 })).status).toBe(404);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/trayectoria`).set(await tk(gestion))).body).toHaveLength(1);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/trayectoria`).set(await tk(otroProfesional))).body).toEqual([]);
    });
  });

  describe('datos privados', () => {
    it('cifrados; solo el propio escribe; leen el propio y ADMIN/GESTION; RUT unico', async () => {
      const rut = rutNuevo();
      const datos = { rut, banco: 'BancoEstado', tipoCuenta: 'CUENTA_RUT', numeroCuenta: '12345678', titular: 'Prof Prueba' };
      const r = await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(profesional)).send(datos);
      expect(r.status).toBe(200);
      expect(r.body).toEqual(expect.objectContaining({ banco: 'BancoEstado', numeroCuenta: '12345678', rut: rut.replace('-', '') }));
      const fila = await t.dueno.profesionalDatosPrivados.findUniqueOrThrow({ where: { usuarioId: profesional.id } });
      expect(Buffer.from(fila.numeroCuenta!).toString('latin1')).not.toContain('12345678');
      for (const u of [admin, gestion, profesional]) {
        expect((await t.http().get(`/api/profesionales/${profesional.id}/datos-privados`).set(await tk(u))).body.numeroCuenta).toBe('12345678');
      }
      expect((await t.http().get(`/api/profesionales/${profesional.id}/datos-privados`).set(await tk(otroProfesional))).status).toBe(404);
      expect((await t.http().get(`/api/profesionales/${profesional.id}/datos-privados`).set(await tk(usuarioPaciente))).status).toBe(403);
      expect((await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(otroProfesional)).send({ banco: 'Banco Inventado' })).status).toBe(400);
      const dup = await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(otroProfesional)).send({ rut });
      expect(dup.status).toBe(409);
      expect(dup.body.restriccion).toBe('profesional_datos_privados_rut_hmac_key');
      // El practicante tambien guarda los suyos (copia de autoria de sus evoluciones).
      expect((await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(practicante)).send({ rut: rutNuevo() })).status).toBe(200);
    });
  });

  describe('tipos de atencion', () => {
    it('todos leen; ADMIN crea, desactiva y asigna', async () => {
      const r = await t.http().post('/api/tipos-atencion').set(await tk(admin)).send({ nombre: `Pareja ${Date.now()}` });
      expect(r.status).toBe(201);
      expect((await t.http().post('/api/tipos-atencion').set(await tk(profesional)).send({ nombre: 'X' })).status).toBe(403);
      const a = await t.http().put(`/api/profesionales/${profesional.id}/tipos-atencion`).set(await tk(admin)).send({ tipoAtencionIds: [r.body.id] });
      expect(a.body).toHaveLength(1);
      expect((await t.http().put(`/api/profesionales/${profesional.id}/tipos-atencion`).set(await tk(profesional)).send({ tipoAtencionIds: [] })).status).toBe(403);
      expect((await t.http().patch(`/api/tipos-atencion/${r.body.id}`).set(await tk(admin)).send({ activo: false })).body.activo).toBe(false);
      expect((await t.http().get('/api/tipos-atencion').set(await tk(usuarioPaciente))).status).toBe(200);
    });
  });

  describe('recalculo de rut_hmac (job manual, runbook de compromiso)', () => {
    it('recalcula con la HMAC activa: corrige un indice alterado; idempotente; busqueda vuelve a funcionar', async () => {
      const rut = rutNuevo();
      const p = (await t.http().post('/api/pacientes').set(await tk(profesional)).send({ nombre: 'Hmac', apellido: 'Prueba', rut, fechaNacimiento: '1980-01-01' })).body;
      await t.dueno.paciente.update({ where: { id: p.id }, data: { rutHmac: new Uint8Array(32).fill(7) } });
      expect((await t.http().get('/api/pacientes').query({ rut }).set(await tk(gestion))).body).toEqual([]);
      const llavero = await llaveroPrueba(t.dueno);
      const r1 = await recalcularRutHmac(t.dueno, llavero, 2);
      expect(r1.every((r) => r.duplicados.length === 0 && r.actualizadas === r.conRut)).toBe(true);
      expect(r1.find((r) => r.tabla === 'pacientes')!.conRut).toBe(await t.dueno.paciente.count({ where: { rut: { not: null } } }));
      expect((await t.http().get('/api/pacientes').query({ rut }).set(await tk(gestion))).body.map((x: { id: string }) => x.id)).toEqual([p.id]);
      const r2 = await recalcularRutHmac(t.dueno, llavero);
      expect(r2.map((r) => r.actualizadas)).toEqual(r1.map((r) => r.actualizadas));
    });
  });

  describe('supervision', () => {
    it('cambiar supervisor: solo ADMIN, sin hueco, avisos por paciente con consentimiento; mismo supervisor 409', async () => {
      const sup1 = await t.datos.usuario('PROFESIONAL');
      const sup2 = await t.datos.usuario('PROFESIONAL');
      const p = await t.datos.usuario('PRACTICANTE', { supervisorId: sup1.id });
      await t.datos.pacienteDePracticante(p.id, sup1.id);
      expect((await t.http().post(`/api/practicantes/${p.id}/supervisor`).set(await tk(gestion)).send({ supervisorId: sup2.id })).status).toBe(403);
      const r = await t.http().post(`/api/practicantes/${p.id}/supervisor`).set(await tk(admin)).send({ supervisorId: sup2.id });
      expect(r.status).toBe(201);
      expect(r.body.avisosCreados).toBe(1);
      expect(await t.dueno.supervision.count({ where: { practicanteId: p.id, hasta: null } })).toBe(1);
      expect((await t.http().post(`/api/practicantes/${p.id}/supervisor`).set(await tk(admin)).send({ supervisorId: sup2.id })).status).toBe(409);
      // Supervisor que no es PROFESIONAL activo -> 422.
      expect((await t.http().post(`/api/practicantes/${p.id}/supervisor`).set(await tk(admin)).send({ supervisorId: gestion.id })).status).toBe(422);
    });

    it('casos y evoluciones seudonimizados: sin identificadores del paciente; comentarios append-only', async () => {
      const caso = await t.datos.pacienteDePracticante(practicante.id, supervisor.id);
      const pacienteFila = await t.dueno.paciente.findUniqueOrThrow({ where: { id: caso.id } });
      const tipo = await t.datos.tipoSesionAprobado();
      const evo = await t.http().post(`/api/fichas/${caso.fichaId}/evoluciones`).set(await tk(practicante)).send({ notas: 'Notas para supervision', tipoSesionId: tipo.id, nivelRiesgo: 'MEDIO' });
      expect(evo.status).toBe(201);

      const casos = await t.http().get('/api/supervision/casos').set(await tk(supervisor));
      expect(casos.status).toBe(200);
      const miCaso = casos.body.find((c: { codigo: string }) => c.codigo === pacienteFila.codigoSeudonimo);
      expect(Object.keys(miCaso).sort()).toEqual(['codigo', 'edad_paciente', 'practicante_id', 'tipo_atencion']);
      const evs = await t.http().get(`/api/supervision/casos/${pacienteFila.codigoSeudonimo}/evoluciones`).set(await tk(supervisor));
      expect(evs.body).toHaveLength(1);
      expect(evs.body[0].notas).toBe('Notas para supervision');
      const json = JSON.stringify([casos.body, evs.body]);
      for (const identificador of [caso.id, caso.fichaId, pacienteFila.nombre + ' ' + pacienteFila.apellido, pacienteFila.apellido]) {
        expect(json).not.toContain(identificador);
      }
      // Otro profesional (no supervisor): sin casos y 0 evoluciones (no revela existencia).
      expect((await t.http().get('/api/supervision/casos').set(await tk(otroProfesional))).body).toEqual([]);
      expect((await t.http().get(`/api/supervision/casos/${pacienteFila.codigoSeudonimo}/evoluciones`).set(await tk(otroProfesional))).body).toEqual([]);
      expect((await t.http().get('/api/supervision/casos').set(await tk(admin))).status).toBe(403);

      const evolucionId = evs.body[0].evolucionId as string;
      const c = await t.http().post(`/api/supervision/evoluciones/${evolucionId}/comentarios`).set(await tk(supervisor)).send({ texto: 'Explorar la alianza terapeutica' });
      expect(c.status).toBe(201);
      expect((await t.http().post(`/api/supervision/evoluciones/${evolucionId}/comentarios`).set(await tk(otroProfesional)).send({ texto: 'x' })).status).toBe(403);
      // Lo leen el tratante actual (el practicante) y el supervisor; otro profesional 404.
      const delPracticante = await t.http().get(`/api/evoluciones/${evolucionId}/comentarios`).set(await tk(practicante));
      expect(delPracticante.body.map((x: { texto: string }) => x.texto)).toEqual(['Explorar la alianza terapeutica']);
      expect((await t.http().get(`/api/evoluciones/${evolucionId}/comentarios`).set(await tk(supervisor))).body).toHaveLength(1);
      expect((await t.http().get(`/api/evoluciones/${evolucionId}/comentarios`).set(await tk(otroProfesional))).status).toBe(404);
      const fila = await t.dueno.supervisionComentario.findUniqueOrThrow({ where: { id: c.body.id } });
      expect(Buffer.from(fila.texto).toString('latin1')).not.toContain('alianza');
      // Auditoria de la lectura supervisada (la hace la funcion).
      expect(await t.dueno.accesoFicha.count({ where: { usuarioId: supervisor.id, accion: 'SUPERVISION' } })).toBeGreaterThan(0);
    });
  });
});
