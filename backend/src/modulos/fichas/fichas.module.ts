import { Module } from '@nestjs/common';

import { CatalogosRetencionService } from './catalogos-retencion.service';
import { EvolucionesService } from './evoluciones.service';
import { CatalogosClinicosController, EvolucionesController, PacientesController, RetencionController } from './fichas.controller';
import { PacientesService } from './pacientes.service';

/** Fichas y Pacientes (02c). Depende solo del Nucleo (core). */
@Module({
  controllers: [PacientesController, EvolucionesController, CatalogosClinicosController, RetencionController],
  providers: [PacientesService, EvolucionesService, CatalogosRetencionService],
})
export class FichasModule {}
