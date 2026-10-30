import { ApiProperty } from '@nestjs/swagger';
import {
  AccionAcceso,
  AlcanceSoporte,
  CanalSolicitudDerecho,
  EstadoSolicitudDerecho,
  TipoDerecho,
  MedioConfirmacion,
  ModeloCobro,
  ModuloCentro,
  Rol,
  TipoAlerta,
  TipoComisionDerivacion,
  TipoPolitica,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
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

  /**
   * 03b-4.2 (C-10): comision de las sesiones de pacientes traidos por el
   * centro. GENERAL = el porcentaje general; PORCENTAJE (0 a 100) o
   * MONTO_FIJO en CLP por sesion (entero, tope: lo cobrado de la sesion).
   */
  @IsOptional()
  @IsEnum(TipoComisionDerivacion)
  comisionDerivacionTipo?: TipoComisionDerivacion;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000)
  comisionDerivacionValor?: number;

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

  /** C-11: los cargos por inasistencia y cancelacion tardia se liquidan al profesional. */
  @IsOptional()
  @IsBoolean()
  liquidarCargosAProfesional?: boolean;

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

  /** 03a-2 (D-4): edad minima para la cuenta propia del paciente (14 a 18; antes opera el adulto responsable). */
  @IsOptional()
  @IsInt()
  @Min(14)
  @Max(18)
  edadMinimaCuenta?: number;

  /** 03a-2: dias que se conservan los mensajes internos del equipo (30 a 3650). */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  retencionMensajesDias?: number;

  /** 03b-3.1: medios con que el paciente confirma su hora (PASARELA exige un adaptador configurado). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(MedioConfirmacion, { each: true })
  mediosPagoHabilitados?: MedioConfirmacion[];

  /** 03b-3.1: horas para pagar o validar la transferencia (siempre antes del inicio). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  plazoValidacionTransferenciaHoras?: number;

  /** 03b-3.1: porcentaje del monto que se paga para confirmar. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  porcentajePagoConfirmacion?: number;

  /** 03b-3.3: horas antes de la sesion en que vence el pago previo de la hora que agenda el equipo (0 a 168). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  horasPlazoPagoEquipo?: number;

  /** 03b-3.3: dias tras la sesion antes de contar el saldo como deuda (0 a 90). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  diasGraciaMorosidad?: number;

  /** 03b-3.3: un paciente con deuda no agenda (ADMIN/GESTION autorizan con motivo). */
  @IsOptional()
  @IsBoolean()
  bloquearAgendaMorosos?: boolean;
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
export class HorarioCentroDto {
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

// ---------------------------------------------------------------------------
// Respuestas (documentan el contrato para el cliente generado del front)
// ---------------------------------------------------------------------------

/** Modulos contratados por el centro (el front oculta los inactivos). */
export class ModulosActivos {
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro', isArray: true })
  activos!: ModuloCentro[];
}

export class RolAdicionalVista {
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  activo!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fechaBaja!: Date | null;
}

/** Cuenta propia (GET/PATCH usuarios/yo). */
export class MiCuenta {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
  /** Rol principal de la cuenta (el activo de la sesion va en el token). */
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  activo!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fechaExpiracionAcceso!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  desactivadoEn!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cerradaEn!: Date | null;
  totpActivo!: boolean;
  createdAt!: Date;
  @ApiProperty({ type: [RolAdicionalVista] })
  rolesAdicionales!: RolAdicionalVista[];
}

/** Fila de directorio_interno() (contacto solo para ADMIN/GESTION; la funcion lo filtra). */
export class MiembroDirectorio {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  @ApiProperty({ enum: Rol, enumName: 'Rol', isArray: true })
  roles!: Rol[];
  tiposAtencion!: string[];
  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
  @ApiProperty({ type: String, nullable: true })
  telefono!: string | null;
}

/** Proxima sesion del profesional (solo metadata). */
export class ProximaSesionDashboard {
  cita_id!: string;
  inicio!: Date;
  @ApiProperty({ type: String, nullable: true })
  espacio_id!: string | null;
  @ApiProperty({ enum: ['PRESENCIAL', 'ONLINE'] })
  modalidad!: string;
}

/** Pendientes de administracion (conteos, sin datos clinicos). */
export class PendientesDashboard {
  /** 03b-3.2: citas pendientes de pago (el pago validado las confirma). */
  pagos_pendientes!: number;
  /** 03b-3.3: pacientes con sesiones terminadas impagas. */
  pacientes_con_deuda!: number;
  transferencias_por_validar!: number;
  ruts_faltantes!: number;
  posibles_duplicados!: number;
  consentimientos_pendientes!: number;
  practicantes_por_vencer!: number;
  por_reprogramar!: number;
  @ApiProperty({ type: Number, nullable: true, description: 'Solo ADMIN' })
  resenas_por_moderar!: number | null;
  @ApiProperty({ type: Number, nullable: true, description: 'Solo ADMIN' })
  alertas_abiertas!: number | null;
}

/**
 * reporte_dashboard() por rol: ADMIN/GESTION reciben los agregados del centro
 * (y `pendientes`); PROFESIONAL/PRACTICANTE, los suyos. Cada campo existe
 * solo para su grupo de roles.
 */
export class ReporteDashboard {
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  sesiones_hoy!: number;
  pacientes_activos!: number;
  @ApiProperty({ required: false, description: 'ADMIN/GESTION' })
  pacientes_nuevos_mes?: number;
  @ApiProperty({ required: false, description: 'ADMIN/GESTION: pagos pendientes y recordatorios sin respuesta en 48 h' })
  por_confirmar?: number;
  @ApiProperty({ required: false, description: 'ADMIN/GESTION: % de horas apartadas sobre el horario de boxes (muestra)' })
  ocupacion_boxes_hoy?: number;
  @ApiProperty({ required: false })
  boxes_activos?: number;
  @ApiProperty({ required: false, description: 'ADMIN/GESTION: sesiones realizadas sin evolucion (7 dias)' })
  fichas_por_cerrar?: number;
  @ApiProperty({ type: PendientesDashboard, required: false })
  pendientes?: PendientesDashboard;
  @ApiProperty({ required: false, description: 'PROFESIONAL/PRACTICANTE' })
  sesiones_semana?: number;
  @ApiProperty({ required: false })
  fichas_sin_cerrar?: number;
  @ApiProperty({ required: false })
  borradores?: number;
  @ApiProperty({ required: false, description: 'PROFESIONAL/PRACTICANTE: sus citas pendientes de pago' })
  pagos_pendientes?: number;
  @ApiProperty({ type: Number, nullable: true, required: false, description: 'PROFESIONAL: pacientes con deuda en sus citas (PRACTICANTE: null)' })
  pacientes_con_deuda?: number | null;
  @ApiProperty({ required: false })
  mensajes_sin_leer?: number;
  @ApiProperty({ type: Number, nullable: true, required: false })
  calificacion?: number | null;
  @ApiProperty({ required: false })
  resenas?: number;
  @ApiProperty({ type: ProximaSesionDashboard, nullable: true, required: false })
  proxima_sesion?: ProximaSesionDashboard | null;
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro', isArray: true })
  modulos!: ModuloCentro[];
}

/** configuracion_centro (fila unica). Los porcentajes son Decimal: llegan como texto. */
export class ConfiguracionCentroVista {
  rolGestionHabilitado!: boolean;
  plazoRespuestaDerivacionHoras!: number;
  @ApiProperty({ enum: ModeloCobro, enumName: 'ModeloCobro' })
  modeloCobro!: ModeloCobro;
  plazoConsentimientoHoras!: number;
  plazoOposicionHoras!: number;
  diasGraciaCierre!: number;
  margenTrasladoMin!: number;
  nombreCentro!: string;
  @ApiProperty({ type: String, nullable: true })
  rutCentro!: string | null;
  plazoAvisoCancelacionHoras!: number;
  @ApiProperty({ type: String, description: 'Decimal (0 a 100)' })
  penalizacionCancelacionPorcentaje!: unknown;
  @ApiProperty({ type: String, description: 'Decimal (0 a 100)' })
  cobroInasistenciaPorcentaje!: unknown;
  @ApiProperty({ type: String, description: 'Decimal (0 a 100): comision del centro sobre lo cobrado en la liquidacion' })
  comisionCentroPorcentaje!: unknown;
  @ApiProperty({ enum: TipoComisionDerivacion, enumName: 'TipoComisionDerivacion' })
  comisionDerivacionTipo!: TipoComisionDerivacion;
  @ApiProperty({ type: String, description: 'Decimal: porcentaje (PORCENTAJE) o CLP por sesion (MONTO_FIJO); sin uso con GENERAL' })
  comisionDerivacionValor!: unknown;
  recordatorioHorasAntes!: number;
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro', isArray: true })
  modulosActivos!: ModuloCentro[];
  liquidarExigeEvolucion!: boolean;
  liquidarCargosAProfesional!: boolean;
  matchFiltroDirecto!: boolean;
  diasRetencionRespuestasMatch!: number;
  minutosRetencionSolicitud!: number;
  retencionMensajesDias!: number;
  edadMinimaCuenta!: number;
  @ApiProperty({ enum: MedioConfirmacion, enumName: 'MedioConfirmacion', isArray: true })
  mediosPagoHabilitados!: MedioConfirmacion[];
  plazoValidacionTransferenciaHoras!: number;
  porcentajePagoConfirmacion!: number;
  horasPlazoPagoEquipo!: number;
  diasGraciaMorosidad!: number;
  bloquearAgendaMorosos!: boolean;
  /** Solo cuentan como deuda las sesiones terminadas despues de esta fecha (la fija la migracion). */
  morosidadDesde!: Date;
  updatedAt!: Date;
}

export class ServicioPublicoVista {
  @ApiProperty({ type: String, required: false })
  icono?: string;
  titulo!: string;
  texto!: string;
}

/** contenido_publico (fila unica): lo que muestra la pagina publica del centro. */
export class ContenidoPublicoVista {
  @ApiProperty({ type: String, nullable: true })
  heroTitulo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  heroTexto!: string | null;
  @ApiProperty({ type: ServicioPublicoVista, isArray: true })
  servicios!: unknown;
  @ApiProperty({ type: String, nullable: true })
  contactoCorreo!: string | null;
  @ApiProperty({ type: String, nullable: true })
  contactoTelefono!: string | null;
  @ApiProperty({ type: String, nullable: true })
  direccion!: string | null;
  @ApiProperty({ type: String, nullable: true })
  whatsapp!: string | null;
  @ApiProperty({ type: String, nullable: true })
  instagram!: string | null;
  @ApiProperty({ type: String, nullable: true })
  mision!: string | null;
  @ApiProperty({ type: String, nullable: true })
  vision!: string | null;
  @ApiProperty({ type: String, nullable: true, description: '#RRGGBB' })
  colorMarca!: string | null;
  @ApiProperty({ type: String, nullable: true })
  logoImagenId!: string | null;
  updatedAt!: Date;
}

export class LogoSubido {
  logoImagenId!: string;
  url!: string;
}

/** Version de una politica (append-only: la vigente de cada tipo es la de mayor version). */
export class PoliticaVista {
  id!: string;
  @ApiProperty({ enum: TipoPolitica, enumName: 'TipoPolitica' })
  tipo!: TipoPolitica;
  version!: number;
  texto!: string;
  vigenteDesde!: Date;
  @ApiProperty({ type: String, nullable: true })
  creadaPorId!: string | null;
}

/** 03b-4.2: version vigente de una politica (sin quien la publico). */
export class PoliticaVigenteVista {
  id!: string;
  version!: number;
  texto!: string;
  vigenteDesde!: Date;
}

/** 03b-4.2: protocolo interno del equipo y si la cuenta ya leyo la version vigente. */
export class ProtocoloEquipoVista {
  @ApiProperty({ type: PoliticaVigenteVista, nullable: true })
  vigente!: PoliticaVigenteVista | null;
  @ApiProperty({ type: Date, nullable: true })
  leidoEn!: Date | null;
}

export class ProtocoloLeido {
  leidoEn!: Date;
}

/** Lectura de la version vigente (ADMIN/GESTION). El nombre lo pone el panel con el directorio. */
export class LecturaProtocoloVista {
  usuarioId!: string;
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  leidoEn!: Date;
}

export class HorarioCentroVista {
  id!: string;
  /** ISO: 1 = lunes ... 7 = domingo. */
  diaSemana!: number;
  inicioMin!: number;
  finMin!: number;
}

export class InvitacionEquipo {
  usuarioId!: string;
  invitacionVence!: Date;
}

export class BajaRolResultado {
  usuarioId!: string;
  @ApiProperty({ enum: Rol, enumName: 'Rol' })
  rol!: Rol;
  fechaEfectiva!: Date;
  citasPorReprogramar!: number;
}

export class TotpReiniciado {
  usuarioId!: string;
  totpActivo!: boolean;
}

/** 03b-4.1: verificacion en dos pasos de la propia cuenta (opcional para pacientes y responsables). */
export class CambiarSegundoFactorDto {
  @IsBoolean()
  activo!: boolean;
}

export class EstadoSegundoFactor {
  activo!: boolean;
  /** Equipo: siempre activa, no se desactiva. */
  obligatorio!: boolean;
  codigosRespaldoRestantes!: number;
}

/** Codigos de respaldo nuevos (se muestran una sola vez). */
export class CodigosRespaldo {
  codigos!: string[];
}

export class PracticanteVista {
  usuarioId!: string;
  @ApiProperty({ type: String, format: 'date' })
  fechaInicio!: Date;
  @ApiProperty({ type: String, format: 'date' })
  fechaTerminoPractica!: Date;
  createdAt!: Date;
  updatedAt!: Date;
}

export class AccesoPracticanteOtorgado {
  practicanteId!: string;
  fechaExpiracion!: Date;
  /** Pacientes avisados por el cambio de supervisor (plazo de oposicion). */
  avisosCambioSupervisor!: number;
}

export class AccesoPracticanteRevocado {
  practicanteId!: string;
  revocado!: boolean;
}

export class HistorialAccesoPracticanteVista {
  id!: string;
  practicanteId!: string;
  @ApiProperty({ type: String, nullable: true })
  actorId!: string | null;
  @ApiProperty({ enum: AccionAcceso, enumName: 'AccionAcceso' })
  accion!: AccionAcceso;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  fechaExpiracion!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  motivo!: string | null;
  createdAt!: Date;
}

export class BajaIniciada {
  usuarioId!: string;
  fechaEfectiva!: Date;
  citasPorReprogramar!: number;
}

export class BajaVista {
  id!: string;
  usuarioId!: string;
  fechaEfectiva!: Date;
  iniciadaPorId!: string;
  iniciadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  procesadaEn!: Date | null;
}

/** pacientes_por_reasignar(): nombre solo para ADMIN/GESTION; el supervisor ve el codigo seudonimo. */
export class PacientePorReasignar {
  paciente_id!: string;
  @ApiProperty({ type: String, nullable: true })
  ficha_id!: string | null;
  codigo!: string;
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
  @ApiProperty({ type: String, nullable: true })
  apellido!: string | null;
  tratante_id!: string;
  motivo!: string;
  derivacion_abierta!: boolean;
}

export class AlertaInternaVista {
  id!: string;
  @ApiProperty({ enum: TipoAlerta, enumName: 'TipoAlerta' })
  tipo!: TipoAlerta;
  @ApiProperty({ type: String, nullable: true })
  referenciaId!: string | null;
  detalle!: string;
  creadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  atendidaEn!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  atendidaPorId!: string | null;
}

export class AlertaAtendida {
  id!: string;
  atendida!: boolean;
}

/** Profesional del equipo tratante del paciente (portal), solo nombre. */
export class IntegranteEquipoTratante {
  id!: string;
  @ApiProperty({ type: String, nullable: true })
  nombre!: string | null;
}

/** AUD-01 (E1.5): acciones que se pueden filtrar en la auditoria de accesos. */
export const ACCIONES_AUDITORIA = [
  'LECTURA',
  'ESCRITURA',
  'DESCARGA',
  'EXPORTACION',
  'ENVIO',
  'DERIVACION',
  'SUPERVISION',
  'RETENCION',
  'ACCESO_TEMPORAL',
] as const;

/** Auditoria de accesos (ADMIN). Sin fechas: los ultimos 7 dias. */
export class FiltroAuditoriaDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desde?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  hasta?: Date;

