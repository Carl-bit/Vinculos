/**
 * 03b-3.1: confirmacion de la cita por medio de pago. Entradas validadas con
 * class-validator y respuestas en un *.dto.ts para que el plugin de Swagger
 * documente el contrato y el front lo tome del esquema generado.
 */
import { ApiProperty } from '@nestjs/swagger';
import { EstadoTransferencia, MedioConfirmacion } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

import { IsRut, NormalizarRut, Recortar } from '../../../core/validacion/validadores';

/** Token opaco que entrega POST /publico/solicitudes (en el cuerpo: nunca en la URL ni en logs). */
export class ReservaDto {
  @IsString()
  @Length(20, 100)
  reserva!: string;
}

export class MedioReservaDto extends ReservaDto {
  @IsEnum(MedioConfirmacion)
  medio!: MedioConfirmacion;
}

/**
 * 03b-3.4: token del enlace de pago que llega por correo a quien no tiene
 * cuenta (la pagina lo lee de la URL y lo manda en el cuerpo).
 */
export class EnlacePagoDto {
  @IsString()
  @Length(20, 100)
  enlace!: string;
}

export class MedioEnlaceDto extends EnlacePagoDto {
  @IsEnum(MedioConfirmacion)
  medio!: MedioConfirmacion;
}

export class MedioDto {
  @IsEnum(MedioConfirmacion)
  medio!: MedioConfirmacion;
}

export class RechazoTransferenciaDto {
  @Recortar()
  @IsString()
  @Length(3, 300)
  motivo!: string;
}

export class FiltroTransferenciasDto {
  @IsOptional()
  @IsEnum(EstadoTransferencia)
  estado?: EstadoTransferencia;
}

/** Cuenta del centro para transferencias (ADMIN). */
export class CuentaCentroDto {
  @NormalizarRut()
  @IsRut()
  rut!: string;

  @Recortar()
  @IsString()
  @Length(2, 80)
  banco!: string;

  @Recortar()
  @IsString()
  @Length(2, 40)
  tipoCuenta!: string;

  @Matches(/^[0-9-]{4,30}$/, { message: 'numeroCuenta: solo digitos y guiones (4 a 30)' })
  numeroCuenta!: string;

  @Recortar()
  @IsString()
  @Length(2, 120)
  titular!: string;
}

/** Pasarela simulada: resultado que elige quien prueba (modo demostracion). */
export class PagoSimuladoDto {
  @IsUUID()
  referencia!: string;

  @IsBoolean()
  pagado!: boolean;
}

/** 03b-3.4: SALDO_PENDIENTE = sesion ya realizada con saldo, que se paga en linea con los medios del centro. */
export const ESTADOS_RESERVA = ['RETENIDA', 'PENDIENTE_PAGO', 'CONFIRMADA', 'LIBERADA', 'CANCELADA', 'POR_REPROGRAMAR', 'SALDO_PENDIENTE'] as const;
export const SIGUIENTES_PASOS = [
  'VERIFICAR_CORREO',
  'ELEGIR_MEDIO',
  'ESPERAR_VALIDACION',
  'TRANSFERENCIA_RECHAZADA',
  'PAGAR_EN_LINEA',
  'NINGUNO',
  'ELEGIR_OTRA_HORA',
  /** 03b-3.2: el pago llego cuando la hora ya no se podia mantener: el centro lo devuelve. */
  'CONTACTAR_CENTRO',
  /** 03b-3.4: saldo sin medios en linea habilitados: se paga en el centro. */
  'PAGAR_EN_CENTRO',
] as const;

/** Estado de la reserva o de la cita en el flujo de pago: sin datos personales. */
export class EstadoConfirmacion {
  @ApiProperty({ enum: ESTADOS_RESERVA, enumName: 'EstadoReserva' })
  estado!: (typeof ESTADOS_RESERVA)[number];
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Fin de la retencion o plazo de pago' })
  venceEn!: Date | null;
  @ApiProperty({ enum: SIGUIENTES_PASOS, enumName: 'SiguientePasoPago' })
  siguiente!: (typeof SIGUIENTES_PASOS)[number];
  @ApiProperty({ enum: MedioConfirmacion, enumName: 'MedioConfirmacion', isArray: true, nullable: true, description: 'Mientras la hora espera el pago' })
  medios!: MedioConfirmacion[] | null;
  @ApiProperty({ enum: MedioConfirmacion, enumName: 'MedioConfirmacion', nullable: true })
  medio!: MedioConfirmacion | null;
  @ApiProperty({ type: Number, nullable: true, description: 'CLP a pagar: para confirmar (porcentaje configurado) o el saldo (SALDO_PENDIENTE)' })
  monto!: number | null;
  comprobanteRecibido!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Solo con TRANSFERENCIA_RECHAZADA' })
  motivoRechazo!: string | null;
  /** true = la pasarela del centro es la simulada (la UI muestra "modo demostracion"). */
  pasarelaSimulada!: boolean;
}

export class DatosTransferencia {
  @ApiProperty({ enum: ['CENTRO', 'PROFESIONAL'] })
  origen!: 'CENTRO' | 'PROFESIONAL';
  rut!: string;
  banco!: string;
  tipoCuenta!: string;
  numeroCuenta!: string;
  titular!: string;
  monto!: number;
  /** Nulo en el pago del saldo (sin plazo). */
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  venceEn!: Date | null;
}

/** 03b-3.4: la sesion del enlace de pago (sin datos del paciente). */
export class ResumenEnlacePago {
  inicio!: Date;
  fin!: Date;
  @ApiProperty({ enum: ['PRESENCIAL', 'ONLINE'] })
  modalidad!: 'PRESENCIAL' | 'ONLINE';
  @ApiProperty({ type: String, nullable: true })
  profesional!: string | null;
}

export class CobroIniciado {
  /** Referencia del intento (la usa la pantalla de la pasarela simulada). */
  referencia!: string;
  urlPago!: string;
  simulada!: boolean;
}

export class ResultadoPasarela {
  @ApiProperty({ enum: ['PENDIENTE', 'PAGADO', 'FALLIDO'] })
  estado!: 'PENDIENTE' | 'PAGADO' | 'FALLIDO';
}

/** Transferencia de una cita (bandeja del validador; 03b-5 le pone pantalla). */
export class TransferenciaVista {
  id!: string;
  citaId!: string;
  @ApiProperty({ enum: EstadoTransferencia, enumName: 'EstadoTransferencia' })
  estado!: EstadoTransferencia;
  comprobanteRecibido!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  comprobanteSubidoEn!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  motivoRechazo!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resueltaEn!: Date | null;
  creadaEn!: Date;
  profesionalId!: string;
  /** 03b-3.2: nulo = reserva sin cuenta (el paciente se crea al validar). */
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  inicio!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pagoVenceEn!: Date | null;
  @ApiProperty({ type: Number, nullable: true })
  monto!: number | null;
}

/** 03b-3.3: hora retenida pagada en caja y concretada (o LIBERADA si ya no se podia mantener: devolucion). */
export class CajaReserva {
  citaId!: string;
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  @ApiProperty({ enum: ['CONFIRMADA', 'LIBERADA'] })
  estado!: 'CONFIRMADA' | 'LIBERADA';
}

export class CuentaCentroVista {
  rut!: string;
  banco!: string;
  tipoCuenta!: string;
  numeroCuenta!: string;
  titular!: string;
  updatedAt!: Date;
}
