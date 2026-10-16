import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuloCentro } from '@prisma/client';

import { ContextoBd } from '../bd/contexto-bd.service';

export const CLAVE_MODULO = 'centro.modulo';

/** Modulo contratado del que depende la ruta (03a). El Nucleo no lleva marca: siempre activo. */
export const Modulo = (modulo: ModuloCentro) => SetMetadata(CLAVE_MODULO, modulo);

const CACHE_MS = 30_000;

/**
 * Global (despues de JwtGuard y RolesGuard): una ruta de un modulo no
 * contratado responde 403. Los modulos los cambia el operador (sin GRANT a
 * la API); se leen con modulos_activos() y se guardan 30 s en memoria.
 */
@Injectable()
export class ModulosGuard implements CanActivate {
  private cache: { valor: ModuloCentro[]; hasta: number } | undefined;

  constructor(
    private readonly reflector: Reflector,
    private readonly bd: ContextoBd,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const modulo = this.reflector.getAllAndOverride<ModuloCentro | undefined>(CLAVE_MODULO, [context.getHandler(), context.getClass()]);
    if (!modulo || (await this.activos()).includes(modulo)) {
      return true;
    }
    throw new ForbiddenException({ message: `El modulo ${modulo} no esta contratado por el centro`, restriccion: 'modulo_inactivo' });
  }

  async activos(): Promise<ModuloCentro[]> {
    if (!this.cache || this.cache.hasta < Date.now()) {
      const [{ m }] = await this.bd.sinContexto('publico').$queryRaw<[{ m: ModuloCentro[] }]>`SELECT modulos_activos()::text[] AS m`;
      this.cache = { valor: m, hasta: Date.now() + CACHE_MS };
    }
    return this.cache.valor;
  }

  /** Tests y operador: olvidar la cache tras cambiar los modulos. */
  olvidar(): void {
    this.cache = undefined;
  }
}
