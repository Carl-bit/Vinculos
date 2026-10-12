/**
 * Traduccion de errores de Postgres (via Prisma) a HTTP, segun
 * requisitos_02_apis.md 2. Nunca se devuelve el mensaje de Postgres: solo un
 * mensaje propio por SQLSTATE o por restriccion conocida.
 */
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface ErrorBd {
  sqlstate: string;
  /** Nombre del constraint/regla, si se pudo identificar. */
  restriccion?: string;
}

/** SQLSTATE -> HTTP. 42501 es 403 por defecto; el servicio usa 404 si revelaria existencia. */
export const HTTP_POR_SQLSTATE: Record<string, number> = {
  '23P01': 409,
  '23505': 409,
  '55000': 409,
  '23001': 409,
  '40001': 409,
  '40P01': 409,
  '23514': 422,
  '23503': 422,
  '23502': 422,
  '42501': 403,
  P0002: 404,
};

export const MENSAJE_POR_SQLSTATE: Record<string, string> = {
  '23P01': 'El horario o recurso ya esta ocupado',
  '23505': 'Ya existe un registro con esos datos',
  '55000': 'El estado actual no permite esta accion',
  '23001': 'El registro no se puede modificar ni eliminar',
  '40001': 'Conflicto de concurrencia: reintentar',
  '40P01': 'Conflicto de concurrencia: reintentar',
  '23514': 'La operacion no cumple una regla de negocio',
  '23503': 'Referencia a un registro inexistente o no visible',
  '23502': 'Falta un dato obligatorio',
  '42501': 'Sin permiso para esta accion',
  P0002: 'Registro no encontrado',
};

/** Mensajes claros para las reglas que la UI necesita distinguir. */
export const MENSAJE_POR_RESTRICCION: Record<string, string> = {
  citas_no_solapamiento_espacio: 'El box ya esta ocupado en ese horario',
  citas_no_solapamiento_profesional: 'El profesional ya tiene una cita en ese horario',
  citas_margen_traslado: 'No se respeta el margen de traslado entre citas de distinta modalidad',
  citas_dentro_de_disponibilidad: 'La cita cae fuera de la disponibilidad del profesional para esa modalidad',
  citas_fuera_de_bloqueos: 'El profesional tiene la agenda bloqueada en ese horario',
  citas_menor_requiere_adulto_responsable: 'Paciente menor de edad: registrar un adulto responsable antes de agendar',
  citas_espacio_segun_modalidad: 'Una cita presencial requiere box; una online no lleva box',
  consentimientos_menor_requiere_adulto_responsable: 'Paciente menor de 18: responde un adulto responsable',
  consentimientos_respaldo_obligatorio: 'ADMIN/GESTION registran con respaldo documental',
  consentimientos_adulto_del_paciente: 'El adulto responsable no corresponde al paciente',
  consentimientos_una_solicitud_abierta: 'Ya hay una solicitud de consentimiento abierta',
  usuarios_ultimo_admin: 'No se puede dejar al centro sin un ADMIN activo',
  usuarios_admin_no_se_desactiva: 'Un ADMIN no se desactiva a si mismo',
  usuarios_gestion_requiere_habilitacion: 'El rol GESTION no esta habilitado en el centro',
  usuarios_email_key: 'Ya existe un usuario con ese email',
  profesionales_publicar_requiere_tarifa: 'Publicar el perfil exige una tarifa general vigente',
  evoluciones_tipo_sesion_aprobado: 'El tipo de sesion no esta aprobado o esta inactivo',
  pacientes_rut_hmac_key: 'Ya existe un paciente con ese RUT',
  profesional_datos_privados_rut_hmac_key: 'Ya existe un profesional con ese RUT',
  tipos_sesion_nombre_key: 'Ya existe un tipo de sesion con ese nombre',
  espacios_nombre_key: 'Ya existe un espacio con ese nombre',
  pacientes_practicante_requiere_consentimiento: 'El practicante tratante no tiene consentimiento vigente del paciente',
  derivaciones_una_abierta_por_ficha: 'La ficha ya tiene una derivacion abierta',
  derivacion_candidatos_validos: 'Candidatos invalidos para la derivacion',
  derivaciones_tipo_atencion_activo: 'Tipo de atencion inexistente o inactivo',
  practicante_requiere_supervision: 'El practicante no tiene supervision vigente',
  historial_accesos_practicante_expiracion_futura: 'La fecha de expiracion debe ser futura',
  configuracion_centro_gestion_activos: 'Hay usuarios GESTION activos: desactivarlos antes de deshabilitar el rol',
  disponibilidad_publica_rango: 'Rango invalido (maximo 62 dias)',
  revisiones_retencion_plazo: 'PURGAR solo para fichas cuya ultima atencion supera los 15 años',
  supervisiones_roles_validos: 'El supervisor debe ser un PROFESIONAL activo',
  bajas_validas: 'Baja solo para cuentas de equipo, con fecha efectiva',
  sesiones_valida: 'Sesion invalida',
  profesional_tipos_atencion_pkey: 'El tipo de atencion ya esta propuesto o asignado',
  tipos_documento_clinico_nombre_key: 'Ya existe un tipo de documento con ese nombre',
  envios_documento_adjunto_solicitado: 'El paciente no pidio recibir el documento adjunto: enviar como enlace',
  pagos_sin_sobrepago: 'El pago supera el saldo de la cita',
  pagos_monto_positivo: 'El monto del pago debe ser positivo',
  pagos_anulacion_coherente: 'Anular un pago exige motivo',
  resoluciones_cita_coherente: 'El traslado exige una cita nueva confirmada del mismo paciente',
  liquidaciones_coherente: 'La liquidacion es de un PROFESIONAL y un periodo valido',
  liquidaciones_sin_solape: 'Ya hay una liquidacion del profesional que se solapa con ese periodo',
  citas_monto_inmutable: 'El monto de la cita no se modifica',
  plantillas_mensaje_variables_permitidas:
    'Variable no permitida: solo nombre_paciente, nombre_profesional, fecha, hora, modalidad, enlace y nombre_centro',
  plantillas_mensaje_coherente: 'Plantilla invalida (asunto y cuerpo no vacios; la bandeja no se desactiva)',
  tipos_documento_clinico_plantilla_valida: 'Variable no permitida: solo nombre_paciente, nombre_profesional, fecha, nombre_centro y contenido',
  configuracion_centro_recordatorio_valido: 'El recordatorio va entre 0 (desactivado) y 168 horas antes',
};

