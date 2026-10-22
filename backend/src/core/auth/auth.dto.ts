import { ApiProperty } from '@nestjs/swagger';
import { Rol } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

import { IsRut, NormalizarRut } from '../validacion/validadores';

const minusculas = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

/** Correo o RUT (este ultimo solo para pacientes, como en la pantalla de inicio). */
export class LoginDto {
  @ValidateIf((o: LoginDto) => !o.rut)
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsRut()
  @NormalizarRut()
  rut?: string;

  @IsString()
  @Length(1, 200)
  password!: string;

  /** Rol con el que trabajar si la cuenta tiene varios (por defecto el principal). */
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;
}

export class RefreshDto {
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class CambioRolDto extends RefreshDto {
  @IsEnum(Rol)
  rol!: Rol;
}

export class DesafioDto {
  @IsString()
  @Length(20, 2000)
  desafio!: string;
}

export class TotpDto extends DesafioDto {
  @Matches(/^\d{6}$/, { message: 'codigo: 6 digitos' })
  codigo!: string;
}

/** Codigo del correo (6 digitos) o de respaldo (XXXXX-XXXXX, con o sin guion). */
export class SegundoFactorDto extends DesafioDto {
  @Matches(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, { message: 'codigo: 6 digitos o un codigo de respaldo' })
  codigo!: string;
}

export class CorreoDto {
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class TokenDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

export class TokenPasswordDto extends TokenDto {
  @IsString()
  @Length(10, 200)
  password!: string;
}

// ---------------------------------------------------------------------------
// Respuestas (documentan el contrato para el cliente generado del front)
// ---------------------------------------------------------------------------

export class Tokens {
  accessToken!: string;
  refreshToken!: string;
  /** Segundos de vida del access token. */
  expiraEn!: number;
  /** Minutos sin actividad tras los que se cierra la sesion (el front la cierra antes de renovar). */
  inactividadMinutos!: number;
  /** Rol activo de la sesion. */
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  /** Roles con los que la cuenta puede trabajar (cambio con /auth/cambio-rol). */
  @ApiProperty({ enum: Rol, enumName: 'Rol', isArray: true })
  roles!: Rol[];
  /**
   * 03b-4.1: solo la primera vez que se verifica por correo (activacion del
   * segundo factor): 10 codigos de respaldo de un solo uso. No se vuelven a
   * mostrar.
   */
  codigosRespaldo?: string[];
}

/**
 * Segundo paso del login (03b-4.1): codigo por correo (obligatorio para el
 * equipo, opcional para pacientes) o TOTP si la API lo habilita y la cuenta
 * lo tiene activo.
 */
export class DesafioSegundoFactor {
  @ApiProperty({ enum: [true] })
  requiereSegundoFactor!: true;
  @ApiProperty({ enum: ['CORREO', 'TOTP'] })
  metodo!: 'CORREO' | 'TOTP';
  /** Primera verificacion de la cuenta: al validarla se entregan los codigos de respaldo. */
  enrolamiento!: boolean;
  /** Correo enmascarado al que se envio el codigo (CORREO). */
  destino!: string | null;
  /** JWT corto (15 min) que identifica el login a medio camino. */
  desafio!: string;
}

/** Enrolamiento TOTP: secreto y URI otpauth para el codigo QR. */
export class EnrolamientoTotp {
  secreto!: string;
  uri!: string;
}
