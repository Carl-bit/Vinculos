import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';

import { Publico, Roles } from '../../core/auth/decoradores';
import { hashToken } from '../../core/auth/tokens-correo';
import { ErrorCuerpoGrande, RespuestaArchivo, TAGS } from '../../core/docs/openapi';
import { Modulo } from '../../core/modulos/modulos';
import { ConfirmacionPagoService } from './confirmacion-pago.service';
import { RegistrarPagoDto } from './dto/cobros.dto';
import {
  CajaReserva,
  CobroIniciado,
  CuentaCentroDto,
  CuentaCentroVista,
  DatosTransferencia,
  EnlacePagoDto,
  EstadoConfirmacion,
  FiltroTransferenciasDto,
  MedioDto,
  MedioEnlaceDto,
  MedioReservaDto,
  PagoSimuladoDto,
  RechazoTransferenciaDto,
  ReservaDto,
  ResultadoPasarela,
  ResumenEnlacePago,
  TransferenciaVista,
} from './dto/confirmacion-pago.dto';

const Uuid = new ParseUUIDPipe();
const PORTAL = ['PACIENTE', 'RESPONSABLE'] as const;
const ARCHIVO = { type: 'string', format: 'binary', description: 'PDF, PNG o JPEG (validado por contenido)' };

const exigirArchivo = (archivo?: Express.Multer.File) => {
  if (!archivo) {
    throw new BadRequestException('Falta el archivo (campo "archivo", multipart/form-data)');
  }
  return archivo;
};

/**
 * Reserva sin cuenta (03b-3.1): el token opaco va en el cuerpo (nunca en la
 * URL ni en logs). El estado sirve aunque el modulo COBROS este inactivo
 * (entonces solo hay retencion y confirmacion); el resto exige COBROS.
 * Rate limit publico por IP.
 */
