import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { TipoPolitica } from '@prisma/client';

import { Publico, Roles } from '../../core/auth/decoradores';
import { hashToken } from '../../core/auth/tokens-correo';
import { ContextoBd } from '../../core/bd/contexto-bd.service';
import { TAGS } from '../../core/docs/openapi';
import { Modulo } from '../../core/modulos/modulos';
import {
  CalcularMatchDto,
  CitasPortalDto,
  CrearResenaDto,
  EditarOpcionMatchDto,
  EditarPreguntaMatchDto,
  FiltroPerfilesDto,
  MatchDto,
  MensajeDto,
  MetricasMatchDto,
  MisDatosDto,
  ModerarResenaDto,
  OpcionMatchDto,
  PacienteDelPortalDto,
  PreguntaMatchDto,
  RangoPublicoDto,
  ReporteResenaDto,
  ResenaDto,
  ResolverEpicrisisDto,
  ResponderConsentimientoTokenDto,
  SolicitarEpicrisisDto,
  SolicitudHoraDto,
  TokenPublicoDto,
} from './dto/match.dto';
import {
  CentroPublico,
  CuestionarioPublico,
  Hueco,
  PerfilPublico,
  PoliticaPublica,
  ResenaPublica,
  ResultadoMatch,
  SolicitudCreada,
  SolicitudVerificada,
} from './dto/publico-respuestas.dto';
import { MatchConfigService } from './match-config.service';
import { MatchService } from './match.service';
import { PortalService } from './portal.service';
import { ResenasService } from './resenas.service';
import { SolicitudesService } from './solicitudes.service';

const Uuid = new ParseUUIDPipe();
const PORTAL = ['PACIENTE', 'RESPONSABLE'] as const;

/**
 * Sin autenticacion: solo datos publicos y funciones del portal diseñadas
 * para eso. Rate limit por IP (PUBLICO_LIMITE_POR_MINUTO).
 */
@ApiTags(TAGS.publico)
@Controller('publico')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class PublicoController {
  constructor(
    private readonly match: MatchService,
    private readonly solicitudes: SolicitudesService,
    private readonly bd: ContextoBd,
  ) {}

  /** Contenido de la pagina publica, modulos activos y politica de cancelacion vigente (terminos). */
  @Get('centro')
  centro(): Promise<CentroPublico> {
    return this.match.centro();
  }

  @Get('politicas/:tipo')
  politica(@Param('tipo', new ParseEnumPipe(TipoPolitica)) tipo: TipoPolitica): Promise<PoliticaPublica> {
    return this.match.politica(tipo);
  }

  /** Foto de perfil o logo (publicas, sin metadatos). */
  @Get('imagenes/:id')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async imagen(@Param('id', Uuid) id: string) {
    const i = await this.match.imagen(id);
    return new StreamableFile(i.contenido, { type: i.tipoMime });
  }

  /** Equipo publico: solo PROFESIONAL con perfil publicado (nunca practicantes). */
  @Get('profesionales')
  @Modulo('PAGINA_PUBLICA')
  perfiles(@Query() filtro: FiltroPerfilesDto): Promise<PerfilPublico[]> {
    return this.match.perfiles(filtro);
  }

  @Get('profesionales/:id/disponibilidad')
  @Modulo('PAGINA_PUBLICA')
  disponibilidad(@Param('id', Uuid) id: string, @Query() rango: RangoPublicoDto): Promise<Hueco[]> {
    return this.match.disponibilidad(id, rango.desde, rango.hasta);
  }

  /** Reseñas publicadas del profesional (D-1). */
  @Get('profesionales/:id/resenas')
  @Modulo('PAGINA_PUBLICA')
  resenas(@Param('id', Uuid) id: string): Promise<ResenaPublica[]> {
    return this.match.resenas(id);
  }

  @Post('resenas/:id/reporte')
  @HttpCode(204)
  async reportar(@Param('id', Uuid) id: string, @Body() dto: ReporteResenaDto) {
    await this.match.reportarResena(id, dto.motivo);
  }

  /** Cuestionario activo del match (configurable por ADMIN). */
  @Get('cuestionario')
  @Modulo('MATCH')
  cuestionario(): Promise<CuestionarioPublico> {
    return this.match.cuestionario();
  }

  /** Resultado del match por reglas, explicable. No guarda las respuestas (C-17). */
  @Post('match')
  @HttpCode(200)
  @Modulo('MATCH')
  calcular(@Body() dto: CalcularMatchDto): Promise<ResultadoMatch> {
    return this.match.calcular(dto.respuestas);
  }

  /** Filtro directo ("prefiero filtrar yo mismo"): necesidad > tiempos > precio. */
  @Get('match')
  @Modulo('MATCH')
  buscar(@Query() dto: MatchDto) {
    return this.match.match(dto);
  }

  /** Pedir hora sin cuenta: retiene la hora y envia el enlace de verificacion al correo. */
  @Post('solicitudes')
  @HttpCode(202)
  @Modulo('AGENDA')
  solicitar(@Body() dto: SolicitudHoraDto): Promise<SolicitudCreada> {
    return this.solicitudes.crear(dto);
  }

  /** El enlace del correo confirma la hora (o la deja por aprobar) y, si corresponde, invita a crear la cuenta. */
  @Post('solicitudes/verificacion')
  @HttpCode(200)
  @Modulo('AGENDA')
  verificar(@Body() dto: TokenPublicoDto): Promise<SolicitudVerificada> {
    return this.solicitudes.verificar(dto.token);
  }

  /** Pagina del enlace de consentimiento (no lo consume). */
  @Post('consentimientos/consulta')
  @HttpCode(200)
  async consultarConsentimiento(@Body() dto: TokenPublicoDto) {
    const [r] = await this.bd.sinContexto('publico').$queryRaw<
      { tipo: string; politica_version: number; politica_texto: string; vence_en: Date; menor: boolean }[]
    >`SELECT * FROM consultar_token_consentimiento(${hashToken(dto.token)})`;
    return r;
  }

  /** Respuesta por enlace de un solo uso (D-3): consentimiento de atencion, de practicante u oposicion a un aviso. */
  @Post('consentimientos/respuesta')
  @HttpCode(200)
  async responderConsentimiento(@Body() dto: ResponderConsentimientoTokenDto) {
    const [{ tipo }] = await this.bd.sinContexto('publico').$queryRaw<[{ tipo: string }]>`
      SELECT responder_token_consentimiento(${hashToken(dto.token)}, ${dto.acepta}, ${dto.version ?? null}) AS tipo`;
    return { tipo, acepta: dto.acepta };
  }
}

