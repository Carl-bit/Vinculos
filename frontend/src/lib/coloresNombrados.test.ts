import { describe, expect, it } from 'vitest';

import { buscarColores, COLORES_NOMBRADOS, nombreDeColor, tonoLegible } from './coloresNombrados';
import { fondoValido, principalValido } from './marca';

describe('colores con nombre', () => {
  it('reconoce primarios, secundarios y nombres de objetos, sin tildes ni mayusculas', () => {
    for (const q of [
      'rojo',
      'amarillo',
      'vainilla',
      'terracota',
      'naranja',
      'celeste',
      'lila',
      'rosa',
      'cafe',
      'gris',
      'oliva',
      'marfil',
      'durazno',
      'frutilla',
      'mostaza',
    ]) {
      expect(buscarColores(q).length, q).toBeGreaterThan(0);
    }
    expect(buscarColores('CAFÉ').map((c) => c.nombre)).toContain('Chocolate');
    expect(buscarColores('vaini')[0]?.nombre).toBe('Vainilla');
    expect(buscarColores('amarillo')[0]?.nombre).toBe('Amarillo');
    expect(buscarColores('r')).toEqual([]);
    expect(buscarColores('#8A')).toEqual([]);
    expect(nombreDeColor('#4f6b2f')).toBe('Verde oliva');
  });

  it('todo tono del catalogo sirve en ambos campos: tal cual o ajustado al contraste de la BD', () => {
    for (const c of COLORES_NOMBRADOS) {
      const p = tonoLegible(c.hex, 'principal');
      const f = tonoLegible(c.hex, 'fondo');
      expect(principalValido(p.hex), `${c.nombre} principal`).toBe(true);
      expect(fondoValido(f.hex), `${c.nombre} fondo`).toBe(true);
    }
    expect(tonoLegible('#4F6B2F', 'principal')).toEqual({ hex: '#4F6B2F', ajustado: false, cuanto: 0 });
    expect(tonoLegible('#F2C500', 'principal').ajustado).toBe(true);
  });

  it('sin codigos repetidos', () => {
    expect(new Set(COLORES_NOMBRADOS.map((c) => c.hex)).size).toBe(COLORES_NOMBRADOS.length);
  });
});
