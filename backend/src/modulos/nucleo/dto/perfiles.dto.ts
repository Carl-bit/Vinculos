import { ApiProperty, PartialType } from '@nestjs/swagger';
import { ModuloCentro, Rol } from '@prisma/client';
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

import { Recortar } from '../../../core/validacion/validadores';

/** Punto 36: solo estos modulos se pueden restringir (sin finanzas ni WhatsApp, fuera del MVP). */
const RESTRINGIBLES = ['PAGINA_PUBLICA', 'FICHAS', 'AGENDA', 'EQUIPO', 'MATCH'] as const;
const BASES = ['ADMIN', 'GESTION', 'PROFESIONAL'] as const;

export class PerfilRolDto {
  @Recortar()
  @IsString()
  @Length(1, 60)
  nombre!: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(300)
  descripcion?: string;

  @ApiProperty({ enum: BASES })
  @IsIn(BASES)
  rolBase!: (typeof BASES)[number];

  /** Modulos que este perfil NO ve (nunca amplia lo que permite el rol base). */
  @ApiProperty({ enum: RESTRINGIBLES, isArray: true })
  @IsArray()
  @ArrayUnique()
  @IsIn(RESTRINGIBLES, { each: true })
  restricciones!: (typeof RESTRINGIBLES)[number][];
}

export class EditarPerfilRolDto extends PartialType(PerfilRolDto) {}

export class AsignarPerfilDto {
  @IsUUID()
  usuarioId!: string;
}

export class PerfilRolVista {
  id!: string;
  nombre!: string;
  @ApiProperty({ type: String, nullable: true })
  descripcion!: string | null;
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rolBase!: Rol;
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro', isArray: true })
  restricciones!: ModuloCentro[];
  /** Cuentas con este perfil (solo la cuenta madre las ve; el resto, vacio). */
  asignados!: string[];
}
