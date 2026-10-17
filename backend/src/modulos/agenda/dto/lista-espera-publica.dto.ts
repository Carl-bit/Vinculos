import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

import { Recortar, TELEFONO_CL } from '../../../core/validacion/validadores';

/**
 * Lista de espera publica (03b): sin cuenta, por profesional (por tipo de
 * atencion queda pendiente). La aceptacion de la politica de datos va con su
 * version (id de GET /publico/politicas/POLITICA_DATOS).
 */
export class InscribirListaEsperaDto {
  @IsUUID()
  profesionalId!: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  @IsUUID()
  politicaId!: string;

  /** Trampa para bots: un humano lo deja vacio. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sitioWeb?: string;
}

export class TokenListaEsperaDto {
  @IsString()
  @Length(20, 200)
  token!: string;
}

/** Respuesta de la inscripcion: siempre la misma (no revela si el correo ya estaba inscrito). */
export class InscripcionListaEspera {
  verificacionEnviada!: boolean;
  /** Vencimiento del enlace de verificacion (24 horas). */
  expiraEn!: Date;
}

/** Inscripcion verificada: vigente hasta expiraEn (configuracion_centro.dias_lista_espera_publica). */
export class InscripcionVerificada {
  expiraEn!: Date;
  @ApiProperty({ type: String, format: 'uuid' })
  profesionalId!: string;
}
