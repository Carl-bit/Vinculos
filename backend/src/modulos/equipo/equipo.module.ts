import { Module } from '@nestjs/common';

import { PerfilesController, SupervisionController, TiposAtencionController, TrayectoriaController } from './equipo.controller';
import { EquipoService } from './equipo.service';
import { SupervisionService } from './supervision.service';

/** Equipo (02e): perfil, trayectoria, datos privados, tarifas, tipos de atencion y supervision. */
@Module({
  controllers: [PerfilesController, TrayectoriaController, TiposAtencionController, SupervisionController],
  providers: [EquipoService, SupervisionService],
})
export class EquipoModule {}
