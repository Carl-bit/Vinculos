import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { TAGS } from '../../core/docs/openapi';
import { Modulo } from '../../core/modulos/modulos';
import { Roles } from '../../core/auth/decoradores';
import { CobrosService } from './cobros.service';
import { ArriendoVista, DetalleCobroCita, EstadoPagoCitaVista, LiquidacionVista, PagoVista, ReporteCobros } from './dto/cobros-respuestas.dto';
import { AnularPagoDto, ArriendoDto, FiltroCobrosDto, LiquidacionDto, PeriodoDto, RegistrarPagoDto, ResolverCitaDto } from './dto/cobros.dto';

const pdf = (contenido: Buffer, nombre: string) => new StreamableFile(contenido, { type: 'application/pdf', disposition: `attachment; filename="${nombre}"` });

const Uuid = new ParseUUIDPipe();

/**
 * Roles segun matriz_permisos.md (pagos, boletas, resoluciones_cita,
 * arriendos, liquidaciones). La BD aplica igual la RLS y las reglas de cada
 * funcion (p. ej. el profesional registra pagos solo con cobro directo).
 */
@ApiTags(TAGS.cobros)
@Controller('cobros')
@Modulo('COBROS')
export class CobrosController {
  constructor(private readonly cobros: CobrosService) {}

  /** Estado de pago por cita (monto, exigible, pagado, saldo, estado). */
  @Get('citas')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  estados(@Query() filtro: FiltroCobrosDto): Promise<EstadoPagoCitaVista[]> {
    return this.cobros.estados(filtro);
  }

  @Get('citas/:id')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL', 'PACIENTE', 'RESPONSABLE')
  detalle(@Param('id', Uuid) id: string): Promise<DetalleCobroCita> {
    return this.cobros.detalle(id);
  }

  @Post('citas/:id/pagos')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  registrarPago(@Param('id', Uuid) id: string, @Body() dto: RegistrarPagoDto): Promise<DetalleCobroCita> {
    return this.cobros.registrarPago(id, dto);
  }

  @Post('pagos/:id/anulacion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  anular(@Param('id', Uuid) id: string, @Body() dto: AnularPagoDto): Promise<PagoVista> {
    return this.cobros.anularPago(id, dto.motivo);
  }

  /** Cancelacion (a tiempo o tardia) e inasistencia: decision registrada y auditada. */
  @Post('citas/:id/resolucion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  resolver(@Param('id', Uuid) id: string, @Body() dto: ResolverCitaDto): Promise<DetalleCobroCita> {
    return this.cobros.resolver(id, dto);
  }

  @Get('arriendos')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  arriendos(@Query('profesionalId', new ParseUUIDPipe({ optional: true })) profesionalId?: string): Promise<ArriendoVista[]> {
    return this.cobros.arriendos(profesionalId);
  }

  @Post('arriendos')
  @Roles('ADMIN', 'GESTION')
  crearArriendo(@Body() dto: ArriendoDto): Promise<ArriendoVista> {
    return this.cobros.crearArriendo(dto);
  }

  /** Cobros por profesional del periodo (sin datos clinicos). PROFESIONAL: solo los suyos. */
  @Get('reporte')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  reporte(@Query() periodo: PeriodoDto): Promise<ReporteCobros> {
    return this.cobros.reporte(periodo.desde, periodo.hasta);
  }

  @Get('reporte/pdf')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  async reportePdf(@Query() periodo: PeriodoDto) {
    return pdf(await this.cobros.reportePdf(periodo.desde, periodo.hasta), 'reporte-cobros.pdf');
  }

  @Get('liquidaciones/:id/pdf')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  async liquidacionPdf(@Param('id', Uuid) id: string) {
    return pdf(await this.cobros.liquidacionPdf(id), 'liquidacion.pdf');
  }

  /** ADMIN/GESTION todas; el profesional las suyas ya emitidas (RLS). */
  @Get('liquidaciones')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  liquidaciones(@Query('profesionalId', new ParseUUIDPipe({ optional: true })) profesionalId?: string): Promise<LiquidacionVista[]> {
    return this.cobros.liquidaciones(profesionalId);
  }

  @Post('liquidaciones')
  @Roles('ADMIN', 'GESTION')
  generar(@Body() dto: LiquidacionDto): Promise<LiquidacionVista> {
    return this.cobros.generarLiquidacion(dto);
  }

  @Post('liquidaciones/:id/emision')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  emitir(@Param('id', Uuid) id: string): Promise<LiquidacionVista> {
    return this.cobros.avanzarLiquidacion(id, 'EMITIDA');
  }

  @Post('liquidaciones/:id/pago')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION')
  pagar(@Param('id', Uuid) id: string): Promise<LiquidacionVista> {
    return this.cobros.avanzarLiquidacion(id, 'PAGADA');
  }
}
