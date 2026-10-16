import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';

import { AdjuntosService } from './adjuntos.service';
import { CatalogosRetencionService } from './catalogos-retencion.service';
import { EvolucionesService } from './evoluciones.service';
import { DocumentosService } from './documentos.service';
import {
  AdjuntosFichaController,
  CatalogosClinicosController,
  DocumentosController,
  EvolucionesController,
  IngresosController,
  PacientesController,
  PlantillasClinicasController,
  RetencionController,
  SeguimientoController,
  TiposDocumentoController,
} from './fichas.controller';
import { IngresosService } from './ingresos.service';
import { PlantillasService } from './plantillas.service';
import { SeguimientoService } from './seguimiento.service';
import { PacientesService } from './pacientes.service';

/** Fichas y Pacientes (02c; documentos clinicos 02h; adjuntos 02i; plantillas por especialidad e ingreso 03a-2). Depende solo del Nucleo (core). */
@Module({
  imports: [
    // Multipart en streaming: multer corta la subida al pasar el limite (413), un archivo por request.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: { fileSize: config.getOrThrow<number>('ADJUNTO_MAX_MB') * 1024 * 1024, files: 1, fields: 0 },
      }),
    }),
  ],
  controllers: [
    PacientesController,
    EvolucionesController,
    CatalogosClinicosController,
    RetencionController,
    TiposDocumentoController,
    DocumentosController,
    AdjuntosFichaController,
    SeguimientoController,
    PlantillasClinicasController,
    IngresosController,
  ],
  providers: [
    PacientesService,
    EvolucionesService,
    CatalogosRetencionService,
    DocumentosService,
    AdjuntosService,
    SeguimientoService,
    PlantillasService,
    IngresosService,
  ],
})
export class FichasModule {}
