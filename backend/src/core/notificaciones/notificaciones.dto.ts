import { ApiProperty } from '@nestjs/swagger';
import { TipoNotificacion } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Personalizacion de una plantilla (ADMIN). Las variables las valida la BD (variable no permitida: 23514 -> 422). */
export class EditarPlantillaDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @Length(1, 200)
  asunto?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @Length(1, 4000)
  cuerpo?: string;

  /** BANDEJA no se desactiva (CHECK -> 422). */
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

/** Solo lo desactivable: los avisos legales no tienen campo (un campo extra es 400). */
export class PreferenciasDto {
  @IsOptional()
  @IsBoolean()
  recordatorios?: boolean;

  @IsOptional()
  @IsBoolean()
  avisosOperativos?: boolean;
}

/** Mensaje de la bandeja propia (registro oficial, ya armado con la plantilla). */
export class MensajeBandeja {
  id!: string;
  @ApiProperty({ enum: TipoNotificacion, enumName: 'TipoNotificacion' })
  tipo!: TipoNotificacion;
  @ApiProperty({ type: String, nullable: true, description: 'Cita, documento, consentimiento, etc. segun el tipo' })
  referenciaId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  asunto!: string | null;
  @ApiProperty({ type: String, nullable: true })
  cuerpo!: string | null;
  creadaEn!: Date;
}

/** Avisos que el paciente (o su adulto responsable) elige recibir por correo. Los avisos legales no se apagan. */
export class Preferencias {
  recordatorios!: boolean;
  avisosOperativos!: boolean;
}

/** Plantilla de mensaje por evento, destinatario y canal; *Ejemplo es el texto original para restaurar. */
export class PlantillaMensajeVista {
  id!: string;
  @ApiProperty({ description: 'TipoNotificacion' })
  evento!: string;
  @ApiProperty({ enum: ['PACIENTE', 'EQUIPO'], enumName: 'DestinatarioMensaje' })
  destinatario!: 'PACIENTE' | 'EQUIPO';
  @ApiProperty({ enum: ['BANDEJA', 'CORREO', 'WHATSAPP'], enumName: 'CanalMensaje' })
  canal!: 'BANDEJA' | 'CORREO' | 'WHATSAPP';
  asunto!: string;
  cuerpo!: string;
  activa!: boolean;
  asuntoEjemplo!: string;
  cuerpoEjemplo!: string;
  updatedAt!: Date;
}