@ApiTags(TAGS.publico)
@Controller('publico/reservas')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class ReservasPublicoController {
  constructor(private readonly pagos: ConfirmacionPagoService) {}

  /** Solo estado, vencimiento y siguiente paso (sin datos personales). La pestaña lo consulta cada pocos segundos. */
  @Post('estado')
  @HttpCode(200)
  estado(@Body() dto: ReservaDto): Promise<EstadoConfirmacion> {
    return this.pagos.estadoReserva(dto.reserva);
  }

  @Post('medio')
  @HttpCode(200)
  @Modulo('COBROS')
  medio(@Body() dto: MedioReservaDto): Promise<EstadoConfirmacion> {
    return this.pagos.elegirMedio({ tipo: 'reserva', hash: hashToken(dto.reserva) }, dto.medio);
  }

  @Post('transferencia')
  @HttpCode(200)
  @Modulo('COBROS')
  transferencia(@Body() dto: ReservaDto): Promise<DatosTransferencia> {
    return this.pagos.datosTransferencia({ tipo: 'reserva', hash: hashToken(dto.reserva) });
  }

  /** Comprobante opcional (multipart: campos "reserva" y "archivo"). */
  @Post('comprobante')
  @HttpCode(200)
  @Modulo('COBROS')
  @UseInterceptors(FileInterceptor('archivo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['reserva', 'archivo'], properties: { reserva: { type: 'string' }, archivo: ARCHIVO } } })
  @ErrorCuerpoGrande()
  comprobante(@Body() dto: ReservaDto, @UploadedFile() archivo?: Express.Multer.File): Promise<EstadoConfirmacion> {
    return this.pagos.subirComprobante({ tipo: 'reserva', hash: hashToken(dto.reserva) }, exigirArchivo(archivo));
  }

  @Post('pasarela')
  @HttpCode(200)
  @Modulo('COBROS')
  pasarela(@Body() dto: ReservaDto): Promise<CobroIniciado> {
    return this.pagos.iniciarPasarela({ tipo: 'reserva', hash: hashToken(dto.reserva) });
  }
}

/**
 * 03b-3.4: enlace de pago de una cita para quien no tiene cuenta (correos de
 * pago pendiente y de deuda). El token va en el cuerpo; varios usos hasta
 * vencer; solo autoriza ver el estado y pagar ESA cita (pendiente de pago o
 * saldo de una sesion realizada). Rate limit publico por IP.
 */
@ApiTags(TAGS.publico)
@Controller('publico/pagos')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
@Modulo('COBROS')
export class PagosEnlaceController {
  constructor(private readonly pagos: ConfirmacionPagoService) {}

  private camino(enlace: string) {
    return { tipo: 'enlace' as const, hash: hashToken(enlace), token: enlace };
  }

  /** Fecha, hora, modalidad y profesional de la sesion (sin datos del paciente). Vencido: 409; inexistente: 404. */
  @Post('resumen')
  @HttpCode(200)
  resumen(@Body() dto: EnlacePagoDto): Promise<ResumenEnlacePago> {
    return this.pagos.resumenEnlace(dto.enlace);
  }

  @Post('estado')
  @HttpCode(200)
  estado(@Body() dto: EnlacePagoDto): Promise<EstadoConfirmacion> {
    return this.pagos.estadoEnlace(this.camino(dto.enlace));
  }

  @Post('medio')
  @HttpCode(200)
  medio(@Body() dto: MedioEnlaceDto): Promise<EstadoConfirmacion> {
    return this.pagos.elegirMedio(this.camino(dto.enlace), dto.medio);
  }

  @Post('transferencia')
  @HttpCode(200)
  transferencia(@Body() dto: EnlacePagoDto): Promise<DatosTransferencia> {
    return this.pagos.datosTransferencia(this.camino(dto.enlace));
  }

  /** Comprobante (multipart: campos "enlace" y "archivo"). */
  @Post('comprobante')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('archivo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['enlace', 'archivo'], properties: { enlace: { type: 'string' }, archivo: ARCHIVO } } })
  @ErrorCuerpoGrande()
  comprobante(@Body() dto: EnlacePagoDto, @UploadedFile() archivo?: Express.Multer.File): Promise<EstadoConfirmacion> {
    return this.pagos.subirComprobante(this.camino(dto.enlace), exigirArchivo(archivo));
  }

  @Post('pasarela')
  @HttpCode(200)
  pasarela(@Body() dto: EnlacePagoDto): Promise<CobroIniciado> {
    return this.pagos.iniciarPasarela(this.camino(dto.enlace));
  }
}

/** Pago de una cita desde la cuenta del paciente o de su adulto responsable (cuenta plena). */
@ApiTags(TAGS.portal)
@Controller('portal/citas')
@Modulo('COBROS')
export class PagoPortalController {
  constructor(private readonly pagos: ConfirmacionPagoService) {}

  @Get(':id/pago')
  @Roles(...PORTAL)
  estado(@Param('id', Uuid) id: string): Promise<EstadoConfirmacion> {
    return this.pagos.estadoPortal(id);
  }

  @Post(':id/medio')
  @HttpCode(200)
  @Roles(...PORTAL)
  medio(@Param('id', Uuid) id: string, @Body() dto: MedioDto): Promise<EstadoConfirmacion> {
    return this.pagos.elegirMedio({ tipo: 'portal', citaId: id }, dto.medio);
  }

  /** Queda en accesos_ficha (DATOS_PAGO). */
  @Get(':id/transferencia')
  @Roles(...PORTAL)
  transferencia(@Param('id', Uuid) id: string): Promise<DatosTransferencia> {
    return this.pagos.datosTransferencia({ tipo: 'portal', citaId: id });
  }

  @Post(':id/comprobante')
  @HttpCode(200)
  @Roles(...PORTAL)
  @UseInterceptors(FileInterceptor('archivo'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['archivo'], properties: { archivo: ARCHIVO } } })
  @ErrorCuerpoGrande()
  comprobante(@Param('id', Uuid) id: string, @UploadedFile() archivo?: Express.Multer.File): Promise<EstadoConfirmacion> {
    return this.pagos.subirComprobante({ tipo: 'portal', citaId: id }, exigirArchivo(archivo));
  }

  @Post(':id/pasarela')
  @HttpCode(200)
  @Roles(...PORTAL)
  pasarela(@Param('id', Uuid) id: string): Promise<CobroIniciado> {
    return this.pagos.iniciarPasarela({ tipo: 'portal', citaId: id });
  }
}

/**
 * Transferencias por validar y cuenta del centro. Valida GESTION/ADMIN
 * (cobro del centro) o el profesional de la cita (cobro directo): la BD lo
 * impone segun el modelo de cobro (matriz_permisos.md).
 */
@ApiTags(TAGS.cobros)
@Controller('cobros')
@Modulo('COBROS')
export class TransferenciasController {
  constructor(private readonly pagos: ConfirmacionPagoService) {}

  @Get('transferencias')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  listar(@Query() filtro: FiltroTransferenciasDto): Promise<TransferenciaVista[]> {
    return this.pagos.listarTransferencias(filtro.estado);
  }

  @Get('transferencias/:id/comprobante')
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  @RespuestaArchivo('application/pdf', 'image/png', 'image/jpeg')
  async comprobante(@Param('id', Uuid) id: string) {
    const c = await this.pagos.comprobante(id);
    return new StreamableFile(c.contenido, { type: c.tipo, disposition: `attachment; filename="${encodeURIComponent(c.nombre)}"` });
  }

  /** Registra el pago (monto de confirmacion) y confirma la cita. */
  @Post('citas/:id/transferencia/validacion')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  validar(@Param('id', Uuid) id: string): Promise<TransferenciaVista> {
    return this.pagos.validarTransferencia(id);
  }

  /**
   * 03b-3.3: pago en caja de una hora retenida presencial (reserva sin cuenta):
   * cubre al menos lo exigido para confirmar y crea paciente, ficha y cita
   * CONFIRMADA. Online: 422 citas_caja_solo_presencial.
   */
  @Post('citas/:id/caja')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  cobrarEnCaja(@Param('id', Uuid) id: string, @Body() dto: RegistrarPagoDto): Promise<CajaReserva> {
    return this.pagos.cobrarEnCaja(id, dto);
  }

  /** Motivo obligatorio; se avisa al paciente y la cita sigue pendiente hasta su plazo. */
  @Post('citas/:id/transferencia/rechazo')
  @HttpCode(200)
  @Roles('ADMIN', 'GESTION', 'PROFESIONAL')
  rechazar(@Param('id', Uuid) id: string, @Body() dto: RechazoTransferenciaDto): Promise<TransferenciaVista> {
    return this.pagos.rechazarTransferencia(id, dto.motivo);
  }

  /** null = sin cuenta registrada. */
  @Get('cuenta-centro')
  @Roles('ADMIN', 'GESTION')
  cuenta(): Promise<CuentaCentroVista | null> {
    return this.pagos.cuentaCentro();
  }

  @Put('cuenta-centro')
  @Roles('ADMIN')
  guardarCuenta(@Body() dto: CuentaCentroDto): Promise<CuentaCentroVista> {
    return this.pagos.guardarCuentaCentro(dto);
  }
}

/**
 * Pasarela: webhook (firma verificada por el adaptador; la BD lo hace
 * idempotente) y, solo con la pasarela simulada, el "pago" de demostracion.
 */
@ApiTags(TAGS.cobros)
@Controller('publico/pasarela')
@Publico()
@UseGuards(ThrottlerGuard)
@SkipThrottle({ login: true })
export class PasarelaController {
  constructor(private readonly pagos: ConfirmacionPagoService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(@Body() cuerpo: Record<string, unknown>, @Headers('x-pasarela-firma') firma?: string): Promise<ResultadoPasarela> {
    return this.pagos.webhook(cuerpo, firma);
  }

  /** Modo demostracion: no se realiza ningun cobro. 404 si la pasarela no es la simulada. */
  @Post('simulada')
  @HttpCode(200)
  simulada(@Body() dto: PagoSimuladoDto): Promise<ResultadoPasarela> {
    return this.pagos.pagoSimulado(dto.referencia, dto.pagado);
  }
}
