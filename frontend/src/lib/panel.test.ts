import { describe, expect, it } from 'vitest';

import { ApiError } from './api/errores';
import { intervaloSondeo, mesChile } from './panel';

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

describe('intervaloSondeo (calendario, estandar_polling.md regla 3)', () => {
  it('sin error: 2 minutos', () => {
    expect(intervaloSondeo(null, 0)).toBe(120_000);
  });

  it('429, 5xx o sin red: duplica por error hasta 5 minutos', () => {
    expect(intervaloSondeo(new ApiError(503), 1)).toBe(240_000);
    expect(intervaloSondeo(new ApiError(429), 2)).toBe(300_000);
    expect(intervaloSondeo(new TypeError('Failed to fetch'), 1)).toBe(240_000);
  });

  it('401, 403 o 404: detiene el sondeo', () => {
    for (const status of [401, 403, 404]) expect(intervaloSondeo(new ApiError(status), 1)).toBe(false);
  });
});
