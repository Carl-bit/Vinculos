import { Module } from '@nestjs/common';

import { PerfilesController } from './perfiles.controller';
import { PerfilesService } from './perfiles.service';

import { AuditoriaService } from './auditoria.service';
import { CentroService } from './centro.service';
import { DerechosService } from './derechos.service';
import { ExportacionCentroService } from './exportacion-centro.service';
import { ExportacionesService } from './exportaciones.service';
import { FeriadosService } from './feriados.service';
import { RecordatoriosPersonalesService } from './recordatorios-personales.service';
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
  FeriadosController,
  RecordatoriosController,
  PracticantesController,
  SoporteController,
  UsuariosController,
} from './nucleo.controller';
import { AdminInicialService } from './admin-inicial.service';
import { ConfigInternaService } from './config-interna.service';
import { ExportacionesInternasController } from './exportaciones-internas.controller';
import { NotasVersionController, NotasVersionInternaController } from './notas-version.controller';
import { SalidaInternaController } from './salida-interna.controller';
import {
  AdminInicialInternoController,
  ConfigInternaController,
  SolicitudesInternasController,
  SolicitudesModuloController,
} from './solicitudes-modulo.controller';
import { SolicitudesModuloService } from './solicitudes-modulo.service';
import { SoporteService } from './soporte.service';
import { UsuariosService } from './usuarios.service';

/** Nucleo (02b): usuarios, configuracion, accesos de practicantes, bajas, alertas y directorio. */
@Module({
  controllers: [
    // Antes de ConfiguracionController: ruta fija configuracion/solicitudes-modulo (tarea 31).
    SolicitudesModuloController,
    SolicitudesInternasController,
    AdminInicialInternoController,
    ConfigInternaController,
    ExportacionesInternasController,
    SalidaInternaController,
    NotasVersionInternaController,
    // Antes de ConfiguracionController: ruta fija configuracion/notas-version (R6).
    NotasVersionController,
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
    FeriadosController,
    RecordatoriosController,
    DirectorioController,
    PerfilesController,
  ],
  providers: [
    UsuariosService,
    EquipoAccesoService,
    CentroService,
    AuditoriaService,
    SoporteService,
    DerechosService,
    ExportacionesService,
    ExportacionCentroService,
    FeriadosService,
    RecordatoriosPersonalesService,
    PerfilesService,
    SolicitudesModuloService,
    AdminInicialService,
    ConfigInternaService,
  ],
})
export class NucleoModule {}
