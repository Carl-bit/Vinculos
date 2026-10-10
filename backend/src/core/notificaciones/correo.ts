import { Injectable, Logger } from '@nestjs/common';

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
}

/**
 * Envio de correo. La API solo conoce esta interfaz; el proveedor real (SMTP,
 * SES...) se conecta al contratarlo (SMTP_URL). Los correos no llevan datos
 * clinicos: avisan y remiten al portal (salvo el enlace de videollamada).
 */
export abstract class ProveedorCorreo {
  abstract enviar(correo: Correo): Promise<void>;
}

/** Implementacion simulada: guarda en memoria (tests) y loguea solo el asunto. */
@Injectable()
export class ProveedorCorreoSimulado extends ProveedorCorreo {
  private readonly logger = new Logger('CorreoSimulado');
  readonly enviados: Correo[] = [];

  async enviar(correo: Correo): Promise<void> {
    this.enviados.push(correo);
    this.logger.log(`correo simulado: ${correo.asunto}`);
  }
}
