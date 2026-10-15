import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Rol } from '@prisma/client';

import type { UsuarioActual } from '../bd/contexto-bd.service';
import { ErroresAutenticados, ErroresPublicos } from '../docs/openapi';

export const CLAVE_PUBLICO = 'auth.publico';
export const CLAVE_ROLES = 'auth.roles';

/** Ruta sin autenticacion (login, portal publico, salud). Sin transaccion RLS. */
export const Publico = () => applyDecorators(SetMetadata(CLAVE_PUBLICO, true), ErroresPublicos());

/**
 * Roles permitidos segun docs/seguridad/matriz_permisos.md. Obligatorio en
 * toda ruta no publica: sin @Roles el RolesGuard rechaza (falla cerrado). La
 * BD aplica igual su RLS: este guard es la primera capa, no la unica.
 */
export const Roles = (...roles: Rol[]) =>
  applyDecorators(
    SetMetadata(CLAVE_ROLES, roles),
    // OpenAPI: JWT, roles permitidos y errores comunes (core/docs/openapi.ts).
    ApiBearerAuth('jwt'),
    ApiOperation({ description: `Roles: ${roles.join(', ')}` }, { overrideExisting: false }),
    ErroresAutenticados(),
  );

/** Usuario del JWT (id, rol). */
export const Actor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioActual => ctx.switchToHttp().getRequest<{ user: UsuarioActual }>().user,
);
