import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';

import { Roles } from '../../core/auth/decoradores';
import { CobrosService } from './cobros.service';
import { AnularPagoDto, ArriendoDto, FiltroCobrosDto, LiquidacionDto, RegistrarPagoDto, ResolverCitaDto } from './dto/cobros.dto';

const Uuid = new ParseUUIDPipe();

/**
 * Roles segun matriz_permisos.md (pagos, boletas, resoluciones_cita,
 * arriendos, liquidaciones). La BD aplica igual la RLS y las reglas de cada
 * funcion (p. ej. el profesional registra pagos solo con cobro directo).
 */
@Controller('cobros')
export class CobrosController {
  constructor(private readonly cobros: CobrosService) {}

  /** Estado de pago por cita (monto, exigible, pagado, saldo, estado). */
  @Get('citas')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE')
  estados(@Query() filtro: FiltroCobrosDto) {
    return this.cobros.estados(filtro);
  }

  @Get('citas/:id')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE')
  detalle(@Param('id', Uuid) id: string) {
    return this.cobros.detalle(id);
  }

  @Post('citas/:id/pagos')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  registrarPago(@Param('id', Uuid) id: string, @Body() dto: RegistrarPagoDto) {
    return this.cobros.registrarPago(id, dto);
  }

  @Post('pagos/:id/anulacion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  anular(@Param('id', Uuid) id: string, @Body() dto: AnularPagoDto) {
    return this.cobros.anularPago(id, dto.motivo);
  }

  /** Cancelacion (a tiempo o tardia) e inasistencia: decision registrada y auditada. */
  @Post('citas/:id/resolucion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  resolver(@Param('id', Uuid) id: string, @Body() dto: ResolverCitaDto) {
    return this.cobros.resolver(id, dto);
  }

  @Get('arriendos')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  arriendos(@Query('profesionalId', new ParseUUIDPipe({ optional: true })) profesionalId?: string) {
    return this.cobros.arriendos(profesionalId);
  }

  @Post('arriendos')
  @Roles('ADMIN', 'GESTION')
  crearArriendo(@Body() dto: ArriendoDto) {
    return this.cobros.crearArriendo(dto);
  }

  /** ADMIN/GESTION todas; el profesional las suyas ya emitidas (RLS). */
  @Get('liquidaciones')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  liquidaciones(@Query('profesionalId', new ParseUUIDPipe({ optional: true })) profesionalId?: string) {
    return this.cobros.liquidaciones(profesionalId);
  }

  @Post('liquidaciones')
  @Roles('ADMIN', 'GESTION')
  generar(@Body() dto: LiquidacionDto) {
    return this.cobros.generarLiquidacion(dto);
  }

  @Post('liquidaciones/:id/emision')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  emitir(@Param('id', Uuid) id: string) {
    return this.cobros.avanzarLiquidacion(id, 'EMITIDA');
  }

  @Post('liquidaciones/:id/pago')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  pagar(@Param('id', Uuid) id: string) {
    return this.cobros.avanzarLiquidacion(id, 'PAGADA');
  }
}
