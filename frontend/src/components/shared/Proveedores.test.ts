import { describe, expect, it } from 'vitest';

import { crearCliente } from './Proveedores';

/** Punto 10: sondeo por defecto, rapido para agenda y citas, y recarga en cadena tras cualquier accion. */
describe('Tiempo real por polling', () => {
  it('cada consulta tiene su intervalo; las fijas no se sondean', async () => {
    const c = crearCliente();
    expect(c.getQueryDefaults(['panel', 'citas', 'x']).refetchInterval).toBe(15_000);
    const cache = c.getQueryCache();
    const intervalo = (clave: string[], staleTime?: number) => {
      const q = cache.build(c, { queryKey: clave, queryFn: async () => 1, staleTime } as { queryKey: string[] });
      const f = c.getDefaultOptions().queries!.refetchInterval as (q: unknown) => number | false;
      return f(q);
    };
    expect(intervalo(['panel', 'pacientes'])).toBe(30_000);
    expect(intervalo(['publico', 'profesionales'], 60_000)).toBe(60_000);
    expect(intervalo(['catalogos', 'x'], 10 * 60_000)).toBe(120_000);
    expect(intervalo(['politica', 'vigente'], Infinity)).toBe(false);
  });

  it('tras una accion invalida todo menos lo fijo', async () => {
    const c = crearCliente();
    c.setQueryData(['panel', 'citas'], 1);
    c.getQueryCache().build(c, { queryKey: ['fija'], staleTime: Infinity } as { queryKey: string[] });
    c.setQueryData(['fija'], 2);
    await c
      .getMutationCache()
      .build(c, { mutationFn: async () => 'ok' })
      .execute(undefined);
    expect(c.getQueryState(['panel', 'citas'])?.isInvalidated).toBe(true);
    expect(c.getQueryState(['fija'])?.isInvalidated).toBe(false);
  });
});
