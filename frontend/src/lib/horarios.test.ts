import { describe, expect, it } from 'vitest';

import { bloquesDeSesion, esManana, porDia, restante } from './horarios';

// 2026-10-19 es lunes; Chile en horario de verano (UTC-3).
const h = (inicio: string, fin: string, modalidad: 'PRESENCIAL' | 'ONLINE' = 'PRESENCIAL') => ({ modalidad, inicio, fin });

describe('bloquesDeSesion', () => {
  it('ofrece bloques de 50 min a hora en punto que caben completos en el hueco', () => {
    const b = bloquesDeSesion([h('2026-10-19T12:20:00Z', '2026-10-19T15:00:00Z')], new Date('2026-10-01T00:00:00Z'));
    expect(b.map((x) => x.inicio.toISOString())).toEqual(['2026-10-19T13:00:00.000Z', '2026-10-19T14:00:00.000Z']);
    expect(b[0]!.fin.toISOString()).toBe('2026-10-19T13:50:00.000Z');
  });

  it('no ofrece horas pasadas ni bloques que no caben', () => {
    const ahora = new Date('2026-10-19T13:10:00Z');
    expect(bloquesDeSesion([h('2026-10-19T12:00:00Z', '2026-10-19T14:40:00Z')], ahora)).toEqual([]);
  });

  it('mezcla modalidades en orden por hora y agrupa por dia de Chile', () => {
    const b = bloquesDeSesion(
      [h('2026-10-20T12:00:00Z', '2026-10-20T13:00:00Z', 'ONLINE'), h('2026-10-19T23:00:00Z', '2026-10-20T00:00:00Z')],
      new Date('2026-10-01T00:00:00Z'),
    );
    expect(b.map((x) => x.modalidad)).toEqual(['PRESENCIAL', 'ONLINE']);
    // 2026-10-20 00:00 UTC = 19-10 21:00 en Chile.
    expect([...porDia(b).keys()]).toEqual(['2026-10-19', '2026-10-20']);
    expect(esManana(b[1]!)).toBe(true);
    expect(esManana(b[0]!)).toBe(false);
  });
});

describe('restante', () => {
  it('formatea mm:ss y no baja de cero', () => {
    const fin = new Date('2026-10-19T13:30:00Z');
    expect(restante(fin, new Date('2026-10-19T13:00:00Z')).texto).toBe('30:00');
    expect(restante(fin, new Date('2026-10-19T13:29:01Z')).texto).toBe('0:59');
    expect(restante(fin, new Date('2026-10-19T14:00:00Z'))).toEqual({ ms: 0, texto: '0:00' });
  });
});
