import { describe, expect, it } from 'vitest';

import { contraste, cssMarca, fondoValido, principalValido } from './marca';

describe('marca por zona', () => {
  it('contraste WCAG igual que la BD', () => {
    expect(contraste('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contraste('#8A4B1F', '#F5EAD8')).toBeCloseTo(5.68, 2);
  });

  it('principal legible sobre crema y fondo claro', () => {
    expect(principalValido('#8A4B1F')).toBe(true);
    expect(principalValido('#D6A15A')).toBe(false);
    expect(fondoValido('#F1EBE2')).toBe(true);
    expect(fondoValido('#8A4B1F')).toBe(false);
  });

  it('cada zona reemplaza sus tokens y descarta lo invalido', () => {
    expect(cssMarca('panel', '#2F5A7A', '#F1EBE2')).toContain('--color-accent-700:#2F5A7A');
    expect(cssMarca('panel', '#2F5A7A', '#F1EBE2')).toContain('--color-lienzo:#F1EBE2');
    expect(cssMarca('portal', '#2F5A7A', '#FFFDF9')).toContain('--color-accent-2-700:#2F5A7A');
    expect(cssMarca('portal', null, '#FFFDF9')).toContain('--color-lienzo:#FFFDF9');
    expect(cssMarca('publico', '#2F5A7A', null)).toContain('--color-accent-700:#2F5A7A');
    expect(cssMarca('publico', null, '#FFFDF9')).toContain('--color-lienzo:#FFFDF9');
    expect(cssMarca('publico', '#D6A15A', '</style>')).toBe('');
  });
});
