/** 02g: match terapeutico y portal. Por rol, incluido acceso anonimo solo a datos publicos. */
import { randomInt } from 'node:crypto';

import { dvRut } from '../src/core/validacion/validadores';
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;

describe('02g match y portal', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let tratante: UsuarioPrueba;
  let otroProfesional: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string };
  let tipoNombre: string;
  let tipoId: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  const publicar = async (u: UsuarioPrueba, monto: number, opciones: { tipo?: boolean; disponible?: boolean } = {}) => {
    const perfil = { especialidad: 'Psicologia', modalidad: 'MIXTA', nombrePublico: `Ps. ${u.id.slice(0, 6)}` };
    await t.http().put('/api/profesionales/yo/perfil').set(await tk(u)).send(perfil);
    await t.http().post('/api/profesionales/yo/tarifas').set(await tk(u)).send({ monto });
    expect((await t.http().put('/api/profesionales/yo/perfil').set(await tk(u)).send({ ...perfil, perfilPublico: true })).status).toBe(200);
    if (opciones.tipo !== false) {
      await t.http().put(`/api/profesionales/${u.id}/tipos-atencion`).set(await tk(admin)).send({ tipoAtencionIds: [tipoId] });
    }
    if (opciones.disponible !== false) {
      await t.datos.disponibleSiempre(u.id);
    }
  };

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    tratante = await t.datos.usuario('PROFESIONAL');
    otroProfesional = await t.datos.usuario('PROFESIONAL');
    paciente = await t.datos.usuarioPaciente(tratante.id);
    const tipo = await t.datos.tipoAtencion();
    tipoNombre = tipo.nombre;
    tipoId = tipo.id;
  });

  afterAll(() => t.cerrar());

  describe('publico (anonimo)', () => {
    it('perfiles publicos sin autenticacion: solo los consentidos, sin datos privados ni contacto', async () => {
      const publico = await t.datos.usuario('PROFESIONAL');
      await publicar(publico, 30000);
      await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(publico)).send({ numeroCuenta: '99887766' });
      const noPublico = await t.datos.usuario('PROFESIONAL');
      await t.http().put('/api/profesionales/yo/perfil').set(await tk(noPublico)).send({ especialidad: 'X', modalidad: 'ONLINE' });
      const r = await t.http().get('/api/publico/profesionales');
      expect(r.status).toBe(200);
      const ids = r.body.map((p: { id: string }) => p.id);
      expect(ids).toContain(publico.id);
      expect(ids).not.toContain(noPublico.id);
      const json = JSON.stringify(r.body);
      expect(json).not.toContain('99887766');
      expect(json).not.toContain(publico.email);
      // Disponibilidad publica: solo de perfiles publicos.
      const desde = new Date(Date.now() + DIA).toISOString();
      const hasta = new Date(Date.now() + 3 * DIA).toISOString();
      expect((await t.http().get(`/api/publico/profesionales/${publico.id}/disponibilidad`).query({ desde, hasta })).body.length).toBeGreaterThan(0);
      await t.datos.disponibleSiempre(noPublico.id);
      expect((await t.http().get(`/api/publico/profesionales/${noPublico.id}/disponibilidad`).query({ desde, hasta })).body).toEqual([]);
      expect((await t.http().get(`/api/publico/profesionales/${publico.id}/disponibilidad`).query({ desde, hasta: new Date(Date.now() + 90 * DIA).toISOString() })).status).toBe(422);
    });

    it('anonimo no llega a nada privado', async () => {
      for (const ruta of ['/api/pacientes', '/api/citas', '/api/portal/equipo', '/api/mensajes', '/api/usuarios/yo', '/api/tipos-atencion']) {
        expect((await t.http().get(ruta)).status).toBe(401);
      }
    });

    it('match: necesidad filtra; tiempos y luego precio ordenan', async () => {
      const barato = await t.datos.usuario('PROFESIONAL');
      const caro = await t.datos.usuario('PROFESIONAL');
      const sinHorario = await t.datos.usuario('PROFESIONAL');
      const otraNecesidad = await t.datos.usuario('PROFESIONAL');
      await publicar(caro, 60000);
      await publicar(barato, 25000);
      await publicar(sinHorario, 20000, { disponible: false });
      await publicar(otraNecesidad, 10000, { tipo: false });
      const r = await t.http().get('/api/publico/match').query({ tipoAtencion: tipoNombre, tarifaMaxima: 40000, modalidad: 'ONLINE' });
      expect(r.status).toBe(200);
      const orden = r.body.map((x: { perfil: { id: string } }) => x.perfil.id).filter((id: string) => [barato.id, caro.id, sinHorario.id, otraNecesidad.id].includes(id));
      expect(orden).toEqual([barato.id, caro.id, sinHorario.id]);
      const porId = Object.fromEntries(r.body.map((x: { perfil: { id: string } }) => [x.perfil.id, x]));
      expect(porId[caro.id]).toEqual(expect.objectContaining({ cumpleTiempos: true, cumplePrecio: false, tarifa: 60000 }));
      expect(porId[sinHorario.id]).toEqual(expect.objectContaining({ cumpleTiempos: false, cumplePrecio: true }));
      expect((await t.http().get('/api/publico/match').query({ tarifaMaxima: -1 })).status).toBe(400);
    });

    it('rate limit en los endpoints publicos -> 429', async () => {
      const limitada = await crearApp({ PUBLICO_LIMITE_POR_MINUTO: '3' });
      try {
        const estados: number[] = [];
        for (let i = 0; i < 4; i++) {
          estados.push((await limitada.http().get('/api/publico/profesionales')).status);
        }
        expect(estados).toEqual([200, 200, 200, 429]);
      } finally {
        await limitada.cerrar();
      }
    });
  });

  describe('portal del paciente', () => {
    it('equipo y citas propias; otros roles 403', async () => {
      const r = await t.http().get('/api/portal/equipo').set(await tk(paciente));
      expect(r.body.map((x: { id: string }) => x.id)).toEqual([tratante.id]);
      expect((await t.http().get('/api/portal/citas').set(await tk(paciente))).status).toBe(200);
      for (const u of [admin, gestion, tratante]) {
        expect((await t.http().get('/api/portal/equipo').set(await tk(u))).status).toBe(403);
      }
    });

    it('datos de pago: solo con cobro directo y cita confirmada sin pago (descifrados, auditado)', async () => {
      const cuerpo = String(randomInt(10_000_000, 20_000_000));
      await t.http().put('/api/profesionales/yo/datos-privados').set(await tk(tratante)).send({ rut: `${cuerpo}-${dvRut(cuerpo)}`, banco: 'BCI', tipoCuenta: 'CORRIENTE', numeroCuenta: '555666777', titular: 'Tratante' });
      await t.datos.disponibleSiempre(tratante.id);
      const inicio = new Date(Date.now() + 4 * DIA);
      inicio.setUTCHours(15, 0, 0, 0);
      const cita = await t.http().post('/api/citas').set(await tk(gestion)).send({ pacienteId: paciente.pacienteId, profesionalId: tratante.id, modalidad: 'ONLINE', inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 3_600_000).toISOString() });
      expect(cita.status).toBe(201);
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'DIRECTO' } });
      try {
        const r = await t.http().get(`/api/portal/citas/${cita.body.id}/datos-pago`).set(await tk(paciente));
        expect(r.body).toEqual(expect.objectContaining({ aplica: true, banco: 'BCI', numeroCuenta: '555666777' }));
        expect(await t.dueno.accesoFicha.count({ where: { usuarioId: paciente.id, accion: 'DATOS_PAGO' } })).toBe(1);
      } finally {
        await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'CENTRO' } });
      }
      expect((await t.http().get(`/api/portal/citas/${cita.body.id}/datos-pago`).set(await tk(paciente))).body).toEqual({ aplica: false });
    });

    it('mensajes: solo a su equipo; el profesional los lee y marca; ADMIN/GESTION nunca', async () => {
      const r = await t.http().post('/api/portal/mensajes').set(await tk(paciente)).send({ profesionalId: tratante.id, contenido: 'Necesito reagendar por un control medico' });
      expect(r.status).toBe(201);
      const fila = await t.dueno.mensajePaciente.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(Buffer.from(fila.contenido).toString('latin1')).not.toContain('reagendar');
      expect(await t.dueno.notificacion.count({ where: { tipo: 'MENSAJE_PACIENTE', usuarioId: tratante.id, referenciaId: r.body.id } })).toBe(1);
      expect((await t.http().post('/api/portal/mensajes').set(await tk(paciente)).send({ profesionalId: otroProfesional.id, contenido: 'hola' })).status).toBe(403);
      const recibidos = await t.http().get('/api/mensajes').set(await tk(tratante));
      expect(recibidos.body.map((m: { contenido: string }) => m.contenido)).toEqual(['Necesito reagendar por un control medico']);
      expect((await t.http().get('/api/mensajes').set(await tk(otroProfesional))).body).toEqual([]);
      for (const u of [admin, gestion]) {
        expect((await t.http().get('/api/mensajes').set(await tk(u))).status).toBe(403);
      }
      expect((await t.http().post(`/api/mensajes/${r.body.id}/leido`).set(await tk(otroProfesional))).status).toBe(404);
      expect((await t.http().post(`/api/mensajes/${r.body.id}/leido`).set(await tk(tratante))).status).toBe(200);
      expect((await t.http().post(`/api/mensajes/${r.body.id}/leido`).set(await tk(tratante))).status).toBe(409);
      // Sin respuesta in-app: el profesional no puede escribir mensajes.
      expect((await t.http().post('/api/portal/mensajes').set(await tk(tratante)).send({ profesionalId: tratante.id, contenido: 'x' })).status).toBe(403);
    });

    it('epicrisis: el paciente solicita; el tratante resuelve; ENTREGADA exige documento', async () => {
      const s = await t.http().post('/api/portal/epicrisis').set(await tk(paciente)).send({ motivo: 'Para continuidad en otra institucion' });
      expect(s.status).toBe(201);
      expect(s.body.estado).toBe('SOLICITADA');
      expect((await t.http().get('/api/epicrisis').set(await tk(gestion))).body.map((x: { id: string }) => x.id)).toContain(s.body.id);
      expect((await t.http().get('/api/epicrisis').set(await tk(otroProfesional))).body).toEqual([]);
      expect((await t.http().post(`/api/epicrisis/${s.body.id}/resolucion`).set(await tk(otroProfesional)).send({ estado: 'EN_PROCESO' })).status).toBe(403);
      expect((await t.http().post(`/api/epicrisis/${s.body.id}/resolucion`).set(await tk(tratante)).send({ estado: 'EN_PROCESO' })).body.estado).toBe('EN_PROCESO');
      expect((await t.http().post(`/api/epicrisis/${s.body.id}/resolucion`).set(await tk(tratante)).send({ estado: 'ENTREGADA' })).status).toBe(400);
      const e = await t.http().post(`/api/epicrisis/${s.body.id}/resolucion`).set(await tk(tratante)).send({ estado: 'ENTREGADA', documentoRef: 'epicrisis-2026-10.pdf' });
      expect(e.body).toEqual(expect.objectContaining({ estado: 'ENTREGADA', resueltaPorId: tratante.id }));
      expect((await t.http().post(`/api/epicrisis/${s.body.id}/resolucion`).set(await tk(tratante)).send({ estado: 'RECHAZADA' })).status).toBe(409);
      expect((await t.http().post('/api/portal/epicrisis').set(await tk(gestion)).send({})).status).toBe(403);
    });
  });
});
