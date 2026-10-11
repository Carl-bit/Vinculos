import { Module } from '@nestjs/common';

import { CatalogosRetencionService } from './catalogos-retencion.service';
import { EvolucionesService } from './evoluciones.service';
import { DocumentosService } from './documentos.service';
import {
  CatalogosClinicosController,
  DocumentosController,
  EvolucionesController,
  PacientesController,
  RetencionController,
  TiposDocumentoController,
} from './fichas.controller';
import { PacientesService } from './pacientes.service';

/** Fichas y Pacientes (02c; documentos clinicos 02h). Depende solo del Nucleo (core). */
@Module({
  controllers: [PacientesController, EvolucionesController, CatalogosClinicosController, RetencionController, TiposDocumentoController, DocumentosController],
  providers: [PacientesService, EvolucionesService, CatalogosRetencionService, DocumentosService],
})
export class FichasModule {}
