import { Modalidad, ModalidadAtencion, TipoDocumentoPracticante, TipoTrayectoria } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
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

/** Mi perfil: nombre publico, bio y frase aceptan null para quitarlos (undefined = sin cambio). */
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
  nombrePublico?: string | null;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(2000)
  bio?: string | null;

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

  /** D-7: emite boleta reembolsable (isapre o seguro complementario). */
  @IsOptional()
  @IsBoolean()
  boletaReembolsable?: boolean;

  /** D-7: convenios con los que atiende (FONASA, isapres...). Filtra el match por prevision. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  convenios?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  idiomas?: string[];

  /** Frase destacada del perfil publico. null = quitarla (Mi perfil). */
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(300)
  citaDestacada?: string | null;
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

  /** D-7: emite boleta reembolsable (isapre o seguro complementario). */
  @IsOptional()
  @IsBoolean()
  boletaReembolsable?: boolean;

  /** D-7: convenios con los que atiende (FONASA, isapres...). Filtra el match por prevision. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  convenios?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  idiomas?: string[];

  /** Frase destacada del perfil publico. */
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(300)
  citaDestacada?: string;
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
  // 2026-11-07: el respaldo es un archivo (POST /trayectoria/:id/respaldos); el enlace ya no se recibe.
}

export class VerificarTrayectoriaDto {
  @IsBoolean()
  verificado!: boolean;
}

/** Observacion de la cuenta madre sobre el respaldo de un titulo (2026-11-08). */
export class ObservarTrayectoriaDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  observacion!: string;
}

/** Documento del practicante (2026-11-08): el tipo y la vigencia van en la query (multipart sin campos de texto). */
export class DocumentoPracticanteDto {
  @IsEnum(TipoDocumentoPracticante)
  tipo!: TipoDocumentoPracticante;

  /** Solo el certificado de alumno regular: hasta cuando vale (informativo, no corta el acceso). */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  vigenteHasta?: string;
}

/** Campos del perfil publico que la cuenta madre puede pedir corregir. */
export const CAMPOS_PERFIL = ['nombre_publico', 'especialidad', 'cita_destacada', 'bio', 'enfoques', 'foto_url'] as const;
export type CampoPerfil = (typeof CAMPOS_PERFIL)[number];
/** Los que corrige ella misma a la segunda solicitud sin cambios (la foto no). */
export const CAMPOS_CORREGIBLES = ['nombre_publico', 'especialidad', 'cita_destacada', 'bio', 'enfoques'] as const;

export class PedirCorreccionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsIn(CAMPOS_PERFIL, { each: true })
  campos!: CampoPerfil[];

  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;
}

export class CorregirCampoDto {
  @IsIn(CAMPOS_CORREGIBLES)
  campo!: (typeof CAMPOS_CORREGIBLES)[number];

  /** Valor nuevo (enfoques separados por coma). Vacio = quitar (no para la especialidad). */
  @IsString()
  @MaxLength(2000)
  valor!: string;

  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;
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

export class ProponerTipoAtencionDto {
  @IsUUID()
  tipoAtencionId!: string;
}

/** ADMIN decide una propuesta (PROPUESTO -> APROBADO | RECHAZADO). */
export class RevisarTipoAtencionDto {
  @IsIn(['APROBADO', 'RECHAZADO'])
  estado!: 'APROBADO' | 'RECHAZADO';
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

/** 03b-4.2: numero de registro de prestador (RNPI). null = quitarlo. */
export class InformarRegistroSisDto {
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{1,10}$/, { message: 'El número de registro son solo dígitos (hasta 10)' })
  numero!: string | null;
}

/** ADMIN: verificacion manual (respaldo de la trayectoria) cuando no hay apikey o el RNPI falla. */
export class VerificacionManualSisDto {
  /** false = el registro no corresponde (NO_COINCIDE). */
  @IsBoolean()
  coincide!: boolean;

  @Recortar()
  @IsString()
  @Length(2, 200)
  tituloHabilitante!: string;

  @Recortar()
  @IsString()
  @Length(2, 200)
  institucion!: string;
}
