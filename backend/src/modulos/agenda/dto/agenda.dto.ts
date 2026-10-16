import { EstadoCita, EstadoListaEspera, ModalidadAtencion, ModoVideollamada, MotivoBloqueoAgenda } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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
}

/** Horario de funcionamiento del box (reemplazo completo; vacio = el del centro). */
export class HorarioEspacioDto {
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => BloqueEspacioDto)
  bloques!: BloqueEspacioDto[];
}

/** "Cubrir sesion" (C-5): otro profesional con acceso clinico temporal vigente en ese horario. */
export class CubrirCitaDto {
  @IsUUID()
  profesionalId!: string;
}

/** Lista de espera por profesional o tipo de atencion (al menos uno). */
export class CrearListaEsperaDto {
  @IsUUID()
  pacienteId!: string;

  @ValidateIf((o: CrearListaEsperaDto) => !o.tipoAtencionId)
  @IsUUID()
  profesionalId?: string;

  @ValidateIf((o: CrearListaEsperaDto) => !o.profesionalId)
  @IsUUID()
  tipoAtencionId?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 500)
  preferencias?: string;
}

export class FiltroListaEsperaDto {
  @IsOptional()
  @IsUUID()
  profesionalId?: string;

  @IsOptional()
  @IsEnum(EstadoListaEspera)
  estado?: EstadoListaEspera;
}

export class CerrarListaEsperaDto {
  @IsIn([EstadoListaEspera.ASIGNADA, EstadoListaEspera.CANCELADA])
  estado!: 'ASIGNADA' | 'CANCELADA';
}
