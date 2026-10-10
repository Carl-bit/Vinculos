import { EstadoEpicrisis, ModalidadAtencion } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Min, ValidateIf } from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

export class RangoPublicoDto {
  @Type(() => Date)
  @IsDate()
  desde!: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}

/** Match: necesidad (tipo de atencion) > tiempos (huecos en el rango) > precio (tarifa maxima). */
export class MatchDto {
  /** Nombre del tipo de atencion (como lo entrega el perfil publico). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  tipoAtencion?: string;

  @IsOptional()
  @IsEnum(ModalidadAtencion)
  modalidad?: ModalidadAtencion;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hasta?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  tarifaMaxima?: number;
}

export class MensajeDto {
  @IsUUID()
  profesionalId!: string;

  @Recortar()
  @IsString()
  @Length(1, 5000)
  contenido!: string;
}

export class SolicitarEpicrisisDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 2000)
  motivo?: string;
}

export class ResolverEpicrisisDto {
  @IsIn([EstadoEpicrisis.EN_PROCESO, EstadoEpicrisis.ENTREGADA, EstadoEpicrisis.RECHAZADA])
  estado!: 'EN_PROCESO' | 'ENTREGADA' | 'RECHAZADA';

  @ValidateIf((o: ResolverEpicrisisDto) => o.estado === 'ENTREGADA')
  @Recortar()
  @IsString()
  @Length(1, 500)
  documentoRef?: string;
}
