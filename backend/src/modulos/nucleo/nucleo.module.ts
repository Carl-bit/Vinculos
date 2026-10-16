import { Module } from '@nestjs/common';

import { CentroService } from './centro.service';
import { EquipoAccesoService } from './equipo-acceso.service';
import {
  AlertasController,
  BajasController,
  CentroController,
  ConfiguracionController,
  DirectorioController,
  PracticantesController,
  UsuariosController,
} from './nucleo.controller';
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
    DirectorioController,
  ],
  providers: [UsuariosService, EquipoAccesoService, CentroService],
})
export class NucleoModule {}
