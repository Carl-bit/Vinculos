import { Rol, ModeloCobro } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
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

import { IsRut, NormalizarRut, Recortar, TELEFONO_CL } from '../../../core/validacion/validadores';

const minusculas = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class CrearUsuarioDto {
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsEnum(Rol)
  rol!: Rol;

  /** Contraseña inicial (el usuario la cambia en /usuarios/yo/password). */
  @IsString()
  @Length(10, 200)
  password!: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  /** PRACTICANTE: expiracion del acceso, supervisor y periodo de practica. */
  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @Type(() => Date)
  @IsDate()
  fechaExpiracionAcceso?: Date;

  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @IsUUID()
  supervisorId?: string;

  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @Type(() => Date)
  @IsDate()
  fechaInicioPractica?: Date;

  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @Type(() => Date)
  @IsDate()
  fechaTerminoPractica?: Date;

  /** PACIENTE: registro de pacientes vinculado (1:1). */
  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PACIENTE')
  @IsUUID()
  pacienteId?: string;
}

/** Campos no sensibles de la propia cuenta. */
export class EditarMiCuentaDto {
  @IsOptional()
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre?: string;

  /** null borra el telefono. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string | null;
}

export class CambiarPasswordDto {
  @IsString()
  @Length(1, 200)
  actual!: string;

  @IsString()
  @Length(10, 200)
  nueva!: string;
}

/** Solo ADMIN. La expiracion y la reactivacion de practicantes van por /practicantes. */
export class EditarUsuarioDto {
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class EditarConfiguracionDto {
  @IsOptional()
  @IsBoolean()
  rolGestionHabilitado?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  plazoRespuestaDerivacionHoras?: number;

  @IsOptional()
  @IsEnum(ModeloCobro)
  modeloCobro?: ModeloCobro;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  plazoConsentimientoHoras?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  plazoOposicionHoras?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  diasGraciaCierre?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  margenTrasladoMin?: number;

  /** Remitente visible de los correos y emisor de boletas del modelo CENTRO. */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombreCentro?: string;

  @IsOptional()
  @IsRut()
  @NormalizarRut()
  rutCentro?: string;

  /** Politica de cancelacion (Cobros). Los porcentajes se definen con el caso de estudio. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  plazoAvisoCancelacionHoras?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  penalizacionCancelacionPorcentaje?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  cobroInasistenciaPorcentaje?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  comisionCentroPorcentaje?: number;

  /** Recordatorio de citas (02i): horas antes del inicio; 0 = desactivado. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  recordatorioHorasAntes?: number;
}

export class OtorgarAccesoDto {
  @Type(() => Date)
  @IsDate()
  fechaExpiracion!: Date;

  /** Si la supervision cerro (reactivacion): nuevo supervisor, en la misma accion. */
  @IsOptional()
  @IsUUID()
  supervisorId?: string;
}

export class RevocarAccesoDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;
}

export class IniciarBajaDto {
  @IsUUID()
  usuarioId!: string;

  @Type(() => Date)
  @IsDate()
  fechaEfectiva!: Date;
}