  @IsOptional()
  @IsUUID()
  pacienteId?: string;

  @IsOptional()
  @IsUUID()
  usuarioId?: string;

  @IsOptional()
  @IsIn(ACCIONES_AUDITORIA)
  accion?: (typeof ACCIONES_AUDITORIA)[number];
}

/** Fila de la auditoria: acceso a datos de un paciente o descarga sin paciente (registro_exportaciones). */
export class RegistroAuditoria {
  id!: string;
  @ApiProperty({ enum: ['ACCESO_FICHA', 'EXPORTACION'] })
  origen!: 'ACCESO_FICHA' | 'EXPORTACION';
  ocurridoEn!: Date;
  usuarioId!: string;
  @ApiProperty({ type: String, nullable: true })
  usuarioNombre!: string | null;
  @ApiProperty({ enum: Rol, enumName: 'Rol', description: 'Rol activo al momento del acceso' })
  rol!: Rol;
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  pacienteNombre!: string | null;
  recurso!: string;
  accion!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Campos que cambiaron u otro detalle; nunca valores' })
  detalle!: string | null;
}

/** AUD-01 (E2.1): autorizacion del centro al soporte de Vinculos (sin datos personales ni clinicos). */
export class OtorgarSoporteDto {
  @Recortar()
  @IsString()
  @Length(5, 500)
  motivo!: string;

