import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HORA, nuevoTokenCorreo } from '../auth/tokens-correo';
import { ContextoBd } from '../bd/contexto-bd.service';
import { LlaveroService } from '../crypto/llavero.service';
import { ProveedorCorreo } from './correo';

export type TipoCorreoCuenta = 'INVITACION' | 'RECUPERACION' | 'ACCESO' | 'VERIFICACION_SOLICITUD' | 'VERIFICACION_CORREO' | 'CONSENTIMIENTO';

const TEXTOS: Record<TipoCorreoCuenta, { ruta: string; asunto: string; cuerpo: string }> = {
  INVITACION: {
    ruta: '/cuenta/activar',
    asunto: 'Active su cuenta',
    cuerpo: 'Lo invitamos a activar su cuenta y elegir una contraseña. El enlace es personal y de un solo uso:',
  },
  RECUPERACION: {
    ruta: '/cuenta/recuperar',
    asunto: 'Recuperar contraseña',
    cuerpo: 'Recibimos una solicitud para cambiar su contraseña. Si no fue usted, ignore este correo. Enlace de un solo uso:',
  },
  ACCESO: {
    ruta: '/cuenta/acceso',
    asunto: 'Su enlace de acceso',
    cuerpo: 'Use este enlace de un solo uso para entrar a su cuenta. Si no lo pidió, ignore este correo:',
  },
  VERIFICACION_SOLICITUD: {
    ruta: '/pedir-hora/verificar',
    asunto: 'Confirme su correo para reservar la hora',
    cuerpo: 'Para confirmar la hora que eligió, abra este enlace antes de que venza la reserva temporal:',
  },
  VERIFICACION_CORREO: {
    ruta: '/cuenta/correo',
    asunto: 'Confirme su nuevo correo',
    cuerpo: 'Para usar este correo en su cuenta, confírmelo con este enlace de un solo uso:',
  },
  CONSENTIMIENTO: {
    ruta: '/consentimiento',
    asunto: 'Solicitud de consentimiento',
    cuerpo: 'El centro le solicita revisar y responder un consentimiento. Enlace de un solo uso:',
  },
};

/**
 * Correos de cuenta con enlace de un solo uso (03a): se envian directo al
 * terminar la operacion (no pasan por la cola de notificaciones: el
 * destinatario puede no ser aun paciente ni usuario). 03a-2: si el envio
 * falla, se encola cifrado en correos_cuenta_pendientes y el job
 * reintentar_correos_cuenta (NotificacionesService) reintenta con backoff
 * hasta 5 veces o hasta que vence el enlace; enviado o vencido, se borra.
 * Nunca se loguea el destinatario ni el enlace.
 */
@Injectable()
export class CorreosCuenta {
  private readonly logger = new Logger('CorreosCuenta');

  constructor(
    private readonly correo: ProveedorCorreo,
    private readonly config: ConfigService,
    private readonly bd: ContextoBd,
    private readonly llavero: LlaveroService,
  ) {}

  enlace(tipo: TipoCorreoCuenta, token: string): string {
    return `${this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '')}${TEXTOS[tipo].ruta}?token=${token}`;
  }

  /** `previo`: parrafo propio antes del enlace (p. ej. el aviso de horas disponibles). */
  async enviar(tipo: TipoCorreoCuenta, para: string, token: string, vence: Date, previo?: string): Promise<void> {
    const t = TEXTOS[tipo];
    const centro = await this.nombreCentro();
    const vencimiento = vence.toLocaleString('es-CL', { timeZone: 'America/Santiago', dateStyle: 'long', timeStyle: 'short' });
    const asunto = `${t.asunto} - ${centro}`;
    const texto = `${previo ? `${previo}\n\n` : ''}${t.cuerpo}\n\n${this.enlace(tipo, token)}\n\nVence: ${vencimiento}. No comparta este enlace.\n\n${centro}`;
    try {
      await this.correo.enviar({ para, remitente: centro, asunto, texto });
    } catch {
      this.logger.warn(`No se pudo enviar el correo ${tipo}: queda para reintento`);
      await this.encolarReintento(para, asunto, texto, vence).catch(() => this.logger.error(`No se pudo encolar el reintento del correo ${tipo}`));
    }
  }

  private async encolarReintento(para: string, asunto: string, texto: string, vence: Date) {
    const id = randomUUID();
    const email = this.llavero.cifrarCampo(para, 'correos_cuenta_pendientes', 'email', id);
    const cuerpo = this.llavero.cifrarCampo(texto, 'correos_cuenta_pendientes', 'cuerpo', id);
    await this.bd.sinContexto('job').$executeRaw`SELECT encolar_correo_cuenta(${id}::uuid, ${email}, ${asunto}, ${cuerpo}, ${vence})`;
  }

  /**
   * Enlace de consentimiento por correo (D-3, ADMIN/GESTION): consentimiento
   * de practicante, aviso de cambio de supervisor o consentimiento de
   * atencion (referencia = paciente). Va al paciente o, si es menor, a su
   * adulto responsable. Se envia despues del COMMIT.
   */
  async enlaceConsentimiento(referenciaId: string) {
    const { token, hash } = nuevoTokenCorreo();
    const vence = new Date(Date.now() + 72 * HORA);
    const [{ email }] = await this.bd.tx().$queryRaw<[{ email: string }]>`
      SELECT crear_token_consentimiento(${referenciaId}::uuid, ${hash}, ${vence}) AS email`;
    this.bd.alConfirmar(() => this.enviar('CONSENTIMIENTO', email, token, vence));
    return { referenciaId, venceEn: vence };
  }

  private async nombreCentro(): Promise<string> {
    const [f] = await this.bd.sinContexto('publico').$queryRaw<[{ c: { nombre_centro: string } }]>`SELECT contenido_publico_centro() AS c`;
    return f?.c.nombre_centro ?? 'Centro';
  }
}
