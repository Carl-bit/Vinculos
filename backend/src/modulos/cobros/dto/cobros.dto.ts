import { DecisionCita, MedioPago } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator';

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

export class LiquidacionDto extends PeriodoDto {
  @IsUUID()
  profesionalId!: string;
}