  @IsEnum(AlcanceSoporte)
  alcance!: AlcanceSoporte;

  /** Entre 1 y 72 horas desde ahora. */
  @IsInt()
  @Min(1)
  @Max(72)
  horas!: number;
}

export class AutorizacionSoporteVista {
  id!: string;
  motivo!: string;
  @ApiProperty({ enum: AlcanceSoporte, enumName: 'AlcanceSoporte' })
  alcance!: AlcanceSoporte;
  desde!: Date;
  hasta!: Date;
  vigente!: boolean;
  @ApiProperty({ type: String, nullable: true })
  otorgadaPor!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revocadaEn!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  revocadaPor!: string | null;
  /** Diagnosticos ejecutados con esta autorizacion. */
  usos!: number;
}

export class RegistroSoporteVista {
  id!: string;
  autorizacionId!: string;
  /** Funcion de diagnostico ejecutada (p. ej. soporte_resumen). */
  funcion!: string;
  /** Rol de BD con que se conecto el soporte. */
  rolBd!: string;
  ocurridoEn!: Date;
}

/** AUD-01 (E2.2): contrato del centro con Vinculos. */
export const TIPOS_CONTRATO = ['TERMINOS_SERVICIO', 'DPA'] as const;

export class AceptarContratoDto {
  @IsIn(TIPOS_CONTRATO)
  tipo!: (typeof TIPOS_CONTRATO)[number];
}

