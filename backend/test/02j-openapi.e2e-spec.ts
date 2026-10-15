/** 02j: documento OpenAPI (tags por modulo, JWT en toda ruta no publica, errores comunes) y /docs fuera de produccion. */
import { docsHabilitada, documentoOpenApi, TAGS } from '../src/core/docs/openapi';
import { crearApp, type AppPrueba } from './apoyo';

describe('02j OpenAPI', () => {
  let t: AppPrueba;

  beforeAll(async () => {
    t = await crearApp();
  });

  afterAll(() => t.cerrar());

  it('cada ruta tiene tag de modulo; las autenticadas llevan JWT y los errores 401/403/404/409/422; las publicas no', () => {
    const doc = documentoOpenApi(t.app);
    const ops = Object.entries(doc.paths).flatMap(([ruta, metodos]) =>
      Object.entries(metodos as Record<string, { tags?: string[]; security?: unknown[]; responses: Record<string, unknown> }>).map(([m, op]) => ({
        ruta: `${m} ${ruta}`,
        op,
      })),
    );
    expect(ops.length).toBeGreaterThan(100);
    const validos: string[] = Object.values(TAGS);
    expect(ops.filter(({ op }) => !op.tags?.some((tag) => validos.includes(tag))).map((o) => o.ruta)).toEqual([]);

    const publicas = ops.filter(({ ruta }) => /\/api\/(auth|salud|publico|calendario|recordatorios)\b/.test(ruta));
    expect(publicas.length).toBeGreaterThan(5);
    expect(publicas.filter(({ op }) => op.security)).toEqual([]);
    const autenticadas = ops.filter((o) => !publicas.includes(o));
    expect(autenticadas.filter(({ op }) => !op.security || !['401', '403', '404', '409', '422'].every((c) => c in op.responses)).map((o) => o.ruta)).toEqual(
      [],
    );
    expect(Object.keys(doc.paths['/api/pacientes/{id}/adjuntos'].post!.responses)).toContain('413');
    expect(doc.components?.securitySchemes?.jwt).toEqual(expect.objectContaining({ scheme: 'bearer', bearerFormat: 'JWT' }));
  });

  it('/docs: habilitada fuera de produccion; DOCS_API la fuerza en ambos sentidos', () => {
    expect(docsHabilitada(undefined, 'development')).toBe(true);
    expect(docsHabilitada(undefined, undefined)).toBe(true);
    expect(docsHabilitada(undefined, 'production')).toBe(false);
    expect(docsHabilitada(true, 'production')).toBe(true);
    expect(docsHabilitada(false, 'development')).toBe(false);
  });
});
