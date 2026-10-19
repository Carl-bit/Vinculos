import { ApiProperty } from '@nestjs/swagger';
import {
  EstadoCandidato,
  EstadoConsentimiento,
  EstadoDerivacion,
  OtorganteConsentimiento,
  RespuestaAviso,
  TipoAvisoConsentimiento,
  TipoConsentimiento,
} from '@prisma/client';
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

/** Consentimiento de atencion con practicante supervisado (02f): estado y quien respondio. */
export class ConsentimientoVista {
  id!: string;
  pacienteId!: string;
  @ApiProperty({ enum: TipoConsentimiento, enumName: 'TipoConsentimiento' })
  tipo!: TipoConsentimiento;
  practicanteId!: string;
  supervisorId!: string;
  @ApiProperty({ type: String, nullable: true })
  derivacionId!: string | null;
  @ApiProperty({ enum: EstadoConsentimiento, enumName: 'EstadoConsentimiento' })
  estado!: EstadoConsentimiento;
  solicitadoEn!: Date;
  venceEn!: Date;
  @ApiProperty({ type: String, nullable: true })
  versionDocumento!: string | null;
  @ApiProperty({ enum: OtorganteConsentimiento, enumName: 'OtorganteConsentimiento', nullable: true })
  otorgadoPorTipo!: OtorganteConsentimiento | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  respondidoEn!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revocadoEn!: Date | null;
}

/** Aviso de cambio de supervisor: el paciente queda conforme o se opone (= revocacion). */
export class AvisoConsentimientoVista {
  id!: string;
  consentimientoId!: string;
  @ApiProperty({ enum: TipoAvisoConsentimiento, enumName: 'TipoAvisoConsentimiento' })
  tipo!: TipoAvisoConsentimiento;
  supervisorAnteriorId!: string;
  supervisorNuevoId!: string;
  notificadoEn!: Date;
  venceEn!: Date;
  @ApiProperty({ enum: RespuestaAviso, enumName: 'RespuestaAviso' })
  respuesta!: RespuestaAviso;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  respondidoEn!: Date | null;
}

class CandidatoDerivacion {
  profesionalId!: string;
  orden!: number;
  @ApiProperty({ enum: EstadoCandidato, enumName: 'EstadoCandidato' })
  estado!: EstadoCandidato;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  venceEn!: Date | null;
}

/** Derivacion (ADMIN o profesionales involucrados, por RLS). Motivo y detalle son texto clinico descifrado. */
export class DerivacionVista {
  id!: string;
  fichaClinicaId!: string;
  /** null si quien consulta ya no ve la ficha (p. ej. el origen tras el traspaso). */
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  profesionalOrigenId!: string;
  @ApiProperty({ type: String, description: 'Texto clinico' })
  motivo!: string;
  tipoAtencionId!: string;
  @ApiProperty({ type: String, nullable: true })
  detalle!: string | null;
  creadaPorId!: string;
  @ApiProperty({ type: String, nullable: true })
  motivoCierre!: string | null;
  @ApiProperty({ enum: EstadoDerivacion, enumName: 'EstadoDerivacion' })
  estado!: EstadoDerivacion;
  fecha!: Date;
  updatedAt!: Date;
  candidatos!: CandidatoDerivacion[];
}

/** Derivacion creada: solo el id (de oficio, el supervisor no ve la derivacion). */
export class DerivacionCreada {
  id!: string;
}

// ---------------------------------------------------------------------------
// 03b-5.2: respuestas que faltaban en el OpenAPI.
// ---------------------------------------------------------------------------

/** Bandeja de ADMIN y supervisores: solo motivo, edad y tipo (sin nombre ni ficha). */
export class DerivacionPendiente {
  derivacionId!: string;
  @ApiProperty({ enum: EstadoDerivacion, enumName: 'EstadoDerivacion' })
  estado!: EstadoDerivacion;
  @ApiProperty({ type: String, nullable: true, description: 'Texto clinico' })
  motivo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  detalle!: string | null;
  tipoAtencion!: string;
  edadPaciente!: number;
}

/** Oferta para el candidato OFRECIDO: solo motivo, edad y tipo; nunca quien la origino ni quien rechazo. */
export class OfertaDerivacion {
  derivacionId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Texto clinico' })
  motivo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  detalle!: string | null;
  tipoAtencion!: string;
  edadPaciente!: number;
  venceEn!: Date;
  /** Citas futuras del paciente que chocan con la agenda del candidato (se reprograman al aceptar). */
  citasEnConflicto!: number;
}

export class DerivacionRespondida {
  derivacionId!: string;
  acepta!: boolean;
}

export class PracticantePropuesto {
  derivacionId!: string;
  practicanteId!: string;
}

export class ConsentimientoSolicitado {
  id!: string;
  pacienteId!: string;
}
