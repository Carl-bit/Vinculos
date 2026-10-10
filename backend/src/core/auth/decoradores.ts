import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Rol } from '@prisma/client';

import type { UsuarioActual } from '../bd/contexto-bd.service';

export const CLAVE_PUBLICO = 'auth.publico';
export const CLAVE_ROLES = 'auth.roles';

/** Ruta sin autenticacion (login, portal publico, salud). Sin transaccion RLS. */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/**
 * Roles permitidos segun docs/seguridad/matriz_permisos.md. Obligatorio en
 * toda ruta no publica: sin @Roles el RolesGuard rechaza (falla cerrado). La
 * BD aplica igual su RLS: este guard es la primera capa, no la unica.
 */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/** Usuario del JWT (id, rol). */
export const Actor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioActual => ctx.switchToHttp().getRequest<{ user: UsuarioActual }>().user,
);
