/**
 * Variables de entorno del silo, validadas al arrancar: si falta una
 * obligatoria o tiene formato invalido, la API no arranca (ConfigModule
 * llama a validarEntorno antes de crear cualquier provider).
 *
 * Llaves: KEK_PATH y RECUPERACION_PUBLICA_PATH son rutas a archivos (Docker
 * secret en produccion), nunca la llave en una variable.
 */
import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MinLength, validateSync } from 'class-validator';

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

  /**
   * 03b-4.1: verificacion en dos pasos con app de autenticacion (TOTP, 03a).
   * Desactivada: el segundo factor es un codigo por correo y las rutas TOTP
   * responden 404. El codigo y las columnas siguen para habilitarla despues
   * (docs/seguridad/requisitos_02_apis.md, 03b-4.1).
   */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  TOTP_HABILITADO: boolean = false;

  /**
   * R10 (Vinculos Control, 2026-11-19): silo de demostracion. Con ES_DEMO=true
   * y la marca de la BD (identidad_silo.es_demo, silo_es_demo()) el login no
   * pide segundo factor. Vacio o false en un silo real; sin la marca de la BD
   * no tiene efecto.
   */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  ES_DEMO: boolean = false;

  /** Intentos de login por minuto e IP. */
  @IsOptional()
  @IsInt()
  @Min(1)
  LOGIN_LIMITE_POR_MINUTO: number = 10;

  /**
   * Recuperacion de contraseña y enlace de acceso: la API tarda siempre esto
   * (ms), exista o no la cuenta; el correo sale en segundo plano. Asi el
   * tiempo de respuesta no revela si el correo esta registrado.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  CUENTA_RESPUESTA_MS: number = 1200;

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

  /**
   * Solo desarrollo y tests (AUD-02): habilita POST /api/pruebas/jobs/:nombre
   * para correr un job al instante (p. ej. el recordatorio por correo en
   * Playwright). Con NODE_ENV=production la API no arranca si esta encendida.
   */
  @IsOptional()
  @Transform(aBooleano)
  @IsBoolean()
  JOBS_MANUALES: boolean = false;

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

  /**
   * AUD-01 (LEG-02): configuration set de Amazon SES del silo (metricas,
   * rebotes y quejas separados por centro). Vacio = sin cabecera.
   */
  @IsOptional()
  @IsString()
  SES_CONFIGURATION_SET: string = '';

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
   * AUD-02: carpeta del archivo cifrado de la exportacion del centro mientras
   * espera su descarga (volumen del silo; maximo 24 h). Vacio: carpeta
   * temporal del sistema (desarrollo y tests).
   */
  @IsOptional()
  @IsString()
  EXPORTACIONES_DIR: string = '';

  /**
   * 03b-4.2: apikey de la API de prestadores de la Superintendencia de Salud
   * (convenio con la Intendencia de Prestadores). Sin valor: verificacion
   * SIMULADA y la API arranca igual (aviso en el log); el ADMIN verifica a mano.
   */
  @IsOptional()
  @IsString()
  SUPERSALUD_APIKEY?: string;

  @IsOptional()
  @IsString()
  SUPERSALUD_URL: string = 'https://apis.superdesalud.gob.cl';
}

export function validarEntorno(config: Record<string, unknown>): Entorno {
  const entorno = plainToInstance(Entorno, config, { enableImplicitConversion: true, exposeDefaultValues: true });
  const errores = validateSync(entorno, { whitelist: false });
  if (errores.length > 0) {
    const detalle = errores.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; ');
    throw new Error(`Variables de entorno invalidas: ${detalle}`);
  }
  const produccion = config.NODE_ENV === 'production';
  if (produccion && entorno.JOBS_MANUALES) {
    throw new Error('Variables de entorno invalidas: JOBS_MANUALES no se permite en produccion (es solo para desarrollo y tests)');
  }
  return entorno;
}
