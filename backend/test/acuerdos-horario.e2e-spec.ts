/**
 * Configuracion (Opcion A, 2026-11-05): acuerdos por profesional (A, B, C)
 * y centro cerrado sin dias de atencion. Por rol.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

describe('Acuerdos por profesional y horario cerrado', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otro: UsuarioPrueba;
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);
  const acuerdo = (profesionalId: string, extra: Record<string, unknown> = {}) => ({
    profesionalId,
    modelo: 'MIXTO',
    cobra: 'CENTRO',
    comisionPorcentaje: 12,
    comisionDerivacionTipo: 'GENERAL',
    comisionDerivacionValor: 0,
    cuotaMensual: 90000,
    cargoBoxHora: 0,
    ivaBox: false,
    vigenteDesde: '2030-01-01',
    ...extra,
  });

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    otro = await t.datos.usuario('PROFESIONAL');
  });

  afterAll(async () => {
    await t.datos.centroAbierto();
    await t.cerrar();
  });

  it('solo ADMIN registra; GESTION lee todos; el profesional solo los suyos; el paciente no entra', async () => {
    const paciente = await t.datos.usuarioPaciente(profesional.id);
    expect(
      (
        await t
          .http()
          .post('/api/cobros/acuerdos')
          .set(await tk(gestion))
          .send(acuerdo(profesional.id))
      ).status,
    ).toBe(403);
    expect(
      (
        await t
          .http()
          .post('/api/cobros/acuerdos')
          .set(await tk(profesional))
          .send(acuerdo(profesional.id))
      ).status,
    ).toBe(403);
    const creado = await t
      .http()
      .post('/api/cobros/acuerdos')
      .set(await tk(admin))
      .send(acuerdo(profesional.id));
    expect(creado.status).toBe(201);
    expect(creado.body).toMatchObject({ profesionalId: profesional.id, modelo: 'MIXTO', cobra: 'CENTRO', cuotaMensual: 90000 });
    await t
      .http()
      .post('/api/cobros/acuerdos')
      .set(await tk(admin))
      .send(acuerdo(otro.id))
      .expect(201);

    const todos = await t
      .http()
      .get('/api/cobros/acuerdos')
      .set(await tk(gestion));
    expect(todos.status).toBe(200);
    expect(todos.body.map((a: { profesionalId: string }) => a.profesionalId)).toEqual(expect.arrayContaining([profesional.id, otro.id]));
    const propios = await t
      .http()
      .get('/api/cobros/acuerdos')
      .set(await tk(profesional));
    expect(propios.body.every((a: { profesionalId: string }) => a.profesionalId === profesional.id)).toBe(true);
    expect(propios.body).toHaveLength(1);
    expect(
      (
        await t
          .http()
          .get('/api/cobros/acuerdos')
          .set(await tk(paciente))
      ).status,
    ).toBe(403);
  });

  it('reglas: A siempre lo cobra el profesional (422), misma fecha (409), no dentro de un periodo liquidado (422)', async () => {
    const p = await t.datos.usuario('PROFESIONAL');
    const a = await t
      .http()
      .post('/api/cobros/acuerdos')
      .set(await tk(admin))
      .send(acuerdo(p.id, { modelo: 'DIRECTO', cobra: 'CENTRO' }));
    expect(a.status).toBe(422);
    await t
      .http()
      .post('/api/cobros/acuerdos')
      .set(await tk(admin))
      .send(acuerdo(p.id))
      .expect(201);
    const repetido = await t
      .http()
      .post('/api/cobros/acuerdos')
      .set(await tk(admin))
      .send(acuerdo(p.id));
    expect(repetido.status).toBe(409);
    expect(repetido.body.mensaje).toMatch(/misma fecha|esa fecha/);

    // Liquidacion de enero 2030 con el acuerdo: cuota del mes; emitida, el periodo no admite otra version.
    const liq = await t
      .http()
      .post('/api/cobros/liquidaciones')
      .set(await tk(gestion))
      .send({ profesionalId: p.id, desde: '2030-01-01', hasta: '2030-02-01' });
    expect(liq.status).toBe(201);
    expect(liq.body).toMatchObject({ cuotaFija: 90000, comisionPorcentaje: '12', total: -90000 });
    await t
      .http()
      .post(`/api/cobros/liquidaciones/${liq.body.id}/emision`)
      .set(await tk(gestion))
      .expect(200);
    const dentro = await t
      .http()
      .post('/api/cobros/acuerdos')
      .set(await tk(admin))
      .send(acuerdo(p.id, { vigenteDesde: '2030-01-15' }));
    expect(dentro.status).toBe(422);
    expect(dentro.body.mensaje).toMatch(/periodo ya liquidado|período ya liquidado/);
  });

  it('sin dias de atencion el centro esta cerrado: no se aparta box (422) y no hay horas libres', async () => {
    const p = await t.datos.usuario('PROFESIONAL');
    const box = await t.datos.espacio();
    await t.dueno.horarioCentro.deleteMany({});
    const manana = new Date(Date.now() + 2 * 86_400_000);
    manana.setUTCHours(14, 0, 0, 0);
    const bloque = await t
      .http()
      .post(`/api/profesionales/${p.id}/bloques`)
      .set(await tk(admin))
      .send({ bloques: [{ espacioId: box.id, inicio: manana.toISOString(), fin: new Date(manana.getTime() + 3_600_000).toISOString() }] });
    expect(bloque.status).toBe(422);
    expect(bloque.body.mensaje).toMatch(/horario de atención del centro/);
    await t.datos.centroAbierto();
  });
});
