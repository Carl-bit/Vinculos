/**
 * Variables de entorno del silo, validadas al arrancar: si falta una
 * obligatoria o tiene formato invalido, la API no arranca (ConfigModule
 * llama a validarEntorno antes de crear cualquier provider).
 *
 * Llaves: KEK_PATH y RECUPERACION_PUBLICA_PATH son rutas a archivos (Docker
 * secret en produccion), nunca la llave en una variable.
 */
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

// Se lee el valor original: la conversion implicita haria Boolean('false') = true.
const aBooleano = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key] === undefined ? undefined : obj[key] === true || obj[key] === 'true';

export class Entorno {
  /** Rol app_user (sujeto a RLS). Unica conexion de la API. */
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  /** Distinto por silo. HS256: al menos 32 caracteres. */
  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  KEK_PATH!: string;

  @IsString()
  @IsNotEmpty()
  RECUPERACION_PUBLICA_PATH!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  PORT: number = 3001;

  @IsOptional()
  @IsString()
  FRONTEND_URL: string = 'http://localhost:3000';

  /** Vida del JWT de acceso. Corto: los cambios de cuenta se aplican igual por acceso_vigente(). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  JWT_ACCESO_MINUTOS: number = 15;

  /**
   * 03b: minutos sin actividad que dura la sesion. Cada refresh token vence a
   * esos minutos y se renueva al rotar; el front cierra la sesion si el
   * usuario no interactua en ese plazo.
   */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(720)
  SESION_INACTIVIDAD_MINUTOS: number = 30;

  /** Intentos de login por minuto e IP. */
  @IsOptional()
  @IsInt()
  @Min(1)
  LOGIN_LIMITE_POR_MINUTO: number = 10;

  /** Consultas por minuto e IP a los endpoints publicos (perfiles, disponibilidad). */
  @IsOptional()
  @IsInt()
  @Min(1)
  PUBLICO_LIMITE_POR_MINUTO: number = 60;

  /** Crons de la API (false en tests: los jobs se llaman a mano). */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  JOBS_HABILITADOS: boolean = true;

  @IsOptional()
  @IsString()
  LOG_LEVEL: string = 'info';

  /** /docs (Swagger UI) y /docs-json. Sin valor: habilitada salvo NODE_ENV=production (core/docs/openapi.ts). */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  DOCS_API?: boolean;

  /** TTL del soft-lock de agenda (solo UX; la fuente de verdad es el EXCLUDE). */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  BLOQUEO_TEMPORAL_TTL_SEGUNDOS: number = 300;

  /** Vida del enlace de videollamada despues del fin de la cita. */
  @IsOptional()
  @IsInt()
  @Min(0)
  ENLACE_ONLINE_HORAS_TRAS_FIN: number = 2;

  /**
   * Integraciones (docs/api/integraciones.md). Correo: SMTP generico de la
   * plataforma (smtp[s]://usuario:clave@host:puerto); vacio = simulado.
   */
  @IsOptional()
  @IsString()
  SMTP_URL: string = '';

  /** Direccion del remitente de la plataforma (el nombre visible es el del centro). */
  @IsOptional()
  @IsString()
  CORREO_REMITENTE: string = 'no-responder@vinculos.cl';

  /** true = videollamada simulada (tests); false = modo de cada profesional. */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  VIDEOLLAMADA_SIMULADA: boolean = false;

  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  JITSI_HABILITADO: boolean = false;

  @IsOptional()
  @IsString()
  JITSI_URL_BASE: string = 'https://meet.jit.si';

  /** Vida del enlace de descarga de un documento clinico enviado por correo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  DOCUMENTO_ENLACE_HORAS: number = 72;

  /** Tamaño maximo de un adjunto externo de la ficha (multipart, 02i). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  ADJUNTO_MAX_MB: number = 10;

  /**
   * 03b-3.1: pasarela de pago (integraciones.md). 'simulada' = modo
   * demostracion, no cobra; vacio = sin pasarela (el centro no puede habilitar
   * el medio PASARELA). Sin valor: 'simulada' fuera de produccion. En
   * produccion la simulada no se acepta: hace falta un adaptador real con sus
   * credenciales.
   */
  @IsOptional()
  @IsIn(['', 'simulada'])
  PASARELA_PROVEEDOR?: string;

  /** Secreto con que la pasarela simulada firma su webhook (sin valor: uno al azar por arranque). */
  @IsOptional()
  @IsString()
  @MinLength(32)
  PASARELA_SECRETO_WEBHOOK?: string;
}

export function validarEntorno(config: Record<string, unknown>): Entorno {
  const entorno = plainToInstance(Entorno, config, { enableImplicitConversion: true, exposeDefaultValues: true });
  const errores = validateSync(entorno, { whitelist: false });
  if (errores.length > 0) {
    const detalle = errores.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; ');
    throw new Error(`Variables de entorno invalidas: ${detalle}`);
  }
  const produccion = config.NODE_ENV === 'production';
  entorno.PASARELA_PROVEEDOR ??= produccion ? '' : 'simulada';
  if (produccion && entorno.PASARELA_PROVEEDOR === 'simulada') {
    throw new Error('Variables de entorno invalidas: PASARELA_PROVEEDOR=simulada no se permite en produccion (falta un adaptador real con credenciales)');
  }
  return entorno;
}
