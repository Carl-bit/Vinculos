/**
 * AUD-02 (API-01, BD-02): listas paginadas por cursor con maximo 100 y orden
 * estable (/pacientes, /auditoria/accesos, /notificaciones) y resumen de
 * pacientes sin columnas cifradas. Por rol: la paginacion no abre filas que la
 * RLS no deja ver.
 */
import { auth, crearApp, type AppPrueba, type UsuarioPrueba } from './apoyo';

type Pagina<T> = { items: T[]; siguienteCursor: string | null };

describe('AUD-02 paginacion', () => {
  let t: AppPrueba;
  let admin: UsuarioPrueba;
  let gestion: UsuarioPrueba;
  let profesional: UsuarioPrueba;
  let otro: UsuarioPrueba;
  const propios: string[] = [];
  const tk = (u: UsuarioPrueba) => t.token(u).then(auth);

  /** Recorre todas las paginas de una lista; devuelve los ids en orden. */
  async function todas(u: UsuarioPrueba, ruta: string, query: Record<string, unknown>) {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    // La BD de tests es compartida por todas las suites: con limite 2 ya pasa de 100 pacientes.
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      const r = await t
        .http()
        .get(ruta)
        .query({ ...query, ...(cursor ? { cursor } : {}) })
        .set(await tk(u));
      expect(r.status).toBe(200);
      const p = r.body as Pagina<{ id: string }>;
      ids.push(...p.items.map((x) => x.id));
      cursor = p.siguienteCursor;
      if (!cursor) return ids;
    }
    throw new Error('demasiadas paginas');
  }

  beforeAll(async () => {
    t = await crearApp();
    await t.dueno.configuracionCentro.update({ where: { id: true }, data: { rolGestionHabilitado: true } });
    admin = await t.datos.usuario('ADMIN');
    gestion = await t.datos.usuario('GESTION');
    profesional = await t.datos.usuario('PROFESIONAL');
    otro = await t.datos.usuario('PROFESIONAL');
    for (let i = 0; i < 7; i++) propios.push((await t.datos.paciente(profesional.id, { nombre: `Pagina${i}` })).id);
    await t.datos.paciente(otro.id, { nombre: 'Ajeno' });
  });

  afterAll(() => t.cerrar());

  it('/pacientes: paginas de a 3 sin repetir ni saltar; el profesional solo los suyos; limite fuera de rango -> 400', async () => {
    const delProfesional = await todas(profesional, '/api/pacientes', { limite: 3 });
    expect(new Set(delProfesional).size).toBe(delProfesional.length);
    expect([...delProfesional].sort()).toEqual([...propios].sort());
    // ADMIN y GESTION recorren a todos (incluye el ajeno) en el mismo orden que una sola pagina grande.
    for (const u of [admin, gestion]) {
      const pocas = await todas(u, '/api/pacientes', { limite: 2 });
      expect(pocas).toEqual(await todas(u, '/api/pacientes', { limite: 100 }));
      expect(pocas.length).toBeGreaterThanOrEqual(propios.length + 1);
    }
    for (const limite of [0, 101, 'x']) {
      expect(
        (
          await t
            .http()
            .get('/api/pacientes')
            .query({ limite })
            .set(await tk(admin))
        ).status,
      ).toBe(400);
    }
  });

  it('/pacientes: la fila no trae contacto de emergencia; sinRut filtra en la BD', async () => {
    const r = await t
      .http()
      .get('/api/pacientes')
      .query({ limite: 100 })
      .set(await tk(admin));
    expect(r.body.items.every((p: Record<string, unknown>) => !('contactoEmergencia' in p))).toBe(true);
    const sinRut = await t.datos.paciente(profesional.id, { nombre: 'SinRut', sinRut: true });
    const s = await t
      .http()
      .get('/api/pacientes')
      .query({ sinRut: true, limite: 100 })
      .set(await tk(admin));
    expect(s.body.items.map((p: { id: string }) => p.id)).toContain(sinRut.id);
    expect(s.body.items.every((p: { rut: string | null }) => p.rut === null)).toBe(true);
  });

  it('/pacientes/resumen: todos los que el rol ve, sin columnas cifradas', async () => {
    const r = await t
      .http()
      .get('/api/pacientes/resumen')
      .set(await tk(profesional));
    expect(r.status).toBe(200);
    expect(r.body.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining(propios));
    expect(r.body.some((p: { nombre: string }) => p.nombre === 'Ajeno')).toBe(false);
    for (const p of r.body as Record<string, unknown>[]) {
      expect(Object.keys(p).sort()).toEqual(['apellido', 'codigoSeudonimo', 'createdAt', 'fechaNacimiento', 'id', 'nombre', 'profesionalId']);
    }
  });

  it('/auditoria/accesos: paginas por cursor opaco sin repetir; solo ADMIN; cursor invalido -> 400', async () => {
    // Filas de acceso (append-only, las escribe el dueño como preparacion): varias con la misma marca de
    // tiempo, para probar el desempate por id del cursor (ocurrido_en, id).
    const mismoInstante = new Date(Date.now() - 60_000);
    await t.dueno.accesoFicha.createMany({
      data: propios.map((pacienteId, i) => ({
        usuarioId: profesional.id,
        rol: 'PROFESIONAL' as const,
        pacienteId,
        recurso: 'pacientes',
        accion: 'LECTURA',
        ocurridoEn: i < 4 ? mismoInstante : new Date(Date.now() - 1000 * i),
      })),
    });
    const paginado = await todas(admin, '/api/auditoria/accesos', { limite: 2 });
    // Mas de una pagina: el cursor se usa de verdad (texto de timestamptz con offset "-03").
    expect(paginado.length).toBeGreaterThan(2);
    expect(new Set(paginado).size).toBe(paginado.length);
    expect(paginado).toEqual(await todas(admin, '/api/auditoria/accesos', { limite: 100 }));
    expect(
      (
        await t
          .http()
          .get('/api/auditoria/accesos')
          .set(await tk(gestion))
      ).status,
    ).toBe(403);
    for (const cursor of ['no valido!', Buffer.from('x|y').toString('base64url')]) {
      expect(
        (
          await t
            .http()
            .get('/api/auditoria/accesos')
            .query({ cursor })
            .set(await tk(admin))
        ).status,
      ).toBe(400);
    }
  });

  it('/notificaciones: paginas por cursor y filtro por tipo', async () => {
    const todasAdmin = await todas(admin, '/api/notificaciones', { limite: 2 });
    expect(new Set(todasAdmin).size).toBe(todasAdmin.length);
    expect(todasAdmin).toEqual(await todas(admin, '/api/notificaciones', { limite: 100 }));
    const r = await t
      .http()
      .get('/api/notificaciones')
      .query({ tipo: 'DERIVACION_OFRECIDA', limite: 100 })
      .set(await tk(admin));
    expect(r.status).toBe(200);
    expect(r.body.items.every((n: { tipo: string }) => n.tipo === 'DERIVACION_OFRECIDA')).toBe(true);
  });
});