export class AceptacionContratoVista {
  @ApiProperty({ type: String, nullable: true })
  por!: string | null;
  aceptadaEn!: Date;
}

export class ContratoVigenteVista {
  @ApiProperty({ enum: TIPOS_CONTRATO })
  tipo!: (typeof TIPOS_CONTRATO)[number];
  politicaId!: string;
  version!: number;
  texto!: string;
  vigenteDesde!: Date;
  @ApiProperty({ type: AceptacionContratoVista, isArray: true })
  aceptaciones!: AceptacionContratoVista[];
}

export class ContratoCentroVista {
  /** Tipos cuya version vigente nadie del centro ha aceptado. */
  @ApiProperty({ enum: TIPOS_CONTRATO, isArray: true })
  pendientes!: (typeof TIPOS_CONTRATO)[number][];
  @ApiProperty({ type: ContratoVigenteVista, isArray: true })
  vigentes!: ContratoVigenteVista[];
}

/** AUD-01 (E2.3a): solicitud de derechos que registra el centro (no el formulario publico). */
export class RegistrarSolicitudDerechoDto {
  @IsEnum(TipoDerecho)
  tipo!: TipoDerecho;

  /** Titular identificado como paciente (opcional: puede no serlo). */
  @IsOptional()
  @IsUUID()
  pacienteId?: string;

