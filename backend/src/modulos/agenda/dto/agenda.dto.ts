import { EstadoCita, ModalidadAtencion, ModoVideollamada, MotivoBloqueoAgenda } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

export class CrearEspacioDto {
  @Recortar()
  @IsString()
  @Length(1, 80)
  nombre!: string;

  /** Descripcion corta (sala amplia, trabajo familiar...). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 200)
  nota?: string;

  /** Duracion de sesion sugerida para este box (presentacion). */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(240)
  duracionDefectoMin?: number;
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

  /** Descripcion corta (sala amplia, trabajo familiar...). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 200)
  nota?: string;

  /** Duracion de sesion sugerida para este box (presentacion). */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(240)
  duracionDefectoMin?: number;
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

  // 03b: sin espacioId. La hora cae dentro de un bloque del profesional y la
  // BD le asigna el box de ese bloque si es presencial.

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

/** Sala de videollamada propia: ENLACE_PROPIO exige su URL https (se guarda cifrada); JITSI no lleva enlace. */
export class SalaDto {
  @IsEnum(ModoVideollamada)
  modo!: ModoVideollamada;

  @ValidateIf((o: SalaDto) => o.modo === 'ENLACE_PROPIO')
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  enlace?: string;
}

export class BloqueEspacioDto {
  /** ISO: 1 = lunes ... 7 = domingo. */
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

  /** 03b: periodo en que rige (semana, mes, trimestre). Sin fechas = siempre. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vigenteDesde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vigenteHasta?: Date;
}

/** Horario de funcionamiento del box (reemplazo completo; vacio = el del centro). */
export class HorarioEspacioDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BloqueEspacioDto)
  bloques!: BloqueEspacioDto[];
}

/** "Cubrir sesion" (C-5): otro profesional con acceso clinico temporal vigente en ese horario. */
export class CubrirCitaDto {
  @IsUUID()
  profesionalId!: string;

  /**
   * Solo ADMIN: otorga en la misma transaccion el acceso clinico temporal de
   * reemplazo (lectura y escritura) hasta esta fecha. Si cubrir falla, el
   * acceso no queda otorgado.
   */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  otorgarAccesoHasta?: Date;
}

/** 03b: horas de un box que el profesional aparta (dentro del horario del box). */
export class BloqueAtencionDto {
  @IsUUID()
  espacioId!: string;

  @Type(() => Date)
  @IsDate()
  inicio!: Date;

  @Type(() => Date)
  @IsDate()
  fin!: Date;
}

/** Apartar varias horas de una vez (p. ej. el mismo bloque varias semanas): todas o ninguna. */
export class ApartarBloquesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(120)
  @ValidateNested({ each: true })
  @Type(() => BloqueAtencionDto)
  bloques!: BloqueAtencionDto[];
}