@ApiTags(TAGS.portal)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly resenas: ResenasService,
  ) {}

  @Get('equipo')
  @Roles(...PORTAL)
  equipo() {
    return this.portal.equipo();
  }

  /** Pacientes del portal: el propio o los menores a cargo del adulto responsable. */
  @Get('pacientes')
  @Roles(...PORTAL)
  pacientes() {
    return this.portal.misPacientes();
  }

  @Get('citas')
  @Roles(...PORTAL)
  citas(@Query() filtro: CitasPortalDto) {
    return this.portal.citas(filtro.pacienteId, filtro.todas);
  }

  @Get('citas/:id/datos-pago')
  @Roles(...PORTAL)
  datosPago(@Param('id', Uuid) id: string) {
    return this.portal.datosPago(id);
  }

  @Post('mensajes')
  @Roles(...PORTAL)
  enviarMensaje(@Body() dto: MensajeDto) {
    return this.portal.enviarMensaje(dto.profesionalId, dto.contenido, dto.pacienteId);
  }

  @Post('epicrisis')
  @Roles(...PORTAL)
  solicitarEpicrisis(@Body() dto: SolicitarEpicrisisDto) {
    return this.portal.solicitarEpicrisis(dto.motivo, dto.pacienteId);
  }

  @Get('mis-datos')
  @Roles(...PORTAL)
  misDatos(@Query() filtro: PacienteDelPortalDto) {
    return this.portal.misDatos(filtro.pacienteId);
  }

  /** C-9: telefono y correo (el correo nuevo se confirma por enlace). Nombre, fecha de nacimiento y adulto responsable: el centro. */
  @Patch('mis-datos')
  @Roles(...PORTAL)
  actualizarMisDatos(@Body() dto: MisDatosDto) {
    return this.portal.actualizarMisDatos(dto);
  }

  @Post('consentimiento-atencion')
  @Roles(...PORTAL)
  consentimientoAtencion(@Body() dto: PacienteDelPortalDto) {
    return this.portal.aceptarConsentimientoAtencion(dto.pacienteId);
  }

  /** Reseñas escritas por la cuenta (con su estado de moderacion). */
  @Get('resenas')
  @Roles(...PORTAL)
  misResenas() {
    return this.resenas.mias();
  }

  /** Una por paciente y profesional, con al menos una sesion realizada; queda PENDIENTE de moderacion. */
  @Post('resenas')
  @Roles(...PORTAL)
  async crearResena(@Body() dto: CrearResenaDto) {
    return this.resenas.crear(dto, await this.portal.pacienteDelPortal(dto.pacienteId));
  }

  /** Editar vuelve a moderacion. */
  @Put('resenas/:id')
  @Roles(...PORTAL)
  editarResena(@Param('id', Uuid) id: string, @Body() dto: ResenaDto) {
    return this.resenas.editar(id, dto);
  }

  @Post('resenas/:id/retiro')
  @HttpCode(200)
  @Roles(...PORTAL)
  retirarResena(@Param('id', Uuid) id: string) {
    return this.resenas.retirar(id);
  }
}

