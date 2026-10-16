import { Module } from '@nestjs/common';

import { EpicrisisController, MatchConfigController, MensajesController, PortalController, PublicoController, ResenasController } from './match.controller';
import { MatchConfigService } from './match-config.service';
import { ResenasService } from './resenas.service';
import { SolicitudesService } from './solicitudes.service';
import { MatchService } from './match.service';
import { PortalService } from './portal.service';

/**
 * Match terapeutico y portal (02g; 03a: match configurable, solicitud de hora
 * sin cuenta, reseñas, adulto responsable). Depende de Equipo y Agenda solo a traves
 * de funciones de la BD (perfiles_publicos, disponibilidad_publica), no de
 * sus servicios.
 */
@Module({
  controllers: [PublicoController, PortalController, MensajesController, EpicrisisController, ResenasController, MatchConfigController],
  providers: [MatchService, PortalService, SolicitudesService, ResenasService, MatchConfigService],
})
export class MatchModule {}
