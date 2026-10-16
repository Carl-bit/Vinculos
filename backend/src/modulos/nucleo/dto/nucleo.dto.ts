import { Rol, ModeloCobro, TipoPolitica } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { IsRut, NormalizarRut, Recortar, TELEFONO_CL } from '../../../core/validacion/validadores';

const minusculas = () => Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export class CrearUsuarioDto {
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre!: string;

  @IsEnum(Rol)
  rol!: Rol;

  /**
   * Contraseña inicial (el usuario la cambia en /usuarios/yo/password). Sin
   * contraseña (03a): la cuenta queda sin acceso hasta que la persona active
   * la invitacion que se le envia por correo.
   */
  @IsOptional()
  @IsString()
  @Length(10, 200)
  password?: string;

  @IsOptional()
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string;

  /** PRACTICANTE: expiracion del acceso, supervisor y periodo de practica. */
  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @Type(() => Date)
  @IsDate()
  fechaExpiracionAcceso?: Date;

  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @IsUUID()
  supervisorId?: string;

  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @Type(() => Date)
  @IsDate()
  fechaInicioPractica?: Date;

  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PRACTICANTE')
  @Type(() => Date)
  @IsDate()
  fechaTerminoPractica?: Date;

  /** PACIENTE: registro de pacientes vinculado (1:1). */
  @ValidateIf((o: CrearUsuarioDto) => o.rol === 'PACIENTE')
  @IsUUID()
  pacienteId?: string;
}

/** Campos no sensibles de la propia cuenta. */
export class EditarMiCuentaDto {
  @IsOptional()
  @minusculas()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre?: string;

  /** null borra el telefono. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' })
  telefono?: string | null;
}

export class CambiarPasswordDto {
  @IsString()
  @Length(1, 200)
  actual!: string;

  @IsString()
  @Length(10, 200)
  nueva!: string;
}

/** Solo ADMIN. La expiracion y la reactivacion de practicantes van por /practicantes. */
export class EditarUsuarioDto {
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

export class EditarConfiguracionDto {
  @IsOptional()
  @IsBoolean()
  rolGestionHabilitado?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  plazoRespuestaDerivacionHoras?: number;

  @IsOptional()
  @IsEnum(ModeloCobro)
  modeloCobro?: ModeloCobro;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  plazoConsentimientoHoras?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  plazoOposicionHoras?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  diasGraciaCierre?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  margenTrasladoMin?: number;

  /** Remitente visible de los correos y emisor de boletas del modelo CENTRO. */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(2, 120)
  nombreCentro?: string;

  @IsOptional()
  @IsRut()
  @NormalizarRut()
  rutCentro?: string;

  /** Politica de cancelacion (Cobros). Los porcentajes se definen con el caso de estudio. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(720)
  plazoAvisoCancelacionHoras?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  penalizacionCancelacionPorcentaje?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  cobroInasistenciaPorcentaje?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  comisionCentroPorcentaje?: number;

  /** Recordatorio de citas (02i): horas antes del inicio; 0 = desactivado. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  recordatorioHorasAntes?: number;

  /** 03a (C-11): liquidar solo citas realizadas con evolucion registrada. */
  @IsOptional()
  @IsBoolean()
  liquidarExigeEvolucion?: boolean;

  /** 03a: el match ofrece "prefiero filtrar yo mismo". */
  @IsOptional()
  @IsBoolean()
  matchFiltroDirecto?: boolean;

  /** 03a (D-6): dias que se guardan las respuestas del match de una solicitud no concretada. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  diasRetencionRespuestasMatch?: number;

  /** 03a (C-15): minutos que se retiene la hora mientras se verifica el correo. */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  minutosRetencionSolicitud?: number;
}

export class OtorgarAccesoDto {
  @Type(() => Date)
  @IsDate()
  fechaExpiracion!: Date;

  /** Si la supervision cerro (reactivacion): nuevo supervisor, en la misma accion. */
  @IsOptional()
  @IsUUID()
  supervisorId?: string;
}

export class RevocarAccesoDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;
}

export class IniciarBajaDto {
  @IsUUID()
  usuarioId!: string;

  @Type(() => Date)
  @IsDate()
  fechaEfectiva!: Date;
}

/** 03a (C-1): segundo rol de una cuenta ADMIN o GESTION. */
export class OtorgarRolDto {
  @IsIn([Rol.PROFESIONAL])
  rol!: 'PROFESIONAL';
}

export class BajaRolDto {
  @Type(() => Date)
  @IsDate()
  fechaEfectiva!: Date;
}

export class ServicioPublicoDto {
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 40)
  icono?: string;

  @Recortar()
  @IsString()
  @Length(1, 120)
  titulo!: string;

  @Recortar()
  @IsString()
  @Length(1, 600)
  texto!: string;
}

/** Contenido de la pagina publica del centro (ADMIN). null borra el campo. */
export class ContenidoPublicoDto {
  @IsOptional() @Recortar() @IsString() @Length(1, 160) heroTitulo?: string | null;
  @IsOptional() @Recortar() @IsString() @Length(1, 1000) heroTexto?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ServicioPublicoDto)
  servicios?: ServicioPublicoDto[];

  @IsOptional() @ValidateIf((_o, v) => v !== null) @minusculas() @IsEmail() @MaxLength(254) contactoCorreo?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(TELEFONO_CL, { message: 'telefono: formato +56XXXXXXXXX' }) contactoTelefono?: string | null;
  @IsOptional() @Recortar() @IsString() @Length(1, 300) direccion?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(TELEFONO_CL, { message: 'whatsapp: formato +56XXXXXXXXX' }) whatsapp?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @Matches(/^@?[A-Za-z0-9._]{1,30}$/, { message: 'instagram: usuario sin espacios' }) instagram?:
    string | null;
  @IsOptional() @Recortar() @IsString() @Length(1, 2000) mision?: string | null;
  @IsOptional() @Recortar() @IsString() @Length(1, 2000) vision?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsHexColor() @Length(7, 7) colorMarca?: string | null;
}

export class PoliticaDto {
  @IsEnum(TipoPolitica)
  tipo!: TipoPolitica;

  @IsString()
  @Length(20, 50000)
  texto!: string;
}

export class BloqueHorarioDto {
  /** ISO: 1 = lunes ... 7 = domingo. */
  @IsInt()
  @Min(1)
  @Max(7)
  diaSemana!: number;

  /** Minutos desde la medianoche de Chile (0-1440). */
  @IsInt()
  @Min(0)
  @Max(1439)
  inicioMin!: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  finMin!: number;
}

/** Reemplaza el horario completo (vacio = sin restriccion). */
export class HorarioDto {
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => BloqueHorarioDto)
  bloques!: BloqueHorarioDto[];
}

/** Filtros del selector de equipo (directorio). */
export class FiltroDirectorioDto {
  @IsOptional()
  @IsEnum(Rol)
  rol?: Rol;

  /** Nombre del tipo de atencion aprobado. */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  tipoAtencion?: string;

  /** Busqueda por nombre (contiene, sin mayusculas). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 120)
  nombre?: string;
}
