import { describe, expect, it } from 'vitest';

import { cuentaRegresiva } from './AvisoInactividad';

describe('cuentaRegresiva (punto 17)', () => {
  it('minutos y segundos', () => expect(cuentaRegresiva(65_000)).toBe('1:05'));
  it('redondea hacia arriba el segundo en curso', () => expect(cuentaRegresiva(1_200)).toBe('0:02'));
  it('nunca negativo', () => expect(cuentaRegresiva(-500)).toBe('0:00'));
});
