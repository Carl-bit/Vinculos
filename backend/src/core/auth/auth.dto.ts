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
