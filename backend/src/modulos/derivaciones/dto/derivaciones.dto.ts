import { OtorganteConsentimiento } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

export class CrearDerivacionDto {
  @IsUUID()
  fichaId!: string;

  /** Texto clinico: no vacio (antes era un CHECK de la BD; ahora va cifrado). */
  @Recortar()
  @IsString()
  @Length(1, 5000)
  motivo!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 10_000)
  detalle?: string;

  @IsUUID()
  tipoAtencionId!: string;

  /** Orden de oferta. Puede ir vacio (de oficio: luego ADMIN o el supervisor proponen). */
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  candidatos!: string[];
}

export class CandidatosDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  candidatos!: string[];
}

export class ProponerPracticanteDto {
  @IsUUID()
  practicanteId!: string;
}

export class ResponderDerivacionDto {
  @IsBoolean()
  acepta!: boolean;
}

export class CancelarDerivacionDto {
  @Recortar()
  @IsString()
  @Length(3, 1000)
  motivo!: string;
}

/** Responde el paciente (si es menor, en nombre de un adulto responsable) o ADMIN/GESTION con respaldo. */
class OtorganteDto {
  @IsEnum(OtorganteConsentimiento)
  otorgadoPorTipo!: OtorganteConsentimiento;

  @ValidateIf((o: OtorganteDto) => o.otorgadoPorTipo === 'ADULTO_RESPONSABLE')
  @IsUUID()
  adultoResponsableId?: string;

  /** Documento firmado escaneado (obligatorio para ADMIN/GESTION: lo exige la BD). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 500)
  respaldoDocumentoRef?: string;
}

export class ResponderConsentimientoDto extends OtorganteDto {
  @IsBoolean()
  acepta!: boolean;

  @ValidateIf((o: ResponderConsentimientoDto) => o.acepta)
  @Recortar()
  @IsString()
  @Length(1, 40)
  versionDocumento?: string;
}

export class RevocarConsentimientoDto extends OtorganteDto {}

export class ResponderAvisoDto extends OtorganteDto {
  @IsIn(['CONFORME', 'OPOSICION'])
  respuesta!: 'CONFORME' | 'OPOSICION';
}

export class SolicitarConsentimientoDto {
  @IsUUID()
  pacienteId!: string;
}
