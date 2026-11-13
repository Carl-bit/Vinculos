import { createServer, type Server, type Socket } from 'node:net';

import { ProveedorCorreoSmtp, TIEMPOS_SMTP } from './correo';

/**
 * AUD-02 (EXT-01): un servidor SMTP que acepta la conexion y nunca saluda.
 * El envio debe fallar al vencer greetingTimeout, no quedar colgado minutos.
 */
describe('ProveedorCorreoSmtp con proveedor que no responde', () => {
  let servidor: Server;
  const sockets: Socket[] = [];
  let puerto = 0;

  beforeAll(async () => {
    servidor = createServer((s) => sockets.push(s));
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    puerto = (servidor.address() as { port: number }).port;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.destroy());
    await new Promise((listo) => servidor.close(listo));
  });

  it('falla dentro del tiempo maximo de saludo', async () => {
    const proveedor = new ProveedorCorreoSmtp(`smtp://127.0.0.1:${puerto}`, 'no-responder@vinculos.cl');
    const inicio = Date.now();
    await expect(proveedor.enviar({ para: 'p@x.cl', asunto: 'A', texto: 'T' })).rejects.toThrow();
    const ms = Date.now() - inicio;
    expect(ms).toBeGreaterThanOrEqual(TIEMPOS_SMTP.greetingTimeout - 500);
    expect(ms).toBeLessThan(TIEMPOS_SMTP.greetingTimeout + 3_000);
  }, 15_000);
});
