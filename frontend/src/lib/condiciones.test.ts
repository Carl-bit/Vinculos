import { describe, expect, it } from 'vitest';

import { condicionesAgendamiento, edadEn } from './condiciones';

const base = { plazo_aviso_cancelacion_horas: 24 };

describe('condicionesAgendamiento (MVP sin COBROS)', () => {
  it('el aviso para cancelar, sin cargos ni pagos', () => {
    const c = condicionesAgendamiento(base, false);
    expect(c[0]).toContain('hasta 24 horas antes');
    expect(c.join(' ')).not.toMatch(/cobr|pag|cargo|costo/i);
  });

  it('agrega la condicion del menor', () => {
    expect(condicionesAgendamiento(base, true).at(-1)).toMatch(/adulto responsable/);
  });
});

describe('edadEn', () => {
  it('cuenta el cumpleaños en la fecha de Chile', () => {
    // 2026-10-20 02:00 UTC = 19-10 23:00 en Chile: aun no cumple 18.
    expect(edadEn('2008-10-20', new Date('2026-10-20T02:00:00Z'))).toBe(17);
    expect(edadEn('2008-10-20', new Date('2026-10-20T15:00:00Z'))).toBe(18);
  });
});