/**
 * Mensajes propios de RAISE ... USING CONSTRAINT (Prisma no expone el campo
 * constraint de Postgres): se reconoce la restriccion por el texto que la
 * migracion escribio. Solo se usa para elegir el mensaje propio de arriba.
 */
const RESTRICCION_POR_TEXTO: [RegExp, string][] = [
  [/fuera de la disponibilidad/, 'citas_dentro_de_disponibilidad'],
  [/agenda bloqueada/, 'citas_fuera_de_bloqueos'],
  [/menor de 18 sin adulto responsable/, 'citas_menor_requiere_adulto_responsable'],
  [/menor de 18: (responde|el consentimiento lo otorga) un adulto/, 'consentimientos_menor_requiere_adulto_responsable'],
  [/con respaldo documental/, 'consentimientos_respaldo_obligatorio'],
  [/Otorgante invalido|adulto responsable no pertenece/, 'consentimientos_adulto_del_paciente'],
  [/ultimo ADMIN/, 'usuarios_ultimo_admin'],
  [/no se desactiva a si mismo/, 'usuarios_admin_no_se_desactiva'],
  [/usuarios GESTION activos/, 'configuracion_centro_gestion_activos'],
  [/GESTION no habilitado/, 'usuarios_gestion_requiere_habilitacion'],
  [/tarifa general vigente/, 'profesionales_publicar_requiere_tarifa'],
  [/Tipo de sesion no aprobado/, 'evoluciones_tipo_sesion_aprobado'],
  [/Candidatos invalidos|Solo se proponen practicantes/, 'derivacion_candidatos_validos'],
  [/Tipo de atencion inexistente o inactivo/, 'derivaciones_tipo_atencion_activo'],
  [/no tiene supervision vigente|no es un practicante con supervision/, 'practicante_requiere_supervision'],
  [/expiracion debe ser futura/, 'historial_accesos_practicante_expiracion_futura'],
  [/Rango invalido \(maximo 62 dias\)/, 'disponibilidad_publica_rango'],
  [/PURGAR solo/, 'revisiones_retencion_plazo'],
  [/requiere consentimiento informado vigente/, 'pacientes_practicante_requiere_consentimiento'],
  [/supera el saldo/, 'pagos_sin_sobrepago'],
  [/monto del pago debe ser positivo/, 'pagos_monto_positivo'],
  [/Anular exige motivo/, 'pagos_anulacion_coherente'],
  [/Adjunto sin solicitud explicita/, 'envios_documento_adjunto_solicitado'],
  [/Traslado: indicar una cita nueva/, 'resoluciones_cita_coherente'],
  [/Liquidacion: un PROFESIONAL/, 'liquidaciones_coherente'],
  [/monto de la cita es inmutable/, 'citas_monto_inmutable'],
];

