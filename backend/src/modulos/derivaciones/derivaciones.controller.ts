import { Body, Controller, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EstadoDerivacion } from '@prisma/client';

import { TAGS } from '../../core/docs/openapi';
import { Roles } from '../../core/auth/decoradores';
import { DerivacionesService } from './derivaciones.service';
import {
  CancelarDerivacionDto,
  CandidatosDto,
  CrearDerivacionDto,
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
export class DerivacionesController {
  constructor(private readonly derivaciones: DerivacionesService) {}

  @Post()
  @Roles('ADMIN', 'PROFESIONAL')
  crear(@Body() dto: CrearDerivacionDto) {
    return this.derivaciones.crear(dto);
  }

  @Get()
  @Roles('ADMIN', 'PROFESIONAL')
  listar(@Query('estado', new ParseEnumPipe(EstadoDerivacion, { optional: true })) estado?: EstadoDerivacion) {
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
  obtener(@Param('id', Uuid) id: string) {
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
export class ConsentimientosController {
  constructor(private readonly derivaciones: DerivacionesService) {}

  @Get('consentimientos')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
  listar() {
    return this.derivaciones.consentimientos();
  }

  @Post('consentimientos/solicitudes')
  @Roles('ADMIN', 'PROFESIONAL')
  solicitar(@Body() dto: SolicitarConsentimientoDto) {
    return this.derivaciones.solicitarConsentimiento(dto.pacienteId);
  }

  @Post('consentimientos/:id/respuesta')
  @HttpCode(200)
  @Roles('PACIENTE', 'ADMIN', 'GESTION')
  responder(@Param('id', Uuid) id: string, @Body() dto: ResponderConsentimientoDto) {
    return this.derivaciones.responderConsentimiento(id, dto);
  }

  @Post('consentimientos/:id/revocacion')
  @HttpCode(200)
  @Roles('PACIENTE', 'ADMIN', 'GESTION')
  revocar(@Param('id', Uuid) id: string, @Body() dto: RevocarConsentimientoDto) {
    return this.derivaciones.revocarConsentimiento(id, dto);
  }

  @Get('avisos-consentimiento')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
  avisos() {
    return this.derivaciones.avisos();
  }

  @Post('avisos-consentimiento/:id/respuesta')
  @HttpCode(200)
  @Roles('PACIENTE', 'ADMIN', 'GESTION')
  responderAviso(@Param('id', Uuid) id: string, @Body() dto: ResponderAvisoDto) {
    return this.derivaciones.responderAviso(id, dto);
  }
}
