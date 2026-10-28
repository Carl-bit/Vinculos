import { Module } from '@nestjs/common';

import { AuditoriaService } from './auditoria.service';
import { CentroService } from './centro.service';
import { DerechosService } from './derechos.service';
import { ExportacionesService } from './exportaciones.service';
import { EquipoAccesoService } from './equipo-acceso.service';
import {
  AlertasController,
  AuditoriaController,
  BajasController,
  CentroController,
  ConfiguracionController,
  DerechosController,
  DerechosPublicoController,
  DirectorioController,
  ExportacionPublicaController,
  ExportacionesController,
  PracticantesController,
  SoporteController,
  UsuariosController,
} from './nucleo.controller';
import { SoporteService } from './soporte.service';
import { UsuariosService } from './usuarios.service';

/** Nucleo (02b): usuarios, configuracion, accesos de practicantes, bajas, alertas y directorio. */
@Module({
  controllers: [
    UsuariosController,
    ConfiguracionController,
    CentroController,
    PracticantesController,
    BajasController,
    AlertasController,
    AuditoriaController,
    SoporteController,
    DerechosController,
    DerechosPublicoController,
    ExportacionesController,
    ExportacionPublicaController,
    DirectorioController,
  ],
  providers: [UsuariosService, EquipoAccesoService, CentroService, AuditoriaService, SoporteService, DerechosService, ExportacionesService],
})
export class NucleoModule {}
