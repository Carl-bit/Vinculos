/**
 * 2026-11-08: Equipo del centro, version 1 (docs/front/equipo_validacion.md).
 * Sitio publico solo con validados, observacion de titulos, documentos del
 * practicante y correcciones del perfil (ADMIN a la segunda solicitud). Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const PDF = Buffer.from('%PDF-1.4 documento de prueba');
const perfil = { especialidad: 'Psicologia clinica', modalidad: 'MIXTA', nombrePublico: 'Ps. Validacion', bio: 'Escribeme al +56 9 1234 5678' };

describe('equipo v1: validacion, observaciones, documentos del practicante y correcciones', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otroProfesional: UsuarioPrueba;
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
    practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: profesional.id });
    usuarioPaciente = await t.datos.usuarioPaciente(profesional.id);
    await t
      .http()
      .post('/api/profesionales/yo/tarifas')
      .set(await tk(profesional))
      .send({ monto: 30000 });
    const r = await t
      .http()
      .put('/api/profesionales/yo/perfil')
      .set(await tk(profesional))
      .send({ ...perfil, perfilPublico: true });
    expect(r.status).toBe(200);
  });

  afterAll(() => t.cerrar());

  const publicos = async () => ((await t.http().get('/api/publico/profesionales')).body as { id: string }[]).map((p) => p.id);

  it('publicado pero sin validar no sale en el sitio; con registro SIS y titulo verificados, si', async () => {
    expect(await publicos()).not.toContain(profesional.id);
    // Titulo con respaldo verificado por ADMIN, registro SIS verificado a mano.
    const titulo = await t
      .http()
      .post('/api/trayectoria')
      .set(await tk(profesional))
      .send({ tipo: 'TITULO', titulo: 'Psicologo', institucion: 'U. de Prueba', anio: 2015 });
    await t
      .http()
      .post(`/api/trayectoria/${titulo.body.id}/respaldos`)
      .set(await tk(profesional))
      .attach('archivo', PDF, { filename: 'titulo.pdf', contentType: 'application/pdf' });
    expect(
      (
        await t
          .http()
          .post(`/api/trayectoria/${titulo.body.id}/verificacion`)
          .set(await tk(admin))
          .send({ verificado: true })
      ).status,
    ).toBe(201);
    expect(await publicos()).not.toContain(profesional.id); // falta el registro SIS
    await t
      .http()
      .put('/api/profesionales/yo/registro-sis')
      .set(await tk(profesional))
      .send({ numero: '445566' });
    const manual = await t
      .http()
      .post(`/api/profesionales/${profesional.id}/registro-sis/verificacion-manual`)
      .set(await tk(admin))
      .send({ coincide: true, tituloHabilitante: 'Psicologo', institucion: 'U. de Prueba' });
    expect(manual.status).toBe(201);
    expect(await publicos()).toContain(profesional.id);
  });

  it('observar un titulo: solo ADMIN; vuelve a revision; un respaldo nuevo limpia la observacion', async () => {
    const titulo = await t
      .http()
      .post('/api/trayectoria')
      .set(await tk(profesional))
      .send({ tipo: 'DIPLOMADO', titulo: 'Diplomado', institucion: 'U. de Prueba', anio: 2020 });
    const id = titulo.body.id as string;
    await t
      .http()
      .post(`/api/trayectoria/${id}/respaldos`)
      .set(await tk(profesional))
      .attach('archivo', PDF, { filename: 'diplomado.pdf', contentType: 'application/pdf' });
    for (const u of [gestion, profesional]) {
      expect(
        (
          await t
            .http()
            .post(`/api/trayectoria/${id}/observacion`)
            .set(await tk(u))
            .send({ observacion: 'Ilegible' })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await t
          .http()
          .post(`/api/trayectoria/${id}/observacion`)
          .set(await tk(admin))
          .send({ observacion: 'x' })
      ).status,
    ).toBe(400);
    const obs = await t
      .http()
      .post(`/api/trayectoria/${id}/observacion`)
      .set(await tk(admin))
      .send({ observacion: 'El respaldo esta ilegible' });
    expect(obs.status).toBe(201);
    expect(obs.body).toEqual(expect.objectContaining({ verificado: false, observacion: 'El respaldo esta ilegible', observadaPorId: admin.id }));
    const nuevo = await t
      .http()
      .post(`/api/trayectoria/${id}/respaldos`)
      .set(await tk(profesional))
      .attach('archivo', PDF, { filename: 'diplomado-v2.pdf', contentType: 'application/pdf' });
    expect(nuevo.body.observacion).toBeNull();
    expect(nuevo.body.respaldos).toHaveLength(2);
  });

  it('documentos del practicante: suben el propio y ADMIN; leen el propio, ADMIN y GESTION; descarga auditada; cifrados', async () => {
    const subir = async (u: UsuarioPrueba, tipo: string, extra = '') =>
      t
        .http()
        .post(`/api/practicantes/${practicante.id}/documentos?tipo=${tipo}${extra}`)
        .set(await tk(u))
        .attach('archivo', PDF, { filename: `${tipo}.pdf`, contentType: 'application/pdf' });
    const cert = await subir(practicante, 'CERTIFICADO_ALUMNO_REGULAR', '&vigenteHasta=2027-03-31');
    expect(cert.status).toBe(201);
    expect(cert.body).toEqual(expect.objectContaining({ tipo: 'CERTIFICADO_ALUMNO_REGULAR', subidoPorId: practicante.id }));
    expect((await subir(admin, 'CONVENIO_PRACTICA')).status).toBe(201);
    expect((await subir(gestion, 'CONVENIO_PRACTICA')).status).toBe(403);
    expect((await subir(profesional, 'CONVENIO_PRACTICA')).status).toBe(403);
    expect((await subir(admin, 'OTRO')).status).toBe(400);
    const exe = await t
      .http()
      .post(`/api/practicantes/${practicante.id}/documentos?tipo=CONVENIO_PRACTICA`)
      .set(await tk(admin))
      .attach('archivo', Buffer.from('MZ ejecutable'), { filename: 'x.exe' });
    expect(exe.status).toBe(422);
    for (const [u, n] of [
      [practicante, 2],
      [admin, 2],
      [gestion, 2],
    ] as const) {
      const l = await t
        .http()
        .get(`/api/practicantes/${practicante.id}/documentos`)
        .set(await tk(u));
      expect(l.body).toHaveLength(n);
      expect(l.body[0].contenido).toBeUndefined();
    }
    expect(
      (
        await t
          .http()
          .get(`/api/practicantes/${practicante.id}/documentos`)
          .set(await tk(profesional))
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .get(`/api/practicantes/${practicante.id}/documentos`)
          .set(await tk(usuarioPaciente))
      ).status,
    ).toBe(403);
    const fila = await t.dueno.practicanteDocumento.findUniqueOrThrow({ where: { id: cert.body.id } });
    expect(Buffer.from(fila.contenido).toString('latin1')).not.toContain('PDF');
    const descarga = await t
      .http()
      .get(`/api/practicantes/documentos/${cert.body.id}`)
      .set(await tk(admin));
    expect(descarga.status).toBe(200);
    expect(Buffer.from(descarga.body).toString()).toContain('%PDF');
    expect(await t.dueno.registroExportacion.count({ where: { recurso: 'practicante_documentos', referenciaId: cert.body.id } })).toBe(1);
  });

  it('correcciones: ADMIN pide; edita el campo solo a la segunda solicitud sin cambios; el profesional ve las suyas', async () => {
    const pedir = async (campos: string[], motivo = 'Tiene un telefono personal') =>
      t
        .http()
        .post(`/api/profesionales/${profesional.id}/correcciones`)
        .set(await tk(admin))
        .send({ campos, motivo });
    const corregir = async (valor: string) =>
      t
        .http()
        .post(`/api/profesionales/${profesional.id}/correcciones/aplicacion`)
        .set(await tk(admin))
        .send({ campo: 'bio', valor, motivo: 'Quitamos el telefono personal' });
    expect(
      (
        await t
          .http()
          .post(`/api/profesionales/${profesional.id}/correcciones`)
          .set(await tk(gestion))
          .send({ campos: ['bio'], motivo: 'x de gestion' })
      ).status,
    ).toBe(403);
    expect((await pedir(['telefono'])).status).toBe(400);
    expect((await pedir(['bio'])).body).toEqual([{ campo: 'bio', solicitudes: 1 }]);
    const temprano = await corregir('Texto sin telefono');
    expect(temprano.status).toBe(422);
    expect(temprano.body.restriccion).toBe('correccion_requiere_segunda_solicitud');
    expect((await pedir(['bio'])).body).toEqual([{ campo: 'bio', solicitudes: 2 }]);
    const corregido = await corregir('Texto sin telefono');
    expect(corregido.status).toBe(201);
    expect(corregido.body.bio).toBe('Texto sin telefono');
    // Editar directo el texto publico ajeno ya no se puede.
    expect(
      (
        await t
          .http()
          .patch(`/api/profesionales/${profesional.id}/perfil`)
          .set(await tk(admin))
          .send({ bio: 'Directo' })
      ).status,
    ).toBe(403);
    const propias = await t
      .http()
      .get(`/api/profesionales/${profesional.id}/correcciones`)
      .set(await tk(profesional));
    expect(propias.body.map((c: { accion: string }) => c.accion)).toEqual(['APLICADA', 'PEDIDA', 'PEDIDA']);
    expect(propias.body[0].huella).toBeUndefined();
    expect(
      (
        await t
          .http()
          .get(`/api/profesionales/${profesional.id}/correcciones`)
          .set(await tk(otroProfesional))
      ).body,
    ).toEqual([]);
  });
});
