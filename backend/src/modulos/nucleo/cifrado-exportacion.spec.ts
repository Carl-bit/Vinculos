import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { llaveParaCifrar, llaveParaDescifrar, publicaDesdeClave } from './cifrado-exportacion';

describe('cifrado de la exportacion del centro v2 (AUD-02)', () => {
  const sal = randomBytes(16);
  const publica = publicaDesdeClave('una clave larga de prueba', sal);

  it('la publica cifra y solo la clave abre', () => {
    const { llave, efimera } = llaveParaCifrar(publica);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', llave, iv);
    const cuerpo = Buffer.concat([c.update('datos del centro'), c.final()]);
    const tag = c.getAuthTag();

    const d = createDecipheriv('aes-256-gcm', llaveParaDescifrar('una clave larga de prueba', sal, efimera), iv);
    d.setAuthTag(tag);
    expect(Buffer.concat([d.update(cuerpo), d.final()]).toString()).toBe('datos del centro');

    const mala = createDecipheriv('aes-256-gcm', llaveParaDescifrar('otra clave larga distinta', sal, efimera), iv);
    mala.setAuthTag(tag);
    expect(() => Buffer.concat([mala.update(cuerpo), mala.final()])).toThrow();
  });

  it('cada archivo usa una llave distinta (par efimero) y la publica es estable', () => {
    expect(publicaDesdeClave('una clave larga de prueba', sal).equals(publica)).toBe(true);
    expect(publica).toHaveLength(32);
    expect(llaveParaCifrar(publica).llave.equals(llaveParaCifrar(publica).llave)).toBe(false);
  });
});
