import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';

import { Publico, Roles } from '../../core/auth/decoradores';
import { MatchDto, MensajeDto, RangoPublicoDto, ResolverEpicrisisDto, SolicitarEpicrisisDto } from './dto/match.dto';
import { MatchService } from './match.service';
import { PortalService } from './portal.service';

const Uuid = new ParseUUIDPipe();

/** Sin autenticacion: solo datos publicos. Rate limit por IP (PUBLICO_LIMITE_POR_MINUTO). */
@Controller('publico')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class PublicoController {
  constructor(private readonly match: MatchService) {}

  @Get('profesionales')
  perfiles() {
    return this.match.perfiles();
  }

  @Get('profesionales/:id/disponibilidad')
  disponibilidad(@Param('id', Uuid) id: string, @Query() rango: RangoPublicoDto) {
    return this.match.disponibilidad(id, rango.desde, rango.hasta);
  }

  @Get('match')
  buscar(@Query() dto: MatchDto) {
    return this.match.match(dto);
  }
}

@Controller('portal')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('equipo')
  @Roles('PACIENTE')
  equipo() {
    return this.portal.equipo();
  }

  @Get('citas')
  @Roles('PACIENTE')
  citas() {
    return this.portal.citas();
  }

  @Get('citas/:id/datos-pago')
  @Roles('PACIENTE')
  datosPago(@Param('id', Uuid) id: string) {
    return this.portal.datosPago(id);
  }

  @Post('mensajes')
  @Roles('PACIENTE')
  enviarMensaje(@Body() dto: MensajeDto) {
    return this.portal.enviarMensaje(dto.profesionalId, dto.contenido);
  }

  @Post('epicrisis')
  @Roles('PACIENTE')
  solicitarEpicrisis(@Body() dto: SolicitarEpicrisisDto) {
    return this.portal.solicitarEpicrisis(dto.motivo);
  }
}

/** Mensajes: el paciente ve los enviados; el profesional los recibidos. ADMIN/GESTION nunca (contenido). */
@Controller('mensajes')
export class MensajesController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Roles('PACIENTE', 'PROFESIONAL', 'PRACTICANTE')
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

@Controller('epicrisis')
export class EpicrisisController {
  constructor(private readonly portal: PortalService) {}

  @Get()
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PRACTICANTE', 'PACIENTE')
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
