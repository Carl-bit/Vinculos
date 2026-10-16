import { describe, expect, it } from 'vitest';

import { formatoClp, formatoRut, pareceRut, rutValido } from './formato';

describe('RUT', () => {
  it('valida el digito verificador', () => {
    expect(rutValido('11.111.111-1')).toBe(true);
    expect(rutValido('12.345.678-5')).toBe(true);
    expect(rutValido('12.345.678-9')).toBe(false);
    expect(rutValido('7.775.777-K')).toBe(false);
    expect(rutValido('abc')).toBe(false);
  });

  it('acepta K mayuscula o minuscula', () => {
    expect(rutValido('10.000.013-k')).toBe(rutValido('10.000.013-K'));
  });

  it('formatea y detecta RUT vs correo', () => {
    expect(formatoRut('123456785')).toBe('12.345.678-5');
    expect(pareceRut('12.345.678-5')).toBe(true);
    expect(pareceRut('ana@centro.cl')).toBe(false);
  });
});

describe('CLP', () => {
  it('sin decimales y con separador de miles', () => {
    expect(formatoClp(35000).replace(/\s/g, ' ')).toMatch(/^\$\s?35\.000$/);
  });
});
