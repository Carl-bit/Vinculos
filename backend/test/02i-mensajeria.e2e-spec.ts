/**
 * 02i: mensajeria (plantillas, preferencias, cola con backoff), recordatorios
 * con token, .ics con UID/SEQUENCE, documentos (PDF y adjuntos de la ficha) y
 * devolucion sin penalizacion. Por rol.
 */
import { ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { NotificacionesService } from '../src/core/notificaciones/notificaciones.service';
import { RecordatoriosService } from '../src/modulos/agenda/recordatorios.service';
import { auth, binario, crearApp, procesarMensajes, textoPdf, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;
let minuto = 0;
/** Cita de una hora que empieza en `horas` desde ahora (minuto distinto por llamada). */
const en = (horas: number) => {
  const inicio = new Date(Date.now() + horas * HORA);
  inicio.setUTCSeconds(0, 0);
  inicio.setUTCMinutes((minuto += 7) % 60);
  // La disponibilidad es por dia (0-1440 hora de Chile): una cita no cruza la medianoche local.
  const horaChile = Number(inicio.toLocaleString('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hourCycle: 'h23' }));
  if (horaChile >= 22) inicio.setTime(inicio.getTime() + 3 * HORA);
  return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + HORA).toISOString() };
};
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

describe('02i mensajeria, recordatorios y documentos', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correo = () => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo);
  const nuevaCita = async (profesionalId: string, pacienteId: string, horas: number, extra: Record<string, unknown> = { modalidad: 'ONLINE' }) => {
    const r = await t
      .http()
      .post('/api/citas')
      .set(await tk(gestion))
      .send({ pacienteId, profesionalId, ...extra, ...en(horas) });
    expect(r.status).toBe(201);
    return r.body as { id: string };
  };
  const profesional = async () => {
    const p = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(p.id);
    return p;
  };

  beforeAll(async () => {
    t = await crearApp({ ADJUNTO_MAX_MB: '1' });
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    await procesarMensajes(t);
  });

  afterAll(async () => {
    correo().fallar = false;
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { recordatorioHorasAntes: 48, plazoAvisoCancelacionHoras: 24, penalizacionCancelacionPorcentaje: 0 },
    });
    await t.cerrar();
  });

  it('plantillas: ejemplos cargados; ADMIN personaliza (se usa en el proximo mensaje); variable no permitida 422; restaurar', async () => {
    const lista = await t
      .http()
      .get('/api/plantillas-mensaje')
      .set(await tk(admin));
    expect(lista.status).toBe(200);
    expect(lista.body.length).toBeGreaterThanOrEqual(28);
    expect(lista.body.every((p: { asunto: string; asuntoEjemplo: string }) => p.asunto === p.asuntoEjemplo)).toBe(true);
    for (const u of [gestion, await t.datos.usuario('PROFESIONAL')]) {
      expect(
        (
          await t
            .http()
            .get('/api/plantillas-mensaje')
            .set(await tk(u))
        ).status,
      ).toBe(403);
    }
    const plantilla = lista.body.find(
      (p: { evento: string; destinatario: string; canal: string }) => p.evento === 'CITA_CONFIRMADA' && p.destinatario === 'PACIENTE' && p.canal === 'CORREO',
    );
    const bandeja = lista.body.find((p: { evento: string; canal: string }) => p.evento === 'CITA_CONFIRMADA' && p.canal === 'BANDEJA');

    const prohibida = await t
      .http()
      .patch(`/api/plantillas-mensaje/${plantilla.id}`)
      .set(await tk(admin))
      .send({ cuerpo: 'Motivo: {{motivo}} el {{fecha}}' });
    expect([prohibida.status, prohibida.body.restriccion]).toEqual([422, 'plantillas_mensaje_variables_permitidas']);
    expect(
      (
        await t
          .http()
          .patch(`/api/plantillas-mensaje/${bandeja.id}`)
          .set(await tk(admin))
          .send({ activa: false })
      ).status,
    ).toBe(422);
    const editada = await t
      .http()
      .patch(`/api/plantillas-mensaje/${plantilla.id}`)
      .set(await tk(admin))
      .send({ cuerpo: 'Personalizado por {{nombre_centro}}: {{fecha}} {{hora}}' });
    expect(editada.status).toBe(200);

    const p = await profesional();
    const pac = await t.datos.usuarioPaciente(p.id);
    await nuevaCita(p.id, pac.pacienteId, 30);
    const [c] = (await procesarMensajes(t)).filter((m) => m.para === pac.email && m.asunto === 'Cita confirmada');
    expect(c.texto).toMatch(/^Personalizado por /);

    const restaurada = await t
      .http()
      .post(`/api/plantillas-mensaje/${plantilla.id}/restauracion`)
      .set(await tk(admin));
    expect(restaurada.status).toBe(200);
    expect([restaurada.body.cuerpo, restaurada.body.activa]).toEqual([plantilla.cuerpoEjemplo, true]);
  });

  it('preferencias: el paciente desactiva recordatorios y avisos operativos (solo el correo); los avisos legales no se desactivan', async () => {
    const p = await profesional();
    const pac = await t.datos.usuarioPaciente(p.id);
    expect(
      (
        await t
          .http()
          .get('/api/notificaciones/preferencias')
          .set(await tk(pac))
      ).body,
    ).toEqual({ recordatorios: true, avisosOperativos: true });
    expect(
      (
        await t
          .http()
          .put('/api/notificaciones/preferencias')
          .set(await tk(pac))
          .send({ avisosLegales: false })
      ).status,
    ).toBe(400);
    expect(
      (
        await t
          .http()
          .put('/api/notificaciones/preferencias')
          .set(await tk(admin))
          .send({ recordatorios: false })
      ).status,
    ).toBe(403);
    const r = await t
      .http()
      .put('/api/notificaciones/preferencias')
      .set(await tk(pac))
      .send({ recordatorios: false, avisosOperativos: false });
    expect(r.body).toEqual({ recordatorios: false, avisosOperativos: false });

    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { recordatorioHorasAntes: 48 } });
    const cita = await nuevaCita(p.id, pac.pacienteId, 20);
    await t.app.get(RecordatoriosService).enviarRecordatorios();
    const recordatorio = await t.dueno.recordatorioCita.findFirstOrThrow({ where: { citaId: cita.id } });
    const canales = async (tipo: 'RECORDATORIO_CITA' | 'CITA_CONFIRMADA' | 'DOCUMENTO_CLINICO', referenciaId?: string) =>
      (await t.dueno.notificacion.findMany({ where: { tipo, pacienteId: pac.pacienteId, referenciaId }, select: { canal: true } })).map((n) => n.canal).sort();
    expect(await canales('RECORDATORIO_CITA', recordatorio.id)).toEqual(['BANDEJA']);
    expect(await canales('CITA_CONFIRMADA', cita.id)).toEqual(['BANDEJA']);

    // Aviso legal (documento emitido): sale por correo igual.
    const tipo = await t
      .http()
      .post('/api/tipos-documento-clinico')
      .set(await tk(admin))
      .send({ nombre: `Certificado pref ${Date.now()}` });
    const doc = await t
      .http()
      .post('/api/documentos-clinicos')
      .set(await tk(p))
      .send({ pacienteId: pac.pacienteId, tipoDocumentoId: tipo.body.id, contenido: 'Texto' });
    const envio = await t
      .http()
      .post(`/api/documentos-clinicos/${doc.body.id}/envios`)
      .set(await tk(p))
      .send({});
    expect(await canales('DOCUMENTO_CLINICO', envio.body.id)).toEqual(['BANDEJA', 'CORREO']);

    const enviados = (await procesarMensajes(t)).filter((m) => m.para === pac.email);
    expect(enviados.map((m) => m.asunto)).toEqual(['Documento disponible']);
    const bandeja = await t
      .http()
      .get('/api/notificaciones/bandeja')
      .set(await tk(pac));
    expect(bandeja.body.map((m: { asunto: string }) => m.asunto).sort()).toEqual(['Cita confirmada', 'Documento disponible', 'Recordatorio de su cita']);
  });

  it('cola: un fallo de correo reintenta con backoff y la bandeja ya tiene el mensaje; dos corridas a la vez no duplican', async () => {
    const p = await profesional();
    const pac = await t.datos.usuarioPaciente(p.id);
    correo().fallar = true;
    const cita = await nuevaCita(p.id, pac.pacienteId, 40);
    expect((await t.dueno.cita.findUniqueOrThrow({ where: { id: cita.id } })).estado).toBe('CONFIRMADA');
    await procesarMensajes(t);
    const fila = async () => t.dueno.notificacion.findFirstOrThrow({ where: { referenciaId: cita.id, canal: 'CORREO' } });
    const fallida = await fila();
    expect([fallida.estado, fallida.intentos, fallida.detalleError]).toEqual(['PENDIENTE', 1, 'fallo el envio']);
    expect(fallida.proximoIntento.getTime()).toBeGreaterThan(Date.now() + 50_000);
    const bandeja = await t
      .http()
      .get('/api/notificaciones/bandeja')
      .set(await tk(pac));
    expect(bandeja.body).toEqual([
      expect.objectContaining({ tipo: 'CITA_CONFIRMADA', asunto: 'Cita confirmada', cuerpo: expect.stringContaining('Hola Paciente') }),
    ]);
    // Antes del proximo intento no se reintenta.
    await t.app.get(NotificacionesService).enviarPendientes();
    expect((await fila()).intentos).toBe(1);

    correo().fallar = false;
    await t.dueno.notificacion.update({ where: { id: fallida.id }, data: { proximoIntento: new Date(Date.now() - 1000) } });
    const enviados = (await procesarMensajes(t)).filter((m) => m.para === pac.email);
    expect(enviados.map((m) => m.asunto)).toEqual(['Cita confirmada']);
    expect([(await fila()).estado, (await fila()).intentos]).toEqual(['ENVIADO', 2]);

    // Sin duplicados: dos corridas simultaneas (advisory lock + SKIP LOCKED).
    const citas = [await nuevaCita(p.id, pac.pacienteId, 41), await nuevaCita(p.id, pac.pacienteId, 42), await nuevaCita(p.id, pac.pacienteId, 43)];
    correo().enviados.length = 0;
    const servicio = t.app.get(NotificacionesService);
    const corridas = await Promise.all([servicio.enviarPendientes(), servicio.enviarPendientes()]);
    expect(corridas.some((c) => c.corrio)).toBe(true);
    const todos = [...correo().enviados, ...(await procesarMensajes(t))];
    const deCitas = todos.filter((m) => m.para === pac.email && m.asunto === 'Cita confirmada');
    expect(deCitas).toHaveLength(3);
    for (const c of citas) {
      expect(await t.dueno.notificacion.findMany({ where: { referenciaId: c.id }, select: { canal: true, estado: true, intentos: true } })).toEqual(
        expect.arrayContaining([
          { canal: 'BANDEJA', estado: 'ENVIADO', intentos: 1 },
          { canal: 'CORREO', estado: 'ENVIADO', intentos: 1 },
        ]),
      );
    }
  });

  it('recordatorio: una vez por cita; token de un solo uso; cancelacion a tiempo o tardia segun la politica vigente', async () => {
    await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ recordatorioHorasAntes: 72, plazoAvisoCancelacionHoras: 24, penalizacionCancelacionPorcentaje: 50 });
    const p = await profesional();
    const pac = await t.datos.usuarioPaciente(p.id);
    const aTiempo = await nuevaCita(p.id, pac.pacienteId, 48);
    const tardia = await nuevaCita(p.id, pac.pacienteId, 10);
    const confirma = await nuevaCita(p.id, pac.pacienteId, 30);
    const job = t.app.get(RecordatoriosService);
    await job.enviarRecordatorios();
    await job.enviarRecordatorios();
    for (const c of [aTiempo, tardia, confirma]) {
      expect(await t.dueno.recordatorioCita.count({ where: { citaId: c.id } })).toBe(1);
    }
    const recordatorios = (await procesarMensajes(t)).filter((m) => m.para === pac.email && m.asunto === 'Recordatorio de su cita');
    expect(recordatorios).toHaveLength(3);
    const tokens = recordatorios.map((m) => /token=([\w-]+)/.exec(m.texto)![1]);
    const consultas = await Promise.all(tokens.map((tok) => t.http().get(`/api/recordatorios/${tok}`)));
    const porInicio = (inicio: string) => tokens[consultas.findIndex((c) => new Date(c.body.inicio).getTime() === new Date(inicio).getTime())];
    const citaDe = async (id: string) => t.dueno.cita.findUniqueOrThrow({ where: { id } });
    const tokATiempo = porInicio((await citaDe(aTiempo.id)).inicio.toISOString());
    const tokTardia = porInicio((await citaDe(tardia.id)).inicio.toISOString());
    const tokConfirma = porInicio((await citaDe(confirma.id)).inicio.toISOString());

    // Antes de confirmar se informa que politica aplicaria; sin datos del paciente.
    const info = await t.http().get(`/api/recordatorios/${tokTardia}`);
    expect(info.body).toEqual(
      expect.objectContaining({ vigente: true, modalidad: 'ONLINE', cancelacion: { aTiempo: false, plazoAvisoHoras: 24, penalizacionPorcentaje: 50 } }),
    );
    expect(JSON.stringify(info.body)).not.toContain(pac.pacienteId);
    expect((await t.http().get(`/api/recordatorios/${tokATiempo}`)).body.cancelacion.aTiempo).toBe(true);
    expect((await t.http().get('/api/recordatorios/token-inexistente')).status).toBe(404);

    const cancelaATiempo = await t.http().post(`/api/recordatorios/${tokATiempo}/cancelacion`);
    expect([cancelaATiempo.status, cancelaATiempo.body]).toEqual([200, { respuesta: 'CANCELADA', cancelacion: { aTiempo: true, penalizacionPorcentaje: 0 } }]);
    expect((await citaDe(aTiempo.id)).estado).toBe('CANCELADA');
    expect((await t.http().post(`/api/recordatorios/${tokATiempo}/cancelacion`)).status).toBe(409);
    expect((await t.http().post(`/api/recordatorios/${tokATiempo}/confirmacion`)).status).toBe(409);

    const cancelaTardia = await t.http().post(`/api/recordatorios/${tokTardia}/cancelacion`);
    expect(cancelaTardia.body).toEqual({ respuesta: 'CANCELADA', cancelacion: { aTiempo: false, penalizacionPorcentaje: 50 } });

    const confirmada = await t.http().post(`/api/recordatorios/${tokConfirma}/confirmacion`);
    expect([confirmada.status, confirmada.body]).toEqual([200, { respuesta: 'CONFIRMADA' }]);
    expect((await citaDe(confirma.id)).estado).toBe('CONFIRMADA');
    expect((await t.http().post(`/api/recordatorios/${tokConfirma}/cancelacion`)).status).toBe(409);

    // La cancelacion avisa al paciente y al profesional.
    const avisos = (await procesarMensajes(t)).filter((m) => m.asunto === 'Cita cancelada');
    expect(avisos.filter((m) => m.para === pac.email)).toHaveLength(2);
    expect(avisos.filter((m) => m.para === p.email)).toHaveLength(2);
  });

  it('.ics: misma UID y SEQUENCE creciente al reprogramar; METHOD:CANCEL al cancelar; el feed refleja lo mismo', async () => {
    const p = await profesional();
    const pac = await t.datos.usuarioPaciente(p.id);
    const cita = await nuevaCita(p.id, pac.pacienteId, 80, { modalidad: 'PRESENCIAL' });
    const ics = async (asunto: string) => {
      const [m] = (await procesarMensajes(t)).filter((x) => x.para === pac.email && x.asunto === asunto);
      return m.adjuntos![0].contenido.toString('utf8');
    };
    const valor = (texto: string, prop: string) => new RegExp(`\\r\\n${prop}[:;]([^\\r]*)`).exec(texto)?.[1];

    const confirmada = await ics('Cita confirmada');
    await t
      .http()
      .patch(`/api/citas/${cita.id}/reprogramacion`)
      .set(await tk(gestion))
      .send(en(81));
    const reprogramada = await ics('Cita reprogramada');
    await t
      .http()
      .patch(`/api/citas/${cita.id}/cancelacion`)
      .set(await tk(gestion));
    const cancelada = await ics('Cita cancelada');

    expect([confirmada, reprogramada, cancelada].map((x) => valor(x, 'UID'))).toEqual([`${cita.id}@vinculos`, `${cita.id}@vinculos`, `${cita.id}@vinculos`]);
    const secuencias = [confirmada, reprogramada, cancelada].map((x) => Number(valor(x, 'SEQUENCE')));
    expect(secuencias[0]).toBe(0);
    expect(secuencias[1]).toBeGreaterThan(secuencias[0]);
    expect(secuencias[2]).toBeGreaterThan(secuencias[1]);
    expect(valor(reprogramada, 'DTSTART')).not.toBe(valor(confirmada, 'DTSTART'));
    expect([valor(confirmada, 'METHOD'), valor(reprogramada, 'METHOD'), valor(cancelada, 'METHOD')]).toEqual(['PUBLISH', 'PUBLISH', 'CANCEL']);
    expect(valor(cancelada, 'STATUS')).toBe('CANCELLED');
    expect(cancelada).toContain('ORGANIZER;CN=');

    const feed = await t
      .http()
      .post('/api/profesionales/yo/calendario')
      .set(await tk(p));
    const texto = (await t.http().get(new URL(feed.body.url).pathname)).text;
    expect(texto).toContain(`UID:${cita.id}@vinculos\r\nSEQUENCE:${secuencias[2]}\r\n`);
    expect(texto).toContain('STATUS:CANCELLED');
  });

  describe('documentos', () => {
    it('PDF emitido: solo lo que define la plantilla del tipo (con el formato del centro); variable no permitida 422', async () => {
      await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ nombreCentro: 'Centro 02i' });
      const p = await profesional();
      const pac = await t.datos.usuarioPaciente(p.id);
      const malo = await t
        .http()
        .post('/api/tipos-documento-clinico')
        .set(await tk(admin))
        .send({ nombre: `Malo ${Date.now()}`, plantilla: 'Diagnostico: {{diagnostico}}' });
      expect([malo.status, malo.body.restriccion]).toEqual([422, 'tipos_documento_clinico_plantilla_valida']);
      const nombreTipo = `Certificado de asistencia ${Date.now()}`;
      const tipo = await t
        .http()
        .post('/api/tipos-documento-clinico')
        .set(await tk(admin))
        .send({
          nombre: nombreTipo,
          plantilla: 'Certifico que {{nombre_paciente}} asiste a tratamiento.\n{{contenido}}\n{{nombre_profesional}}',
        });
      expect(tipo.status).toBe(201);
      const doc = await t
        .http()
        .post('/api/documentos-clinicos')
        .set(await tk(p))
        .send({ pacienteId: pac.pacienteId, tipoDocumentoId: tipo.body.id, contenido: 'Asiste en forma regular.' });
      expect(doc.status).toBe(201);
      await t
        .http()
        .post(`/api/documentos-clinicos/${doc.body.id}/envios`)
        .set(await tk(p))
        .send({});
      const [m] = (await procesarMensajes(t)).filter((x) => x.para === pac.email && x.asunto === 'Documento disponible');
      const token = /token=([\w-]+)/.exec(m.texto)![1];
      const pdf = await t
        .http()
        .get(`/api/documentos-clinicos/descarga/${token}`)
        .set(await tk(pac))
        .buffer(true)
        .parse(binario);
      expect(pdf.status).toBe(200);
      const paciente = await t.dueno.paciente.findUniqueOrThrow({ where: { id: pac.pacienteId } });
      const usuario = await t.dueno.usuario.findUniqueOrThrow({ where: { id: p.id } });
      const lineas = textoPdf(pdf.body).split('\n');
      expect(lineas.slice(0, -1)).toEqual([
        'Centro 02i',
        nombreTipo,
        `Certifico que ${paciente.nombre} ${paciente.apellido} asiste a tratamiento.`,
        'Asiste en forma regular.',
        usuario.nombre,
      ]);
      expect(lineas.at(-1)).toMatch(/^Emitido el \d{1,2} de [a-z]+ de \d{4}$/);
      for (const dato of [pac.pacienteId, pac.email]) {
        expect(pdf.body.toString('latin1')).not.toContain(dato);
      }
    });

    it('adjuntos de la ficha: multipart validado por contenido, cifrado y auditado; limite de tamaño; solo el tratante', async () => {
      const p = await profesional();
      const otro = await profesional();
      const pac = await t.datos.usuarioPaciente(p.id);
      const subir = async (u: UsuarioPrueba, datos: Buffer, nombre: string, tipo: string) =>
        t
          .http()
          .post(`/api/pacientes/${pac.pacienteId}/adjuntos`)
          .set(await tk(u))
          .attach('archivo', datos, { filename: nombre, contentType: tipo });

      const ok = await subir(p, PDF, 'informe externo.pdf', 'application/pdf');
      expect(ok.status).toBe(201);
      expect(ok.body).toEqual(expect.objectContaining({ nombreArchivo: 'informe externo.pdf', tipoMime: 'application/pdf', tamanoBytes: PDF.length }));
      expect(ok.body).not.toHaveProperty('contenido');
      // El tipo sale del contenido, no de lo que declara el cliente.
      expect((await subir(p, PNG, 'foto.pdf', 'application/pdf')).body.tipoMime).toBe('image/png');
      const falso = await subir(p, Buffer.from('no soy un pdf'), 'falso.pdf', 'application/pdf');
      expect([falso.status, falso.body.restriccion]).toEqual([422, 'adjuntos_ficha_tipo']);
      expect((await subir(p, Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]), 'grande.pdf', 'application/pdf')).status).toBe(413);
      expect((await subir(otro, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
      for (const u of [admin, gestion, pac]) {
        expect((await subir(u, PDF, 'x.pdf', 'application/pdf')).status).toBe(403);
      }

      const fila = await t.dueno.adjuntoFicha.findUniqueOrThrow({ where: { id: ok.body.id } });
      expect(Buffer.from(fila.contenido).toString('latin1')).not.toContain('%PDF');
      expect(Buffer.from(fila.contenido).toString('latin1')).not.toContain(PDF.toString('base64').slice(0, 12));
      const bajada = await t
        .http()
        .get(`/api/adjuntos-ficha/${ok.body.id}`)
        .set(await tk(p))
        .buffer(true)
        .parse(binario);
      expect([bajada.status, bajada.headers['content-type']]).toEqual([200, 'application/pdf']);
      expect(bajada.body).toEqual(PDF);
      expect(
        await t.dueno.accesoFicha.findMany({ where: { usuarioId: p.id, recurso: 'adjuntos_ficha' }, select: { accion: true }, orderBy: { ocurridoEn: 'asc' } }),
      ).toEqual([{ accion: 'ESCRITURA' }, { accion: 'ESCRITURA' }, { accion: 'LECTURA' }]);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${pac.pacienteId}/adjuntos`)
            .set(await tk(p))
        ).body,
      ).toHaveLength(2);
      expect(
        (
          await t
            .http()
            .get(`/api/pacientes/${pac.pacienteId}/adjuntos`)
            .set(await tk(otro))
        ).body,
      ).toEqual([]);
      expect(
        (
          await t
            .http()
            .get(`/api/adjuntos-ficha/${ok.body.id}`)
            .set(await tk(otro))
        ).status,
      ).toBe(404);
      for (const u of [admin, gestion, pac]) {
        expect(
          (
            await t
              .http()
              .get(`/api/adjuntos-ficha/${ok.body.id}`)
              .set(await tk(u))
          ).status,
        ).toBe(403);
      }
    });

    it('JSON grande (mas de 1 MB) rechazado: los archivos van por multipart', async () => {
      const p = await profesional();
      const pac = await t.datos.paciente(p.id);
      const r = await t
        .http()
        .post('/api/documentos-clinicos')
        .set(await tk(p))
        .send({ pacienteId: pac.id, tipoDocumentoId: pac.id, contenido: 'x'.repeat(1_100_000) });
      expect(r.status).toBe(413);
    });
  });

  it('configuracion: el recordatorio activo debe salir antes del plazo de aviso de cancelacion (422 con mensaje claro); 0 lo desactiva', async () => {
    expect((await t.dueno.configuracionCentro.findUniqueOrThrow({ where: { id: true } })).recordatorioHorasAntes).toBeGreaterThan(0);
    const igual = await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ recordatorioHorasAntes: 24, plazoAvisoCancelacionHoras: 24 });
    expect(igual.status).toBe(422);
    expect(igual.body.restriccion).toBe('configuracion_centro_recordatorio_antes_de_cancelacion');
    expect(igual.body.mensaje).toMatch(/antes del plazo de aviso de cancelacion/);
    // Subir solo el plazo por sobre el recordatorio vigente tambien choca (la regla mira la fila completa).
    await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ recordatorioHorasAntes: 48, plazoAvisoCancelacionHoras: 24 });
    expect(
      (
        await t
          .http()
          .patch('/api/configuracion')
          .set(await tk(admin))
          .send({ plazoAvisoCancelacionHoras: 72 })
      ).status,
    ).toBe(422);
    const desactivado = await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ recordatorioHorasAntes: 0, plazoAvisoCancelacionHoras: 72 });
    expect(desactivado.status).toBe(200);
    expect(
      (
        await t
          .http()
          .patch('/api/configuracion')
          .set(await tk(admin))
          .send({ recordatorioHorasAntes: 48, plazoAvisoCancelacionHoras: 24 })
      ).status,
    ).toBe(200);
  });

  it('cobros: cancelacion a tiempo con pagos y sin reagendar = devolucion completa sin penalizacion; el paciente recibe aviso del pago', async () => {
    await t
      .http()
      .patch('/api/configuracion')
      .set(await tk(admin))
      .send({ plazoAvisoCancelacionHoras: 24, penalizacionCancelacionPorcentaje: 50 });
    const p = await profesional();
    await t
      .http()
      .post('/api/profesionales/yo/tarifas')
      .set(await tk(p))
      .send({ monto: 30000 });
    const pac = await t.datos.usuarioPaciente(p.id);
    const cita = await nuevaCita(p.id, pac.pacienteId, 96);
    expect(
      (
        await t
          .http()
          .post(`/api/cobros/citas/${cita.id}/pagos`)
          .set(await tk(gestion))
          .send({ monto: 10000, medioPago: 'TRANSFERENCIA' })
      ).status,
    ).toBe(201);
    await t
      .http()
      .patch(`/api/citas/${cita.id}/cancelacion`)
      .set(await tk(gestion));
    const r = await t
      .http()
      .post(`/api/cobros/citas/${cita.id}/resolucion`)
      .set(await tk(gestion))
      .send({ decision: 'DEVOLUCION' });
    expect(r.status).toBe(200);
    expect(r.body.resolucion).toEqual(expect.objectContaining({ decision: 'DEVOLUCION', aTiempo: true, montoDevolucion: 10000, montoExigible: 0 }));
    expect(Number(r.body.resolucion.porcentaje)).toBe(0);
    expect([r.body.estado_pago, r.body.saldo]).toEqual(['SIN_COBRO', 0]);

    await procesarMensajes(t);
    const bandeja = await t
      .http()
      .get('/api/notificaciones/bandeja')
      .set(await tk(pac));
    expect(bandeja.body.map((m: { asunto: string }) => m.asunto)).toEqual(expect.arrayContaining(['Pago registrado', 'Cita cancelada']));
  });
});
