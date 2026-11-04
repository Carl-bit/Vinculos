/**
 * AUD-01 (docs/cumplimiento/roadmap_aud01.md): alineacion con las decisiones
 * de cumplimiento. Una seccion por entrega, por rol.
 */
import { createDecipheriv, randomInt, randomUUID, scryptSync } from 'node:crypto';

import { ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { dvRut } from '../src/core/validacion/validadores';
import { auth, crearApp, procesarMensajes, type AppPrueba, type UsuarioPrueba } from './apoyo';

const HORA = 3_600_000;
let minuto = 0;
/** Cita de una hora que empieza en `horas` desde ahora (minuto distinto por llamada). */
const en = (horas: number) => {
  const inicio = new Date(Date.now() + horas * HORA);
  inicio.setUTCSeconds(0, 0);
  inicio.setUTCMinutes((minuto += 7) % 60);
  return { inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + HORA).toISOString() };
};

describe('AUD-01 cumplimiento', () => {
  let t: AppPrueba;
  let gestion: UsuarioPrueba;
  let admin: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    gestion = await t.datos.usuario('GESTION');
    admin = await t.datos.usuario('ADMIN');
    await procesarMensajes(t);
  });

  afterAll(async () => {
    await t.dueno.contenidoPublico.update({ where: { id: true }, data: { contactoCorreo: null } });
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'CENTRO', mediosPagoHabilitados: ['PAGO_EN_CENTRO'] } });
    await t.cerrar();
  });

  describe('E1.2 Reply-To', () => {
    it('los avisos al paciente responden al correo de contacto del centro; sin correo de contacto no llevan Reply-To', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      await t.datos.disponibleSiempre(p.id);
      const pac = await t.datos.usuarioPaciente(p.id);
      const agendar = async (horas: number) => {
        const r = await t
          .http()
          .post('/api/citas')
          .set(await tk(gestion))
          .send({ pacienteId: pac.pacienteId, profesionalId: p.id, modalidad: 'ONLINE', ...en(horas) });
        expect(r.status).toBe(201);
      };

      await t.dueno.contenidoPublico.upsert({
        where: { id: true },
        create: { contactoCorreo: 'contacto@centro.test' },
        update: { contactoCorreo: 'contacto@centro.test' },
      });
      await agendar(50);
      const con = (await procesarMensajes(t)).filter((m) => m.para === pac.email);
      expect(con.length).toBeGreaterThan(0);
      expect(con.every((m) => m.responderA === 'contacto@centro.test')).toBe(true);

      await t.dueno.contenidoPublico.update({ where: { id: true }, data: { contactoCorreo: null } });
      await agendar(52);
      const sin = (await procesarMensajes(t)).filter((m) => m.para === pac.email);
      expect(sin.length).toBeGreaterThan(0);
      expect(sin.every((m) => !m.responderA)).toBe(true);
    });
  });

  describe('E1.3 Pasarela solo del centro', () => {
    it('ADMIN: con PASARELA habilitada no puede pasar a cobro DIRECTO (422 con mensaje) ni habilitarla con DIRECTO; con CENTRO si', async () => {
      const patch = async (body: Record<string, unknown>) =>
        t
          .http()
          .patch('/api/configuracion')
          .set(await tk(admin))
          .send(body);
      expect((await patch({ modeloCobro: 'CENTRO', mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'PASARELA'] })).status).toBe(200);
      const directo = await patch({ modeloCobro: 'DIRECTO' });
      expect(directo.status).toBe(422);
      expect(directo.body.mensaje).toContain('propia pasarela de pago');
      expect((await patch({ mediosPagoHabilitados: ['PAGO_EN_CENTRO'] })).status).toBe(200);
      expect((await patch({ modeloCobro: 'DIRECTO' })).status).toBe(200);
      const habilitar = await patch({ mediosPagoHabilitados: ['PAGO_EN_CENTRO', 'PASARELA'] });
      expect(habilitar.status).toBe(422);
      expect(habilitar.body.restriccion).toBe('configuracion_centro_pasarela_cobro_directo');
    });
  });

  describe('E1.4 Comprobante de pago y documento tributario', () => {
    const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Santiago' });
    const nuevaCitaPagada = async (p: UsuarioPrueba, pacienteId: string, horas: number, cobra: UsuarioPrueba) => {
      if ((await t.dueno.tarifa.count({ where: { profesionalId: p.id } })) === 0) {
        await t.dueno.tarifa.create({ data: { profesionalId: p.id, monto: 30000 } });
      }
      const r = await t
        .http()
        .post('/api/citas')
        .set(await tk(gestion))
        .send({ pacienteId, profesionalId: p.id, modalidad: 'ONLINE', ...en(horas) });
      expect(r.status).toBe(201);
      const monto = (await t.dueno.cita.findUniqueOrThrow({ where: { id: r.body.id } })).monto!;
      const pago = await t
        .http()
        .post(`/api/cobros/citas/${r.body.id}/pagos`)
        .set(await tk(cobra))
        .send({ monto, medioPago: 'EFECTIVO' });
      expect([pago.status, pago.body.mensaje ?? pago.body.message]).toEqual([201, undefined]);
      return { id: r.body.id as string, monto, detalle: pago.body };
    };
    const registrar = async (u: UsuarioPrueba, citaId: string, body: Record<string, unknown>) =>
      t
        .http()
        .post(`/api/cobros/citas/${citaId}/documentos-tributarios`)
        .set(await tk(u))
        .send(body);

    it('cobra el centro: comprobante CP- (no tributario) y aviso COMPROBANTE_EMITIDO; GESTION registra la boleta del SII, el profesional no; anular con motivo', async () => {
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'CENTRO' } });
      const p = await t.datos.usuario('PROFESIONAL');
      await t.datos.disponibleSiempre(p.id);
      const pac = await t.datos.usuarioPaciente(p.id);
      const c = await nuevaCitaPagada(p, pac.pacienteId, 60, gestion);
      expect(c.detalle.comprobante).toEqual(expect.objectContaining({ numero: expect.stringMatching(/^CP-\d{8}$/), monto: c.monto }));
      expect(c.detalle.documentosTributarios).toEqual([]);
      const avisos = await t.dueno.notificacion.findMany({ where: { tipo: 'COMPROBANTE_EMITIDO', pacienteId: pac.pacienteId } });
      expect(avisos.length).toBeGreaterThan(0);

      expect((await registrar(p, c.id, { tipo: 'BOLETA_ELECTRONICA', folio: '1001', fechaEmision: hoy(), monto: c.monto })).status).toBe(403);
      expect((await registrar(gestion, c.id, { tipo: 'BOLETA_ELECTRONICA', folio: '10-01', fechaEmision: hoy(), monto: c.monto })).status).toBe(400);
      const honorarios = await registrar(gestion, c.id, { tipo: 'BOLETA_HONORARIOS', folio: '1001', fechaEmision: hoy(), monto: c.monto });
      expect(honorarios.status).toBe(422);
      const ok = await registrar(gestion, c.id, { tipo: 'BOLETA_ELECTRONICA', folio: '1001', fechaEmision: hoy(), monto: c.monto });
      expect(ok.status).toBe(201);
      expect(ok.body.documentosTributarios).toEqual([
        expect.objectContaining({ tipo: 'BOLETA_ELECTRONICA', folio: '1001', emisor: 'CENTRO', fechaEmision: hoy(), monto: c.monto, estado: 'REGISTRADO' }),
      ]);
      const doc = ok.body.documentosTributarios[0].id as string;
      const anular = async (u: UsuarioPrueba, motivo: string) =>
        t
          .http()
          .post(`/api/cobros/documentos-tributarios/${doc}/anulacion`)
          .set(await tk(u))
          .send({ motivo });
      expect((await anular(p, 'no es mio')).status).toBe(403);
      const anulado = await anular(admin, 'Folio mal digitado');
      expect(anulado.status).toBe(200);
      expect(anulado.body.documentosTributarios[0]).toEqual(expect.objectContaining({ estado: 'ANULADO', motivoAnulacion: 'Folio mal digitado' }));

      // El paciente ve su comprobante y el registro del SII en el detalle de su cita.
      const suyo = await t
        .http()
        .get(`/api/cobros/citas/${c.id}`)
        .set(await tk(pac));
      expect(suyo.status).toBe(200);
      expect(suyo.body.comprobante.numero).toBe(c.detalle.comprobante.numero);
      expect(suyo.body.documentosTributarios).toHaveLength(1);
    });

    it('cobro directo: el profesional registra su boleta de honorarios; GESTION no', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      await t.datos.disponibleSiempre(p.id);
      const pac = await t.datos.usuarioPaciente(p.id);
      await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'MIXTO' } });
      try {
        await t.dueno.profesional.upsert({
          where: { usuarioId: p.id },
          create: { usuarioId: p.id, especialidad: 'Psicologia', modalidad: 'MIXTA', cobroDirecto: true },
          update: { cobroDirecto: true },
        });
        const c = await nuevaCitaPagada(p, pac.pacienteId, 62, p);
        expect((await registrar(gestion, c.id, { tipo: 'BOLETA_HONORARIOS', folio: '55', fechaEmision: hoy(), monto: c.monto })).status).toBe(403);
        const r = await registrar(p, c.id, { tipo: 'BOLETA_HONORARIOS', folio: '55', fechaEmision: hoy(), monto: c.monto });
        expect(r.status).toBe(201);
        expect(r.body.documentosTributarios[0]).toEqual(expect.objectContaining({ emisor: 'PROFESIONAL', tipo: 'BOLETA_HONORARIOS' }));
      } finally {
        await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modeloCobro: 'CENTRO' } });
      }
    });
  });

  describe('E1.5 Trazabilidad', () => {
    it('editar datos del paciente queda con usuario, rol activo y campos (sin valores); el PDF de cobros queda como descarga; solo ADMIN ve la auditoria', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      const pac = await t.datos.paciente(p.id);
      const editar = await t
        .http()
        .patch(`/api/pacientes/${pac.id}`)
        .set(await tk(gestion))
        .send({ telefono: '+56911112222' });
      expect(editar.status).toBe(200);
      const pdf = await t
        .http()
        .get('/api/cobros/reporte/pdf')
        .query({ desde: '2026-01-01', hasta: '2026-02-01' })
        .set(await tk(gestion));
      expect(pdf.status).toBe(200);

      expect(
        (
          await t
            .http()
            .get('/api/auditoria/accesos')
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
      const delPaciente = await t
        .http()
        .get('/api/auditoria/accesos')
        .query({ pacienteId: pac.id })
        .set(await tk(admin));
      expect(delPaciente.status).toBe(200);
      expect(delPaciente.body).toEqual([
        expect.objectContaining({
          origen: 'ACCESO_FICHA',
          usuarioId: gestion.id,
          rol: 'GESTION',
          recurso: 'pacientes',
          accion: 'ESCRITURA',
          detalle: 'campos: telefono',
          pacienteNombre: expect.any(String),
        }),
      ]);
      expect(JSON.stringify(delPaciente.body)).not.toContain('11112222');
      const descargas = await t
        .http()
        .get('/api/auditoria/accesos')
        .query({ usuarioId: gestion.id, accion: 'DESCARGA' })
        .set(await tk(admin));
      expect(descargas.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ origen: 'EXPORTACION', recurso: 'reporte_cobros', pacienteId: null, rol: 'GESTION' })]),
      );
    });
  });

  describe('E2.1 Soporte', () => {
    it('ADMIN autoriza (1 a 72 h) y revoca; GESTION no; el registro arranca vacio', async () => {
      const otorgar = async (u: UsuarioPrueba, body: Record<string, unknown>) =>
        t
          .http()
          .post('/api/soporte/autorizaciones')
          .set(await tk(u))
          .send(body);
      expect((await otorgar(gestion, { motivo: 'Correos que no salen', alcance: 'DIAGNOSTICO', horas: 4 })).status).toBe(403);
      expect((await otorgar(admin, { motivo: 'Correos que no salen', alcance: 'DIAGNOSTICO', horas: 100 })).status).toBe(400);
      const ok = await otorgar(admin, { motivo: 'Correos que no salen', alcance: 'DIAGNOSTICO', horas: 4 });
      expect(ok.status).toBe(201);
      expect(ok.body).toEqual(expect.objectContaining({ alcance: 'DIAGNOSTICO', vigente: true, usos: 0, otorgadaPor: expect.any(String) }));
      const revocada = await t
        .http()
        .post(`/api/soporte/autorizaciones/${ok.body.id}/revocacion`)
        .set(await tk(admin));
      expect(revocada.status).toBe(200);
      expect(revocada.body).toEqual(expect.objectContaining({ vigente: false, revocadaEn: expect.any(String) }));
      const otraVez = await t
        .http()
        .post(`/api/soporte/autorizaciones/${ok.body.id}/revocacion`)
        .set(await tk(admin));
      expect(otraVez.status).toBe(409);
      const registro = await t
        .http()
        .get('/api/soporte/registro')
        .set(await tk(admin));
      expect(registro.status).toBe(200);
      expect(
        (
          await t
            .http()
            .get('/api/soporte/registro')
            .set(await tk(gestion))
        ).status,
      ).toBe(403);
    });
  });

  describe('E2.2 Contrato del centro', () => {
    it('el operador publica; solo ADMIN lo ve y acepta (version, fecha y quien); el ADMIN no publica terminos ni DPA', async () => {
      await t.dueno.politica.create({ data: { tipo: 'TERMINOS_SERVICIO', version: 0, texto: 'Terminos de servicio de prueba para el e2e de AUD-01.' } });
      const ver = async (u: UsuarioPrueba) =>
        t
          .http()
          .get('/api/contrato-centro')
          .set(await tk(u));
      expect((await ver(gestion)).status).toBe(403);
      const antes = await ver(admin);
      expect(antes.status).toBe(200);
      expect(antes.body.pendientes).toContain('TERMINOS_SERVICIO');
      const aceptado = await t
        .http()
        .post('/api/contrato-centro/aceptacion')
        .set(await tk(admin))
        .send({ tipo: 'TERMINOS_SERVICIO' });
      expect(aceptado.status).toBe(200);
      expect(aceptado.body.pendientes).not.toContain('TERMINOS_SERVICIO');
      expect(aceptado.body.vigentes.find((v: { tipo: string }) => v.tipo === 'TERMINOS_SERVICIO').aceptaciones).toEqual([
        expect.objectContaining({ aceptadaEn: expect.any(String) }),
      ]);
      const publicar = await t
        .http()
        .post('/api/politicas')
        .set(await tk(admin))
        .send({ tipo: 'DPA', texto: 'Un DPA escrito por el centro, que no corresponde.' });
      expect(publicar.status).toBe(403);
      const publico = await t.http().get('/api/publico/politicas/TERMINOS_SERVICIO');
      expect(publico.status).toBe(404);
    });
  });

  describe('E2.3a Solicitudes de derechos', () => {
    it('ADMIN registra (detalle cifrado, 30 dias habiles), la ve con los dias que quedan y la cierra con respuesta; GESTION no', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      const pac = await t.datos.paciente(p.id);
      const registrar = async (u: UsuarioPrueba) =>
        t
          .http()
          .post('/api/derechos/solicitudes')
          .set(await tk(u))
          .send({ tipo: 'ACCESO', pacienteId: pac.id, canal: 'CORREO', detalle: 'Pide copia de sus datos personales' });
      expect((await registrar(gestion)).status).toBe(403);
      const r = await registrar(admin);
      expect(r.status).toBe(201);
      expect(r.body).toEqual(
        expect.objectContaining({
          tipo: 'ACCESO',
          estado: 'RECIBIDA',
          pacienteNombre: expect.any(String),
          detalle: 'Pide copia de sus datos personales',
          venceEl: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          diasHabilesRestantes: 30,
        }),
      );
      const fila = await t.dueno.solicitudDerecho.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(Buffer.from(fila.detalle!).toString('latin1')).not.toContain('copia de sus datos');
      const avanzar = async (body: Record<string, unknown>) =>
        t
          .http()
          .post(`/api/derechos/solicitudes/${r.body.id}/estado`)
          .set(await tk(admin))
          .send(body);
      expect((await avanzar({ estado: 'RESUELTA' })).status).toBe(422);
      const resuelta = await avanzar({ estado: 'RESUELTA', respuesta: 'Se envio la copia al correo registrado.' });
      expect(resuelta.status).toBe(200);
      expect(resuelta.body).toEqual(
        expect.objectContaining({ estado: 'RESUELTA', diasHabilesRestantes: null, respuesta: 'Se envio la copia al correo registrado.' }),
      );
      expect((await avanzar({ estado: 'EN_CURSO' })).status).toBe(409);
      expect(await t.dueno.accesoFicha.count({ where: { pacienteId: pac.id, recurso: 'solicitudes_derechos', accion: 'LECTURA' } })).toBeGreaterThan(0);
    });
  });

  describe('E2.3c Bloqueo y canales', () => {
    it('bloqueado: no se agenda ni se edita (409 con el motivo), lo agendado sigue; al levantar vuelve; el paciente activa WhatsApp solo con el modulo y lo retira', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      await t.datos.disponibleSiempre(p.id);
      const pac = await t.datos.usuarioPaciente(p.id);
      const agendar = async (horas: number) =>
        t
          .http()
          .post('/api/citas')
          .set(await tk(gestion))
          .send({ pacienteId: pac.pacienteId, profesionalId: p.id, modalidad: 'ONLINE', ...en(horas) });
      expect((await agendar(80)).status).toBe(201);
      const bloquear = async (u: UsuarioPrueba) =>
        t
          .http()
          .post(`/api/derechos/pacientes/${pac.pacienteId}/bloqueo`)
          .set(await tk(u))
          .send({ motivo: 'Revisando una solicitud del titular' });
      expect((await bloquear(gestion)).status).toBe(403);
      const b = await bloquear(admin);
      expect(b.status).toBe(200);
      expect(b.body).toEqual(expect.objectContaining({ bloqueoDesde: expect.any(String), bloqueoMotivo: 'Revisando una solicitud del titular' }));
      const nueva = await agendar(82);
      expect(nueva.status).toBe(409);
      expect(nueva.body.restriccion).toBe('pacientes_tratamiento_bloqueado');
      const editar = await t
        .http()
        .patch(`/api/pacientes/${pac.pacienteId}`)
        .set(await tk(gestion))
        .send({ telefono: '+56933334444' });
      expect(editar.status).toBe(409);
      const vista = await t
        .http()
        .get(`/api/pacientes/${pac.pacienteId}`)
        .set(await tk(gestion));
      expect(vista.body.bloqueoDesde).toEqual(expect.any(String));
      expect(
        (
          await t
            .http()
            .post(`/api/derechos/pacientes/${pac.pacienteId}/bloqueo/levantamiento`)
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      expect((await agendar(84)).status).toBe(201);

      const prefs = async (body?: Record<string, unknown>) =>
        body
          ? t
              .http()
              .put('/api/notificaciones/preferencias')
              .set(await tk(pac))
              .send(body)
          : t
              .http()
              .get('/api/notificaciones/preferencias')
              .set(await tk(pac));
      expect((await prefs()).body).toEqual(expect.objectContaining({ whatsapp: false, whatsappConsentidoEn: null }));
      // 2026-11-03: sin el modulo WHATSAPP (desactivado por defecto) el consentimiento no se puede dar.
      const sinModulo = await prefs({ whatsapp: true });
      expect(sinModulo.status).toBe(422);
      expect(sinModulo.body.mensaje).toMatch(/no tiene avisos por WhatsApp/);
      await t.dueno.$executeRaw`UPDATE configuracion_centro SET modulos_activos = modulos_activos || 'WHATSAPP'::modulo_centro`;
      try {
        expect((await prefs({ whatsapp: true })).body).toEqual(expect.objectContaining({ whatsapp: true, whatsappConsentidoEn: expect.any(String) }));
      } finally {
        await t.dueno.$executeRaw`UPDATE configuracion_centro SET modulos_activos = array_remove(modulos_activos, 'WHATSAPP')`;
      }
      // Ya dado, se retira aunque el modulo este apagado.
      expect((await prefs({ whatsapp: false })).body).toEqual(expect.objectContaining({ whatsapp: false, whatsappConsentidoEn: null }));
    });
  });

  describe('E2.3b Formulario publico por RUT', () => {
    it('misma respuesta exista o no el RUT; si es paciente se registra y avisa solo al correo registrado; el correo no se cambia', async () => {
      const p = await t.datos.usuario('PROFESIONAL');
      const pac = await t.datos.paciente(p.id, { sinRut: true });
      const cuerpo = String(randomInt(10_000_000, 25_000_000));
      const rutPaciente = `${cuerpo}-${dvRut(cuerpo)}`;
      const datos = await t
        .http()
        .patch(`/api/pacientes/${pac.id}`)
        .set(await tk(gestion))
        .send({ rut: rutPaciente, email: `e23b-${cuerpo}@x.cl` });
      expect(datos.status).toBe(200);
      const fila = { email: `e23b-${cuerpo}@x.cl` };
      const correo = t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo);
      correo.enviados.length = 0;
      const enviar = (rut: string) =>
        t.http().post('/api/publico/derechos').send({ rut, tipo: 'ACCESO', detalle: 'Quiero copia de mis datos', cambiarCorreo: true });
      const desconocido = await enviar('11.111.111-1');
      const conocido = await enviar(rutPaciente);
      expect([desconocido.status, conocido.status]).toEqual([202, 202]);
      expect(conocido.body).toEqual(desconocido.body);
      expect(conocido.body.mensaje).toContain('correo que el centro tiene registrado');
      const s = await t.dueno.solicitudDerecho.findFirstOrThrow({ where: { pacienteId: pac.id, canal: 'FORMULARIO_PUBLICO' } });
      expect(s.pideCambioCorreo).toBe(true);
      await new Promise((r) => setTimeout(r, 200));
      const avisos = correo.enviados.filter((c) => c.asunto.startsWith('Recibimos tu solicitud'));
      expect(avisos.map((c) => c.para)).toEqual([fila.email]);
      expect((await t.dueno.paciente.findUniqueOrThrow({ where: { id: pac.id }, select: { email: true } })).email).toBe(fila.email);
    });
  });

  describe('Fase 3 Exportaciones', () => {
    it('paciente sin cuenta: ADMIN prepara lo administrativo, el tratante lo clinico (ADMIN no), enlace + codigo al correo registrado; descarga JSON y PDF', async () => {
      const p = await t.datos.usuario('PROFESIONAL', { nombre: 'Ps. Tratante' });
      const pac = await t.datos.paciente(p.id);
      await t.dueno.paciente.update({ where: { id: pac.id }, data: { email: `exp-${pac.id.slice(0, 8)}@x.cl` } });
      const tipoSesionId = (await t.datos.tipoSesionAprobado()).id;
      const evo = await t
        .http()
        .post(`/api/fichas/${pac.fichaId}/evoluciones`)
        .set(await tk(p))
        .send({ notas: 'Nota clinica para exportar.', tipoSesionId, nivelRiesgo: 'BAJO' });
      expect(evo.status).toBe(201);
      const sol = await t
        .http()
        .post('/api/derechos/solicitudes')
        .set(await tk(admin))
        .send({ tipo: 'PORTABILIDAD', pacienteId: pac.id, canal: 'CORREO' });
      const preparar = async (u: UsuarioPrueba) =>
        t
          .http()
          .post(`/api/derechos/solicitudes/${sol.body.id}/exportacion`)
          .set(await tk(u));
      expect((await preparar(gestion)).status).toBe(403);
      const e = await preparar(admin);
      expect(e.status).toBe(201);
      expect(e.body).toEqual(expect.objectContaining({ estado: 'ESPERANDO_TRATANTE', requiereClinica: true }));
      expect(
        (
          await t
            .http()
            .post(`/api/exportaciones/${e.body.id}/clinica`)
            .set(await tk(admin))
        ).status,
      ).toBe(403);
      const pendientes = await t
        .http()
        .get('/api/exportaciones/pendientes')
        .set(await tk(p));
      expect(pendientes.body.map((x: { id: string }) => x.id)).toContain(e.body.id);
      const correo = t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo);
      correo.enviados.length = 0;
      const clinica = await t
        .http()
        .post(`/api/exportaciones/${e.body.id}/clinica`)
        .set(await tk(p));
      expect(clinica.status).toBe(200);
      expect(clinica.body.estado).toBe('ENVIADA');
      await new Promise((r) => setTimeout(r, 200));
      const textos = correo.enviados.map((c) => c.texto).join(' ');
      const token = /exportacion\?token=([\w-]+)/.exec(textos)?.[1];
      const codigo = /Tu codigo es: (\d{8})/.exec(textos)?.[1];
      expect(token && codigo).toBeTruthy();
      expect(new Set(correo.enviados.filter((c) => c.asunto.includes('datos')).map((c) => c.para))).toEqual(new Set([`exp-${pac.id.slice(0, 8)}@x.cl`]));
      const bajar = (body: Record<string, unknown>) => t.http().post('/api/publico/exportacion/descarga').send(body).buffer(true);
      expect((await bajar({ token, codigo: '00000000', formato: 'json' })).status).toBe(403);
      const json = await bajar({ token, codigo, formato: 'json' });
      expect(json.status).toBe(200);
      const doc = json.body as { formato: string; datos: Record<string, Record<string, unknown>[]> };
      expect(doc.formato).toBe('vinculos-exportacion-paciente');
      expect(doc.datos.pacientes[0].id).toBe(pac.id);
      expect(doc.datos.evoluciones[0].notas).toBe('Nota clinica para exportar.');
      expect(JSON.stringify(doc)).not.toContain('rut_hmac');
      const pdf = await bajar({ token, codigo, formato: 'pdf' });
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(await t.dueno.accesoFicha.count({ where: { pacienteId: pac.id, recurso: 'exportacion_paciente', accion: 'EXPORTACION' } })).toBe(2);
    });

    it('menor de 14: la copia va solo a sus adultos responsables (con cuenta: su sesion; sin cuenta: codigo), no al paciente', async () => {
      const p = await t.datos.usuario('PROFESIONAL', { nombre: 'Ps. Infantil' });
      const pac = await t.datos.paciente(p.id, { fechaNacimiento: new Date(Date.now() - 10 * 365.25 * 24 * HORA) });
      const sufijo = pac.id.slice(0, 8);
      await t.dueno.paciente.update({ where: { id: pac.id }, data: { email: `nino-${sufijo}@x.cl` } });
      const responsable = await t.datos.usuario('RESPONSABLE');
      await t.dueno.adultoResponsable.create({
        data: { id: randomUUID(), pacienteId: pac.id, nombre: 'Madre', email: `madre-${sufijo}@x.cl`, usuarioId: responsable.id },
      });
      await t.dueno.adultoResponsable.create({ data: { id: randomUUID(), pacienteId: pac.id, nombre: 'Padre', email: `padre-${sufijo}@x.cl` } });
      const sol = await t
        .http()
        .post('/api/derechos/solicitudes')
        .set(await tk(admin))
        .send({ tipo: 'ACCESO', pacienteId: pac.id, canal: 'PRESENCIAL' });
      const e = await t
        .http()
        .post(`/api/derechos/solicitudes/${sol.body.id}/exportacion`)
        .set(await tk(admin));
      expect(e.status).toBe(201);
      const correo = t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo);
      correo.enviados.length = 0;
      const clinica = await t
        .http()
        .post(`/api/exportaciones/${e.body.id}/clinica`)
        .set(await tk(p));
      expect(clinica.status).toBe(200);
      expect(clinica.body.destinatarios).toEqual([
        { adultoResponsable: true, descargas: 0 },
        { adultoResponsable: true, descargas: 0 },
      ]);
      await new Promise((r) => setTimeout(r, 200));
      const aDatos = correo.enviados.filter((c) => c.asunto.includes('persona a tu cargo'));
      expect(new Set(aDatos.map((c) => c.para))).toEqual(new Set([`madre-${sufijo}@x.cl`, `padre-${sufijo}@x.cl`]));
      expect(correo.enviados.some((c) => c.para === `nino-${sufijo}@x.cl`)).toBe(false);
      // Madre (cuenta RESPONSABLE): enlace al portal, sin codigo; descarga con su sesion y otra cuenta no.
      const deMadre = aDatos.filter((c) => c.para === `madre-${sufijo}@x.cl`);
      expect(deMadre).toHaveLength(1);
      const tokenMadre = /\/portal\/exportacion\?token=([\w-]+)/.exec(deMadre[0].texto)?.[1];
      const portal = async (u: UsuarioPrueba) =>
        t
          .http()
          .post('/api/portal/exportacion/descarga')
          .set(await tk(u))
          .send({ token: tokenMadre, formato: 'json' })
          .buffer(true);
      expect((await portal(await t.datos.usuario('RESPONSABLE'))).status).toBe(403);
      const json = await portal(responsable);
      expect(json.status).toBe(200);
      expect((json.body as { datos: { pacientes: { id: string }[] } }).datos.pacientes[0].id).toBe(pac.id);
      // Padre (sin cuenta): enlace publico mas codigo.
      const dePadre = correo.enviados
        .filter((c) => c.para === `padre-${sufijo}@x.cl`)
        .map((c) => c.texto)
        .join(' ');
      expect(dePadre).not.toContain('/portal/');
      const tokenPadre = /exportacion\?token=([\w-]+)/.exec(dePadre)?.[1];
      const codigo = /Tu codigo es: (\d{8})/.exec(dePadre)?.[1];
      const pub = await t.http().post('/api/publico/exportacion/descarga').send({ token: tokenPadre, codigo, formato: 'pdf' }).buffer(true);
      expect(pub.status).toBe(200);
    });

    it('centro: solo ADMIN, clave de 16 o mas; el archivo sale cifrado (se abre solo con la clave), sin llaves ni contraseñas; queda registrado', async () => {
      const pedir = async (u: UsuarioPrueba, clave: string) =>
        t
          .http()
          .post('/api/exportacion-centro')
          .set(await tk(u))
          .send({ clave })
          .buffer(true)
          .parse((res, cb) => {
            const partes: Buffer[] = [];
            res.on('data', (c: Buffer) => partes.push(c));
            res.on('end', () => cb(null, Buffer.concat(partes)));
          });
      expect((await pedir(gestion, 'una clave larga de prueba')).status).toBe(403);
      expect((await pedir(admin, 'corta')).status).toBe(400);
      const clave = 'una clave larga de prueba';
      const r = await pedir(admin, clave);
      expect(r.status).toBe(200);
      const archivo = r.body as Buffer;
      const magia = Buffer.from('VINCULOS-EXPORT-1\n');
      expect(archivo.subarray(0, magia.length).equals(magia)).toBe(true);
      expect(archivo.toString('latin1')).not.toContain('pacientes');
      let q = magia.length;
      const sal = archivo.subarray(q, (q += 16));
      const iv = archivo.subarray(q, (q += 12));
      const tag = archivo.subarray(q, (q += 16));
      const d = createDecipheriv('aes-256-gcm', scryptSync(clave, sal, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), iv);
      d.setAuthTag(tag);
      const plano = Buffer.concat([d.update(archivo.subarray(q)), d.final()]).toString('utf8');
      const exp = JSON.parse(plano) as { formato: string; datos: Record<string, unknown[]> };
      expect(exp.formato).toBe('vinculos-exportacion-centro');
      expect(exp.datos.pacientes.length).toBeGreaterThan(0);
      expect(exp.datos).not.toHaveProperty('llaves_datos');
      expect(exp.datos).not.toHaveProperty('sesiones');
      expect(plano).not.toContain('password_hash');
      expect(await t.dueno.registroExportacion.count({ where: { recurso: 'exportacion_centro', usuarioId: admin.id } })).toBe(1);
    });
  });

  describe('E2.3a Feriados', () => {
    it('los de la ley vienen calculados; solo ADMIN agrega y quita (de hoy en adelante); quitado sigue listado', async () => {
      const anio = new Date().getUTCFullYear() + 1;
      const ver = async (u: UsuarioPrueba) =>
        t
          .http()
          .get(`/api/feriados?anio=${anio}`)
          .set(await tk(u));
      expect((await ver(gestion)).status).toBe(403);
      const lista = await ver(admin);
      expect(lista.status).toBe(200);
      expect(lista.body).toContainEqual({ fecha: `${anio}-01-01`, nombre: 'Año Nuevo', origen: 'LEY', quitado: false });
      const fecha = `${anio}-07-07`;
      const agregar = async (u: UsuarioPrueba) =>
        t
          .http()
          .post('/api/feriados')
          .set(await tk(u))
          .send({ fecha, nombre: 'Feriado regional' });
      expect((await agregar(gestion)).status).toBe(403);
      const ok = await agregar(admin);
      expect(ok.status).toBe(201);
      expect(ok.body).toContainEqual({ fecha, nombre: 'Feriado regional', origen: 'CENTRO', quitado: false });
      expect((await agregar(admin)).status).toBe(409);
      const quitar = await t
        .http()
        .delete(`/api/feriados/${fecha}`)
        .set(await tk(admin));
      expect(quitar.status).toBe(200);
      expect(quitar.body).toContainEqual({ fecha, nombre: 'Feriado regional', origen: 'CENTRO', quitado: true });
      const pasado = await t
        .http()
        .post('/api/feriados')
        .set(await tk(admin))
        .send({ fecha: '2020-03-02', nombre: 'Pasado' });
      expect(pasado.status).toBe(422);
    });
  });
});
