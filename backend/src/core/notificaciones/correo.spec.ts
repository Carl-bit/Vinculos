import { createTransport } from 'nodemailer';

import { ProveedorCorreoSmtp } from './correo';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

/** AUD-01 (COM-02, LEG-02): Reply-To del centro y configuration set de SES del silo. */
describe('ProveedorCorreoSmtp', () => {
  const sendMail = jest.fn().mockResolvedValue({});
  beforeEach(() => {
    sendMail.mockClear();
    (createTransport as jest.Mock).mockReturnValue({ sendMail });
  });

  it('con Reply-To y configuration set: los envia; el remitente es la plataforma con el nombre del centro', async () => {
    await new ProveedorCorreoSmtp('smtp://x', 'no-responder@vinculos.cl', 'centro-prueba').enviar({
      para: 'p@x.cl',
      asunto: 'A',
      texto: 'T',
      remitente: 'Centro',
      responderA: 'contacto@centro.cl',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'Centro', address: 'no-responder@vinculos.cl' },
        replyTo: 'contacto@centro.cl',
        headers: { 'X-SES-CONFIGURATION-SET': 'centro-prueba' },
      }),
    );
  });

  it('sin Reply-To ni configuration set: no agrega esos campos', async () => {
    await new ProveedorCorreoSmtp('smtp://x', 'no-responder@vinculos.cl').enviar({ para: 'p@x.cl', asunto: 'A', texto: 'T', responderA: null });
    const enviado = sendMail.mock.calls[0][0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty('replyTo');
    expect(enviado).not.toHaveProperty('headers');
  });
});
