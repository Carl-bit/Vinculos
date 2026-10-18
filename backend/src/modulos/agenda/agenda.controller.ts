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
  BloqueAtencionVista,
  BloqueoAgendaVista,
  BloquesLiberados,
  CitaAprobada,
  CitaVista,
  ConflictoMargen,
  DisponibilidadHabitual,
  Eliminados,
  EnlaceCita,
  EspacioVista,
  HorarioEspacioVista,
  HoraLibreBox,
  HorarioTomado,
  HuecoAgenda,
  ListaEsperaVista,
  OcupacionBox,
  RecordatorioConsulta,
  RecordatorioRespuesta,
  VerificacionHorario,
  FeedCalendario,
  SalaVideollamadaVista,
} from './dto/agenda-respuestas.dto';
import { InscribirListaEsperaDto, InscripcionListaEspera, InscripcionVerificada, TokenListaEsperaDto } from './dto/lista-espera-publica.dto';
import { ListaEsperaPublicaService } from './lista-espera-publica.service';
import {
  ApartarBloquesDto,
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
  listar(): Promise<EspacioVista[]> {
    return this.agenda.espacios();
  }

  @Post()
  @Roles('ADMIN', 'GESTION')
  crear(@Body() dto: CrearEspacioDto): Promise<EspacioVista> {
    return this.agenda.crearEspacio(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'GESTION')
  editar(@Param('id', Uuid) id: string, @Body() dto: EditarEspacioDto): Promise<EspacioVista> {
    return this.agenda.editarEspacio(id, dto);
  }

  /** Horario de funcionamiento del box (vacio = el del centro). */
  @Get(':id/horario')
  @Roles(...EQUIPO_AGENDA)
  horario(@Param('id', Uuid) id: string): Promise<HorarioEspacioVista[]> {
    return this.agenda.horarioEspacio(id);
  }

  @Put(':id/horario')
  @Roles('ADMIN', 'GESTION')
  reemplazarHorario(@Param('id', Uuid) id: string, @Body() dto: HorarioEspacioDto): Promise<HorarioEspacioVista[]> {
    return this.agenda.reemplazarHorarioEspacio(id, dto.bloques);
  }

  /** Ocupacion de boxes (bloques apartados + soft-locks), sin pacientes ni profesionales. */
  @Get('ocupacion')
  @Roles(...EQUIPO_AGENDA)
  ocupacion(@Query() rango: RangoDto): Promise<OcupacionBox[]> {
    return this.agenda.ocupacion(rango.desde, rango.hasta);
  }

  /** 03b: horas libres de cada box para apartar (horario vigente del box menos bloques). Max. 62 dias. */
  @Get('disponibilidad')
  @Roles(...EQUIPO_AGENDA)
  disponibilidad(@Query() rango: RangoDto): Promise<HoraLibreBox[]> {
    return this.agenda.disponibilidadEspacios(rango.desde, rango.hasta);
  }
}

/**
 * Bloques de box (03b: la agenda del profesional), horario habitual semanal
 * y bloqueos: el propio y ADMIN/GESTION (RLS).
 */
@ApiTags(TAGS.agenda)
@Controller('profesionales/:profesionalId')
@Modulo('AGENDA')
export class AgendaProfesionalController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('bloques')
  @Roles(...EQUIPO_AGENDA)
  bloques(@Param('profesionalId', Uuid) id: string, @Query() rango: RangoDto): Promise<BloqueAtencionVista[]> {
    return this.agenda.bloques(id, rango.desde, rango.hasta);
  }

  /** Aparta horas de box (todas o ninguna): fuera del horario del box 422, ya apartadas 409. */
  @Post('bloques')
  @Roles(...EQUIPO_AGENDA)
  apartarBloques(@Param('profesionalId', Uuid) id: string, @Body() dto: ApartarBloquesDto): Promise<BloqueAtencionVista[]> {
    return this.agenda.apartarBloques(id, dto.bloques);
  }

  /** Libera un bloque sin citas ni retenciones dentro (si las tiene, 409). */
  @Delete('bloques/:id')
  @Roles(...EQUIPO_AGENDA)
  liberarBloque(@Param('profesionalId', Uuid) profesionalId: string, @Param('id', Uuid) id: string): Promise<BloquesLiberados> {
    return this.agenda.liberarBloque(profesionalId, id);
  }

  /** Horario habitual semanal (referencia para apartar bloques; ya no decide la agenda). */
  @Get('disponibilidad')
  @Roles(...EQUIPO_AGENDA)
  disponibilidad(@Param('profesionalId', Uuid) id: string): Promise<DisponibilidadHabitual[]> {
    return this.agenda.disponibilidad(id);
  }

  @Post('disponibilidad')
  @Roles(...EQUIPO_AGENDA)
  crearDisponibilidad(@Param('profesionalId', Uuid) id: string, @Body() dto: CrearDisponibilidadDto): Promise<DisponibilidadHabitual> {
    return this.agenda.crearDisponibilidad(id, dto);
  }

  @Delete('disponibilidad/:id')
  @Roles(...EQUIPO_AGENDA)
  eliminarDisponibilidad(@Param('profesionalId', Uuid) profesionalId: string, @Param('id', Uuid) id: string): Promise<Eliminados> {
    return this.agenda.eliminarDisponibilidad(profesionalId, id);
  }

  @Get('bloqueos')
  @Roles(...EQUIPO_AGENDA)
  bloqueos(@Param('profesionalId', Uuid) id: string): Promise<BloqueoAgendaVista[]> {
    return this.agenda.bloqueos(id);
  }

  @Post('bloqueos')
  @Roles(...EQUIPO_AGENDA)
  crearBloqueo(@Param('profesionalId', Uuid) id: string, @Body() dto: CrearBloqueoAgendaDto): Promise<BloqueoAgendaVista> {
    return this.agenda.crearBloqueo(id, dto);
  }

  @Delete('bloqueos/:id')
  @Roles(...EQUIPO_AGENDA)
  eliminarBloqueo(@Param('profesionalId', Uuid) profesionalId: string, @Param('id', Uuid) id: string): Promise<Eliminados> {
    return this.agenda.eliminarBloqueo(profesionalId, id);
  }

  /** Huecos libres por modalidad (max. 62 dias), sin motivos. */
  @Get('huecos')
  @Roles(...TODOS)
  huecos(@Param('profesionalId', Uuid) id: string, @Query() rango: RangoDto): Promise<HuecoAgenda[]> {
    return this.agenda.huecos(id, rango.desde, rango.hasta);
  }

  /** Citas futuras que no cumplen el margen vigente (no se mueven solas). */
  @Get('conflictos-margen')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE')
  conflictosMargen(@Param('profesionalId', Uuid) id: string): Promise<ConflictoMargen[]> {
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
  tomar(@Body() dto: HorarioDto): Promise<HorarioTomado> {
    return this.agenda.tomarHorario(dto);
  }

  @Get()
  @Roles(...EQUIPO_AGENDA)
  mios(): Promise<HorarioTomado[]> {
    return this.agenda.misHorariosTomados();
  }

  @Delete(':id')
  @Roles(...EQUIPO_AGENDA)
  soltar(@Param('id', Uuid) id: string): Promise<Eliminados> {
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
  listar(@Query() filtro: FiltroCitasDto): Promise<CitaVista[]> {
    return this.citas.listar(filtro);
  }

  @Get('por-reprogramar')
  @Roles(...EQUIPO_AGENDA)
  porReprogramar(): Promise<CitaVista[]> {
    return this.citas.porReprogramar();
  }

  /** Verificacion previa (opcion C): disponibilidad, margen y box, con alternativas. */
  @Post('verificacion')
  @HttpCode(200)
  @Roles(...EQUIPO_AGENDA)
  verificar(@Body() dto: HorarioDto): Promise<VerificacionHorario> {
    return this.citas.verificar(dto);
  }

  @Post()
  @Roles(...EQUIPO_AGENDA)
  crear(@Body() dto: CrearCitaDto): Promise<CitaVista> {
    return this.citas.crear(dto);
  }

  @Get(':id')
  @Roles(...TODOS)
  obtener(@Param('id', Uuid) id: string): Promise<CitaVista> {
    return this.citas.obtener(id);
  }

  @Patch(':id/cancelacion')
  @Roles(...EQUIPO_AGENDA)
  cancelar(@Param('id', Uuid) id: string): Promise<CitaVista> {
    return this.citas.cancelar(id);
  }

  @Patch(':id/reprogramacion')
  @Roles(...EQUIPO_AGENDA)
  reprogramar(@Param('id', Uuid) id: string, @Body() dto: ReprogramarCitaDto): Promise<CitaVista> {
    return this.citas.reprogramar(id, dto);
  }

  @Get(':id/enlace')
  @Roles(...TODOS)
  enlace(@Param('id', Uuid) id: string): Promise<EnlaceCita> {
    return this.citas.enlace(id);
  }

  /** Aprobar una cita SOLICITADA (paciente nuevo de un profesional que aprueba). */
  @Post(':id/aprobacion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  aprobar(@Param('id', Uuid) id: string): Promise<CitaAprobada> {
    return this.citas.aprobar(id);
  }

  /** "Cubrir sesion": otro profesional con acceso clinico temporal vigente (si no, 422). Cambiar de tratante = derivacion. */
  @Patch(':id/profesional')
  @Roles('ADMIN', 'GESTION')
  cubrir(@Param('id', Uuid) id: string, @Body() dto: CubrirCitaDto): Promise<CitaVista> {
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
  listar(@Query() filtro: FiltroListaEsperaDto): Promise<ListaEsperaVista[]> {
    return this.lista.listar(filtro);
  }

  @Post()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  crear(@Body() dto: CrearListaEsperaDto): Promise<ListaEsperaVista> {
    return this.lista.crear(dto);
  }

  @Post(':id/cierre')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  cerrar(@Param('id', Uuid) id: string, @Body() dto: CerrarListaEsperaDto): Promise<ListaEsperaVista> {
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
  sala(): Promise<SalaVideollamadaVista> {
    return this.integraciones.miSala();
  }

  @Put('videollamada')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  guardarSala(@Body() dto: SalaDto): Promise<SalaVideollamadaVista> {
    return this.integraciones.guardarMiSala(dto);
  }

  /** Genera (o regenera) el token del feed: la URL se muestra una sola vez. */
  @Post('calendario')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  regenerarFeed(): Promise<FeedCalendario> {
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
  consultar(@Param('token') token: string): Promise<RecordatorioConsulta> {
    return this.recordatorios.consultar(token);
  }

  @Post(':token/confirmacion')
  @HttpCode(200)
  confirmar(@Param('token') token: string): Promise<RecordatorioRespuesta> {
    return this.recordatorios.responder(token, 'CONFIRMADA');
  }

  @Post(':token/cancelacion')
  @HttpCode(200)
  cancelar(@Param('token') token: string): Promise<RecordatorioRespuesta> {
    return this.recordatorios.responder(token, 'CANCELADA');
  }
}

/**
 * Lista de espera publica (03b): sin cuenta ni sesion; verificada por correo.
 * Rate limit publico por IP. No revela si un correo ya estaba inscrito.
 */
@ApiTags(TAGS.publico)
@Controller('publico/lista-espera')
@Modulo('AGENDA')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class ListaEsperaPublicaController {
  constructor(private readonly lista: ListaEsperaPublicaService) {}

  @Post()
  @HttpCode(202)
  inscribir(@Body() dto: InscribirListaEsperaDto): Promise<InscripcionListaEspera> {
    return this.lista.inscribir(dto);
  }

  /** El enlace del correo activa la inscripcion (un solo uso). */
  @Post('verificacion')
  @HttpCode(200)
  verificar(@Body() dto: TokenListaEsperaDto): Promise<InscripcionVerificada> {
    return this.lista.verificar(dto.token);
  }

  /** El enlace de baja borra la inscripcion. */
  @Post('baja')
  @HttpCode(204)
  async baja(@Body() dto: TokenListaEsperaDto): Promise<void> {
    await this.lista.baja(dto.token);
  }
}
