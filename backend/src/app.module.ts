import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { PrismaModule } from './core/prisma/prisma.module';

/**
 * Raiz del monolito modular.
 *
 * Reglas al agregar un modulo aqui (ver CLAUDE.md):
 * - Un modulo NUNCA importa el service de otro modulo. El cruce se hace con
 *   eventos de dominio (EventEmitterModule, global) o pasando por el nucleo.
 * - Orden de dependencia = orden de sprints:
 *     1. Nucleo (usuarios, roles, RLS)
 *     2. Fichas y Pacientes | Agenda y Espacios | Equipo
 *     3. Match Terapeutico  (depende de Equipo)
 *     4. Cobros             (depende de Agenda y Espacios)
 *
 * Los imports de los 5 modulos los agrega el prompt 02_apis.md.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    EventEmitterModule.forRoot({ global: true, wildcard: false }),
    PrismaModule,
  ],
})
export class AppModule {}
