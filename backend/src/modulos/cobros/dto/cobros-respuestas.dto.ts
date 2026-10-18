/**
 * Respuestas de Cobros (03b-3): solo documentan el contrato para el cliente
 * generado del front. Los nombres en snake_case vienen de la vista
 * estado_pago_citas (RLS de quien consulta: el paciente ve lo suyo).
 */
import { ApiProperty } from '@nestjs/swagger';
import { CobradoPor, DecisionCita, EstadoLiquidacion, EstadoPago, MedioPago, OrigenPago } from '@prisma/client';

export const ESTADOS_PAGO = ['SIN_COBRO', 'PENDIENTE', 'PARCIAL', 'PAGADO'] as const;

/** estado_pago_citas: monto fijado al confirmar, exigible, pagado, devolucion y saldo. */
export class EstadoPagoCitaVista {
  cita_id!: string;
  profesional_id!: string;
  paciente_id!: string;
  @ApiProperty({ description: 'estado de la cita (CONFIRMADA, CANCELADA, ...)' })
  estado_cita!: string;
  inicio!: Date;
  fin!: Date;
  @ApiProperty({ type: Number, nullable: true })
  monto!: number | null;
  exigible!: number;
  pagado!: number;
  devolucion!: number;
  saldo!: number;
  @ApiProperty({ enum: ESTADOS_PAGO, enumName: 'EstadoPagoCita' })
  estado_pago!: (typeof ESTADOS_PAGO)[number];
}

export class PagoVista {
  id!: string;
  citaId!: string;
  monto!: number;
  @ApiProperty({ enum: MedioPago, enumName: 'MedioPago' })
  medioPago!: MedioPago;
  fecha!: Date;
  @ApiProperty({ enum: EstadoPago, enumName: 'EstadoPago' })
  estado!: EstadoPago;
  @ApiProperty({ enum: OrigenPago, enumName: 'OrigenPago' })
  origen!: OrigenPago;
  @ApiProperty({ enum: CobradoPor, enumName: 'CobradoPor' })
  cobradoPor!: CobradoPor;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  anuladoEn!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  motivoAnulacion!: string | null;
}

export class ResolucionCitaVista {
  @ApiProperty({ enum: DecisionCita, enumName: 'DecisionCita' })
  decision!: DecisionCita;
  @ApiProperty({ type: Boolean, nullable: true })
  aTiempo!: boolean | null;
  @ApiProperty({ type: String, description: 'Decimal (porcentaje aplicado)' })
  porcentaje!: unknown;
  montoExigible!: number;
  montoDevolucion!: number;
  @ApiProperty({ type: String, nullable: true })
  citaNuevaId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  motivo!: string | null;
  decididoEn!: Date;
}

export class BoletaVista {
  id!: string;
  citaId!: string;
  /** Numero simulado (sin SII). */
  numero!: string;
  monto!: number;
  @ApiProperty({ type: String, nullable: true })
  emisorNombre!: string | null;
  @ApiProperty({ type: String, nullable: true })
  emisorRut!: string | null;
  createdAt!: Date;
}

export class DetalleCobroCita extends EstadoPagoCitaVista {
  pagos!: PagoVista[];
  @ApiProperty({ type: ResolucionCitaVista, nullable: true })
  resolucion!: ResolucionCitaVista | null;
  @ApiProperty({ type: BoletaVista, nullable: true })
  boleta!: BoletaVista | null;
}

/** Fila de reporte_cobros(): sesiones realizadas del periodo y montos por profesional (sin datos clinicos). */
export class ReporteCobrosProfesional {
  profesional_id!: string;
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
  sesiones!: number;
  cobrado!: number;
  pendiente!: number;
  comision_estimada!: number;
}

export class ReporteCobrosMedio {
  @ApiProperty({ enum: MedioPago, enumName: 'MedioPago' })
  medio!: MedioPago;
  pagos!: number;
  monto!: number;
}

export class ReporteCobros {
  @ApiProperty({ description: 'AAAA-MM-DD' })
  desde!: string;
  @ApiProperty({ description: 'AAAA-MM-DD (excluyente)' })
  hasta!: string;
  profesionales!: ReporteCobrosProfesional[];
  medios!: ReporteCobrosMedio[];
}

export class ArriendoVista {
  id!: string;
  profesionalId!: string;
  @ApiProperty({ type: String, nullable: true })
  espacioId!: string | null;
  @ApiProperty({ type: String, format: 'date' })
  periodoDesde!: Date;
  @ApiProperty({ type: String, format: 'date' })
  periodoHasta!: Date;
  monto!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

/** Liquidacion: total = cobrado - comision del centro - arriendos. BORRADOR se recalcula; EMITIDA y PAGADA no cambian. */
export class LiquidacionVista {
  id!: string;
  profesionalId!: string;
  @ApiProperty({ type: String, format: 'date' })
  periodoDesde!: Date;
  @ApiProperty({ type: String, format: 'date' })
  periodoHasta!: Date;
  totalCobrado!: number;
  @ApiProperty({ type: String, description: 'Decimal (porcentaje de comision del centro)' })
  comisionPorcentaje!: unknown;
  comision!: number;
  arriendos!: number;
  total!: number;
  @ApiProperty({ enum: EstadoLiquidacion, enumName: 'EstadoLiquidacion' })
  estado!: EstadoLiquidacion;
  creadaPorId!: string;
  creadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  emitidaEn!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pagadaEn!: Date | null;
}
