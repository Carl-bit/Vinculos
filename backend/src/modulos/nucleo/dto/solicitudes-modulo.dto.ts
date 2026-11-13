import { ApiProperty } from '@nestjs/swagger';
import { AccionModulo, EstadoSolicitudModulo, ModuloCentro, Rol } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDate, IsEmail, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';

/** Tarea 31: el ADMIN pide activar o desactivar un modulo (lo aplica el operador de Vinculos). */
export class SolicitarModuloDto {
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro' })
  @IsEnum(ModuloCentro)
  modulo!: ModuloCentro;

  @ApiProperty({ enum: AccionModulo, enumName: 'AccionModulo' })
  @IsEnum(AccionModulo)
  accion!: AccionModulo;

  /** Para que lo necesita el centro (queda en el silo; no sale al plano de control). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

export class SolicitudModuloVista {
  id!: string;
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro' })
  modulo!: ModuloCentro;
  @ApiProperty({ enum: AccionModulo, enumName: 'AccionModulo' })
  accion!: AccionModulo;
  @ApiProperty({ type: String, nullable: true })
  motivo!: string | null;
  @ApiProperty({ enum: EstadoSolicitudModulo, enumName: 'EstadoSolicitudModulo' })
  estado!: EstadoSolicitudModulo;
  /** Respuesta del operador de Vinculos. */
  @ApiProperty({ type: String, nullable: true })
  respuesta!: string | null;
  pedidaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  respondidaEn!: Date | null;
}

/** R2: consulta del plano de control. */
export class FiltroSolicitudesInternasDto {
  /** Solo las actualizadas despues de esta fecha (ISO). Sin fecha: todas (hasta 500). */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;
}

/** R2: lo que sale del silo. Sin motivo ni quien la pidio: solo el rol. */
export class SolicitudModuloInterna {
  id!: string;
  modulo!: ModuloCentro;
  accion!: AccionModulo;
  pedidaPorRol!: Rol;
  pedidaEn!: Date;
  estado!: EstadoSolicitudModulo;
  respondidaEn!: Date | null;
  actualizadaEn!: Date;
}

/** R3: respuesta del plano de control. */
export class ResponderSolicitudDto {
  @IsIn(['APROBADA', 'RECHAZADA', 'APLICADA'])
  estado!: Exclude<EstadoSolicitudModulo, 'PENDIENTE'>;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  respuesta?: string;
}

/** R5: ADMIN inicial del manifiesto (responsables.admin_inicial). */
export class AdminInicialDto {
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @Length(2, 120)
  nombre!: string;
}

/** R4: revision aprobada del manifiesto que el plano de control aplica al silo. */
export class ConfigInternaDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @Matches(/^[0-9a-f]{64}$/)
  hash!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsEnum(ModuloCentro, { each: true })
  modulos!: ModuloCentro[];

  /** Columnas de configuracion_centro (lista cerrada en la BD). */
  @IsObject()
  reglas!: Record<string, unknown>;
}
