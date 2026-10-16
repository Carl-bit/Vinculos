import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../core/docs/openapi';
import { Modulo } from '../../core/modulos/modulos';
import { Publico, Roles } from '../../core/auth/decoradores';
import { AgendaService } from './agenda.service';
import { ListaEsperaService } from './lista-espera.service';
import { CitasService } from './citas.service';
import { IntegracionesAgendaService } from './integraciones-agenda.service';
import { RecordatoriosService } from './recordatorios.service';
import {
  CerrarListaEsperaDto,
  CrearBloqueoAgendaDto,
  CrearListaEsperaDto,
  CubrirCitaDto,
  FiltroListaEsperaDto,
  HorarioEspacioDto,
  CrearCitaDto,
  CrearDisponibilidadDto,
  CrearEspacioDto,
  EditarEspacioDto,
  FiltroCitasDto,
  HorarioDto,
  RangoDto,
  ReprogramarCitaDto,
  SalaDto,
} from './dto/agenda.dto';

const Uuid = new ParseUUIDPipe();
const TODOS = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE'] as const;
const EQUIPO_AGENDA = ['ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE'] as const;

@ApiTags(TAGS.agenda)
@Controller('espacios')
@Modulo('AGENDA')
export class EspaciosController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  @Roles(...TODOS)
  listar() {
    return this.agenda.espacios();
  }

  @Post()
  @Roles('ADMIN', 'GESTION')
  crear(@Body() dto: CrearEspacioDto) {
    return this.agenda.crearEspacio(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'GESTION')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarEspacioDto) {
    return this.agenda.editarEspacio(id, dto);
  }

  /** Horario de funcionamiento del box (vacio = el del centro). */
  @Get(':id/horario')
  @Roles(...EQUIPO_AGENDA)
  horario(@Param('id', Uuid) id: string) {
    return this.agenda.horarioEspacio(id);
  }

  @Put(':id/horario')
  @Roles('ADMIN', 'GESTION')
  reemplazarHorario(@Param('id', Uuid) id: string, @Body() dto: HorarioEspacioDto) {
    return this.agenda.reemplazarHorarioEspacio(id, dto.bloques);
  }

  /** Ocupacion de boxes (citas confirmadas + soft-locks), sin pacientes. */
  @Get('ocupacion')
  @Roles(...EQUIPO_AGENDA)
  ocupacion(@Query() rango: RangoDto) {
    return this.agenda.ocupacion(rango.desde, rango.hasta);
  }
}

/** Disponibilidad semanal y bloqueos: el propio y ADMIN/GESTION (RLS). */
@ApiTags(TAGS.agenda)
@Controller('profesionales/:profesionalId')
@Modulo('AGENDA')
export class AgendaProfesionalController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('disponibilidad')
  @Roles(...EQUIPO_AGENDA)
  disponibilidad(@Param('profesionalId', Uuid) id: string) {
    return this.agenda.disponibilidad(id);
  }

  @Post('disponibilidad')
  @Roles(...EQUIPO_AGENDA)
  crearDisponibilidad(@Param('profesionalId', Uuid) id: string, @Body() dto: CrearDisponibilidadDto) {
    return this.agenda.crearDisponibilidad(id, dto);
  }

  @Delete('disponibilidad/:id')
  @Roles(...EQUIPO_AGENDA)
  eliminarDisponibilidad(@Param('profesionalId', Uuid) profesionalId: string, @Param('id', Uuid) id: string) {
    return this.agenda.eliminarDisponibilidad(profesionalId, id);
  }

  @Get('bloqueos')
  @Roles(...EQUIPO_AGENDA)
  bloqueos(@Param('profesionalId', Uuid) id: string) {
    return this.agenda.bloqueos(id);
  }

  @Post('bloqueos')
  @Roles(...EQUIPO_AGENDA)
  crearBloqueo(@Param('profesionalId', Uuid) id: string, @Body() dto: CrearBloqueoAgendaDto) {
    return this.agenda.crearBloqueo(id, dto);
  }

  @Delete('bloqueos/:id')
  @Roles(...EQUIPO_AGENDA)
  eliminarBloqueo(@Param('profesionalId', Uuid) profesionalId: string, @Param('id', Uuid) id: string) {
    return this.agenda.eliminarBloqueo(profesionalId, id);
  }

  /** Huecos libres por modalidad (max. 62 dias), sin motivos. */
  @Get('huecos')
  @Roles(...TODOS)
  huecos(@Param('profesionalId', Uuid) id: string, @Query() rango: RangoDto) {
    return this.agenda.huecos(id, rango.desde, rango.hasta);
  }

  /** Citas futuras que no cumplen el margen vigente (no se mueven solas). */
  @Get('conflictos-margen')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  conflictosMargen(@Param('profesionalId', Uuid) id: string) {
    return this.agenda.citasEnConflictoMargen(id);
  }
}

/** Soft-locks con TTL (cada uno los suyos). */
@ApiTags(TAGS.agenda)
@Controller('agenda/horarios-tomados')
@Modulo('AGENDA')
export class HorariosTomadosController {
  constructor(private readonly agenda: AgendaService) {}

  @Post()
  @Roles(...EQUIPO_AGENDA)
  tomar(@Body() dto: HorarioDto) {
    return this.agenda.tomarHorario(dto);
  }

  @Get()
  @Roles(...EQUIPO_AGENDA)
  mios() {
    return this.agenda.misHorariosTomados();
  }

  @Delete(':id')
  @Roles(...EQUIPO_AGENDA)
  soltar(@Param('id', Uuid) id: string) {
    return this.agenda.soltarHorario(id);
  }
}

