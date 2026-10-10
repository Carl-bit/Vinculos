import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma base del silo (sin extension de cifrado). Una instancia = una
 * DB = un cliente.
 *
 * Se conecta como `app_user` (DATABASE_URL): sin superusuario, sin BYPASSRLS,
 * no dueño de tablas; la RLS aplica siempre. Los modulos NO lo usan: usan
 * ContextoBd (core/bd), que agrega el cifrado y abre la transaccion con
 * contexto RLS por request. Este cliente solo lo usan directamente el
 * CryptoModule (llaves_vigentes, registrar_evento_llaves) y ContextoBd.
 *
 * Los avisos de Prisma van al logger de Nest (nunca console). Los errores de
 * consulta no se loguean aqui: los traduce el filtro global sin filtrar
 * valores.
 */
@Injectable()
export class PrismaService extends PrismaClient<{ log: [{ emit: 'event'; level: 'warn' }] }> implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [{ emit: 'event', level: 'warn' }] });
    this.$on('warn', (e) => this.logger.warn(e.message));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conectado a la base de datos del silo');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
