import { TipoHiloInterno } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

/** Largo maximo de un mensaje interno (la BD limita el cifrado). */
export const MAX_MENSAJE_INTERNO = 4000;

export class CrearHiloDto {
  @IsEnum(TipoHiloInterno)
  tipo!: TipoHiloInterno;

  /** En un hilo GENERAL no se nombra a pacientes (regla documentada). */
  @Recortar()
  @IsString()
  @Length(1, 200)
  asunto!: string;

  /** Solo CASO: paciente con acceso clinico vigente del autor. */
  @ValidateIf((o: CrearHiloDto) => o.tipo === TipoHiloInterno.CASO)
  @IsUUID()
  pacienteId?: string;

  /** Solo GENERAL: integrantes vigentes del equipo (el creador participa siempre). */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  participantes?: string[];
}

export class ListarHilosDto {
  @IsOptional()
  @IsUUID()
  pacienteId?: string;
}

export class MensajeInternoDto {
  @Recortar()
  @IsString()
  @Length(1, MAX_MENSAJE_INTERNO)
  contenido!: string;
}

export class ParticipantesDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  participantes!: string[];
}

export class EspecialidadDto {
  @Recortar()
  @IsString()
  @Length(2, 80)
  nombre!: string;
}

export class EditarEspecialidadDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class DeclararEspecialidadDto {
  @IsUUID()
  especialidadId!: string;
}

export class RevisarEspecialidadDto {
  @IsBoolean()
  aprobar!: boolean;
}