function restriccionDeMensaje(mensaje: string | undefined): string | undefined {
  if (!mensaje) {
    return undefined;
  }
  // Con o sin comillas escapadas (Prisma serializa el error de Postgres en JSON).
  const nombrada = /constraint \\?"([a-z0-9_]+)\\?"/.exec(mensaje)?.[1];
  if (nombrada) {
    return nombrada;
  }
  return RESTRICCION_POR_TEXTO.find(([re]) => re.test(mensaje))?.[1];
}

/** Nombre del indice unico (convencion de Prisma: <tabla>_<columnas>_key). */
function indiceUnico(meta: Record<string, unknown>): string | undefined {
  if (typeof meta.target === 'string') {
    return meta.target;
  }
  const modelo = Prisma.dmmf.datamodel.models.find((m) => m.name === meta.modelName);
  if (!modelo || !Array.isArray(meta.target)) {
    return undefined;
  }
  const columnas = (meta.target as string[]).map((c) => modelo.fields.find((f) => f.name === c)?.dbName ?? c);
  return `${modelo.dbName ?? modelo.name}_${columnas.join('_')}_key`;
}

/** Extrae SQLSTATE y restriccion de un error de Prisma. undefined si no es de la BD. */
export function errorBd(error: unknown): ErrorBd | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = (error.meta ?? {}) as Record<string, unknown>;
    if (error.code === 'P2002') {
      return { sqlstate: '23505', restriccion: indiceUnico(meta) };
    }
    if (error.code === 'P2025') {
      return { sqlstate: 'P0002' };
    }
    if (error.code === 'P2003') {
      return { sqlstate: '23503' };
    }
    if (error.code === 'P2034') {
      return { sqlstate: '40001' };
    }
    // P2010 (raw), P2004 y otros: el SQLSTATE viene en meta o en el texto.
    const codigo = typeof meta.code === 'string' ? meta.code : /code: "?([0-9A-Z]{5})"?/.exec(error.message)?.[1];
    const mensaje = typeof meta.message === 'string' ? meta.message : error.message;
    return codigo ? { sqlstate: codigo, restriccion: restriccionDeMensaje(mensaje) } : undefined;
  }
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    // El texto del error trae el codigo y el mensaje de Postgres (solo se usa para clasificar).
    const codigo = /code: "?([0-9A-Z]{5})"?/.exec(error.message)?.[1] ?? /SqlState\(E?([0-9A-Z]{5})\)/.exec(error.message)?.[1];
    return codigo ? { sqlstate: codigo, restriccion: restriccionDeMensaje(error.message) } : undefined;
  }
  return undefined;
}

export function esSqlstate(error: unknown, ...codigos: string[]): boolean {
  const e = errorBd(error);
  return !!e && codigos.includes(e.sqlstate);
}

/**
 * Prisma no informa el indice de un 23505 cuando no puede leerlo (RLS): el
 * servicio que sabe cual es lo traduce con esta excepcion (409 + restriccion).
 */
export function conflicto(restriccion: string): ConflictException {
  return new ConflictException({ message: MENSAJE_POR_RESTRICCION[restriccion] ?? MENSAJE_POR_SQLSTATE['23505'], restriccion });
}
