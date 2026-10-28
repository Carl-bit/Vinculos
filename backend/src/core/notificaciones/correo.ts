import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

export interface Adjunto {
  nombre: string;
  contenido: Buffer;
  tipo: string;
}

export interface Correo {
  para: string;
  asunto: string;
  texto: string;
  /** Nombre visible del remitente (el del centro); la direccion es la de la plataforma. */
  remitente?: string;
  /** AUD-01 (COM-02): Reply-To = correo de contacto del centro (contenido_publico.contacto_correo). */
  responderA?: string | null;
  adjuntos?: Adjunto[];
}

/**
 * Envio de correo (docs/api/integraciones.md). Los modulos solo conocen esta
 * interfaz; CoreModule elige la implementacion por configuracion: SMTP si hay
 * SMTP_URL (sirve con SES u otro servicio), si no la simulada. Los correos no
 * llevan datos clinicos: avisan y remiten al portal, salvo el enlace de
 * videollamada y los documentos clinicos emitidos (unico contenido clinico
 * que sale por correo, por defecto como enlace que expira).
 */
export abstract class ProveedorCorreo {
  abstract enviar(correo: Correo): Promise<void>;
}

/** Implementacion simulada: guarda en memoria (tests) y loguea solo el asunto. */
@Injectable()
export class ProveedorCorreoSimulado extends ProveedorCorreo {
  private readonly logger = new Logger('CorreoSimulado');
  readonly enviados: Correo[] = [];
  /** Tests: simula una caida del proveedor (el envio lanza). */
  fallar = false;

  async enviar(correo: Correo): Promise<void> {
    if (this.fallar) {
      throw new Error('proveedor de correo caido (simulado)');
    }
    this.enviados.push(correo);
    this.logger.log(`correo simulado: ${correo.asunto}`);
  }
}

/**
 * SMTP generico, configurado a nivel de plataforma (SMTP_URL, CORREO_REMITENTE).
 * El remitente visible es el nombre del centro con la direccion de la
 * plataforma; las respuestas van al correo de contacto del centro (Reply-To,
 * docs/api/correo_ses.md). Nunca loguea destinatarios ni contenido.
 */
export class ProveedorCorreoSmtp extends ProveedorCorreo {
  private readonly transporte: Transporter;

  constructor(
    url: string,
    private readonly direccion: string,
    /** Configuration set de SES del silo (docs/api/correo_ses.md); sin el, no va la cabecera. */
    private readonly configuracionSes?: string,
  ) {
    super();
    this.transporte = createTransport(url);
  }

  async enviar(correo: Correo): Promise<void> {
    await this.transporte.sendMail({
      from: { name: correo.remitente ?? 'Vinculos', address: this.direccion },
      ...(correo.responderA ? { replyTo: correo.responderA } : {}),
      ...(this.configuracionSes ? { headers: { 'X-SES-CONFIGURATION-SET': this.configuracionSes } } : {}),
      to: correo.para,
      subject: correo.asunto,
      text: correo.texto,
      attachments: correo.adjuntos?.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })),
    });
  }
}
