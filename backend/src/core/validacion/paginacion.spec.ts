import 'reflect-metadata';

import { argumentosPagina, pagina } from './paginacion';

const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

describe('paginacion', () => {
  it('pide una fila de mas y salta el cursor', () => {
    expect(argumentosPagina({})).toEqual({ take: 51 });
    expect(argumentosPagina({ limite: 10, cursor: 'c' })).toEqual({ take: 11, cursor: { id: 'c' }, skip: 1 });
  });

  it('con fila de mas: corta y el cursor es la ultima entregada', () => {
    expect(pagina(filas(11), { limite: 10 })).toEqual({ items: filas(10), siguienteCursor: 'id-9' });
  });

  it('sin fila de mas: ultima pagina', () => {
    expect(pagina(filas(10), { limite: 10 })).toEqual({ items: filas(10), siguienteCursor: null });
    expect(pagina([], {})).toEqual({ items: [], siguienteCursor: null });
  });
});
