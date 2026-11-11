/**
 * MVP sin COBROS (2026-11-11): la hora que pide el paciente queda SOLICITADA y
 * solo su profesional la aprueba o la rechaza. Por rol.
 */
import type { ModuloCentro } from '@prisma/client';

import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

const DIA = 86_400_000;
const HORA = 3_600_000;

describe('MVP aprobacion de horas', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let tratante: UsuarioPrueba;
  let otro: UsuarioPrueba;
  let paciente: UsuarioPrueba & { pacienteId: string };
  let pacienteId: string;
  let modulos: ModuloCentro[];
  let dias = 70;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const aprobacion = (id: string) => `/api/citas/${id}/aprobacion`;
  // Como dueño: la API no fija SOLICITADA (la dejan reservar_cita_portal y concretar_reserva).
  const solicitada = async (vence = new Date(Date.now() + DIA)) => {
    const inicio = new Date(Date.now() + dias++ * DIA);
    const cita = await t.dueno.cita.create({
      data: {
        modalidad: 'ONLINE',
        profesionalId: tratante.id,
        pacienteId,
        inicio,
        fin: new Date(inicio.getTime() + HORA),
        estado: 'SOLICITADA',
        aprobacionVenceEn: vence,
      },
    });
    return cita.id;
  };

  beforeAll(async () => {
    t = await crearApp();
    modulos = (await t.dueno.configuracionCentro.findUniqueOrThrow({ where: { id: true } })).modulosActivos;
    await t.dueno.configuracionCentro.update({
      where: { id: true },
      data: { rolGestionHabilitado: true, modulosActivos: modulos.filter((m) => m !== 'COBROS') },
    });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    tratante = await t.datos.usuario('PROFESIONAL');
    otro = await t.datos.usuario('PROFESIONAL');
    await t.datos.disponibleSiempre(tratante.id);
    paciente = await t.datos.usuarioPaciente(tratante.id);
    pacienteId = paciente.pacienteId;
  });

  afterAll(async () => {
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modulosActivos: modulos } });
    await t.cerrar();
  });

  it('aprobar: solo su profesional; ADMIN y GESTION 403, otro profesional 404; ya decidida 409', async () => {
    const id = await solicitada();
    for (const u of [admin, gestion]) {
      expect(
        (
          await t
            .http()
            .patch(aprobacion(id))
            .set(await tk(u))
            .send({ aprobar: true })
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await t
          .http()
          .patch(aprobacion(id))
          .set(await tk(otro))
          .send({ aprobar: true })
      ).status,
    ).toBe(404);
    expect(
      (
        await t
          .http()
          .patch(aprobacion(id))
          .set(await tk(tratante))
          .send({})
      ).status,
    ).toBe(400);

    const r = await t
      .http()
      .patch(aprobacion(id))
      .set(await tk(tratante))
      .send({ aprobar: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'CONFIRMADA', aprobacionVenceEn: null });
    expect(
      (
        await t
          .http()
          .patch(aprobacion(id))
          .set(await tk(tratante))
          .send({ aprobar: true })
      ).status,
    ).toBe(409);
  });

  it('rechazar la deja CANCELADA; una SOLICITADA no se reprograma (409); la vencida no se aprueba (409)', async () => {
    const id = await solicitada();
    const movida = await t
      .http()
      .patch(`/api/citas/${id}/reprogramacion`)
      .set(await tk(tratante))
      .send({ inicio: new Date(Date.now() + 90 * DIA).toISOString(), fin: new Date(Date.now() + 90 * DIA + HORA).toISOString() });
    expect(movida.status).toBe(409);
    const r = await t
      .http()
      .patch(aprobacion(id))
      .set(await tk(tratante))
      .send({ aprobar: false });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('CANCELADA');

    const vencida = await solicitada(new Date(Date.now() + 60_000));
    await t.dueno.cita.update({ where: { id: vencida }, data: { aprobacionVenceEn: new Date(Date.now() - 60_000) } });
    expect(
      (
        await t
          .http()
          .patch(aprobacion(vencida))
          .set(await tk(tratante))
          .send({ aprobar: true })
      ).status,
    ).toBe(409);
    // BD compartida: que no la cuente el job de otra suite.
    await t.dueno.cita.update({ where: { id: vencida }, data: { estado: 'CANCELADA', aprobacionVenceEn: null } });
  });

  it('la cita muestra el plazo de aprobacion', async () => {
    const id = await solicitada();
    const r = await t
      .http()
      .get(`/api/citas/${id}`)
      .set(await tk(tratante));
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('SOLICITADA');
    expect(new Date(r.body.aprobacionVenceEn).getTime()).toBeGreaterThan(Date.now());
  });

  it('punto 7: rechazar proponiendo horas las deja PROPUESTA; el paciente elige una (las otras se sueltan) o rechaza todas', async () => {
    const hora = (d: number, h: number) => {
      const inicio = new Date(Date.now() + d * DIA + h * HORA);
      return { modalidad: 'ONLINE', inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + HORA).toISOString() };
    };
    const id = await solicitada();
    const base = dias++;
    const alternativas = [hora(base, 1), hora(base, 3)];
    expect(
      (
        await t
          .http()
          .patch(aprobacion(id))
          .set(await tk(tratante))
          .send({ aprobar: false, alternativas: [] })
      ).status,
    ).toBe(400);
    expect(
      (
        await t
          .http()
          .patch(aprobacion(id))
          .set(await tk(otro))
          .send({ aprobar: false, alternativas })
      ).status,
    ).toBe(404);
    const r = await t
      .http()
      .patch(aprobacion(id))
      .set(await tk(tratante))
      .send({ aprobar: false, alternativas });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('CANCELADA');

    const portal = await t
      .http()
      .get('/api/portal/citas')
      .set(await tk(paciente));
    expect(portal.status).toBe(200);
    const propuestas = (portal.body as { id: string; estado: string; propuestaDeId: string | null }[]).filter((c) => c.propuestaDeId === id);
    expect(propuestas.map((c) => c.estado)).toEqual(['PROPUESTA', 'PROPUESTA']);
    // La hora propuesta esta ocupada: el equipo no agenda encima (409).
    const encima = await t
      .http()
      .post('/api/citas')
      .set(await tk(tratante))
      .send({ profesionalId: tratante.id, pacienteId, ...alternativas[0] });
    expect(encima.status).toBe(409);

    const propuesta = (i: number) => `/api/citas/${propuestas[i].id}/propuesta`;
    for (const u of [admin, gestion, tratante]) {
      expect(
        (
          await t
            .http()
            .patch(propuesta(0))
            .set(await tk(u))
            .send({ aceptar: true })
        ).status,
      ).toBe(403);
    }
    const elegida = await t
      .http()
      .patch(propuesta(1))
      .set(await tk(paciente))
      .send({ aceptar: true });
    expect(elegida.status).toBe(200);
    expect(elegida.body.estado).toBe('CONFIRMADA');
    expect(
      (
        await t
          .http()
          .get(`/api/citas/${propuestas[0].id}`)
          .set(await tk(tratante))
      ).body.estado,
    ).toBe('CANCELADA');
    expect(
      (
        await t
          .http()
          .patch(propuesta(0))
          .set(await tk(paciente))
          .send({ aceptar: true })
      ).status,
    ).toBe(409);

    // Ninguna le acomoda: se sueltan todas.
    const otra = await solicitada();
    const b = dias++;
    await t
      .http()
      .patch(aprobacion(otra))
      .set(await tk(tratante))
      .send({ aprobar: false, alternativas: [hora(b, 1)] });
    const grupo = (
      (
        await t
          .http()
          .get('/api/portal/citas')
          .set(await tk(paciente))
      ).body as { id: string; propuestaDeId: string | null }[]
    ).filter((c) => c.propuestaDeId === otra);
    const rechazo = await t
      .http()
      .patch(`/api/citas/${grupo[0].id}/propuesta`)
      .set(await tk(paciente))
      .send({ aceptar: false });
    expect(rechazo.status).toBe(200);
    expect(rechazo.body.estado).toBe('CANCELADA');
  });
});
