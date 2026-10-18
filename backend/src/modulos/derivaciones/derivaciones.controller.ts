import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EstadoDerivacion } from '@prisma/client';

import { TAGS } from '../../core/docs/openapi';
import { Modulo } from '../../core/modulos/modulos';
import { Roles } from '../../core/auth/decoradores';
import { CorreosCuenta } from '../../core/notificaciones/correos-cuenta';
import { DerivacionesService } from './derivaciones.service';
import {
  AvisoConsentimientoVista,
  CancelarDerivacionDto,
  CandidatosDto,
  ConsentimientoVista,
  CrearDerivacionDto,
  DerivacionCreada,
  DerivacionVista,
  ProponerPracticanteDto,
  ResponderAvisoDto,
  ResponderConsentimientoDto,
  ResponderDerivacionDto,
  RevocarConsentimientoDto,
  SolicitarConsentimientoDto,
} from './dto/derivaciones.dto';

const Uuid = new ParseUUIDPipe();

/** Roles segun matriz_permisos.md (funciones de derivacion). La BD valida el detalle (tratante, supervisor, bandeja). */
@ApiTags(TAGS.derivaciones)
@Controller('derivaciones')
@Modulo('FICHAS')
export class DerivacionesController {
  constructor(private readonly derivaciones: DerivacionesService) {}

  @Post()
  @Roles('ADMIN', 'PROFESIONAL')
  crear(@Body() dto: CrearDerivacionDto): Promise<DerivacionCreada> {
    return this.derivaciones.crear(dto);
  }

  @Get()
  @Roles('ADMIN', 'PROFESIONAL')
  listar(@Query('estado', new ParseEnumPipe(EstadoDerivacion, { optional: true })) estado?: EstadoDerivacion): Promise<DerivacionVista[]> {
    return this.derivaciones.listar(estado);
  }

  /** Bandeja de ofertas: ADMIN y supervisores vigentes. */
  @Get('pendientes')
  @Roles('ADMIN', 'PROFESIONAL')
  pendientes() {
    return this.derivaciones.pendientes();
  }

  @Get(':id')
  @Roles('ADMIN', 'PROFESIONAL')
  obtener(@Param('id', Uuid) id: string): Promise<DerivacionVista> {
    return this.derivaciones.obtener(id);
  }

  @Get(':id/oferta')
  @Roles('PROFESIONAL', 'PRACTICANTE')
  oferta(@Param('id', Uuid) id: string) {
    return this.derivaciones.oferta(id);
  }

  @Post(':id/respuesta')
  @HttpCode(200)
  @Roles('PROFESIONAL', 'PRACTICANTE')
  responder(@Param('id', Uuid) id: string, @Body() dto: ResponderDerivacionDto) {
    return this.derivaciones.responder(id, dto.acepta);
  }

  @Post(':id/cancelacion')
  @HttpCode(200)
  @Roles('ADMIN', 'PROFESIONAL')
  cancelar(@Param('id', Uuid) id: string, @Body() dto: CancelarDerivacionDto) {
    return this.derivaciones.cancelar(id, dto.motivo);
  }

  @Put(':id/candidatos')
  @Roles('ADMIN')
  definirCandidatos(@Param('id', Uuid) id: string, @Body() dto: CandidatosDto) {
    return this.derivaciones.definirCandidatos(id, dto.candidatos);
  }

  @Post(':id/candidatos/:profesionalId/reintegro')
  @HttpCode(200)
  @Roles('ADMIN')
  reintegrar(@Param('id', Uuid) id: string, @Param('profesionalId', Uuid) profesionalId: string) {
    return this.derivaciones.reintegrar(id, profesionalId);
  }

  @Post(':id/practicantes')
  @HttpCode(200)
  @Roles('ADMIN', 'PROFESIONAL')
  proponer(@Param('id', Uuid) id: string, @Body() dto: ProponerPracticanteDto) {
    return this.derivaciones.proponerPracticante(id, dto.practicanteId);
  }
}

/** Consentimientos y avisos: responde el paciente (o su adulto responsable) o ADMIN/GESTION con respaldo. */
@ApiTags(TAGS.derivaciones)
@Controller()
@Modulo('FICHAS')
export class ConsentimientosController {
  constructor(
    private readonly derivaciones: DerivacionesService,
    private readonly correos: CorreosCuenta,
  ) {}

  @Get('consentimientos')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
  listar(): Promise<ConsentimientoVista[]> {
    return this.derivaciones.consentimientos();
  }

  @Post('consentimientos/solicitudes')
  @Roles('ADMIN', 'PROFESIONAL')
  solicitar(@Body() dto: SolicitarConsentimientoDto) {
    return this.derivaciones.solicitarConsentimiento(dto.pacienteId);
  }

  @Post('consentimientos/:id/respuesta')
  @HttpCode(200)
  @Roles('PACIENTE', 'RESPONSABLE', 'ADMIN', 'GESTION')
  responder(@Param('id', Uuid) id: string, @Body() dto: ResponderConsentimientoDto): Promise<ConsentimientoVista> {
    return this.derivaciones.responderConsentimiento(id, dto);
  }

  @Post('consentimientos/:id/revocacion')
  @HttpCode(200)
  @Roles('PACIENTE', 'RESPONSABLE', 'ADMIN', 'GESTION')
  revocar(@Param('id', Uuid) id: string, @Body() dto: RevocarConsentimientoDto): Promise<ConsentimientoVista> {
    return this.derivaciones.revocarConsentimiento(id, dto);
  }

  @Get('avisos-consentimiento')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE', 'RESPONSABLE')
  avisos(): Promise<AvisoConsentimientoVista[]> {
    return this.derivaciones.avisos();
  }

  @Post('avisos-consentimiento/:id/respuesta')
  @HttpCode(200)
  @Roles('PACIENTE', 'RESPONSABLE', 'ADMIN', 'GESTION')
  responderAviso(@Param('id', Uuid) id: string, @Body() dto: ResponderAvisoDto): Promise<AvisoConsentimientoVista> {
    return this.derivaciones.responderAviso(id, dto);
  }

  /** D-3: enlace de un solo uso por correo para responder la solicitud (al paciente o a su adulto responsable). */
  @Post('consentimientos/:id/enlace')
  @Roles('ADMIN', 'GESTION')
  enlaceConsentimiento(@Param('id', Uuid) id: string) {
    return this.correos.enlaceConsentimiento(id);
  }

  /** D-3: enlace de un solo uso para responder (o oponerse a) un aviso de cambio de supervisor. */
  @Post('avisos-consentimiento/:id/enlace')
  @Roles('ADMIN', 'GESTION')
  enlaceAviso(@Param('id', Uuid) id: string) {
    return this.correos.enlaceConsentimiento(id);
  }
}
