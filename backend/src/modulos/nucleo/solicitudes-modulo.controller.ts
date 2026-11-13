import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Roles } from '../../core/auth/decoradores';
import { TAGS } from '../../core/docs/openapi';
import { Interno, tokenInterno } from '../../core/interno/interno.guard';
import { AdminInicialService } from './admin-inicial.service';
import { ConfigInternaService } from './config-interna.service';
import {
  AdminInicialDto,
  ConfigInternaDto,
  FiltroSolicitudesInternasDto,
  ResponderSolicitudDto,
  SolicitarModuloDto,
  SolicitudModuloInterna,
  SolicitudModuloVista,
} from './dto/solicitudes-modulo.dto';
import { SolicitudesModuloService } from './solicitudes-modulo.service';

/** Tarea 31: Configuracion > Modulos. Solo la cuenta madre (ADMIN). */
@ApiTags(TAGS.nucleo)
@Controller('configuracion/solicitudes-modulo')
export class SolicitudesModuloController {
  constructor(private readonly solicitudes: SolicitudesModuloService) {}

  @Get()
  @Roles('ADMIN')
  listar(): Promise<SolicitudModuloVista[]> {
    return this.solicitudes.listar();
  }

  /** 422 si el modulo ya esta en ese estado, falta una dependencia o no esta disponible; 409 si ya hay una abierta. */
  @Post()
  @Roles('ADMIN')
  solicitar(@Body() dto: SolicitarModuloDto): Promise<SolicitudModuloVista> {
    return this.solicitudes.solicitar(dto);
  }
}

/**
 * R2 y R3 (Vinculos Control): solo el agente del plano de control, por la red
 * de borde del silo y con el token del silo (core/interno). Fuera del OpenAPI.
 */
@Controller('internal/solicitudes')
@Interno()
export class SolicitudesInternasController {
  constructor(private readonly solicitudes: SolicitudesModuloService) {}

  @Get()
  async listar(@Req() req: Request, @Query() filtro: FiltroSolicitudesInternasDto): Promise<{ solicitudes: SolicitudModuloInterna[] }> {
    return { solicitudes: await this.solicitudes.internas(tokenInterno(req) ?? '', filtro.desde) };
  }

  @Post(':id/respuesta')
  responder(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResponderSolicitudDto) {
    return this.solicitudes.responder(tokenInterno(req) ?? '', id, dto);
  }
}

/**
 * R5 (Vinculos Control, P9): invitacion del ADMIN inicial. 409 si el silo ya
 * tiene una cuenta madre activa o una pendiente con otro correo.
 */
@Controller('internal/admin-inicial')
@Interno()
export class AdminInicialInternoController {
  constructor(private readonly admin: AdminInicialService) {}

  @Post()
  @HttpCode(200)
  invitar(@Req() req: Request, @Body() dto: AdminInicialDto) {
    return this.admin.invitar(tokenInterno(req) ?? '', dto.email, dto.nombre);
  }
}

/** R4 (Vinculos Control): aplicar y leer la revision del manifiesto del silo. */
@Controller('internal/config')
@Interno()
export class ConfigInternaController {
  constructor(private readonly config: ConfigInternaService) {}

  @Get()
  leer(@Req() req: Request) {
    return this.config.leer(tokenInterno(req) ?? '');
  }

  @Post()
  @HttpCode(200)
  aplicar(@Req() req: Request, @Body() dto: ConfigInternaDto) {
    return this.config.aplicar(tokenInterno(req) ?? '', dto);
  }
}
