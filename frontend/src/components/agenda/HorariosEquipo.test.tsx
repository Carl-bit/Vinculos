import { describe, expect, it } from 'vitest';

import { unirHoras } from './HorariosEquipo';

describe('apartar horas: unirHoras', () => {
  it('horas seguidas de un dia salen como un solo bloque; sin repetidas y en orden', () => {
    expect(unirHoras([14, 10, 11, 9, 11, 16])).toEqual([
      { desde: 9, hasta: 12 },
      { desde: 14, hasta: 15 },
      { desde: 16, hasta: 17 },
    ]);
    expect(unirHoras([])).toEqual([]);
  });
});