/** Moderacion de reseñas (ADMIN): sin el feedback privado del paciente. */
@ApiTags(TAGS.portal)
@Controller('resenas')
@Modulo('PAGINA_PUBLICA')
export class ResenasController {
  constructor(private readonly resenas: ResenasService) {}

  @Get()
  @Roles('ADMIN')
  cola() {
    return this.resenas.paraModerar();
  }

  /** Publicar u ocultar con motivo (queda auditado). */
  @Post(':id/moderacion')
  @HttpCode(200)
  @Roles('ADMIN')
  moderar(@Param('id', Uuid) id: string, @Body() dto: ModerarResenaDto) {
    return this.resenas.moderar(id, dto.publicar, dto.motivo);
  }
}

/** Configuracion del cuestionario y metricas del match (ADMIN). */
@ApiTags(TAGS.publico)
@Controller('match')
@Modulo('MATCH')
export class MatchConfigController {
  constructor(private readonly config: MatchConfigService) {}

  @Get('preguntas')
  @Roles('ADMIN')
  preguntas() {
    return this.config.preguntas();
  }

  @Post('preguntas')
  @Roles('ADMIN')
  crearPregunta(@Body() dto: PreguntaMatchDto) {
    return this.config.crearPregunta(dto);
  }

  @Patch('preguntas/:id')
  @Roles('ADMIN')
  editarPregunta(@Param('id', Uuid) id: string, @Body() dto: EditarPreguntaMatchDto) {
    return this.config.editarPregunta(id, dto);
  }

  @Post('preguntas/:id/opciones')
  @Roles('ADMIN')
  crearOpcion(@Param('id', Uuid) id: string, @Body() dto: OpcionMatchDto) {
    return this.config.crearOpcion(id, dto);
  }

  @Patch('opciones/:id')
  @Roles('ADMIN')
  editarOpcion(@Param('id', Uuid) id: string, @Body() dto: EditarOpcionMatchDto) {
    return this.config.editarOpcion(id, dto);
  }

  @Get('metricas')
  @Roles('ADMIN')
  metricas(@Query() q: MetricasMatchDto) {
    return this.config.metricas(q.dias);
  }
}

/** Mensajes: el paciente ve los enviados; el profesional los recibidos. ADMIN/GESTION nunca (contenido). */
@ApiTags(TAGS.portal)
@Controller('mensajes')
export class MensajesController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Roles('PACIENTE', 'RESPONSABLE', 'PROFESIONAL', 'PRACTICANTE')
  listar() {
    return this.portal.mensajes();
  }

  @Post(':id/leido')
  @HttpCode(200)
  @Roles('PROFESIONAL', 'PRACTICANTE')
  leido(@Param('id', Uuid) id: string) {
    return this.portal.marcarLeido(id);
  }
}

@ApiTags(TAGS.portal)
@Controller('epicrisis')
export class EpicrisisController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
  listar() {
    return this.portal.epicrisis();
  }

  @Post(':id/resolucion')
  @HttpCode(200)
  @Roles('ADMIN', 'PROFESIONAL', 'PRACTICANTE')
  resolver(@Param('id', Uuid) id: string, @Body() dto: ResolverEpicrisisDto) {
    return this.portal.resolverEpicrisis(id, dto.estado, dto.documentoRef);
  }
}
