import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { HORA, nuevoTokenCorreo } from '../../core/auth/tokens-correo';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';

/** Misma vigencia que la invitacion de equipo (03a). */
const INVITACION_HORAS = 72;

/**
 * R5 (Vinculos Control, paso P9 de aprovisionar): invitacion del ADMIN
 * inicial de un silo nuevo. La regla vive en invitar_admin_inicial() (token
 * del silo, sin contexto de usuario); aqui solo se genera el token del enlace
 * y se envia el correo de invitacion de siempre. Al plano de control vuelve
 * solo si se invito y cuando vence (nunca el enlace).
 */
@Injectable()
export class AdminInicialService {
  constructor(
    private readonly bd: ContextoBd,
    private readonly correos: CorreosCuenta,
  ) {}

  async invitar(tokenInterno: string, email: string, nombre: string): Promise<{ invitada: true; vence: Date }> {
    const { token, hash } = nuevoTokenCorreo();
    const vence = new Date(Date.now() + INVITACION_HORAS * HORA);
    const [fila] = await this.bd.sinContexto('interno').$queryRaw<[{ email: string }]>`
      SELECT email FROM invitar_admin_inicial(${tokenInterno}, ${email}, ${nombre}, ${randomUUID()}::uuid, ${hash}, ${vence})`;
    // Ya confirmado (sin transaccion de request): el enlace solo viaja por correo.
    await this.correos.enviar('INVITACION', fila.email, token, vence);
    return { invitada: true, vence };
  }
}
