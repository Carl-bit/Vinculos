import { Module } from '@nestjs/common';

import { EpicrisisController, MensajesController, PortalController, PublicoController } from './match.controller';
import { MatchService } from './match.service';
import { PortalService } from './portal.service';

/**
 * Match terapeutico y portal (02g). Depende de Equipo y Agenda solo a traves
 * de funciones de la BD (perfiles_publicos, disponibilidad_publica), no de
 * sus servicios.
 */
@Module({
  controllers: [PublicoController, PortalController, MensajesController, EpicrisisController],
  providers: [MatchService, PortalService],
})
export class MatchModule {}