  @IsIn(['PRESENCIAL', 'CORREO', 'PORTAL'])
  canal!: Exclude<CanalSolicitudDerecho, 'FORMULARIO_PUBLICO'>;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 2000)
  detalle?: string;
}

export class AvanzarSolicitudDerechoDto {
  @IsIn(['EN_CURSO', 'RESUELTA', 'RECHAZADA'])
  estado!: Exclude<EstadoSolicitudDerecho, 'RECIBIDA'>;

  /** Respuesta al titular: obligatoria al resolver o rechazar (la BD lo exige). */
  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 4000)
  respuesta?: string;
}

/** AUD-01 Fase 3: estado de la exportacion de un paciente (solo metadatos). */
export const ESTADOS_EXPORTACION = ['ESPERANDO_TRATANTE', 'LISTA', 'ENVIADA', 'VENCIDA'] as const;

/** A quien se envio la copia (sin correos): el paciente o un adulto responsable. */
export class DestinatarioExportacionVista {
  adultoResponsable!: boolean;
  descargas!: number;
}

export class ExportacionPacienteVista {
  id!: string;
  pacienteId!: string;
  solicitudId!: string;
  @ApiProperty({ enum: ESTADOS_EXPORTACION })
  estado!: (typeof ESTADOS_EXPORTACION)[number];
  /** El paciente tiene ficha: falta (o ya esta) la parte clinica del tratante. */
  requiereClinica!: boolean;
  creadaEn!: Date;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  clinicaEn!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  enviadaEn!: Date | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  venceEn!: Date | null;
  descargas!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  purgadaEn!: Date | null;
  /** Segun la edad: menor de 14 sus adultos responsables; 14 a 17 ambos; mayor, el paciente. */
  @ApiProperty({ type: [DestinatarioExportacionVista] })
  destinatarios!: DestinatarioExportacionVista[];
}

