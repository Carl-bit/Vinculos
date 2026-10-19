import { describe, expect, it } from 'vitest';

import { correccionesDe } from '@/lib/fichas';

import { claveDesde } from './EditorPlantilla';

describe('claveDesde', () => {
  it('pasa la etiqueta a una clave valida (minusculas, sin tildes, _)', () => {
    expect(claveDesde('Motivo de consulta')).toBe('motivo_de_consulta');
    expect(claveDesde('¿Ánimo reportado? (1 a 10)')).toBe('animo_reportado_1_a_10');
  });

  it('empieza con letra y no pasa de 40 caracteres', () => {
    expect(claveDesde('2 sesiones')).toBe('campo_2_sesiones');
    expect(claveDesde('x'.repeat(60))).toHaveLength(40);
    expect(claveDesde('')).toBe('campo');
  });
});

describe('correccionesDe', () => {
  it('asocia cada registro corregido con su correccion (append-only)', () => {
    const r = (id: string, createdAt: string, corrigeAId: string | null = null) => ({ id, createdAt, corrigeAId });
    const mapa = correccionesDe([r('a', '2026-01-01'), r('b', '2026-01-02', 'a'), r('c', '2026-01-03', 'b'), r('d', '2026-01-04')]);
    expect(mapa.get('a')?.id).toBe('b');
    expect(mapa.get('b')?.id).toBe('c');
    expect(mapa.has('c')).toBe(false);
    expect(mapa.has('d')).toBe(false);
  });
});
