import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Rol } from '@prisma/client';

import type { UsuarioActual } from '../bd/contexto-bd.service';
import { CLAVE_PUBLICO, CLAVE_ROLES } from './decoradores';

interface Solicitud {
  headers: Record<string, string | string[] | undefined>;
  user?: UsuarioActual;
}

const ROLES = new Set<string>(Object.values(Rol));

/** Global: exige Bearer JWT valido salvo en rutas @Publico. */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [context.getHandler(), context.getClass()])) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Solicitud>();
    const cabecera = req.headers.authorization;
    const token = typeof cabecera === 'string' && cabecera.startsWith('Bearer ') ? cabecera.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }
    try {
      const carga = await this.jwt.verifyAsync<{ sub: string; rol: string; tipo: string }>(token, { algorithms: ['HS256'] });
      if (carga.tipo !== 'acceso' || !ROLES.has(carga.rol)) {
        throw new Error('token no es de acceso');
      }
      req.user = { id: carga.sub, rol: carga.rol as Rol };
    } catch {
      throw new UnauthorizedException('Token de acceso invalido o vencido');
    }
    return true;
  }
}

/** Global: rol del JWT dentro de @Roles(...). Ruta sin @Roles = denegada. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const objetivos = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, objetivos)) {
      return true;
    }
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(CLAVE_ROLES, objetivos);
    const usuario = context.switchToHttp().getRequest<Solicitud>().user;
    if (!roles || !usuario || !roles.includes(usuario.rol)) {
      throw new ForbiddenException('El rol no tiene permiso para esta accion');
    }
    return true;
  }
}
