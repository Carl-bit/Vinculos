import { Modalidad, ModalidadAtencion, TipoTrayectoria } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
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
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { IsRut, NormalizarRut, Recortar } from '../../../core/validacion/validadores';

/** Bancos aceptados para datos de transferencia (la BD no valida lo cifrado). */
export const BANCOS = [
  'Banco de Chile',
  'BancoEstado',
  'Santander',
  'BCI',
  'Scotiabank',
  'Itau',
  'BICE',
  'Security',
  'Falabella',
  'Ripley',
  'Consorcio',
  'Internacional',
  'Coopeuch',
  'Tenpo',
  'Mercado Pago',
  'MACH',
] as const;
export const TIPOS_CUENTA = ['CORRIENTE', 'VISTA', 'AHORRO', 'CUENTA_RUT'] as const;

export class PerfilDto {
  @Recortar()
  @IsString()
  @Length(2, 120)
  especialidad!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  enfoques?: string[];

  @IsEnum(Modalidad)
  modalidad!: Modalidad;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombrePublico?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  fotoUrl?: string;

  /** Solo el propio lo enciende y exige tarifa general vigente (BD). */
  @IsOptional()
  @IsBoolean()
  perfilPublico?: boolean;

  /** Solo cuenta con modelo de cobro MIXTO. */
  @IsOptional()
  @IsBoolean()
  cobroDirecto?: boolean;
}

export class EditarPerfilDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  especialidad?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  enfoques?: string[];

  @IsOptional()
  @IsEnum(Modalidad)
  modalidad?: Modalidad;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombrePublico?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  fotoUrl?: string;

  @IsOptional()
  @IsBoolean()
  perfilPublico?: boolean;

  @IsOptional()
  @IsBoolean()
  cobroDirecto?: boolean;
}

export class MargenDto {
  /** null = usa el margen del centro. */
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(600)
  margenTrasladoMin!: number | null;
}

export class TrayectoriaDto {
  @IsEnum(TipoTrayectoria)
  tipo!: TipoTrayectoria;

  @Recortar()
  @IsString()
  @Length(2, 200)
  titulo!: string;

  @Recortar()
  @IsString()
  @Length(2, 200)
  institucion!: string;

  @IsInt()
  @Min(1950)
  @Max(2100)
  anio!: number;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 40)
  registroSuperintendencia?: string;

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  documentoRespaldoUrl?: string;
}

export class VerificarTrayectoriaDto {
  @IsBoolean()
  verificado!: boolean;
}

export class DatosPrivadosDto {
  @IsOptional()
  @NormalizarRut()
  @IsRut()
  rut?: string;

  @IsOptional()
  @IsIn(BANCOS)
  banco?: string;

  @IsOptional()
  @IsIn(TIPOS_CUENTA)
  tipoCuenta?: string;

  @IsOptional()
  @Matches(/^\d{4,20}$/, { message: 'numeroCuenta: solo digitos (4 a 20)' })
  numeroCuenta?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  titular?: string;
}

export class TarifaDto {
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  monto!: number;

  /** Tipo y modalidad nulos = tarifa general (obligatoria para publicar). */
  @IsOptional()
  @IsUUID()
  tipoAtencionId?: string;

  @IsOptional()
  @IsEnum(ModalidadAtencion)
  modalidad?: ModalidadAtencion;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  vigenteDesde?: Date;
}

export class TipoAtencionDto {
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(500)
  descripcion?: string;
}

export class EditarTipoAtencionDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(500)
  descripcion?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class AsignarTiposAtencionDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  tipoAtencionIds!: string[];
}

export class CambiarSupervisorDto {
  @IsUUID()
  supervisorId!: string;
}

export class ComentarioDto {
  @Recortar()
  @IsString()
  @Length(1, 5000)
  texto!: string;
}
