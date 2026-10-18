import { ApiProperty } from '@nestjs/swagger';
import { AccionAcceso, ModeloCobro, ModuloCentro, Rol, TipoAlerta, TipoPolitica } from '@prisma/client';
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
  solicitudes_por_aprobar!: number;
  ruts_faltantes!: number;
  posibles_duplicados!: number;
  consentimientos_pendientes!: number;
  practicantes_por_vencer!: number;
  por_reprogramar!: number;
  lista_espera!: number;
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
  @ApiProperty({ required: false, description: 'ADMIN/GESTION: solicitudes y recordatorios sin respuesta en 48 h' })
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
  @ApiProperty({ required: false })
  solicitudes_por_aprobar?: number;
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
  recordatorioHorasAntes!: number;
  @ApiProperty({ enum: ModuloCentro, enumName: 'ModuloCentro', isArray: true })
  modulosActivos!: ModuloCentro[];
  liquidarExigeEvolucion!: boolean;
  matchFiltroDirecto!: boolean;
  diasRetencionRespuestasMatch!: number;
  minutosRetencionSolicitud!: number;
  retencionMensajesDias!: number;
  edadMinimaCuenta!: number;
  diasListaEsperaPublica!: number;
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
