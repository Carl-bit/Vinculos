/** 02c: Fichas y pacientes. Tests por rol; ADMIN no lee evoluciones; practicante solo sus pacientes; auditoria. */
import { randomInt, randomUUID } from 'node:crypto';

import { dvRut } from '../src/core/validacion/validadores';
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const rutNuevo = () => {
  const cuerpo = String(randomInt(10_000_000, 25_000_000));
  return `${cuerpo.slice(0, -6)}.${cuerpo.slice(-6, -3)}.${cuerpo.slice(-3)}-${dvRut(cuerpo)}`;
};

describe('02c fichas y pacientes', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otroProfesional: UsuarioPrueba;
  let supervisor: UsuarioPrueba;
  let practicante: UsuarioPrueba;
  let usuarioPaciente: UsuarioPrueba & { pacienteId: string; fichaId: string };
  let tipoSesionId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL', { nombre: 'Dra. Autora' });
    otroProfesional = await t.datos.usuario('PROFESIONAL');
    supervisor = await t.datos.usuario('PROFESIONAL');
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
    usuarioPaciente = await t.datos.usuarioPaciente(profesional.id);
    tipoSesionId = (await t.datos.tipoSesionAprobado()).id;
  });

  afterAll(() => t.cerrar());

  describe('pacientes', () => {
    it('PROFESIONAL crea propio (con ficha); RUT cifrado + indice ciego; RUT repetido -> 409; DV invalido -> 400', async () => {
      const rut = rutNuevo();
      const r = await t
        .http()
        .post('/api/pacientes')
        .set(await tk(profesional))
        .send({ nombre: 'Ana', apellido: 'Rut', rut, fechaNacimiento: '1985-02-03', telefono: '+56911110000' });
      expect(r.status).toBe(201);
      expect(r.body.profesionalId).toBe(profesional.id);
      expect(r.body.fichaId).toBeTruthy();
      expect(r.body.rut).toBe(rut.replace(/[.-]/g, ''));
      const fila = await t.dueno.paciente.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(Buffer.from(fila.rut!).toString('latin1')).not.toContain(rut.replace(/[.-]/g, '').slice(0, 6));
      expect(fila.rutHmac?.length).toBe(32);
      const dup = await t
        .http()
        .post('/api/pacientes')
        .set(await tk(profesional))
        .send({ nombre: 'B', apellido: 'C', rut: rut.replace(/\./g, ''), fechaNacimiento: '1985-02-03' });
      expect(dup.status).toBe(409);
      expect(dup.body.restriccion).toBe('pacientes_rut_hmac_key');
      const malo = rut.slice(0, -1) + (rut.endsWith('1') ? '2' : '1');
      expect(
        (
          await t
            .http()
            .post('/api/pacientes')
            .set(await tk(profesional))
            .send({ nombre: 'B', apellido: 'C', rut: malo, fechaNacimiento: '1985-02-03' })
        ).status,
      ).toBe(400);
    });

    it('GESTION crea con tratante (sin ficha); PRACTICANTE/PACIENTE no crean; nadie asigna directo a un practicante', async () => {
      const r = await t
        .http()
        .post('/api/pacientes')
        .set(await tk(gestion))
        .send({ nombre: 'G', apellido: 'Gestion', fechaNacimiento: '2000-01-01', profesionalId: profesional.id });
      expect(r.status).toBe(201);
      expect(r.body.fichaId).toBeNull();
      expect(
        (
          await t
            .http()
            .post('/api/pacientes')
            .set(await tk(gestion))
            .send({ nombre: 'G', apellido: 'X', fechaNacimiento: '2000-01-01' })
        ).status,
      ).toBe(400);
      for (const u of [practicante, usuarioPaciente]) {
        expect(
          (
            await t
              .http()
              .post('/api/pacientes')
              .set(await tk(u))
              .send({ nombre: 'X', apellido: 'Y', fechaNacimiento: '2000-01-01' })
          ).status,
        ).toBe(403);
      }
      const directo = await t
        .http()
        .post('/api/pacientes')
        .set(await tk(admin))
        .send({ nombre: 'X', apellido: 'Y', fechaNacimiento: '2000-01-01', profesionalId: practicante.id });
      expect(directo.status).toBe(403);
    });

    it('busqueda exacta por RUT (cualquier formato) y visibilidad por rol', async () => {
      const rut = rutNuevo();
      const creado = (
        await t
          .http()
          .post('/api/pacientes')
          .set(await tk(profesional))
          .send({ nombre: 'Busca', apellido: 'Me', rut, fechaNacimiento: '1990-01-01' })
      ).body;
      const sinPuntos = rut.replace(/\./g, '');
      for (const u of [gestion, admin, profesional]) {
        const r = await t
          .http()
          .get('/api/pacientes')
          .query({ rut: sinPuntos })
          .set(await tk(u));
        expect(r.status).toBe(200);
        expect(r.body.map((p: { id: string }) => p.id)).toEqual([creado.id]);
      }
      expect(
        (
          await t
            .http()
            .get('/api/pacientes')
            .query({ rut: sinPuntos })
            .set(await tk(otroProfesional))
        ).body,
      ).toEqual([]);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${creado.id}`)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(404);
      const propio = await t
        .http()
        .get('/api/pacientes')
        .set(await tk(usuarioPaciente));
      expect(propio.body.map((p: { id: string }) => p.id)).toEqual([usuarioPaciente.pacienteId]);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${creado.id}`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(404);
    });

    it('PATCH datos administrativos: GESTION y tratante si; otro profesional 404; PACIENTE 403; tratante no se cambia aqui', async () => {
      const id = usuarioPaciente.pacienteId;
      const r = await t
        .http()
        .patch(`/api/pacientes/${id}`)
        .set(await tk(gestion))
        .send({ telefono: '+56933334444' });
      expect(r.status).toBe(200);
      expect(r.body.telefono).toBe('+56933334444');
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${id}`)
            .set(await tk(profesional))
            .send({ nombre: 'Editado' })
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${id}`)
            .set(await tk(otroProfesional))
            .send({ nombre: 'X' })
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${id}`)
            .set(await tk(usuarioPaciente))
            .send({ nombre: 'X' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .patch(`/api/pacientes/${id}`)
            .set(await tk(gestion))
            .send({ profesionalId: otroProfesional.id })
        ).status,
      ).toBe(400);
    });

    it('sin DELETE', async () => {
      expect(
        (
          await t
            .http()
            .delete(`/api/pacientes/${usuarioPaciente.pacienteId}`)
            .set(await tk(admin))
        ).status,
      ).toBe(404);
    });
  });

  describe('adultos responsables', () => {
    it('alta por gestion o tratante; el paciente ve los suyos; RUT cifrado', async () => {
      const menor = await t.datos.paciente(profesional.id, { fechaNacimiento: new Date('2015-06-01') });
      const rut = rutNuevo();
      const r = await t
        .http()
        .post(`/api/pacientes/${menor.id}/adultos-responsables`)
        .set(await tk(profesional))
        .send({ nombre: 'Madre', parentesco: 'madre', rut, telefono: '+56955556666' });
      expect(r.status).toBe(201);
      expect(r.body.rut).toBe(rut.replace(/[.-]/g, ''));
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${menor.id}/adultos-responsables`)
            .set(await tk(otroProfesional))
            .send({ nombre: 'X' })
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${menor.id}/adultos-responsables`)
            .set(await tk(gestion))
            .send({ nombre: 'Padre' })
        ).status,
      ).toBe(201);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${menor.id}/adultos-responsables`)
            .set(await tk(gestion))
        ).body,
      ).toHaveLength(2);
      const propio = await t
        .http()
        .post(`/api/pacientes/${usuarioPaciente.pacienteId}/adultos-responsables`)
        .set(await tk(gestion))
        .send({ nombre: 'Contacto' });
      expect(propio.status).toBe(201);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${usuarioPaciente.pacienteId}/adultos-responsables`)
            .set(await tk(usuarioPaciente))
        ).body,
      ).toHaveLength(1);
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${usuarioPaciente.pacienteId}/adultos-responsables`)
            .set(await tk(usuarioPaciente))
            .send({ nombre: 'X' })
        ).status,
      ).toBe(403);
    });
  });

  describe('ficha y evoluciones', () => {
    it('ficha: ADMIN y tratante leen metadata (auditado); GESTION y PACIENTE 403; otro profesional 404', async () => {
      const id = usuarioPaciente.pacienteId;
      const r = await t
        .http()
        .get(`/api/pacientes/${id}/ficha`)
        .set(await tk(admin));
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(usuarioPaciente.fichaId);
      expect(await t.dueno.accesoFicha.count({ where: { usuarioId: admin.id, fichaId: usuarioPaciente.fichaId, accion: 'LECTURA' } })).toBe(1);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${id}/ficha`)
            .set(await tk(profesional))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${id}/ficha`)
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${id}/ficha`)
            .set(await tk(usuarioPaciente))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${id}/ficha`)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(404);
    });

    it('tratante crea evolucion: copia de autoria cifrada, intervenciones, advertencia; auditada', async () => {
      const intervencion = await t.dueno.intervencion.findFirstOrThrow();
      const r = await t
        .http()
        .post(`/api/fichas/${usuarioPaciente.fichaId}/evoluciones`)
        .set(await tk(profesional))
        .send({ notas: 'Sesion de prueba: avances.', tipoSesionId, nivelRiesgo: 'BAJO', intervencionIds: [intervencion.id] });
      expect(r.status).toBe(201);
      expect(r.body.advertencia).toMatch(/datos identificatorios/);
      expect(r.body.evolucion).toEqual(
        expect.objectContaining({
          notas: 'Sesion de prueba: avances.',
          copiaAutoria: { nombre: 'Dra. Autora', rut: 'sin RUT registrado', registro: 'sin registro' },
          intervenciones: [{ id: intervencion.id, nombre: intervencion.nombre }],
        }),
      );
      const fila = await t.dueno.evolucion.findUniqueOrThrow({ where: { id: r.body.evolucion.id } });
      expect(Buffer.from(fila.notas).toString('latin1')).not.toContain('avances');
      expect(
        await t.dueno.accesoFicha.count({
          where: { usuarioId: profesional.id, fichaId: usuarioPaciente.fichaId, recurso: 'evoluciones', accion: 'ESCRITURA' },
        }),
      ).toBe(1);

      // Correccion = fila nueva con corrige_a_id; la original queda.
      const c = await t
        .http()
        .post(`/api/fichas/${usuarioPaciente.fichaId}/evoluciones`)
        .set(await tk(profesional))
        .send({ notas: 'Correccion', tipoSesionId, nivelRiesgo: 'NINGUNO', corrigeAId: r.body.evolucion.id });
      expect(c.status).toBe(201);
      const lista = await t
        .http()
        .get(`/api/fichas/${usuarioPaciente.fichaId}/evoluciones`)
        .set(await tk(profesional));
      expect(lista.body.map((e: { notas: string }) => e.notas)).toEqual(['Sesion de prueba: avances.', 'Correccion']);
      expect(await t.dueno.accesoFicha.count({ where: { usuarioId: profesional.id, recurso: 'evoluciones', accion: 'LECTURA' } })).toBe(1);
    });

    it('ADMIN, GESTION y PACIENTE no leen ni escriben evoluciones; otro profesional 404', async () => {
      const ruta = `/api/fichas/${usuarioPaciente.fichaId}/evoluciones`;
      for (const u of [admin, gestion, usuarioPaciente]) {
        expect(
          (
            await t
              .http()
              .get(ruta)
              .set(await tk(u))
          ).status,
        ).toBe(403);
        expect(
          (
            await t
              .http()
              .post(ruta)
              .set(await tk(u))
              .send({ notas: 'x', tipoSesionId, nivelRiesgo: 'BAJO' })
          ).status,
        ).toBe(403);
      }
      expect(
        (
          await t
            .http()
            .get(ruta)
            .set(await tk(otroProfesional))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .post(ruta)
            .set(await tk(otroProfesional))
            .send({ notas: 'x', tipoSesionId, nivelRiesgo: 'BAJO' })
        ).status,
      ).toBe(404);
    });

    it('practicante: solo sus pacientes (con consentimiento)', async () => {
      const suyo = await t.datos.pacienteDePracticante(practicante.id, supervisor.id);
      const ok = await t
        .http()
        .post(`/api/fichas/${suyo.fichaId}/evoluciones`)
        .set(await tk(practicante))
        .send({ notas: 'Practicante escribe', tipoSesionId, nivelRiesgo: 'NINGUNO' });
      expect(ok.status).toBe(201);
      expect(ok.body.evolucion.copiaAutoria.registro).toBe('sin registro');
      expect(
        (
          await t
            .http()
            .get(`/api/fichas/${suyo.fichaId}/evoluciones`)
            .set(await tk(practicante))
        ).body,
      ).toHaveLength(1);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${suyo.id}`)
            .set(await tk(practicante))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get(`/api/fichas/${usuarioPaciente.fichaId}/evoluciones`)
            .set(await tk(practicante))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${usuarioPaciente.pacienteId}`)
            .set(await tk(practicante))
        ).status,
      ).toBe(404);
      // El supervisor no lee la ficha directamente (solo seudonimizada, 02e).
      expect(
        (
          await t
            .http()
            .get(`/api/fichas/${suyo.fichaId}/evoluciones`)
            .set(await tk(supervisor))
        ).status,
      ).toBe(404);
    });

    it('tipo de sesion no aprobado -> 422 con la restriccion', async () => {
      const propuesto = await t
        .http()
        .post('/api/tipos-sesion')
        .set(await tk(profesional))
        .send({ nombre: `Propuesto ${randomUUID()}` });
      const r = await t
        .http()
        .post(`/api/fichas/${usuarioPaciente.fichaId}/evoluciones`)
        .set(await tk(profesional))
        .send({ notas: 'x', tipoSesionId: propuesto.body.id, nivelRiesgo: 'BAJO' });
      expect(r.status).toBe(422);
      expect(r.body.restriccion).toBe('evoluciones_tipo_sesion_aprobado');
    });
  });

  describe('tipos de sesion', () => {
    it('proponen PROFESIONAL/PRACTICANTE (siempre PROPUESTO); solo ADMIN revisa', async () => {
      const r = await t
        .http()
        .post('/api/tipos-sesion')
        .set(await tk(practicante))
        .send({ nombre: `Grupal ${randomUUID()}` });
      expect(r.status).toBe(201);
      expect(r.body.estado).toBe('PROPUESTO');
      expect(
        (
          await t
            .http()
            .post('/api/tipos-sesion')
            .set(await tk(profesional))
            .send({ nombre: 'X', estado: 'APROBADO' })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .post('/api/tipos-sesion')
            .set(await tk(gestion))
            .send({ nombre: 'Y' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .patch(`/api/tipos-sesion/${r.body.id}`)
            .set(await tk(profesional))
            .send({ estado: 'APROBADO' })
        ).status,
      ).toBe(403);
      const a = await t
        .http()
        .patch(`/api/tipos-sesion/${r.body.id}`)
        .set(await tk(admin))
        .send({ estado: 'APROBADO' });
      expect(a.status).toBe(200);
      expect(a.body).toEqual(expect.objectContaining({ estado: 'APROBADO', revisadoPorId: admin.id }));
      const cola = await t
        .http()
        .get('/api/tipos-sesion')
        .query({ estado: 'PROPUESTO' })
        .set(await tk(admin));
      expect(cola.body.every((x: { estado: string }) => x.estado === 'PROPUESTO')).toBe(true);
    });
  });

  describe('retencion', () => {
    it('solo ADMIN; PURGAR sobre ficha reciente -> 422; CONSERVAR se registra', async () => {
      expect(
        (
          await t
            .http()
            .get('/api/retencion/fichas')
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      for (const u of [gestion, profesional]) {
        expect(
          (
            await t
              .http()
              .get('/api/retencion/fichas')
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
      const purgar = await t
        .http()
        .post('/api/retencion/revisiones')
        .set(await tk(admin))
        .send({ fichaId: usuarioPaciente.fichaId, decision: 'PURGAR', motivo: 'prueba' });
      expect(purgar.status).toBe(422);
      expect(purgar.body.restriccion).toBe('revisiones_retencion_plazo');
      const conservar = await t
        .http()
        .post('/api/retencion/revisiones')
        .set(await tk(admin))
        .send({ fichaId: usuarioPaciente.fichaId, decision: 'CONSERVAR', motivo: 'tratamiento vigente' });
      expect(conservar.status).toBe(201);
      expect(
        (
          await t
            .http()
            .get('/api/retencion/revisiones')
            .set(await tk(admin))
        ).body.length,
      ).toBeGreaterThan(0);
    });
  });
});
