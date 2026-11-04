import { describe, expect, it } from 'vitest';

import { carriles, estadoVisual, horaInicioCentro, posicion, tramosLibres } from './grillaAgenda';

describe('grilla de la agenda', () => {
  it('tramosLibres: corta el rango bajo las sesiones y descarta el descanso entre ellas', () => {
    const r = (desde: string, hasta: string) => ({ inicio: `2026-11-03T${desde}:00.000Z`, fin: `2026-11-03T${hasta}:00.000Z` });
    expect(tramosLibres(r('12:00', '16:00'), [])).toEqual([r('12:00', '16:00')]);
    // Sesiones seguidas: los 10 minutos entre ellas no quedan como tramo.
    expect(tramosLibres(r('12:00', '16:00'), [r('13:00', '13:50'), r('12:00', '12:50')])).toEqual([r('13:50', '16:00')]);
    // Una sesion que se sale del rango y una ajena al rango.
    expect(tramosLibres(r('12:00', '14:00'), [r('11:30', '12:30'), r('15:00', '15:50')])).toEqual([r('12:30', '14:00')]);
    expect(tramosLibres(r('12:00', '13:00'), [r('12:00', '13:00')])).toEqual([]);
  });

  it('posicion en % del rango 08:00-24:00 por hora de inicio (Chile) y duracion', () => {
    // 10:30 a 11:20 en Chile (UTC-3 en noviembre): 2,5 h y 50 min de 16 h.
    const p = posicion('2026-11-03T13:30:00Z', '2026-11-03T14:20:00Z');
    expect(p.top).toBeCloseTo((150 / 960) * 100);
    expect(p.alto).toBeCloseTo((50 / 960) * 100);
    // Lo que empieza antes de la apertura se recorta al borde: 07:30-08:30 deja 30 min visibles.
    expect(posicion('2026-11-03T10:30:00Z', '2026-11-03T11:30:00Z')).toEqual({ top: 0, alto: (30 / 960) * 100 });
    // Otra apertura del centro (09:00): rango de 15 h.
    expect(posicion('2026-11-03T13:30:00Z', '2026-11-03T14:20:00Z', 9).top).toBeCloseTo((90 / 900) * 100);
  });

  it('primera hora: la apertura mas temprana del centro, o las 08:00 sin horario', () => {
    expect(horaInicioCentro(undefined)).toBe(8);
    expect(horaInicioCentro([{ inicioMin: 9 * 60 + 30 }, { inicioMin: 7 * 60 }])).toBe(7);
  });

  it('carriles: solo las que se pisan comparten ancho', () => {
    const a = { inicio: '2026-11-03T13:00:00Z', fin: '2026-11-03T14:00:00Z' };
    const b = { inicio: '2026-11-03T13:30:00Z', fin: '2026-11-03T14:30:00Z' };
    const c = { inicio: '2026-11-03T15:00:00Z', fin: '2026-11-03T16:00:00Z' };
    const r = carriles([c, b, a]);
    expect(r.get(a)).toEqual({ carril: 0, total: 2 });
    expect(r.get(b)).toEqual({ carril: 1, total: 2 });
    expect(r.get(c)).toEqual({ carril: 0, total: 1 });
  });

  it('estado visual con simbolo: confirmada, pago, atendida, sin evolucion, no asistio, por reprogramar', () => {
    const ahora = Date.parse('2026-11-03T12:00:00Z');
    const futura = { fin: '2026-11-04T12:00:00Z' };
    const pasada = { fin: '2026-11-02T12:00:00Z' };
    expect(estadoVisual({ ...futura, estado: 'CONFIRMADA' }, { ahora })).toBe('confirmada');
    expect(estadoVisual({ ...futura, estado: 'PENDIENTE_PAGO' }, { ahora })).toBe('pendiente_pago');
    expect(estadoVisual({ ...pasada, estado: 'CONFIRMADA' }, { ahora, conEvolucion: true })).toBe('atendida');
    expect(estadoVisual({ ...pasada, estado: 'CONFIRMADA' }, { ahora, conEvolucion: false })).toBe('sin_evolucion');
    expect(estadoVisual({ ...pasada, estado: 'CONFIRMADA' }, { ahora, conEvolucion: false, inasistencia: true })).toBe('no_asistio');
    expect(estadoVisual({ ...pasada, estado: 'CONFIRMADA' }, { ahora })).toBe('realizada');
    expect(estadoVisual({ ...futura, estado: 'POR_REPROGRAMAR' }, { ahora })).toBe('por_reprogramar');
    expect(estadoVisual({ ...futura, estado: 'CANCELADA' }, { ahora })).toBeNull();
  });
});
