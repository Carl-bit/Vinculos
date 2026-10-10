import { EstadoCita, ModalidadAtencion, MotivoBloqueoAgenda } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

export class CrearEspacioDto {
  @Recortar()
  @IsString()
  @Length(1, 80)
  nombre!: string;
}

export class EditarEspacioDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class RangoDto {
  @Type(() => Date)
  @IsDate()
  desde!: Date;

  @Type(() => Date)
  @IsDate()
  hasta!: Date;
}

/** Minutos desde la medianoche de Chile: 0 <= inicio < fin <= 1440 (1440 = fin del dia). */
export class CrearDisponibilidadDto {
  @IsInt()
  @Min(1)
  @Max(7)
  diaSemana!: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  inicioMin!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  finMin!: number;

  @IsEnum(ModalidadAtencion)
  modalidad!: ModalidadAtencion;
}

export class CrearBloqueoAgendaDto {
  @Type(() => Date)
  @IsDate()
  inicio!: Date;

  /** Nulo = indefinido. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  fin?: Date;

  /** BAJA solo lo crea iniciar_baja_profesional. */
  @IsIn([MotivoBloqueoAgenda.VACACIONES, MotivoBloqueoAgenda.LICENCIA, MotivoBloqueoAgenda.PERSONAL])
  motivo!: MotivoBloqueoAgenda;
}

/** Horario de una cita o de un soft-lock. */
export class HorarioDto {
  @IsUUID()
  profesionalId!: string;

  @IsEnum(ModalidadAtencion)
  modalidad!: ModalidadAtencion;

  /** Solo PRESENCIAL (la BD lo exige). */
  @ValidateIf((o: HorarioDto) => o.modalidad === 'PRESENCIAL')
  @IsUUID()
  espacioId?: string;

  @Type(() => Date)
  @IsDate()
  inicio!: Date;

  @Type(() => Date)
  @IsDate()
  fin!: Date;
}

export class CrearCitaDto extends HorarioDto {
  @IsUUID()
  pacienteId!: string;
}

export class ReprogramarCitaDto {
  @Type(() => Date)
  @IsDate()
  inicio!: Date;

  @Type(() => Date)
  @IsDate()
  fin!: Date;

  @IsOptional()
  @IsEnum(ModalidadAtencion)
  modalidad?: ModalidadAtencion;

  @IsOptional()
  @IsUUID()
  espacioId?: string;
}

export class FiltroCitasDto {
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

  @IsOptional()
  @IsUUID()
  pacienteId?: string;

  @IsOptional()
  @IsEnum(EstadoCita)
  estado?: EstadoCita;
}
