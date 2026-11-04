/**
 * Respuestas de Cobros (03b-3): solo documentan el contrato para el cliente
 * generado del front. Los nombres en snake_case vienen de la vista
 * estado_pago_citas (RLS de quien consulta: el paciente ve lo suyo).
 */
import { ApiProperty } from '@nestjs/swagger';
import {
  CobradorAcuerdo,
  ModeloCobro,
  TipoComisionDerivacion,
  CobradoPor,
  DecisionCita,
  EstadoDocumentoTributario,
  EstadoLiquidacion,
  EstadoPago,
  MedioPago,
  OrigenPago,
  TipoDocumentoTributario,
} from '@prisma/client';

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
  /** 03b-4.2: la cita tiene resolucion INASISTENCIA (solo en el listado). */
  @ApiProperty({ required: false })
  inasistencia?: boolean;
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
  /** 03b-3.3: TRASLADO o DEVOLUCION de una cita confirmada ya terminada (se trata como cancelacion tardia). */
  inasistenciaJustificada!: boolean;
  decididoEn!: Date;
}

/**
 * 03b-3.3: deuda por paciente (sesiones terminadas con saldo, pasados los
 * dias de gracia). Con el bloqueo del centro activo, el paciente no agenda
 * hasta regularizar. Sin nombres: el panel los pone con lo que ya ve.
 */
export class DeudaPaciente {
  paciente_id!: string;
  sesiones!: number;
  saldo!: number;
  /** Fin de la sesion impaga mas antigua. */
  desde!: Date;
  @ApiProperty({ type: String, isArray: true, description: 'Citas con saldo, de la mas antigua a la mas reciente' })
  citas!: string[];
}

/** AUD-01: comprobante de pago interno, no tributario (numero "CP-"; los antiguos "SIM-"). */
export class ComprobantePagoVista {
  id!: string;
  citaId!: string;
  /** Numero interno del comprobante (no es un folio del SII). */
  numero!: string;
  monto!: number;
  @ApiProperty({ type: String, nullable: true })
  emisorNombre!: string | null;
  @ApiProperty({ type: String, nullable: true })
  emisorRut!: string | null;
  createdAt!: Date;
}

/** AUD-01 (E1.4): documento tributario emitido fuera del sistema. */
export class DocumentoTributarioVista {
  id!: string;
  citaId!: string;
  @ApiProperty({ enum: TipoDocumentoTributario, enumName: 'TipoDocumentoTributario' })
  tipo!: TipoDocumentoTributario;
  folio!: string;
  @ApiProperty({ enum: CobradoPor, enumName: 'CobradoPor', description: 'Quien lo emitio: el centro o el profesional con cobro directo' })
  emisor!: CobradoPor;
  @ApiProperty({ type: String, format: 'date', description: 'AAAA-MM-DD' })
  fechaEmision!: string;
  monto!: number;
  @ApiProperty({ enum: EstadoDocumentoTributario, enumName: 'EstadoDocumentoTributario' })
  estado!: EstadoDocumentoTributario;
  registradoEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  anuladoEn!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  motivoAnulacion!: string | null;
}

export class DetalleCobroCita extends EstadoPagoCitaVista {
  pagos!: PagoVista[];
  @ApiProperty({ type: ResolucionCitaVista, nullable: true })
  resolucion!: ResolucionCitaVista | null;
  @ApiProperty({ type: ComprobantePagoVista, nullable: true })
  comprobante!: ComprobantePagoVista | null;
  /** AUD-01: boletas o facturas del SII registradas (vigentes y anuladas). */
  documentosTributarios!: DocumentoTributarioVista[];
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

/** Version de un acuerdo por profesional (append-only; la vigente es la ultima con vigenteDesde <= hoy). */
export class AcuerdoProfesionalVista {
  id!: string;
  profesionalId!: string;
  @ApiProperty({ enum: ModeloCobro, enumName: 'ModeloCobro' })
  modelo!: ModeloCobro;
  @ApiProperty({ enum: CobradorAcuerdo, enumName: 'CobradorAcuerdo' })
  cobra!: CobradorAcuerdo;
  @ApiProperty({ type: String, description: 'Decimal (porcentaje sobre lo cobrado)' })
  comisionPorcentaje!: unknown;
  @ApiProperty({ enum: TipoComisionDerivacion, enumName: 'TipoComisionDerivacion' })
  comisionDerivacionTipo!: TipoComisionDerivacion;
  @ApiProperty({ type: String, description: 'Decimal (porcentaje o pesos segun el tipo)' })
  comisionDerivacionValor!: unknown;
  cuotaMensual!: number;
  cargoBoxHora!: number;
  ivaBox!: boolean;
  @ApiProperty({ type: String, format: 'date' })
  vigenteDesde!: Date;
  creadoPorId!: string;
  createdAt!: Date;
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
  /** C-11: parte de totalCobrado que viene de cargos por inasistencia y cancelacion tardia. */
  cargosLiquidados!: number;
  @ApiProperty({ type: String, description: 'Decimal (porcentaje de comision del centro)' })
  comisionPorcentaje!: unknown;
  /** Comision total del centro (general + derivacion). */
  comision!: number;
  /** 03b-4.2 (C-10): parte de la comision por sesiones de pacientes traidos por el centro (0 con regla GENERAL). */
  comisionDerivacion!: number;
  sesionesDerivadas!: number;
  arriendos!: number;
  /** Acuerdo del profesional que rigio (null = reglas del centro). */
  @ApiProperty({ type: String, nullable: true })
  acuerdoId!: string | null;
  /** Cuota fija del acuerdo: una por cada dia 1 de mes dentro del periodo. */
  cuotaFija!: number;
  @ApiProperty({ type: String, description: 'Decimal (horas de box apartadas en el periodo)' })
  horasBox!: unknown;
  /** Cargo por hora de box del acuerdo x horasBox. */
  usoBox!: number;
  /** Comision de captados que cobro el propio profesional (se la debe al centro). */
  comisionCobroPropio!: number;
  /** total = cobrado - comision - arriendos - cuotaFija - usoBox - comisionCobroPropio; negativo = el profesional le debe al centro. */
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
