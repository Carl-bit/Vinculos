import { base32, codigoTotp, desdeBase32, verificarTotp } from './totp';

describe('TOTP (RFC 6238)', () => {
  // Vector del RFC 6238 (SHA1): secreto ASCII "12345678901234567890".
  const secreto = base32(Buffer.from('12345678901234567890'));

  it('reproduce los vectores del RFC (6 ultimos digitos)', () => {
    expect(codigoTotp(secreto, 59_000)).toBe('287082');
    expect(codigoTotp(secreto, 1_111_111_109_000)).toBe('081804');
    expect(codigoTotp(secreto, 2_000_000_000_000)).toBe('279037');
  });

  it('acepta un paso de deriva y rechaza codigos lejanos o mal formados', () => {
    const t = 1_111_111_109_000;
    expect(verificarTotp(secreto, codigoTotp(secreto, t - 30_000), t)).toBe(true);
    expect(verificarTotp(secreto, codigoTotp(secreto, t + 30_000), t)).toBe(true);
    expect(verificarTotp(secreto, codigoTotp(secreto, t + 90_000), t)).toBe(false);
    expect(verificarTotp(secreto, '12345', t)).toBe(false);
  });

  it('base32 ida y vuelta', () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(desdeBase32(base32(b))).toEqual(b);
  });
});
