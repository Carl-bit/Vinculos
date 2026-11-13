import { applyDecorators, CanActivate, ExecutionContext, Injectable, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { Publico } from '../auth/decoradores';
import { ContextoBd } from '../bd/contexto-bd.service';

/**
 * /api/internal/* (Vinculos Control, R2 a R5). Lo llama solo el agente del
 * plano de control, dentro de la red de borde del silo (erp-<slug>_borde),
 * con un token por silo. Tres capas:
 *   1. Traefik responde 403 a /api/internal desde el tunel (infra/docker-compose.yml).
 *   2. Este guard: Bearer valido segun interno_token_valido() (la BD guarda
 *      solo el SHA-256, en identidad_silo; sin hash configurado, siempre 401).
 *   3. Cada funcion SECURITY DEFINER vuelve a validar el token y exige que no
 *      haya contexto de usuario.
 * Nunca usa cuentas de usuarios del centro (sesion unica) ni credenciales de
 * dueño. Sin transaccion RLS (ruta @Publico).
 */
@Injectable()
export class InternoGuard implements CanActivate {
  constructor(private readonly bd: ContextoBd) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const token = tokenInterno(context.switchToHttp().getRequest<Request>());
    if (token) {
      const [{ valido }] = await this.bd.sinContexto('interno').$queryRaw<[{ valido: boolean }]>`SELECT interno_token_valido(${token}) AS valido`;
      if (valido) {
        return true;
      }
    }
    throw new UnauthorizedException('Token interno invalido');
  }
}

/** Token del header Authorization (Bearer), o null. */
export function tokenInterno(req: Request): string | null {
  const t = /^Bearer (\S{32,256})$/.exec(req.headers.authorization ?? '')?.[1];
  return t ?? null;
}

/**
 * Controlador interno: sin JWT ni roles (Publico), con InternoGuard, sin el
 * limite publico por IP (el agente es uno y llama cada minuto) y fuera del
 * OpenAPI publico del centro.
 */
export const Interno = () => applyDecorators(Publico(), UseGuards(InternoGuard), SkipThrottle(), ApiBearerAuth('interno'), ApiExcludeController());