export class SolicitudDerechoVista {
  id!: string;
  @ApiProperty({ enum: TipoDerecho, enumName: 'TipoDerecho' })
  tipo!: TipoDerecho;
  @ApiProperty({ type: String, nullable: true })
  pacienteId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  pacienteNombre!: string | null;
  /** AUD-01 (E2.3c): el tratamiento del paciente esta bloqueado. */
  pacienteBloqueado!: boolean;
  @ApiProperty({ enum: CanalSolicitudDerecho, enumName: 'CanalSolicitudDerecho' })
  canal!: CanalSolicitudDerecho;
  @ApiProperty({ enum: EstadoSolicitudDerecho, enumName: 'EstadoSolicitudDerecho' })
  estado!: EstadoSolicitudDerecho;
  recibidaEn!: Date;
  /** AAAA-MM-DD: 30 dias habiles desde la recepcion. */
  @ApiProperty({ type: String, format: 'date' })
  venceEl!: string;
  /** Dias habiles que quedan (solo abiertas). */
  @ApiProperty({ type: Number, nullable: true })
  diasHabilesRestantes!: number | null;
  @ApiProperty({ type: String, nullable: true })
  detalle!: string | null;
  @ApiProperty({ type: String, nullable: true })
  respuesta!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resueltaEn!: Date | null;
  /** E2.3b: pidio actualizar su correo (verificar identidad antes de cambiarlo). */
  pideCambioCorreo!: boolean;
  /** Fase 3: exportacion en curso o enviada de esta solicitud. */
  @ApiProperty({ type: ExportacionPacienteVista, nullable: true })
  exportacion!: ExportacionPacienteVista | null;
}

