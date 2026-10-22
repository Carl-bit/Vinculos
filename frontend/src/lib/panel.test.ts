import { describe, expect, it } from 'vitest';

import { mesChile } from './panel';

describe('mesChile (vista mensual, 03b-4.1)', () => {
  it('semanas completas de lunes a domingo que cubren el mes', () => {
    // Febrero 2028 (bisiesto): empieza martes y termina martes 29.
    const m = mesChile(0, '2028-02-10');
    expect(m.primero).toBe('2028-02-01');
    expect(m.dias[0]).toBe('2028-01-31');
    expect(m.dias.at(-1)).toBe('2028-03-05');
    expect(m.dias.length % 7).toBe(0);
    expect(m.dias).toContain('2028-02-29');
  });

  it('desplaza por meses (incluso cruzando el año)', () => {
    expect(mesChile(1, '2026-12-15').primero).toBe('2027-01-01');
    expect(mesChile(-1, '2026-01-15').primero).toBe('2025-12-01');
  });
});
