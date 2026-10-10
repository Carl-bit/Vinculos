import { Module } from '@nestjs/common';

import { AgendaProfesionalController, CitasController, EspaciosController, HorariosTomadosController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { CitasService } from './citas.service';
import { ProveedorVideollamada, ProveedorVideollamadaSimulado } from './videollamada';

/** Agenda y Espacios (02d). Depende solo del Nucleo (core). Emite eventos de citas. */
@Module({
  controllers: [EspaciosController, AgendaProfesionalController, HorariosTomadosController, CitasController],
  providers: [AgendaService, CitasService, { provide: ProveedorVideollamada, useClass: ProveedorVideollamadaSimulado }],
})
export class AgendaModule {}
