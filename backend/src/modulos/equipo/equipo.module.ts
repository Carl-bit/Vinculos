import { Module } from '@nestjs/common';

import { PerfilesController, SupervisionController, TiposAtencionController, TrayectoriaController } from './equipo.controller';
import { EquipoService } from './equipo.service';
import { EspecialidadesService } from './especialidades.service';
import { EspecialidadesController, MensajeriaInternaController } from './mensajeria-interna.controller';
import { MensajeriaInternaService } from './mensajeria-interna.service';
import { SupervisionService } from './supervision.service';

/**
 * Equipo (02e): perfil, trayectoria, datos privados, tarifas, tipos de atencion y supervision.
 * 03a-2: especialidades del profesional y mensajeria interna del equipo.
 */
@Module({
  controllers: [
    PerfilesController,
    TrayectoriaController,
    TiposAtencionController,
    SupervisionController,
    EspecialidadesController,
    MensajeriaInternaController,
  ],
  providers: [EquipoService, SupervisionService, EspecialidadesService, MensajeriaInternaService],
})
export class EquipoModule {}
