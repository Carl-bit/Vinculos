/**
 * 03a-2: campos clinicos por especialidad (especialidades, plantillas
 * versionadas, valores cifrados en evoluciones, borradores e ingreso;
 * supervision solo con campos marcados) y mensajeria interna del equipo
 * (hilos GENERAL y CASO, retiro, purga, nombres minimizados). Ademas,
 * brechas.md 7: duplicados solo por administracion, RUT antes de la primera
 * evolucion, edad minima de cuenta configurable, preferencias del adulto
 * responsable y reintento de correos de cuenta.
 */
import { randomUUID } from 'node:crypto';

import { aad } from '../src/common/crypto/cifrado';
import { JobsService } from '../src/core/jobs/jobs.service';
import { ProveedorCorreo, type ProveedorCorreoSimulado } from '../src/core/notificaciones/correo';
import { NotificacionesService } from '../src/core/notificaciones/notificaciones.service';
import { auth, crearApp, llaveroPrueba, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;

type Campo = Record<string, unknown>;
const campo = (clave: string, tipo: string, extra: Campo = {}): Campo => ({
  clave,
  etiqueta: clave,
  tipo,
  obligatorio: false,
  orden: 1,
  visible_en_supervision: true,
  es_texto_libre: false,
  ...extra,
});

describe('03a-2 plantillas clinicas y mensajeria interna', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let prof: UsuarioPrueba;
  let otroProf: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string; fichaId: string };
  let psicologia: string;
  let nutricion: string;
  let tipoSesion: string;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const correo = () => t.app.get<ProveedorCorreo, ProveedorCorreoSimulado>(ProveedorCorreo);

  /** Declara y aprueba una especialidad. */
  const conEspecialidad = async (u: UsuarioPrueba, especialidadId: string) => {
    expect(
      (
        await t
          .http()
          .post('/api/profesionales/yo/especialidades')
          .set(await tk(u))
          .send({ especialidadId })
      ).status,
    ).toBe(201);
    expect(
      (
        await t
          .http()
          .post(`/api/profesionales/${u.id}/especialidades/${especialidadId}/revision`)
          .set(await tk(admin))
          .send({ aprobar: true })
      ).body.estado,
    ).toBe('APROBADO');
  };

  /** Plantilla propia publicada por ADMIN. */
  const plantillaPublicada = async (especialidadId: string, tipo: 'INGRESO' | 'EVOLUCION', definicion: Campo[]) => {
    const p = await t
      .http()
      .post('/api/plantillas-clinicas')
      .set(await tk(admin))
      .send({ especialidadId, tipo, nombre: `Plantilla ${randomUUID().slice(0, 6)}`, definicion });
    expect(p.status).toBe(201);
    const pub = await t
      .http()
      .post(`/api/plantillas-clinicas/${p.body.id}/publicacion`)
      .set(await tk(admin));
    expect(pub.body.estado).toBe('PUBLICADA');
    return pub.body as { id: string; version: number; familiaId: string };
  };

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    prof = await t.datos.usuario('PROFESIONAL');
    otroProf = await t.datos.usuario('PROFESIONAL');
    paciente = await t.datos.usuarioPaciente(prof.id);
    psicologia = (await t.dueno.especialidad.findUniqueOrThrow({ where: { nombre: 'Psicología' } })).id;
    nutricion = (await t.dueno.especialidad.findUniqueOrThrow({ where: { nombre: 'Nutrición' } })).id;
    tipoSesion = (await t.datos.tipoSesionAprobado()).id;
  });

  afterAll(() => t.cerrar());

  describe('especialidades y plantillas', () => {
    it('especialidades: catalogo de ADMIN; el profesional declara y ADMIN aprueba; el paciente no', async () => {
      expect(
        (
          await t
            .http()
            .post('/api/especialidades')
            .set(await tk(gestion))
            .send({ nombre: 'Kinesiología' })
        ).status,
      ).toBe(403);
      const nueva = await t
        .http()
        .post('/api/especialidades')
        .set(await tk(admin))
        .send({ nombre: `Kinesiología ${randomUUID().slice(0, 4)}` });
      expect(nueva.status).toBe(201);
      expect(
        (
          await t
            .http()
            .patch(`/api/especialidades/${nueva.body.id}`)
            .set(await tk(admin))
            .send({ activo: false })
        ).body,
      ).toEqual(expect.objectContaining({ activo: false }));
      expect(
        (
          await t
            .http()
            .get('/api/especialidades')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post('/api/profesionales/yo/especialidades')
            .set(await tk(prof))
            .send({ especialidadId: nueva.body.id })
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/profesionales/${prof.id}/especialidades/${psicologia}/revision`)
            .set(await tk(admin))
            .send({ aprobar: true })
        ).status,
      ).toBe(404);
      await conEspecialidad(prof, psicologia);
      expect(
        (
          await t
            .http()
            .get(`/api/profesionales/${prof.id}/especialidades`)
            .set(await tk(otroProf))
        ).body.map((e: { especialidadId: string }) => e.especialidadId),
      ).toEqual([psicologia]);
    });

    it('plantillas: el profesional propone (con la especialidad aprobada), solo ADMIN publica, la publicada es inmutable y editar crea version', async () => {
      const def = [campo('motivo', 'TEXTO', { obligatorio: true }), campo('nivel', 'SELECCION_UNICA', { opciones: ['Alto', 'Bajo'] })];
      const sinEspecialidad = await t
        .http()
        .post('/api/plantillas-clinicas')
        .set(await tk(otroProf))
        .send({ especialidadId: psicologia, tipo: 'EVOLUCION', nombre: 'Propia', definicion: def });
      expect(sinEspecialidad.status).toBe(403);
      // Seleccion sin opciones: la BD rechaza la definicion (CHECK -> 422).
      expect(
        (
          await t
            .http()
            .post('/api/plantillas-clinicas')
            .set(await tk(prof))
            .send({ especialidadId: psicologia, tipo: 'EVOLUCION', nombre: 'Mala', definicion: [campo('x', 'SELECCION_UNICA')] })
        ).status,
      ).toBe(422);
      const propuesta = await t
        .http()
        .post('/api/plantillas-clinicas')
        .set(await tk(prof))
        .send({ especialidadId: psicologia, tipo: 'EVOLUCION', nombre: 'Seguimiento breve', definicion: def });
      expect(propuesta.status).toBe(201);
      expect(propuesta.body).toEqual(expect.objectContaining({ estado: 'BORRADOR', version: 1 }));
      // El borrador lo ven su autor y ADMIN; otro profesional no.
      expect(
        (
          await t
            .http()
            .get(`/api/plantillas-clinicas/${propuesta.body.id}`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .patch(`/api/plantillas-clinicas/${propuesta.body.id}`)
            .set(await tk(prof))
            .send({ nombre: 'Seguimiento breve v1' })
        ).body.nombre,
      ).toBe('Seguimiento breve v1');
      expect(
        (
          await t
            .http()
            .post(`/api/plantillas-clinicas/${propuesta.body.id}/publicacion`)
            .set(await tk(prof))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post(`/api/plantillas-clinicas/${propuesta.body.id}/publicacion`)
            .set(await tk(admin))
        ).body.estado,
      ).toBe('PUBLICADA');
      expect(
        (
          await t
            .http()
            .patch(`/api/plantillas-clinicas/${propuesta.body.id}`)
            .set(await tk(prof))
            .send({ nombre: 'Cambio' })
        ).status,
      ).toBe(409);
      const v2 = await t
        .http()
        .post(`/api/plantillas-clinicas/${propuesta.body.id}/versiones`)
        .set(await tk(prof));
      expect(v2.body).toEqual(expect.objectContaining({ estado: 'BORRADOR', version: 2, familiaId: propuesta.body.familiaId }));
      expect(
        (
          await t
            .http()
            .post(`/api/plantillas-clinicas/${v2.body.id}/publicacion`)
            .set(await tk(admin))
        ).status,
      ).toBe(200);
      expect(
        (
          await t
            .http()
            .get(`/api/plantillas-clinicas/${propuesta.body.id}`)
            .set(await tk(prof))
        ).body.estado,
      ).toBe('INACTIVA');
      // La BD no deja borrar ni alterar una version publicada (ni como dueño).
      await expect(t.dueno.plantillaClinica.delete({ where: { id: v2.body.id } })).rejects.toThrow();
      await expect(t.dueno.plantillaClinica.update({ where: { id: v2.body.id }, data: { nombre: 'x' } })).rejects.toThrow();
    });
  });

  describe('uso de plantillas', () => {
    it('evolucion con plantilla: valores validados (422), cifrados, mostrada con su version; correccion con la misma version', async () => {
      const v1 = await plantillaPublicada(psicologia, 'EVOLUCION', [
        campo('objetivo', 'TEXTO', { obligatorio: true, es_texto_libre: true }),
        campo('adherencia', 'SELECCION_UNICA', { opciones: ['Alta', 'Baja'] }),
      ]);
      const base = { notas: 'Sesion', tipoSesionId: tipoSesion, nivelRiesgo: 'BAJO', plantillaId: v1.id };
      const mala = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
        .set(await tk(prof))
        .send({ ...base, valores: { adherencia: 'Media', extra: 1 } });
      expect(mala.status).toBe(422);
      expect(mala.body.errores).toEqual(expect.arrayContaining(['objetivo: obligatorio', 'adherencia: una de las opciones de la plantilla']));
      // Sin plantilla y con valores (o al reves): 400.
      expect(
        (
          await t
            .http()
            .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
            .set(await tk(prof))
            .send({ notas: 'x', tipoSesionId: tipoSesion, nivelRiesgo: 'BAJO', valores: { a: 1 } })
        ).status,
      ).toBe(400);
      const evo = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
        .set(await tk(prof))
        .send({ ...base, valores: { objetivo: 'Regular el sueño', adherencia: 'Alta' } });
      expect(evo.status).toBe(201);
      expect(evo.body.evolucion.valores).toEqual({ objetivo: 'Regular el sueño', adherencia: 'Alta' });
      const [fila] = await t.dueno.$queryRaw<{ valores: Buffer }[]>`SELECT valores FROM evoluciones WHERE id = ${evo.body.evolucion.id}::uuid`;
      expect(fila.valores[0]).toBe(1);
      expect(fila.valores.toString('latin1')).not.toContain('Regular');

      // Version nueva publicada: la evolucion antigua sigue con la suya.
      const v2 = await t
        .http()
        .post(`/api/plantillas-clinicas/${v1.id}/versiones`)
        .set(await tk(admin));
      await t
        .http()
        .post(`/api/plantillas-clinicas/${v2.body.id}/publicacion`)
        .set(await tk(admin));
      const lista = await t
        .http()
        .get(`/api/fichas/${paciente.fichaId}/evoluciones`)
        .set(await tk(prof));
      const antigua = lista.body.find((e: { id: string }) => e.id === evo.body.evolucion.id);
      expect(antigua.plantilla).toEqual(expect.objectContaining({ id: v1.id, version: 1, estado: 'INACTIVA' }));
      // Registro nuevo con una version inactiva: 422. Correccion: la misma version (aunque inactiva) si; otra, no.
      expect(
        (
          await t
            .http()
            .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
            .set(await tk(prof))
            .send({ ...base, valores: { objetivo: 'x' } })
        ).status,
      ).toBe(422);
      expect(
        (
          await t
            .http()
            .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
            .set(await tk(prof))
            .send({ ...base, plantillaId: v2.body.id, valores: { objetivo: 'x' }, corrigeAId: evo.body.evolucion.id })
        ).status,
      ).toBe(422);
      const correccion = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
        .set(await tk(prof))
        .send({ ...base, valores: { objetivo: 'Regular el sueño (corregido)' }, corrigeAId: evo.body.evolucion.id });
      expect(correccion.status).toBe(201);
      expect(correccion.body.evolucion.plantilla.version).toBe(1);

      // Plantilla de una especialidad que el profesional no tiene: 422.
      const nutri = await plantillaPublicada(nutricion, 'EVOLUCION', [campo('peso', 'NUMERO')]);
      const otra = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/evoluciones`)
        .set(await tk(prof))
        .send({ ...base, plantillaId: nutri.id, valores: { peso: 70 } });
      expect(otra.status).toBe(422);
      expect(otra.body.restriccion).toBe('registro_plantilla_especialidad');
    });

    it('ficha de ingreso: plantilla INGRESO, append-only, solo el equipo tratante; borradores con valores incompletos', async () => {
      const ingreso = await plantillaPublicada(psicologia, 'INGRESO', [
        campo('motivo_consulta', 'TEXTO_LARGO', { obligatorio: true, es_texto_libre: true }),
        campo('tratamiento_previo', 'SI_NO', { obligatorio: true }),
      ]);
      const evolucion = await plantillaPublicada(psicologia, 'EVOLUCION', [campo('objetivo', 'TEXTO', { obligatorio: true })]);
      expect(
        (
          await t
            .http()
            .post(`/api/fichas/${paciente.fichaId}/ingresos`)
            .set(await tk(prof))
            .send({ plantillaId: evolucion.id, valores: { objetivo: 'x' } })
        ).status,
      ).toBe(422);
      const r = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/ingresos`)
        .set(await tk(prof))
        .send({ plantillaId: ingreso.id, valores: { motivo_consulta: 'Ansiedad', tratamiento_previo: false } });
      expect(r.status).toBe(201);
      expect(r.body.plantilla.tipo).toBe('INGRESO');
      for (const u of [admin, otroProf]) {
        expect(
          (
            await t
              .http()
              .get(`/api/fichas/${paciente.fichaId}/ingresos`)
              .set(await tk(u))
          ).status,
        ).toBe(u === admin ? 403 : 404);
      }
      expect(
        (
          await t
            .http()
            .get(`/api/fichas/${paciente.fichaId}/ingresos`)
            .set(await tk(prof))
        ).body,
      ).toHaveLength(1);
      await expect(t.dueno.ingresoFicha.delete({ where: { id: r.body.id } })).rejects.toThrow();

      // Borrador: valores incompletos se guardan; al confirmar se exigen los obligatorios.
      const b = await t
        .http()
        .post(`/api/fichas/${paciente.fichaId}/borradores`)
        .set(await tk(prof))
        .send({ contenido: 'Notas en curso', plantillaId: evolucion.id, valores: {} });
      expect(b.status).toBe(201);
      expect(
        (
          await t
            .http()
            .post(`/api/borradores/${b.body.id}/confirmacion`)
            .set(await tk(prof))
            .send({ tipoSesionId: tipoSesion, nivelRiesgo: 'BAJO' })
        ).status,
      ).toBe(422);
      await t
        .http()
        .put(`/api/borradores/${b.body.id}`)
        .set(await tk(prof))
        .send({ contenido: 'Notas en curso', plantillaId: evolucion.id, valores: { objetivo: 'Listo' } });
      const confirmado = await t
        .http()
        .post(`/api/borradores/${b.body.id}/confirmacion`)
        .set(await tk(prof))
        .send({ tipoSesionId: tipoSesion, nivelRiesgo: 'BAJO' });
      expect(confirmado.status).toBe(201);
      expect(confirmado.body.evolucion.valores).toEqual({ objetivo: 'Listo' });
    });

    it('supervision seudonimizada: solo los campos visibles en supervision, con los de texto libre señalados', async () => {
      const supervisor = await t.datos.usuario('PROFESIONAL');
      const practicante = await t.datos.usuario('PRACTICANTE', { supervisorId: supervisor.id });
      const caso = await t.datos.pacienteDePracticante(practicante.id, supervisor.id);
      const p = await plantillaPublicada(psicologia, 'EVOLUCION', [
        campo('visible', 'TEXTO', { es_texto_libre: true }),
        campo('oculto', 'TEXTO', { visible_en_supervision: false }),
      ]);
      const evo = await t
        .http()
        .post(`/api/fichas/${caso.fichaId}/evoluciones`)
        .set(await tk(practicante))
        .send({
          notas: 'n',
          tipoSesionId: tipoSesion,
          nivelRiesgo: 'BAJO',
          plantillaId: p.id,
          valores: { visible: 'para supervision', oculto: 'solo tratante' },
        });
      expect(evo.status).toBe(201);
      const fila = await t.dueno.paciente.findUniqueOrThrow({ where: { id: caso.id } });
      const evs = await t
        .http()
        .get(`/api/supervision/casos/${fila.codigoSeudonimo}/evoluciones`)
        .set(await tk(supervisor));
      expect(evs.body[0]).toEqual(
        expect.objectContaining({ valores: { visible: 'para supervision' }, camposTextoLibre: ['visible'], plantilla: expect.objectContaining({ id: p.id }) }),
      );
      expect(JSON.stringify(evs.body)).not.toContain('solo tratante');
    });
  });

  describe('mensajeria interna', () => {
    it('hilo CASO: tratante y acceso temporal; ADMIN/GESTION no; al perder el acceso deja de verlo; lectura auditada; aviso sin contenido', async () => {
      const crear = (u: UsuarioPrueba, pacienteId: string) =>
        tk(u).then((h) => t.http().post('/api/hilos').set(h).send({ tipo: 'CASO', asunto: 'Coordinacion del caso', pacienteId }));
      for (const u of [admin, gestion, otroProf]) {
        expect((await crear(u, paciente.pacienteId)).status).toBe(404);
      }
      const hilo = await crear(prof, paciente.pacienteId);
      expect(hilo.status).toBe(201);
      const msg = await t
        .http()
        .post(`/api/hilos/${hilo.body.id}/mensajes`)
        .set(await tk(prof))
        .send({ contenido: 'Propongo interconsulta' });
      expect(msg.status).toBe(201);
      for (const u of [admin, gestion, otroProf]) {
        expect(
          (
            await t
              .http()
              .get(`/api/hilos/${hilo.body.id}/mensajes`)
              .set(await tk(u))
          ).status,
        ).toBe(404);
        expect(
          (
            await t
              .http()
              .get('/api/hilos')
              .set(await tk(u))
          ).body.map((h: { id: string }) => h.id),
        ).not.toContain(hilo.body.id);
      }
      // Acceso temporal: lo ve, escribe y recibe aviso (bandeja + correo, sin contenido).
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${paciente.pacienteId}/accesos-temporales`)
            .set(await tk(prof))
            .send({ profesionalId: otroProf.id, motivo: 'INTERCONSULTA', alcance: 'LECTURA', hasta: new Date(Date.now() + 5 * DIA) })
        ).status,
      ).toBe(201);
      const lectura = await t
        .http()
        .get(`/api/hilos/${hilo.body.id}/mensajes`)
        .set(await tk(otroProf));
      expect(lectura.status).toBe(200);
      expect(lectura.body.mensajes.map((m: { contenido: string }) => m.contenido)).toEqual(['Propongo interconsulta']);
      expect(
        await t.dueno.accesoFicha.count({
          where: { usuarioId: otroProf.id, pacienteId: paciente.pacienteId, recurso: 'mensajes_internos', accion: 'LECTURA' },
        }),
      ).toBeGreaterThan(0);
      await t
        .http()
        .post(`/api/hilos/${hilo.body.id}/mensajes`)
        .set(await tk(otroProf))
        .send({ contenido: 'De acuerdo' });
      const aviso = await t.dueno.notificacion.findMany({ where: { tipo: 'MENSAJE_INTERNO', usuarioId: prof.id, referenciaId: hilo.body.id } });
      expect(aviso.map((n) => n.canal).sort()).toEqual(['BANDEJA', 'CORREO']);
      expect(
        (
          await t
            .http()
            .get('/api/hilos')
            .set(await tk(prof))
        ).body.find((h: { id: string }) => h.id === hilo.body.id).noLeidos,
      ).toBe(1);

      // Pierde el acceso (cambio de tratante): deja de ver el hilo al instante.
      const otro = await t.datos.paciente(prof.id);
      const hilo2 = await crear(prof, otro.id);
      const nuevo = await t.datos.usuario('PROFESIONAL');
      await t.dueno.paciente.update({ where: { id: otro.id }, data: { profesionalId: nuevo.id } });
      expect(
        (
          await t
            .http()
            .get(`/api/hilos/${hilo2.body.id}/mensajes`)
            .set(await tk(prof))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .get(`/api/hilos/${hilo2.body.id}/mensajes`)
            .set(await tk(nuevo))
        ).status,
      ).toBe(200);
    });

    it('hilo GENERAL: participantes del equipo; el paciente nunca; retiro dentro de 5 minutos; nombre minimizado tras cerrar la cuenta', async () => {
      expect(
        (
          await t
            .http()
            .get('/api/hilos')
            .set(await tk(paciente))
        ).status,
      ).toBe(403);
      expect(
        (
          await t
            .http()
            .post('/api/hilos')
            .set(await tk(gestion))
            .send({ tipo: 'GENERAL', asunto: 'Turnos', participantes: [paciente.id] })
        ).status,
      ).toBe(422);
      const salida = await t.datos.usuario('PROFESIONAL', { nombre: 'Ps. Que Se Va' });
      const hilo = await t
        .http()
        .post('/api/hilos')
        .set(await tk(gestion))
        .send({ tipo: 'GENERAL', asunto: 'Turnos de diciembre', participantes: [prof.id, salida.id] });
      expect(hilo.status).toBe(201);
      expect(
        (
          await t
            .http()
            .get(`/api/hilos/${hilo.body.id}/mensajes`)
            .set(await tk(otroProf))
        ).status,
      ).toBe(404);
      const m = await t
        .http()
        .post(`/api/hilos/${hilo.body.id}/mensajes`)
        .set(await tk(prof))
        .send({ contenido: 'Puedo cubrir el martes' });
      expect(
        (
          await t
            .http()
            .post(`/api/hilos/mensajes/${m.body.id}/retiro`)
            .set(await tk(gestion))
        ).status,
      ).toBe(404);
      expect(
        (
          await t
            .http()
            .post(`/api/hilos/mensajes/${m.body.id}/retiro`)
            .set(await tk(prof))
        ).status,
      ).toBe(200);
      await t
        .http()
        .post(`/api/hilos/${hilo.body.id}/mensajes`)
        .set(await tk(salida))
        .send({ contenido: 'Yo el jueves' });
      // Mensaje de hace 10 minutos (como dueño): ya no se retira.
      const llavero = await llaveroPrueba(t.dueno);
      const viejo = randomUUID();
      await t.dueno.mensajeInterno.create({
        data: {
          id: viejo,
          hiloId: hilo.body.id,
          autorId: prof.id,
          rolAutor: 'PROFESIONAL',
          contenido: new Uint8Array(llavero.cifrar('antiguo', 'CLINICO', aad('mensajes_internos', 'contenido', viejo))),
          creadoEn: new Date(Date.now() - 10 * 60_000),
        },
      });
      expect(
        (
          await t
            .http()
            .post(`/api/hilos/mensajes/${viejo}/retiro`)
            .set(await tk(prof))
        ).status,
      ).toBe(409);
      // Cierre de cuenta: sus mensajes quedan, con nombre minimizado.
      await t.dueno.usuario.update({
        where: { id: salida.id },
        data: { activo: false, cerradaEn: new Date(), email: null, nombre: null, passwordHash: null, telefono: null },
      });
      const vista = await t
        .http()
        .get(`/api/hilos/${hilo.body.id}/mensajes`)
        .set(await tk(gestion));
      expect(vista.body.mensajes.map((x: { autor: string; contenido: string | null; retirado: boolean }) => [x.autor, x.contenido, x.retirado])).toEqual(
        expect.arrayContaining([
          [expect.any(String), null, true],
          ['Ex integrante del equipo', 'Yo el jueves', false],
        ]),
      );
    });

    it('rate limit por usuario y purga por retencion', async () => {
      const hilo = await t
        .http()
        .post('/api/hilos')
        .set(await tk(otroProf))
        .send({ tipo: 'GENERAL', asunto: 'Rafaga' });
      let ultimo = 0;
      for (let i = 0; i < 31; i++) {
        ultimo = (
          await t
            .http()
            .post(`/api/hilos/${hilo.body.id}/mensajes`)
            .set(await tk(otroProf))
            .send({ contenido: `m${i}` })
        ).status;
      }
      expect(ultimo).toBe(429);

      // Hilo con un solo mensaje mas antiguo que la retencion: el job borra ambos.
      const viejo = await t
        .http()
        .post('/api/hilos')
        .set(await tk(prof))
        .send({ tipo: 'GENERAL', asunto: 'Antiguo' });
      const llavero = await llaveroPrueba(t.dueno);
      const id = randomUUID();
      const hace = new Date(Date.now() - 400 * DIA);
      await t.dueno.mensajeInterno.create({
        data: {
          id,
          hiloId: viejo.body.id,
          autorId: prof.id,
          rolAutor: 'PROFESIONAL',
          contenido: new Uint8Array(llavero.cifrar('viejo', 'CLINICO', aad('mensajes_internos', 'contenido', id))),
          creadoEn: hace,
        },
      });
      await t.dueno.hiloInterno.update({ where: { id: viejo.body.id }, data: { ultimoMensajeEn: hace } });
      await t.app.get(JobsService).purgarMensajesInternos();
      expect(await t.dueno.mensajeInterno.count({ where: { id } })).toBe(0);
      expect(await t.dueno.hiloInterno.count({ where: { id: viejo.body.id } })).toBe(0);
      expect(await t.dueno.hiloInterno.count({ where: { id: hilo.body.id } })).toBe(1);
    });
  });

  describe('decisiones de brechas.md 7', () => {
    it('duplicados: alerta y aviso a administracion; solo ADMIN/GESTION resuelven', async () => {
      const dup = await t.datos.paciente(prof.id);
      await t.dueno.paciente.update({ where: { id: dup.id }, data: { posibleDuplicado: true } });
      expect(await t.dueno.alertaInterna.count({ where: { tipo: 'POSIBLE_DUPLICADO', referenciaId: dup.id, atendidaEn: null } })).toBe(1);
      expect(await t.dueno.notificacion.count({ where: { tipo: 'POSIBLE_DUPLICADO', usuarioId: gestion.id, referenciaId: dup.id } })).toBeGreaterThan(0);
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${dup.id}/duplicado-revisado`)
            .set(await tk(prof))
            .send({ resolucion: 'DISTINTO' })
        ).status,
      ).toBe(403);
      const r = await t
        .http()
        .post(`/api/pacientes/${dup.id}/duplicado-revisado`)
        .set(await tk(gestion))
        .send({ resolucion: 'DISTINTO' });
      expect(r.status).toBe(200);
      expect(r.body.posibleDuplicado).toBe(false);
      expect(await t.dueno.alertaInterna.count({ where: { tipo: 'POSIBLE_DUPLICADO', referenciaId: dup.id, atendidaEn: null } })).toBe(0);
      expect(await t.dueno.accesoFicha.count({ where: { pacienteId: dup.id, accion: 'DUPLICADO_DISTINTO' } })).toBe(1);
    });

    it('RUT obligatorio antes de la primera evolucion para todo paciente', async () => {
      const sinRut = await t.datos.paciente(prof.id, { sinRut: true });
      const r = await t
        .http()
        .post(`/api/fichas/${sinRut.fichaId}/evoluciones`)
        .set(await tk(prof))
        .send({ notas: 'Primera', tipoSesionId: tipoSesion, nivelRiesgo: 'BAJO' });
      expect(r.status).toBe(422);
      expect(r.body.restriccion).toBe('evoluciones_paciente_requiere_rut');
    });

    it('edad minima de la cuenta configurable (ADMIN); preferencias del adulto responsable por menor', async () => {
      expect(
        (
          await t
            .http()
            .patch('/api/configuracion')
            .set(await tk(admin))
            .send({ edadMinimaCuenta: 13 })
        ).status,
      ).toBe(400);
      await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ edadMinimaCuenta: 16 });
      const teen = await t.datos.paciente(prof.id, { fechaNacimiento: new Date(Date.now() - 15 * 365.25 * DIA) });
      const inv = await t
        .http()
        .post(`/api/pacientes/${teen.id}/invitacion`)
        .set(await tk(admin))
        .send({ email: `teen-${randomUUID().slice(0, 6)}@test.cl` });
      expect(inv.status).toBe(400);
      await t
        .http()
        .patch('/api/configuracion')
        .set(await tk(admin))
        .send({ edadMinimaCuenta: 14 });
      expect(
        (
          await t
            .http()
            .post(`/api/pacientes/${teen.id}/invitacion`)
            .set(await tk(admin))
            .send({ email: `teen-${randomUUID().slice(0, 6)}@test.cl` })
        ).status,
      ).toBe(201);

      const adulto = await t.dueno.adultoResponsable.create({ data: { id: randomUUID(), pacienteId: teen.id, nombre: 'Padre', email: 'padre@test.cl' } });
      const responsable = await t.datos.usuario('RESPONSABLE');
      await t.dueno.adultoResponsable.update({ where: { id: adulto.id }, data: { usuarioId: responsable.id } });
      const pref = await t
        .http()
        .put(`/api/notificaciones/preferencias/pacientes/${teen.id}`)
        .set(await tk(responsable))
        .send({ recordatorios: false });
      expect(pref.body).toEqual(expect.objectContaining({ recordatorios: false, avisosOperativos: true }));
      expect(
        (
          await t
            .http()
            .get(`/api/notificaciones/preferencias/pacientes/${paciente.pacienteId}`)
            .set(await tk(responsable))
        ).status,
      ).toBe(404);
    });

    it('correo de cuenta fallido: queda cifrado para reintento y el job lo envia y lo borra', async () => {
      const email = `reintento-${randomUUID().slice(0, 6)}@test.cl`;
      const u = await t.dueno.usuario.create({
        data: { id: randomUUID(), email, nombre: 'Reintento', rol: 'PACIENTE', pacienteId: (await t.datos.paciente(prof.id)).id, passwordHash: 'x' },
      });
      correo().fallar = true;
      expect((await t.http().post('/api/auth/recuperacion').send({ email })).status).toBe(204);
      correo().fallar = false;
      const pendientes = await t.dueno.correoCuentaPendiente.findMany();
      expect(pendientes).toHaveLength(1);
      expect(Buffer.from(pendientes[0].email).toString('latin1')).not.toContain(email);
      await t.dueno.correoCuentaPendiente.updateMany({ data: { proximoIntento: new Date() } });
      await t.app.get(NotificacionesService).reintentarCorreosCuenta();
      expect(await t.dueno.correoCuentaPendiente.count()).toBe(0);
      expect(correo().enviados.some((c) => c.para === email && /token=/.test(c.texto))).toBe(true);
      expect(u.id).toBeDefined();
    });
  });
});
