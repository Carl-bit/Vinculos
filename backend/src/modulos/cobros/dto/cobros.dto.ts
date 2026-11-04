import { CobradorAcuerdo, DecisionCita, MedioPago, ModeloCobro, TipoComisionDerivacion, TipoDocumentoTributario } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

/** Montos en CLP enteros. El sobrepago lo rechaza la BD (422). */
export class RegistrarPagoDto {
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  monto!: number;

  @IsEnum(MedioPago)
  medioPago!: MedioPago;
}

export class AnularPagoDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;
}

/**
 * AUD-01 (E1.4): boleta o factura emitida fuera del sistema (SII). La
 * registra quien cobro la cita; el monto no supera lo pagado sin documentar.
 */
export class RegistrarDocumentoTributarioDto {
  @IsEnum(TipoDocumentoTributario)
  tipo!: TipoDocumentoTributario;

  /** Folio del SII: solo digitos (hasta 12). */
  @Recortar()
  @Matches(/^\d{1,12}$/, { message: 'El folio son solo dígitos (hasta 12)' })
  folio!: string;

  /** AAAA-MM-DD (fecha de Chile), no futura. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  fechaEmision!: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  monto!: number;
}

/**
 * Decision de cobro (politica de cancelacion): TRASLADO exige la cita nueva
 * (credito o reprogramacion); DEVOLUCION e INASISTENCIA no la llevan.
 */
export class ResolverCitaDto {
  @IsEnum(DecisionCita)
  decision!: DecisionCita;

  @ValidateIf((o: ResolverCitaDto) => o.decision === 'TRASLADO')
  @IsUUID()
  citaNuevaId?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

export class FiltroCobrosDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hasta?: Date;

  @IsOptional()
  @IsUUID()
  profesionalId?: string;
}

/** Periodo [desde, hasta) en fechas (AAAA-MM-DD). */
export class PeriodoDto {
  @Type(() => Date)
  @IsDate()
  desde!: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}

export class ArriendoDto extends PeriodoDto {
  @IsUUID()
  profesionalId!: string;

  @IsOptional()
  @IsUUID()
  espacioId?: string;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  monto!: number;
}

/**
 * Version nueva del acuerdo de un profesional (ADMIN). modelo DIRECTO = A
 * (cobra el profesional), CENTRO = B (cobra el centro), MIXTO = C (`cobra`
 * decide). Rige desde vigenteDesde; nunca dentro de un periodo liquidado (422).
 */
export class AcuerdoProfesionalDto {
  @IsUUID()
  profesionalId!: string;

  @IsEnum(ModeloCobro)
  modelo!: ModeloCobro;

  @IsEnum(CobradorAcuerdo)
  cobra!: CobradorAcuerdo;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  comisionPorcentaje!: number;

  @IsEnum(TipoComisionDerivacion)
  comisionDerivacionTipo!: TipoComisionDerivacion;

  /** Porcentaje (0 a 100) o monto en pesos segun el tipo; 0 con GENERAL. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  comisionDerivacionValor!: number;

  @IsInt()
  @Min(0)
  @Max(100_000_000)
  cuotaMensual!: number;

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  cargoBoxHora!: number;

  @IsBoolean()
  ivaBox!: boolean;

  @Type(() => Date)
  @IsDate()
  vigenteDesde!: Date;
}

export class LiquidacionDto extends PeriodoDto {
  @IsUUID()
  profesionalId!: string;
}