/** Citas: ADMIN/GESTION todas; PROFESIONAL/PRACTICANTE las propias; PACIENTE solo lee las suyas. */
@ApiTags(TAGS.agenda)
@Controller('citas')
@Modulo('AGENDA')
export class CitasController {
  constructor(private readonly citas: CitasService) {}

  @Get()
  @Roles(...TODOS)
  listar(@Query() filtro: FiltroCitasDto) {
    return this.citas.listar(filtro);
  }

  @Get('por-reprogramar')
  @Roles(...EQUIPO_AGENDA)
  porReprogramar() {
    return this.citas.porReprogramar();
  }

  /** Verificacion previa (opcion C): disponibilidad, margen y box, con alternativas. */
  @Post('verificacion')
  @HttpCode(200)
  @Roles(...EQUIPO_AGENDA)
  verificar(@Body() dto: HorarioDto) {
    return this.citas.verificar(dto);
  }

  @Post()
  @Roles(...EQUIPO_AGENDA)
  crear(@Body() dto: CrearCitaDto) {
    return this.citas.crear(dto);
  }

  @Get(':id')
  @Roles(...TODOS)
  obtener(@Param('id', Uuid) id: string) {
    return this.citas.obtener(id);
  }

  @Patch(':id/cancelacion')
  @Roles(...EQUIPO_AGENDA)
  cancelar(@Param('id', Uuid) id: string) {
    return this.citas.cancelar(id);
  }

  @Patch(':id/reprogramacion')
  @Roles(...EQUIPO_AGENDA)
  reprogramar(@Param('id', Uuid) id: string, @Body() dto: ReprogramarCitaDto) {
    return this.citas.reprogramar(id, dto);
  }

  @Get(':id/enlace')
  @Roles(...TODOS)
  enlace(@Param('id', Uuid) id: string) {
    return this.citas.enlace(id);
  }

  /** Aprobar una cita SOLICITADA (paciente nuevo de un profesional que aprueba). */
  @Post(':id/aprobacion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  aprobar(@Param('id', Uuid) id: string) {
    return this.citas.aprobar(id);
  }

  /** "Cubrir sesion": otro profesional con acceso clinico temporal vigente (si no, 422). Cambiar de tratante = derivacion. */
  @Patch(':id/profesional')
  @Roles('ADMIN', 'GESTION')
  cubrir(@Param('id', Uuid) id: string, @Body() dto: CubrirCitaDto) {
    return this.citas.cubrir(id, dto.profesionalId);
  }

  /** "Requerir cierre": aviso al profesional (sesion sin evolucion registrada). */
  @Post(':id/cierre-requerido')
  @HttpCode(200)
  @Roles('ADMIN')
  requerirCierre(@Param('id', Uuid) id: string) {
    return this.citas.requerirCierre(id);
  }
}

/** Lista de espera por profesional o tipo de atencion (03a). */
@ApiTags(TAGS.agenda)
@Controller('lista-espera')
@Modulo('AGENDA')
export class ListaEsperaController {
  constructor(private readonly lista: ListaEsperaService) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  listar(@Query() filtro: FiltroListaEsperaDto) {
    return this.lista.listar(filtro);
  }

  @Post()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  crear(@Body() dto: CrearListaEsperaDto) {
    return this.lista.crear(dto);
  }

  @Post(':id/cierre')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  cerrar(@Param('id', Uuid) id: string, @Body() dto: CerrarListaEsperaDto) {
    return this.lista.cerrar(id, dto.estado);
  }
}

/** Sala de videollamada y feed iCal: cada profesional o practicante los suyos (02h). */
@ApiTags(TAGS.agenda)
@Controller('profesionales/yo')
@Modulo('AGENDA')
export class IntegracionesAgendaController {
  constructor(private readonly integraciones: IntegracionesAgendaService) {}

  @Get('videollamada')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  sala() {
    return this.integraciones.miSala();
  }

  @Put('videollamada')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  guardarSala(@Body() dto: SalaDto) {
    return this.integraciones.guardarMiSala(dto);
  }

  /** Genera (o regenera) el token del feed: la URL se muestra una sola vez. */
  @Post('calendario')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  regenerarFeed() {
    return this.integraciones.regenerarFeed();
  }
}

/** Feed iCal privado: sin sesion, el token de la URL autoriza (rate limit publico). */
@ApiTags(TAGS.agenda)
@Controller('calendario')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class CalendarioPublicoController {
  constructor(private readonly integraciones: IntegracionesAgendaService) {}

  @Get(':token')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'private, no-store')
  feed(@Param('token') token: string) {
    return this.integraciones.feed(token);
  }
}

/**
 * Respuesta a un recordatorio (02i): sin sesion, el token del enlace autoriza
 * (un solo uso, hasta el inicio de la cita; rate limit publico). Primero se
 * consulta (muestra si una cancelacion seria a tiempo o tardia) y despues se
 * confirma asistencia o se cancela.
 */
@ApiTags(TAGS.agenda)
@Controller('recordatorios')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class RecordatoriosPublicoController {
  constructor(private readonly recordatorios: RecordatoriosService) {}

  @Get(':token')
  @Header('Cache-Control', 'private, no-store')
  consultar(@Param('token') token: string) {
    return this.recordatorios.consultar(token);
  }

  @Post(':token/confirmacion')
  @HttpCode(200)
  confirmar(@Param('token') token: string) {
    return this.recordatorios.responder(token, 'CONFIRMADA');
  }

  @Post(':token/cancelacion')
  @HttpCode(200)
  cancelar(@Param('token') token: string) {
    return this.recordatorios.responder(token, 'CANCELADA');
  }
}
