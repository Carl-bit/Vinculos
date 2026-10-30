/**
 * 03b-4.2 (correctivo de interfaz): recordatorios personales del inicio,
 * registro en la Superintendencia de Salud (RNPI, verificador SIMULADO: la
 * API arranca sin apikey) y metadatos de la agenda (sesiones con evolucion e
 * inasistencia). Por rol, contra la RLS real.
 */
import { randomInt } from 'node:crypto';

import { dvRut } from '../src/core/validacion/validadores';
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const rutNuevo = () => {
  const cuerpo = String(randomInt(5_000_000, 9_999_999));
  return `${cuerpo}-${dvRut(cuerpo)}`;
};

describe('03b-4.2 correctivo de interfaz', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let otro: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    // Sin SUPERSALUD_APIKEY: la API arranca con el verificador SIMULADO.
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL', { nombre: 'Ana Rojas' });
    otro = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(() => t.cerrar());

  describe('recordatorios personales', () => {
    it('el autor crea, marca y borra; texto cifrado; nadie mas (ni ADMIN) los ve; el paciente no entra', async () => {
      const creado = await t
        .http()
        .post('/api/mis-recordatorios')
        .set(await tk(prof))
        .send({ texto: 'Llamar al colegio de turno', venceEl: '2030-01-15' });
      expect(creado.status).toBe(201);
      expect(creado.body).toEqual(expect.objectContaining({ texto: 'Llamar al colegio de turno', venceEl: '2030-01-15', hechoEn: null }));
      const fila = await t.dueno.recordatorioPersonal.findUniqueOrThrow({ where: { id: creado.body.id } });
      expect(Buffer.from(fila.texto).toString('latin1')).not.toContain('colegio');

      for (const u of [admin, gestion, otro]) {
        const r = await t
          .http()
          .get('/api/mis-recordatorios')
          .set(await tk(u));
        expect(r.status).toBe(200);
        expect(r.body.map((x: { id: string }) => x.id)).not.toContain(creado.body.id);
        expect(
          (
            await t
              .http()
              .patch(`/api/mis-recordatorios/${creado.body.id}`)
              .set(await tk(u))
              .send({ hecho: true })
          ).status,
        ).toBe(404);
      }

      const hecho = await t
        .http()
        .patch(`/api/mis-recordatorios/${creado.body.id}`)
        .set(await tk(prof))
        .send({ hecho: true });
      expect(hecho.status).toBe(200);
      expect(hecho.body.hechoEn).not.toBeNull();
      expect(
        (
          await t
            .http()
            .post('/api/mis-recordatorios')
            .set(await tk(prof))
            .send({ texto: 'x'.repeat(301) })
        ).status,
      ).toBe(400);
      expect(
        (
          await t
            .http()
            .delete(`/api/mis-recordatorios/${creado.body.id}`)
            .set(await tk(prof))
        ).status,
      ).toBe(204);

      const paciente = await t.datos.usuarioPaciente(prof.id);
      expect(
        (
          await t
            .http()
            .get('/api/mis-recordatorios')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
    });
  });

  describe('registro en la Superintendencia (RNPI)', () => {
    const perfil = { especialidad: 'Psicología clínica', modalidad: 'MIXTA', nombrePublico: 'Ps. Ana Rojas' };

    it('sin RUT queda PENDIENTE; con RUT el simulado verifica; 9... no existe -> NO_COINCIDE; ADMIN verifica a mano; GESTION solo lee', async () => {
      await t
        .http()
        .put('/api/profesionales/yo/perfil')
        .set(await tk(prof))
        .send(perfil);
      const sinRut = await t
        .http()
        .put('/api/profesionales/yo/registro-sis')
        .set(await tk(prof))
        .send({ numero: '123456' });
      expect(sinRut.status).toBe(200);
      expect(sinRut.body).toEqual(expect.objectContaining({ estado: 'PENDIENTE', numero: '123456', verificacionSimulada: true }));
      expect(sinRut.body.motivo).toMatch(/RUT/);

      await t
        .http()
        .put('/api/profesionales/yo/datos-privados')
        .set(await tk(prof))
        .send({ rut: rutNuevo() });
      const verificado = await t
        .http()
        .post(`/api/profesionales/${prof.id}/registro-sis/verificacion`)
        .set(await tk(admin));
      expect(verificado.status).toBe(201);
      expect(verificado.body).toEqual(
        expect.objectContaining({ estado: 'VERIFICADO_AUTOMATICO', metodo: 'AUTOMATICO', tituloHabilitante: 'Psicología clínica', motivo: null }),
      );

      // Minimizacion: la fila solo guarda numero, titulo, institucion, fecha, estado y metodo.
      const fila = await t.dueno.registroSis.findUniqueOrThrow({ where: { profesionalId: prof.id } });
      expect(Object.keys(fila).sort()).toEqual(
        ['actualizadoEn', 'estado', 'institucion', 'metodo', 'numero', 'profesionalId', 'tituloHabilitante', 'verificadoEn', 'verificadoPorId'].sort(),
      );

      const noExiste = await t
        .http()
        .put('/api/profesionales/yo/registro-sis')
        .set(await tk(prof))
        .send({ numero: '900001' });
      expect(noExiste.body).toEqual(expect.objectContaining({ estado: 'NO_COINCIDE' }));
      expect(noExiste.body.motivo).toMatch(/no existe/);

      for (const [u, esperado] of [
        [gestion, 403],
        [otro, 403],
      ] as const) {
        expect(
          (
            await t
              .http()
              .post(`/api/profesionales/${prof.id}/registro-sis/verificacion-manual`)
              .set(await tk(u))
              .send({ coincide: true, tituloHabilitante: 'Psicólogo', institucion: 'U. de Chile' })
          ).status,
        ).toBe(esperado);
      }
      const manual = await t
        .http()
        .post(`/api/profesionales/${prof.id}/registro-sis/verificacion-manual`)
        .set(await tk(admin))
        .send({ coincide: true, tituloHabilitante: 'Psicólogo', institucion: 'U. de Chile' });
      expect(manual.status).toBe(201);
      expect(manual.body).toEqual(expect.objectContaining({ estado: 'VERIFICADO_MANUAL', metodo: 'MANUAL' }));

      const visto = await t
        .http()
        .get(`/api/profesionales/${prof.id}/registro-sis`)
        .set(await tk(gestion));
      expect(visto.body.estado).toBe('VERIFICADO_MANUAL');
      expect(
        (
          await t
            .http()
            .put('/api/profesionales/yo/registro-sis')
            .set(await tk(admin))
            .send({ numero: '1' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .put('/api/profesionales/yo/registro-sis')
            .set(await tk(prof))
            .send({ numero: '12-3' })
        ).status,
      ).toBe(400);
    });

    it('perfil publico: insignia solo con registro verificado y perfil publicado', async () => {
      await t
        .http()
        .post('/api/profesionales/yo/tarifas')
        .set(await tk(prof))
        .send({ monto: 30000 });
      const publicar = await t
        .http()
        .put('/api/profesionales/yo/perfil')
        .set(await tk(prof))
        .send({ ...perfil, perfilPublico: true });
      expect(publicar.status).toBe(200);
      const publicos = await t.http().get('/api/publico/profesionales');
      const mio = publicos.body.find((p: { id: string }) => p.id === prof.id);
      expect(mio.registro_sis).toEqual(expect.objectContaining({ numero: '900001', estado: 'VERIFICADO_MANUAL' }));

      await t
        .http()
        .put('/api/profesionales/yo/registro-sis')
        .set(await tk(prof))
        .send({ numero: null });
      const despues = await t.http().get('/api/publico/profesionales');
      expect(despues.body.find((p: { id: string }) => p.id === prof.id).registro_sis).toBeNull();
    });
  });

  describe('agenda: sesiones con evolucion (metadato del tratante)', () => {
    it('PROFESIONAL recibe ids; ADMIN y GESTION no (es clinico)', async () => {
      const q = `?desde=${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}&hasta=${encodeURIComponent(new Date().toISOString())}`;
      const r = await t
        .http()
        .get(`/api/citas-con-evolucion${q}`)
        .set(await tk(prof));
      expect(r.status).toBe(200);
      expect(Array.isArray(r.body)).toBe(true);
      for (const u of [admin, gestion]) {
        expect(
          (
            await t
              .http()
              .get(`/api/citas-con-evolucion${q}`)
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
    });
  });
});
