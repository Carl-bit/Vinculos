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
