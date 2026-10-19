/** 02h parte A: tipos de atencion, documentos por correo, avisos de derivacion e integraciones. Por rol. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { JobsService } from '../src/core/jobs/jobs.service';
import { auth, binario, crearApp, procesarMensajes, textoPdf, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;

/** Hora fija de un dia futuro (UTC), distinta por llamada para no chocar entre citas. */
let desfase = 0;
const horario = (dias: number) => {
  const inicio = new Date(Date.now() + dias * DIA);
  inicio.setUTCHours(12 + (desfase++ % 8), 0, 0, 0);
  return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + 3_600_000).toISOString() };
};

describe('02h ajustes (A1, A2, A3, A6)', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let otroProf: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string };
  let otroPaciente: UsuarioPrueba & { pacienteId: string };
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const enviar = () => procesarMensajes(t);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
    otroProf = await t.datos.usuario('PROFESIONAL');
    paciente = await t.datos.usuarioPaciente(prof.id);
    otroPaciente = await t.datos.usuarioPaciente(otroProf.id);
  });

  afterAll(() => t.cerrar());

  describe('A1 tipos de atencion por profesional', () => {
    it('el profesional propone, solo ADMIN aprueba o rechaza; solo los aprobados cuentan en match, perfiles y directorio', async () => {
      const tipo = await t.datos.tipoAtencion();
      const rechazado = await t.datos.tipoAtencion();
      const p = await t.datos.usuario('PROFESIONAL');
      const perfil = { especialidad: 'Psicologia', modalidad: 'MIXTA', nombrePublico: `Ps. ${p.id.slice(0, 6)}` };
      await t
        .http()
        .put('/api/profesionales/yo/perfil')
        .set(await tk(p))
        .send(perfil);
      await t
        .http()
        .post('/api/profesionales/yo/tarifas')
        .set(await tk(p))
        .send({ monto: 30000 });
      expect(
        (
          await t
            .http()
            .put('/api/profesionales/yo/perfil')
            .set(await tk(p))
            .send({ ...perfil, perfilPublico: true })
        ).status,
      ).toBe(200);
      await t.datos.disponibleSiempre(p.id);

      const propuesta = await t
        .http()
        .post('/api/profesionales/yo/tipos-atencion')
        .set(await tk(p))
        .send({ tipoAtencionId: tipo.id });
      expect(propuesta.status).toBe(201);
      expect(propuesta.body).toEqual([expect.objectContaining({ tipoAtencionId: tipo.id, estado: 'PROPUESTO', revisadoPorId: null })]);
      expect(
        (
          await t
            .http()
            .post('/api/profesionales/yo/tipos-atencion')
            .set(await tk(p))
            .send({ tipoAtencionId: tipo.id })
        ).status,
      ).toBe(409);
      await t
        .http()
        .post('/api/profesionales/yo/tipos-atencion')
        .set(await tk(p))
        .send({ tipoAtencionId: rechazado.id });
      for (const u of [gestion, admin, paciente]) {
        expect(
          (
            await t
              .http()
              .post('/api/profesionales/yo/tipos-atencion')
              .set(await tk(u))
              .send({ tipoAtencionId: tipo.id })
          ).status,
        ).toBe(403);
      }

      const cuenta = async () => {
        const publico = (await t.http().get('/api/publico/profesionales')).body.find((x: { id: string }) => x.id === p.id);
        const match = (await t.http().get('/api/publico/match').query({ tipoAtencion: tipo.nombre })).body.map((x: { perfil: { id: string } }) => x.perfil.id);
        const directorio = (
          await t
            .http()
            .get('/api/directorio')
            .set(await tk(gestion))
        ).body.find((x: { id: string }) => x.id === p.id);
        return { publico: publico.tipos_atencion, enMatch: match.includes(p.id), directorio: directorio.tiposAtencion };
      };
      expect(await cuenta()).toEqual({ publico: [], enMatch: false, directorio: [] });

      const cola = await t
        .http()
        .get('/api/tipos-atencion/propuestas')
        .set(await tk(admin));
      expect(cola.body.filter((x: { profesionalId: string }) => x.profesionalId === p.id)).toHaveLength(2);
      expect(
        (
          await t
            .http()
            .get('/api/tipos-atencion/propuestas')
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
      for (const u of [p, gestion]) {
        expect(
          (
            await t
              .http()
              .patch(`/api/profesionales/${p.id}/tipos-atencion/${tipo.id}`)
              .set(await tk(u))
              .send({ estado: 'APROBADO' })
          ).status,
        ).toBe(403);
      }
      const aprobado = await t
        .http()
        .patch(`/api/profesionales/${p.id}/tipos-atencion/${tipo.id}`)
        .set(await tk(admin))
        .send({ estado: 'APROBADO' });
      expect(aprobado.body).toEqual(expect.objectContaining({ estado: 'APROBADO', revisadoPorId: admin.id }));
      await t
        .http()
        .patch(`/api/profesionales/${p.id}/tipos-atencion/${rechazado.id}`)
        .set(await tk(admin))
        .send({ estado: 'RECHAZADO' });
      expect(await cuenta()).toEqual({ publico: [tipo.nombre], enMatch: true, directorio: [tipo.nombre] });
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${p.id}/tipos-atencion`)
            .set(await tk(p))
        ).body
          .map((x: { estado: string }) => x.estado)
          .sort(),
      ).toEqual(['APROBADO', 'RECHAZADO']);
    });
  });

  describe('A2 documentos clinicos por correo', () => {
    let tipoDocId: string;
    const CONTENIDO = 'Epicrisis con contenido clinico reservado';
    const pdfDe = (r: { body: Buffer }) => textoPdf(r.body).replace(/\s+/g, ' ');

    it('catalogo de tipos de documento: solo ADMIN escribe; el equipo lee; el paciente no', async () => {
      const r = await t
        .http()
        .post('/api/tipos-documento-clinico')
        .set(await tk(admin))
        .send({ nombre: `Epicrisis ${Date.now()}` });
      expect(r.status).toBe(201);
      expect(r.body.plantilla).toBe('{{contenido}}');
      tipoDocId = r.body.id;
      expect(
        (
          await t
            .http()
            .post('/api/tipos-documento-clinico')
            .set(await tk(admin))
            .send({ nombre: r.body.nombre })
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .post('/api/tipos-documento-clinico')
            .set(await tk(prof))
            .send({ nombre: 'Receta' })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .get('/api/tipos-documento-clinico')
            .set(await tk(gestion))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get('/api/tipos-documento-clinico')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
      const inactivo = await t
        .http()
        .post('/api/tipos-documento-clinico')
        .set(await tk(admin))
        .send({ nombre: `Inactivo ${Date.now()}` });
      expect(
        (
          await t
            .http()
            .patch(`/api/tipos-documento-clinico/${inactivo.body.id}`)
            .set(await tk(admin))
            .send({ activo: false })
        ).body.activo,
      ).toBe(false);
      const conInactivo = await t
        .http()
        .post('/api/documentos-clinicos')
        .set(await tk(prof))
        .send({
          pacienteId: paciente.pacienteId,
          tipoDocumentoId: inactivo.body.id,
          contenido: CONTENIDO,
        });
      expect(conInactivo.status).toBe(403);
    });

    it('emite el tratante; envio por enlace que expira y exige sesion; cada descarga queda registrada; el correo no lleva contenido', async () => {
      const cuerpo = { pacienteId: paciente.pacienteId, tipoDocumentoId: tipoDocId, contenido: CONTENIDO };
      // 02i: el paciente ajeno no se ve (404, no revela que existe); ADMIN/GESTION lo ven pero no emiten (403).
      expect(
        (
          await t
            .http()
            .post('/api/documentos-clinicos')
            .set(await tk(otroProf))
            .send(cuerpo)
        ).status,
      ).toBe(404);
      for (const u of [admin, gestion, paciente]) {
        expect(
          (
            await t
              .http()
              .post('/api/documentos-clinicos')
              .set(await tk(u))
              .send(cuerpo)
          ).status,
        ).toBe(403);
      }
      // 02i: sin subida de archivos (ni base64): solo el texto redactado.
      expect(
        (
          await t
            .http()
            .post('/api/documentos-clinicos')
            .set(await tk(prof))
            .send({ ...cuerpo, tipoMime: 'application/pdf' })
        ).status,
      ).toBe(400);
      const doc = await t
        .http()
        .post('/api/documentos-clinicos')
        .set(await tk(prof))
        .send(cuerpo);
      expect(doc.status).toBe(201);
      expect(doc.body).not.toHaveProperty('contenido');
      expect(doc.body.tipoMime).toBe('application/pdf');
      const fila = await t.dueno.documentoClinico.findUniqueOrThrow({ where: { id: doc.body.id } });
      expect(Buffer.from(fila.contenido).toString('latin1')).not.toContain('reservado');

      for (const u of [admin, gestion]) {
        expect(
          (
            await t
              .http()
              .get('/api/documentos-clinicos')
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
      expect(
        (
          await t
            .http()
            .get('/api/documentos-clinicos')
            .set(await tk(otroPaciente))
        ).body,
      ).toEqual([]);
      expect(
        (
          await t
            .http()
            .get('/api/documentos-clinicos')
            .set(await tk(paciente))
        ).body.map((d: { id: string }) => d.id),
      ).toEqual([doc.body.id]);

      // Adjunto sin solicitud del paciente -> 422.
      const sinSolicitud = await t
        .http()
        .post(`/api/documentos-clinicos/${doc.body.id}/envios`)
        .set(await tk(prof))
        .send({ modo: 'ADJUNTO' });
      expect(sinSolicitud.status).toBe(422);
      expect(sinSolicitud.body.restriccion).toBe('envios_documento_adjunto_solicitado');
      const envio = await t
        .http()
        .post(`/api/documentos-clinicos/${doc.body.id}/envios`)
        .set(await tk(prof))
        .send({});
      expect(envio.status).toBe(201);
      expect(envio.body.modo).toBe('ENLACE');
      expect(new Date(envio.body.expiraEn).getTime()).toBeGreaterThan(Date.now() + 71 * 3_600_000);
      expect(await t.dueno.accesoFicha.count({ where: { usuarioId: prof.id, recurso: { in: ['documentos_clinicos', 'envios_documento'] } } })).toBe(2);

      const enviados = (await procesarMensajes(t)).filter((c) => c.para === paciente.email && c.asunto === 'Documento disponible');
      expect(enviados).toHaveLength(1);
      expect(enviados[0].adjuntos ?? []).toEqual([]);
      expect(enviados[0].texto).toContain('iniciar sesión');
      expect(enviados[0].texto).not.toContain('reservado');
      const token = /token=([\w-]+)/.exec(enviados[0].texto)![1];

      const descarga = (u?: UsuarioPrueba) => {
        const r = t.http().get(`/api/documentos-clinicos/descarga/${token}`).buffer(true).parse(binario);
        return u ? tk(u).then((h) => r.set(h)) : r;
      };
      expect((await descarga()).status).toBe(401);
      expect((await descarga(otroPaciente)).status).toBe(404);
      expect((await descarga(prof)).status).toBe(403);
      for (let i = 0; i < 2; i++) {
        const d = await descarga(paciente);
        expect(d.status).toBe(200);
        expect(d.headers['content-type']).toContain('application/pdf');
        expect(d.body.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdfDe(d)).toContain(CONTENIDO);
      }
      expect(await t.dueno.descargaDocumento.count({ where: { documentoId: doc.body.id, usuarioId: paciente.id } })).toBe(2);
      expect(await t.dueno.accesoFicha.count({ where: { usuarioId: paciente.id, accion: 'DESCARGA' } })).toBe(2);

      // Enlace vencido: 410 y no registra.
      const vencido = randomBytes(32).toString('base64url');
      await t.dueno.envioDocumento.create({
        data: {
          id: randomUUID(),
          documentoId: doc.body.id,
          modo: 'ENLACE',
          tokenHash: createHash('sha256').update(vencido).digest('hex'),
          enlace: (await t.dueno.envioDocumento.findFirstOrThrow({ where: { documentoId: doc.body.id } })).enlace,
          expiraEn: new Date(Date.now() - 1000),
          enviadoPorId: prof.id,
        },
      });
      expect(
        (
          await t
            .http()
            .get(`/api/documentos-clinicos/descarga/${vencido}`)
            .set(await tk(paciente))
        ).status,
      ).toBe(410);
      expect(await t.dueno.descargaDocumento.count({ where: { documentoId: doc.body.id } })).toBe(2);

      // ADMIN audita envios y descargas sin ver el documento.
      const auditoria = await t
        .http()
        .get(`/api/documentos-clinicos/${doc.body.id}/envios`)
        .set(await tk(admin));
      expect(auditoria.body).toHaveLength(2);
      expect(JSON.stringify(auditoria.body)).not.toContain('enlace');
    });

    it('adjunto solo si el paciente lo pide (solicitud registrada, una vez); va el PDF generado', async () => {
      const doc = await t
        .http()
        .post('/api/documentos-clinicos')
        .set(await tk(prof))
        .send({ pacienteId: paciente.pacienteId, tipoDocumentoId: tipoDocId, contenido: CONTENIDO });
      expect(
        (
          await t
            .http()
            .post(`/api/documentos-clinicos/${doc.body.id}/solicitud-adjunto`)
            .set(await tk(otroPaciente))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .post(`/api/documentos-clinicos/${doc.body.id}/solicitud-adjunto`)
            .set(await tk(prof))
        ).status,
      ).toBe(403);
      const solicitud = await t
        .http()
        .post(`/api/documentos-clinicos/${doc.body.id}/solicitud-adjunto`)
        .set(await tk(paciente));
      expect(solicitud.status).toBe(200);
      expect(solicitud.body.adjuntoSolicitadoEn).not.toBeNull();
      expect(
        (
          await t
            .http()
            .post(`/api/documentos-clinicos/${doc.body.id}/solicitud-adjunto`)
            .set(await tk(paciente))
        ).status,
      ).toBe(409);
      expect(
        (
          await t
            .http()
            .post(`/api/documentos-clinicos/${doc.body.id}/envios`)
            .set(await tk(prof))
            .send({ modo: 'ADJUNTO' })
        ).status,
      ).toBe(201);
      const [correo] = (await procesarMensajes(t)).filter((c) => c.para === paciente.email && c.asunto === 'Documento disponible');
      expect(correo.adjuntos).toEqual([expect.objectContaining({ nombre: doc.body.nombreArchivo, tipo: 'application/pdf' })]);
      expect(textoPdf(correo.adjuntos![0].contenido).replace(/\s+/g, ' ')).toContain(CONTENIDO);
    });

    it('03b-5: vista previa sin guardar (solo el tratante) y copia del PDF emitido para el tratante (auditada)', async () => {
      const cuerpo = { pacienteId: paciente.pacienteId, tipoDocumentoId: tipoDocId, contenido: 'Texto de la vista previa' };
      const antes = await t.dueno.documentoClinico.count();
      const previa = await t
        .http()
        .post('/api/documentos-clinicos/vista-previa')
        .set(await tk(prof))
        .send(cuerpo)
        .buffer(true)
        .parse(binario);
      expect(previa.status).toBe(200);
      expect(previa.headers['content-type']).toContain('application/pdf');
      expect(pdfDe(previa)).toContain('Texto de la vista previa');
      expect(await t.dueno.documentoClinico.count()).toBe(antes);
      // Paciente ajeno: 404 (no revela que existe); administracion y el paciente: 403.
      expect(
        (
          await t
            .http()
            .post('/api/documentos-clinicos/vista-previa')
            .set(await tk(otroProf))
            .send(cuerpo)
        ).status,
      ).toBe(404);
      for (const u of [admin, gestion, paciente]) {
        expect(
          (
            await t
              .http()
              .post('/api/documentos-clinicos/vista-previa')
              .set(await tk(u))
              .send(cuerpo)
          ).status,
        ).toBe(403);
      }

      const doc = await t
        .http()
        .post('/api/documentos-clinicos')
        .set(await tk(prof))
        .send({ ...cuerpo, contenido: CONTENIDO });
      const lecturas = () => t.dueno.accesoFicha.count({ where: { usuarioId: prof.id, recurso: 'documentos_clinicos', accion: 'LECTURA' } });
      const previas = await lecturas();
      const copia = await t
        .http()
        .get(`/api/documentos-clinicos/${doc.body.id}/copia`)
        .set(await tk(prof))
        .buffer(true)
        .parse(binario);
      expect(copia.status).toBe(200);
      expect(pdfDe(copia)).toContain(CONTENIDO);
      expect(await lecturas()).toBe(previas + 1);
      expect(
        (
          await t
            .http()
            .get(`/api/documentos-clinicos/${doc.body.id}/copia`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(404);
      for (const u of [admin, gestion, paciente]) {
        expect(
          (
            await t
              .http()
              .get(`/api/documentos-clinicos/${doc.body.id}/copia`)
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
    });
  });

  describe('A3 notificaciones de derivacion', () => {
    it('el candidato recibe aviso de su oferta (tambien si un rechazo o el job la pasan); nunca ve la lista, el orden ni quien rechazo; el origen recibe avisos y ve el detalle', async () => {
      const origen = await t.datos.usuario('PROFESIONAL');
      const [c1, c2, c3] = [await t.datos.usuario('PROFESIONAL'), await t.datos.usuario('PROFESIONAL'), await t.datos.usuario('PROFESIONAL')];
      const ficha = await t.datos.paciente(origen.id);
      const tipo = await t.datos.tipoAtencion();
      const r = await t
        .http()
        .post('/api/derivaciones')
        .set(await tk(origen))
        .send({
          fichaId: ficha.fichaId,
          motivo: 'Motivo clinico reservado',
          tipoAtencionId: tipo.id,
          candidatos: [c1.id, c2.id, c3.id],
        });
      expect(r.status).toBe(201);
      const id = r.body.id as string;
      // 02i: una fila por canal; la bandeja es el registro oficial.
      const avisos = async (u: UsuarioPrueba) =>
        (
          (
            await t
              .http()
              .get('/api/notificaciones')
              .set(await tk(u))
          ).body as Record<string, unknown>[]
        ).filter((n) => n.canal === 'BANDEJA');

      const deC1 = await avisos(c1);
      expect(deC1).toEqual([expect.objectContaining({ tipo: 'DERIVACION_OFRECIDA', referenciaId: id, usuarioId: c1.id })]);
      expect(deC1[0]).not.toHaveProperty('creadaPorId');
      expect(await avisos(c2)).toEqual([]);
      expect(
        (
          await t
            .http()
            .get(`/api/derivaciones/${id}`)
            .set(await tk(c1))
        ).status,
      ).toBe(404);

      // Rechazo: la oferta pasa a c2, que no sabe quien rechazo ni ve la lista.
      expect(
        (
          await t
            .http()
            .post(`/api/derivaciones/${id}/respuesta`)
            .set(await tk(c1))
            .send({ acepta: false })
        ).status,
      ).toBe(200);
      expect(await avisos(c2)).toEqual([expect.objectContaining({ tipo: 'DERIVACION_OFRECIDA', referenciaId: id })]);
      expect((await t.dueno.notificacion.findFirstOrThrow({ where: { usuarioId: c2.id } })).creadaPorId).toBeNull();
      const oferta = await t
        .http()
        .get(`/api/derivaciones/${id}/oferta`)
        .set(await tk(c2));
      expect(Object.keys(oferta.body).sort()).toEqual(['citasEnConflicto', 'derivacionId', 'detalle', 'edadPaciente', 'motivo', 'tipoAtencion', 'venceEn']);
      expect(
        (
          await t
            .http()
            .get(`/api/derivaciones/${id}`)
            .set(await tk(c2))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .get('/api/derivaciones')
            .set(await tk(c2))
        ).body,
      ).toEqual([]);

      // Job: la oferta de c2 vence y pasa a c3.
      await t.dueno.derivacionCandidato.updateMany({
        where: { derivacionId: id, estado: 'OFRECIDA' },
        data: { ofrecidaEn: new Date(Date.now() - 2 * DIA), venceEn: new Date(Date.now() - 1000) },
      });
      await t.app.get(JobsService).expirarOfertas();
      expect(await avisos(c3)).toEqual([expect.objectContaining({ tipo: 'DERIVACION_OFRECIDA', referenciaId: id })]);

      // El origen: avisos de cambio de estado (uno pendiente a la vez) y el detalle completo.
      expect((await avisos(origen)).filter((n) => n.tipo === 'DERIVACION_ACTUALIZADA' && n.referenciaId === id).length).toBeGreaterThanOrEqual(1);
      const detalle = await t
        .http()
        .get(`/api/derivaciones/${id}`)
        .set(await tk(origen));
      expect(detalle.body.candidatos.map((c: { profesionalId: string; estado: string }) => [c.profesionalId, c.estado])).toEqual([
        [c1.id, 'RECHAZADA'],
        [c2.id, 'EXPIRADA'],
        [c3.id, 'OFRECIDA'],
      ]);

      const enviados = await enviar();
      const aC3 = enviados.find((c) => c.para === c3.email)!;
      expect(aC3.texto).toContain('tiene una nueva oferta de derivación');
      for (const dato of ['Motivo clinico', c1.id, c2.id, c1.email, c2.email]) {
        expect(aC3.texto).not.toContain(dato);
      }
      expect(enviados.some((c) => c.para === origen.email && c.asunto === 'Cambios en una derivación')).toBe(true);
    });
  });

  describe('A6 integraciones', () => {
    it('feed iCal: exige token valido, sin nombres ni motivos, incluye por reprogramar; regenerar invalida el anterior', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      const box = await t.datos.disponibleSiempre(p.id);
      const pac = await t.datos.paciente(p.id, { nombre: 'Zacarias' });
      const presencial = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send({ pacienteId: pac.id, profesionalId: p.id, modalidad: 'PRESENCIAL', ...horario(3) });
      const online = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send({ pacienteId: pac.id, profesionalId: p.id, modalidad: 'ONLINE', ...horario(4) });
      expect([presencial.status, online.status]).toEqual([201, 201]);
      await t.dueno.cita.update({ where: { id: online.body.id }, data: { estado: 'POR_REPROGRAMAR' } });

      for (const u of [gestion, admin, paciente]) {
        expect(
          (
            await t
              .http()
              .post('/api/profesionales/yo/calendario')
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
      const primera = await t
        .http()
        .post('/api/profesionales/yo/calendario')
        .set(await tk(p));
      expect(primera.status).toBe(201);
      const ruta = (url: string) => new URL(url).pathname;
      const feed = await t.http().get(ruta(primera.body.url));
      expect(feed.status).toBe(200);
      expect(feed.headers['content-type']).toContain('text/calendar');
      expect(feed.text).toContain('SUMMARY:Sesión\r\n');
      expect(feed.text).toContain(`LOCATION:${box.nombre}`);
      expect(feed.text).toContain('SUMMARY:Sesión (por reprogramar)');
      for (const dato of ['Zacarias', pac.id, 'Motivo', 'motivo']) {
        expect(feed.text).not.toContain(dato);
      }
      expect((await t.http().get('/api/calendario/token-invalido.ics')).status).toBe(404);
      const tokenHash = (await t.dueno.feedCalendario.findUniqueOrThrow({ where: { usuarioId: p.id } })).tokenHash;
      expect(primera.body.url).not.toContain(tokenHash);

      const segunda = await t
        .http()
        .post('/api/profesionales/yo/calendario')
        .set(await tk(p));
      expect((await t.http().get(ruta(primera.body.url))).status).toBe(404);
      expect((await t.http().get(ruta(segunda.body.url))).status).toBe(200);
    });

    it('.ics adjunto en confirmacion y reprogramacion con la misma regla; remitente = nombre del centro', async () => {
      await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ nombreCentro: 'Centro Prueba 02h' });
      const p = await t.datos.usuario('PROFESIONAL');
      const box = await t.datos.disponibleSiempre(p.id);
      const pac = await t.datos.usuarioPaciente(p.id);
      const cita = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send({ pacienteId: pac.pacienteId, profesionalId: p.id, modalidad: 'PRESENCIAL', ...horario(5) });
      await t
        .http()
        .patch(`/api/citas/${cita.body.id}/reprogramacion`)
        .set(await tk(gestion))
        .send(horario(6));
      const deCita = (await enviar()).filter((c) => c.para === pac.email);
      expect(deCita.map((c) => c.asunto).sort()).toEqual(['Cita confirmada', 'Cita reprogramada']);
      for (const c of deCita) {
        expect(c.remitente).toBe('Centro Prueba 02h');
        expect(c.adjuntos).toEqual([expect.objectContaining({ nombre: 'sesion.ics', tipo: expect.stringContaining('text/calendar') })]);
        const ics = c.adjuntos![0].contenido.toString('utf8');
        expect(ics).toContain('SUMMARY:Sesión');
        expect(ics).toContain(`LOCATION:${box.nombre}`);
        expect(ics).not.toContain(pac.pacienteId);
        expect(ics).not.toContain('Paciente');
      }
    });

    it('videollamada por profesional: ENLACE_PROPIO (cifrado) por defecto; JITSI solo si la plataforma lo habilita', async () => {
      const real = await crearApp({ VIDEOLLAMADA_SIMULADA: 'false' });
      const conJitsi = await crearApp({ VIDEOLLAMADA_SIMULADA: 'false', JITSI_HABILITADO: 'true', JITSI_URL_BASE: 'https://jitsi.centro.test' });
      try {
        const tkR = (u: UsuarioPrueba) => real.token(u).then(auth);
        const conSala = await t.datos.usuario('PROFESIONAL');
        const sinSala = await t.datos.usuario('PROFESIONAL');
        const jitsi = await t.datos.usuario('PROFESIONAL');
        for (const u of [conSala, sinSala, jitsi]) {
          await t.datos.disponibleSiempre(u.id);
        }
        expect(
          (
            await real
              .http()
              .get('/api/profesionales/yo/videollamada')
              .set(await tkR(conSala))
          ).body,
        ).toEqual({ modo: 'ENLACE_PROPIO', enlace: null });
        expect(
          (
            await real
              .http()
              .put('/api/profesionales/yo/videollamada')
              .set(await tkR(conSala))
              .send({ modo: 'ENLACE_PROPIO' })
          ).status,
        ).toBe(400);
        expect(
          (
            await real
              .http()
              .put('/api/profesionales/yo/videollamada')
              .set(await tkR(conSala))
              .send({ modo: 'ENLACE_PROPIO', enlace: 'http://inseguro' })
          ).status,
        ).toBe(400);
        await real
          .http()
          .put('/api/profesionales/yo/videollamada')
          .set(await tkR(conSala))
          .send({ modo: 'ENLACE_PROPIO', enlace: 'https://zoom.us/j/555' });
        expect(Buffer.from((await t.dueno.salaVideollamada.findUniqueOrThrow({ where: { usuarioId: conSala.id } })).enlace!).toString('latin1')).not.toContain(
          'zoom',
        );
        await real
          .http()
          .put('/api/profesionales/yo/videollamada')
          .set(await tkR(jitsi))
          .send({ modo: 'JITSI' });
        expect(
          (
            await real
              .http()
              .put('/api/profesionales/yo/videollamada')
              .set(await tkR(gestion))
              .send({ modo: 'JITSI' })
          ).status,
        ).toBe(403);

        const crear = async (app: AppPrueba, u: UsuarioPrueba) => {
          const pac = await t.datos.usuarioPaciente(u.id);
          const r = await app
            .http()
            .post('/api/citas')
            .set(await app.token(gestion).then(auth))
            .send({ pacienteId: pac.pacienteId, profesionalId: u.id, modalidad: 'ONLINE', ...horario(7) });
          return { r, pac };
        };
        const propio = await crear(real, conSala);
        expect(propio.r.status).toBe(201);
        expect(
          (
            await real
              .http()
              .get(`/api/citas/${propio.r.body.id}/enlace`)
              .set(await tkR(propio.pac))
          ).body.url,
        ).toBe('https://zoom.us/j/555');
        const sinConfig = await crear(real, sinSala);
        expect([sinConfig.r.status, sinConfig.r.body.restriccion]).toEqual([422, 'videollamada_sin_sala']);
        const desactivado = await crear(real, jitsi);
        expect([desactivado.r.status, desactivado.r.body.restriccion]).toEqual([422, 'videollamada_jitsi_deshabilitado']);
        const habilitado = await crear(conJitsi, jitsi);
        expect(habilitado.r.status).toBe(201);
        const url = (
          await conJitsi
            .http()
            .get(`/api/citas/${habilitado.r.body.id}/enlace`)
            .set(await conJitsi.token(habilitado.pac).then(auth))
        ).body.url;
        expect(url).toMatch(/^https:\/\/jitsi\.centro\.test\/vinculos-[0-9a-f]{32}$/);
      } finally {
        await real.cerrar();
        await conJitsi.cerrar();
      }
    });
  });
});
