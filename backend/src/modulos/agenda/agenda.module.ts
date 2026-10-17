import { Module } from '@nestjs/common';

import {
  AgendaProfesionalController,
  CalendarioPublicoController,
  CitasController,
  EspaciosController,
  HorariosTomadosController,
  IntegracionesAgendaController,
  ListaEsperaController,
  ListaEsperaPublicaController,
  RecordatoriosPublicoController,
} from './agenda.controller';
import { ListaEsperaPublicaService } from './lista-espera-publica.service';
import { ListaEsperaService } from './lista-espera.service';
import { AgendaService } from './agenda.service';
import { IntegracionesAgendaService } from './integraciones-agenda.service';
import { CitasService } from './citas.service';
import { RecordatoriosService } from './recordatorios.service';

/**
 * Agenda y Espacios (02d; recordatorios con token 02i). Depende solo del Nucleo (core): la videollamada y el
 * calendario son interfaces de core (la implementacion la elige CoreModule).
 * Emite eventos de citas.
 */
@Module({
  controllers: [
    EspaciosController,
    AgendaProfesionalController,
    HorariosTomadosController,
    CitasController,
    IntegracionesAgendaController,
    CalendarioPublicoController,
    RecordatoriosPublicoController,
    ListaEsperaController,
    ListaEsperaPublicaController,
  ],
  providers: [AgendaService, CitasService, IntegracionesAgendaService, RecordatoriosService, ListaEsperaService, ListaEsperaPublicaService],
})
export class AgendaModule {}
