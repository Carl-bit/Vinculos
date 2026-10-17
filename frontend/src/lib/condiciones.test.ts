import { describe, expect, it } from 'vitest';

import { condicionesAgendamiento, edadEn } from './condiciones';

const base = { plazo_aviso_cancelacion_horas: 24, penalizacion_cancelacion_porcentaje: 0, cobro_inasistencia_porcentaje: 0, modelo_cobro: 'CENTRO' as const };

describe('condicionesAgendamiento', () => {
  it('sin porcentajes no promete cobros', () => {
    const c = condicionesAgendamiento(base, false);
    expect(c[0]).toContain('hasta 24 horas antes');
    expect(c.join(' ')).not.toMatch(/se cobra/);
    expect(c.at(-1)).toBe('La sesión se paga al centro.');
  });

  it('con porcentajes los muestra y agrega la condicion del menor', () => {
    const c = condicionesAgendamiento({ ...base, penalizacion_cancelacion_porcentaje: 50, cobro_inasistencia_porcentaje: 100, modelo_cobro: 'DIRECTO' }, true);
    expect(c.join(' ')).toMatch(/se cobra el 50 % del valor/);
    expect(c.join(' ')).toMatch(/no llegas sin avisar, se cobra el 100 %/);
    expect(c).toContain('La sesión se paga directamente al profesional.');
    expect(c.at(-1)).toMatch(/adulto responsable/);
  });
});

describe('edadEn', () => {
  it('cuenta el cumpleaños en la fecha de Chile', () => {
    // 2026-10-20 02:00 UTC = 19-10 23:00 en Chile: aun no cumple 18.
    expect(edadEn('2008-10-20', new Date('2026-10-20T02:00:00Z'))).toBe(17);
    expect(edadEn('2008-10-20', new Date('2026-10-20T15:00:00Z'))).toBe(18);
  });
});
