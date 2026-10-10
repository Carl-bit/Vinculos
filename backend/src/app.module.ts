import { DynamicModule, Module } from '@nestjs/common';

import { CoreModule, type OpcionesCore } from './core/core.module';
import { AgendaModule } from './modulos/agenda/agenda.module';
import { DerivacionesModule } from './modulos/derivaciones/derivaciones.module';
import { EquipoModule } from './modulos/equipo/equipo.module';
import { FichasModule } from './modulos/fichas/fichas.module';
import { MatchModule } from './modulos/match/match.module';
import { NucleoModule } from './modulos/nucleo/nucleo.module';

/**
 * Raiz del monolito modular.
 *
 * Reglas al agregar un modulo aqui (ver CLAUDE.md):
 * - Un modulo NUNCA importa el service de otro modulo. El cruce se hace con
 *   eventos de dominio (EventEmitterModule, global; contratos en
 *   core/eventos) o pasando por el nucleo (core).
 * - Orden de dependencia = orden de sprints:
 *     1. Nucleo (usuarios, roles, RLS)
 *     2. Fichas y Pacientes | Agenda y Espacios | Equipo | Derivaciones
 *     3. Match Terapeutico  (depende de Equipo)
 *     4. Cobros             (depende de Agenda y Espacios)
 */
export const MODULOS: DynamicModule['imports'] = [NucleoModule, FichasModule, AgendaModule, EquipoModule, DerivacionesModule, MatchModule];

@Module({})
export class AppModule {
  /** main.ts y los tests de integracion arman la app con este metodo. */
  static crear(opciones: OpcionesCore = {}): DynamicModule {
    return { module: AppModule, imports: [CoreModule.forRoot(opciones), ...(MODULOS ?? [])] };
  }
}
