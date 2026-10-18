import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Roles } from '../../core/auth/decoradores';
import { TAGS } from '../../core/docs/openapi';
import { Modulo } from '../../core/modulos/modulos';
import {
  CrearHiloDto,
  DeclararEspecialidadDto,
  EditarEspecialidadDto,
  EspecialidadDto,
  ListarHilosDto,
  MensajeInternoDto,
  ParticipantesDto,
  RevisarEspecialidadDto,
} from './dto/mensajeria-interna.dto';
import { EspecialidadesService } from './especialidades.service';
import { EspecialidadDeclaradaVista, EspecialidadVista } from './dto/equipo-respuestas.dto';
import { MensajeriaInternaService } from './mensajeria-interna.service';

const Uuid = new ParseUUIDPipe();
const EQUIPO = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'] as const;

/**
 * Mensajeria interna del equipo (03a-2). Nunca PACIENTE ni RESPONSABLE. La
 * visibilidad la decide la BD con el rol activo: GENERAL a sus participantes;
 * CASO a quien tiene acceso clinico vigente (ADMIN/GESTION no).
 */
@ApiTags(TAGS.equipo)
@Controller('hilos')
@Modulo('EQUIPO')
export class MensajeriaInternaController {
  constructor(private readonly mensajeria: MensajeriaInternaService) {}

  @Post()
  @Roles(...EQUIPO)
  crear(@Body() dto: CrearHiloDto) {
    return this.mensajeria.crearHilo(dto);
  }

  /** Lectura por polling; incluye no leidos por hilo. */
  @Get()
  @Roles(...EQUIPO)
  listar(@Query() filtro: ListarHilosDto) {
    return this.mensajeria.hilos(filtro);
  }

  @Get(':id/mensajes')
  @Roles(...EQUIPO)
  mensajes(@Param('id', Uuid) id: string) {
    return this.mensajeria.mensajes(id);
  }

  @Post(':id/mensajes')
  @Roles(...EQUIPO)
  enviar(@Param('id', Uuid) id: string, @Body() dto: MensajeInternoDto) {
    return this.mensajeria.enviar(id, dto.contenido);
  }

  @Post(':id/participantes')
  @HttpCode(200)
  @Roles(...EQUIPO)
  participantes(@Param('id', Uuid) id: string, @Body() dto: ParticipantesDto) {
    return this.mensajeria.agregarParticipantes(id, dto.participantes);
  }

  /** Solo el autor y dentro de 5 minutos. */
  @Post('mensajes/:mensajeId/retiro')
  @HttpCode(200)
  @Roles(...EQUIPO)
  retirar(@Param('mensajeId', Uuid) id: string) {
    return this.mensajeria.retirar(id);
  }
}

/** Especialidades (03a-2): catalogo de ADMIN; el profesional declara y ADMIN aprueba. */
@ApiTags(TAGS.equipo)
@Controller()
@Modulo('EQUIPO')
export class EspecialidadesController {
  constructor(private readonly especialidades: EspecialidadesService) {}

  @Get('especialidades')
  @Roles(...EQUIPO)
  listar(): Promise<EspecialidadVista[]> {
    return this.especialidades.listar();
  }

  @Post('especialidades')
  @Roles('ADMIN')
  crear(@Body() dto: EspecialidadDto): Promise<EspecialidadVista> {
    return this.especialidades.crear(dto);
  }

  @Patch('especialidades/:id')
  @Roles('ADMIN')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarEspecialidadDto): Promise<EspecialidadVista> {
    return this.especialidades.editar(id, dto);
  }

  @Post('profesionales/yo/especialidades')
  @Roles('PROFESIONAL')
  declarar(@Body() dto: DeclararEspecialidadDto): Promise<EspecialidadDeclaradaVista> {
    return this.especialidades.declarar(dto.especialidadId);
  }

  @Get('profesionales/:id/especialidades')
  @Roles(...EQUIPO)
  declaradas(@Param('id', Uuid) id: string): Promise<EspecialidadDeclaradaVista[]> {
    return this.especialidades.declaradas(id);
  }

  @Post('profesionales/:id/especialidades/:especialidadId/revision')
  @HttpCode(200)
  @Roles('ADMIN')
  revisar(
    @Param('id', Uuid) id: string,
    @Param('especialidadId', Uuid) especialidadId: string,
    @Body() dto: RevisarEspecialidadDto,
  ): Promise<EspecialidadDeclaradaVista> {
    return this.especialidades.revisar(id, especialidadId, dto.aprobar);
  }
}
