import { Module } from '@nestjs/common';

import { EquipoAccesoService } from './equipo-acceso.service';
import {
  AlertasController,
  BajasController,
  ConfiguracionController,
  DirectorioController,
  PracticantesController,
  UsuariosController,
} from './nucleo.controller';
import { UsuariosService } from './usuarios.service';

/** Nucleo (02b): usuarios, configuracion, accesos de practicantes, bajas, alertas y directorio. */
@Module({
  controllers: [UsuariosController, ConfiguracionController, PracticantesController, BajasController, AlertasController, DirectorioController],
  providers: [UsuariosService, EquipoAccesoService],
})
export class NucleoModule {}
