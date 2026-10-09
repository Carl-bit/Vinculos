import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma del silo. Una instancia = una DB = un cliente.
 *
 * Se conecta como `app_user` (DATABASE_URL): sin superusuario, sin BYPASSRLS,
 * no dueño de tablas. La RLS aplica siempre (ver migracion
 * 20261006000000_endurecimiento_rls); no hace falta `SET LOCAL ROLE`.
 * El RlsInterceptor (prompt 02a (prompts/00_index.md)) envuelve cada request en
 * `this.$transaction(...)` y al inicio ejecuta
 * `set_config('app.current_usuario_id', id, true)` y
 * `set_config('app.current_rol', rol, true)`. Fuera de esa transaccion las
 * tablas con RLS devuelven 0 filas (falla cerrado).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado a la base de datos del silo');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