/** AUD-01 (E2.3c): bloqueo del tratamiento de un paciente mientras se resuelve una solicitud. */
export class BloquearTratamientoDto {
  @Recortar()
  @IsString()
  @Length(3, 500)
  motivo!: string;

  @IsOptional()
  @IsUUID()
  solicitudId?: string;
}

export class CancelarPerifericosDto {
  /** Solicitud de cancelacion abierta del paciente. */
  @IsUUID()
  solicitudId!: string;
}

export class EstadoBloqueoVista {
  pacienteId!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  bloqueoDesde!: Date | null;
  @ApiProperty({ type: String, nullable: true })
  bloqueoMotivo!: string | null;
}

export class CancelacionPerifericos {
  /** Que se borro y que se conserva, con el motivo legal. */
  mensaje!: string;
}

/** AUD-01 (E2.3b): solicitud de derechos sin cuenta, por RUT. La respuesta es siempre la misma. */
export class SolicitudDerechoPublicaDto {
  @IsRut()
  @NormalizarRut()
  rut!: string;

  @IsEnum(TipoDerecho)
  tipo!: TipoDerecho;

  @IsOptional()
  @Recortar()
  @IsString()
  @Length(1, 2000)
  detalle?: string;

  /** Quiere actualizar el correo registrado: el centro lo hace tras verificar su identidad. */
  @IsOptional()
  @IsBoolean()
  cambiarCorreo?: boolean;

  /** Trampa para bots: debe venir vacio. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sitioWeb?: string;
}

export class SolicitudDerechoPublicaRecibida {
  /** Siempre el mismo texto, exista o no el RUT. */
  mensaje!: string;
}

/** Descarga de la exportacion de un paciente: enlace del correo y, sin cuenta, el codigo del segundo correo. */
export class DescargaExportacionDto {
  @IsString()
  @Length(20, 200)
  token!: string;

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'El codigo son 8 digitos' })
  codigo?: string;

  @IsIn(['json', 'pdf'])
  formato!: 'json' | 'pdf';
}

/** Exportacion del centro: clave del ADMIN (no se guarda ni se registra). */
export class ExportarCentroDto {
  @IsString()
  @Length(16, 200)
  clave!: string;
}

/** AUD-01 (E2.3a): feriados de un año (los de la ley y los del centro). */
export class FiltroFeriadosDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  anio!: number;
}

/** Feriado puntual o regional que la ley no calcula (o uno quitado que se repone). */
export class AgregarFeriadoDto {
  /** AAAA-MM-DD, de hoy en adelante. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  fecha!: string;

  @Recortar()
  @IsString()
  @Length(2, 120)
  nombre!: string;
}

export const ORIGENES_FERIADO = ['LEY', 'CENTRO'] as const;

export class FeriadoVista {
  /** AAAA-MM-DD */
  fecha!: string;
  nombre!: string;
  /** LEY: lo calcula el sistema; CENTRO: lo agrego un ADMIN. */
  @ApiProperty({ enum: ORIGENES_FERIADO })
  origen!: (typeof ORIGENES_FERIADO)[number];
  /** Quitado por un ADMIN: no cuenta como feriado. */
  quitado!: boolean;
}

/** 03b-4.2: recordatorio personal (solo su autor). Sin datos clinicos: la pantalla lo advierte. */
export class RecordatorioPersonalDto {
  @Recortar()
  @IsString()
  @Length(1, 300)
  texto!: string;

  /** AAAA-MM-DD opcional. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsISO8601({ strict: true })
  venceEl?: string;
}

export class MarcarRecordatorioDto {
  @IsBoolean()
  hecho!: boolean;
}

export class RecordatorioPersonalVista {
  id!: string;
  texto!: string;
  /** AAAA-MM-DD */
  @ApiProperty({ nullable: true, type: String })
  venceEl!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  hechoEn!: Date | null;
  creadoEn!: Date;
}
