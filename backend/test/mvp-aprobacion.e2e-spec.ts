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
    pacienteId = (await t.datos.usuarioPaciente(tratante.id)).pacienteId;
  });

  afterAll(async () => {
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { modulosActivos: modulos } });
    await t.cerrar();
  });

  it('aprobar: solo su profesional; ADMIN y GESTION 403, otro profesional 404; ya decidida 409', async () => {
    const id = await solicitada();
    for (const u of [admin, gestion]) {
      expect((await t.http().patch(aprobacion(id)).set(await tk(u)).send({ aprobar: true })).status).toBe(403);
    }
    expect((await t.http().patch(aprobacion(id)).set(await tk(otro)).send({ aprobar: true })).status).toBe(404);
    expect((await t.http().patch(aprobacion(id)).set(await tk(tratante)).send({})).status).toBe(400);

    const r = await t.http().patch(aprobacion(id)).set(await tk(tratante)).send({ aprobar: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'CONFIRMADA', aprobacionVenceEn: null });
    expect((await t.http().patch(aprobacion(id)).set(await tk(tratante)).send({ aprobar: true })).status).toBe(409);
  });

  it('rechazar la deja CANCELADA; una SOLICITADA no se reprograma (409); la vencida no se aprueba (409)', async () => {
    const id = await solicitada();
    const movida = await t
      .http()
      .patch(`/api/citas/${id}/reprogramacion`)
      .set(await tk(tratante))
      .send({ inicio: new Date(Date.now() + 90 * DIA).toISOString(), fin: new Date(Date.now() + 90 * DIA + HORA).toISOString() });
    expect(movida.status).toBe(409);
    const r = await t.http().patch(aprobacion(id)).set(await tk(tratante)).send({ aprobar: false });
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('CANCELADA');

    const vencida = await solicitada(new Date(Date.now() + 60_000));
    await t.dueno.cita.update({ where: { id: vencida }, data: { aprobacionVenceEn: new Date(Date.now() - 60_000) } });
    expect((await t.http().patch(aprobacion(vencida)).set(await tk(tratante)).send({ aprobar: true })).status).toBe(409);
    // BD compartida: que no la cuente el job de otra suite.
    await t.dueno.cita.update({ where: { id: vencida }, data: { estado: 'CANCELADA', aprobacionVenceEn: null } });
  });

  it('la cita muestra el plazo de aprobacion', async () => {
    const id = await solicitada();
    const r = await t.http().get(`/api/citas/${id}`).set(await tk(tratante));
    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('SOLICITADA');
    expect(new Date(r.body.aprobacionVenceEn).getTime()).toBeGreaterThan(Date.now());
  });
});
