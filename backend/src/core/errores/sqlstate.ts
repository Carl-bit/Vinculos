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
  citas_dentro_de_disponibilidad: 'La cita cae fuera de las horas de box que el profesional tiene apartadas',
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
  plantillas_mensaje_variables_permitidas: 'Variable no permitida: solo nombre_paciente, nombre_profesional, fecha, hora, modalidad, enlace y nombre_centro',
  plantillas_mensaje_coherente: 'Plantilla invalida (asunto y cuerpo no vacios; la bandeja no se desactiva)',
  tipos_documento_clinico_plantilla_valida: 'Variable no permitida: solo nombre_paciente, nombre_profesional, fecha, nombre_centro y contenido',
  configuracion_centro_recordatorio_valido: 'El recordatorio va entre 0 (desactivado) y 168 horas antes',
  configuracion_centro_recordatorio_antes_de_cancelacion:
    'El recordatorio debe salir antes del plazo de aviso de cancelacion: recordatorioHorasAntes mayor que plazoAvisoCancelacionHoras (o 0 para desactivarlo)',
  // 03a
  roles_adicionales_combinacion: 'Combinacion de roles invalida: solo ADMIN o GESTION suman PROFESIONAL',
  usuarios_paciente_edad_minima: 'La cuenta de paciente exige correo y la edad minima configurada (antes: el adulto responsable)',
  // 03a-2: plantillas clinicas, mensajeria interna y duplicados.
  registro_plantilla_valida: 'Use una plantilla publicada del tipo correcto (una correccion usa la version del registro que corrige)',
  registro_plantilla_especialidad: 'La plantilla es de una especialidad que no tiene aprobada',
  plantillas_clinicas_validas: 'Definicion de plantilla invalida (campos, tipos u opciones)',
  hilos_internos_coherentes: 'Hilo general sin paciente y solo con integrantes vigentes del equipo; hilo de caso con paciente',
  pacientes_duplicado_resolucion: 'Resolucion: DISTINTO o MISMO_PACIENTE',
  usuarios_responsable_de_menor: 'La cuenta de adulto responsable es para pacientes menores de 18 y requiere correo',
  tokens_correo_sin_destinatario: 'El paciente (o su adulto responsable) no tiene correo registrado',
  aceptaciones_politica_version_vigente: 'Hay una version nueva de la politica: vuelva a leerla y aceptarla',
  aceptaciones_politica_coherente: 'Aceptacion invalida (menor: adulto responsable; presencial: respaldo)',
  citas_dentro_de_horario_centro: 'La cita cae fuera del horario de atencion del centro',
  citas_dentro_de_horario_espacio: 'La cita cae fuera del horario de funcionamiento del box',
  citas_profesional_con_acceso: 'El profesional no es el tratante ni tiene acceso clinico temporal en ese horario: usar derivacion o acceso temporal',
  solicitudes_hora_limite: 'Ya hay solicitudes pendientes de verificar para este correo: revise su bandeja de entrada',
  solicitudes_hora_disponible: 'La hora ya no esta disponible: elija otra',
  solicitudes_hora_coherente: 'Solicitud invalida (hora pasada o datos incompletos)',
  videollamada_sin_sala: 'El profesional no tiene sala de videollamada configurada para atender online',
  resenas_requiere_sesion: 'Solo se puede reseñar a un profesional con al menos una sesion realizada',
  resenas_paciente_id_profesional_id_key: 'Ya hay una reseña de este paciente para el profesional: editela',
  resenas_coherente: 'Reseña invalida (calificacion de 1 a 5; ocultar exige motivo)',
  accesos_clinicos_temporales_validos: 'Acceso temporal invalido: otro PROFESIONAL activo y un plazo de hasta 180 dias',
  evoluciones_cita_del_paciente: 'La sesion indicada no es de este paciente',
  evoluciones_paciente_requiere_rut: 'Registre el RUT del paciente antes de su primera evolucion',
  altas_paciente_fecha: 'La fecha de alta no puede ser futura',
  reporte_cobros_periodo: 'Periodo invalido (maximo un año)',
  configuracion_centro_modulos_coherentes: 'Modulos incoherentes: Match requiere Equipo y Cobros requiere Agenda',
  configuracion_centro_portal_valido: 'Valores fuera de rango para el portal',
  imagenes_publicas_validas: 'Imagen invalida (JPEG, PNG o WebP de hasta 1024 px y 1 MB tras procesar)',
  contenido_publico_valido: 'Contenido publico invalido (hasta 12 servicios, color #RRGGBB)',
  politicas_coherente: 'El texto de la politica no puede estar vacio',
  horario_centro_valido: 'Horario invalido (dia 1-7 y minutos 0-1440, inicio antes del fin)',
  horarios_espacio_valido: 'Horario invalido (dia 1-7 y minutos 0-1440, inicio antes del fin)',
  // 03b
  horarios_espacio_periodo: 'Periodo invalido: la fecha de inicio va antes de la de termino',
  bloques_atencion_sin_choque_box: 'Ese box ya esta apartado por otro profesional en ese horario',
  bloques_atencion_sin_choque_profesional: 'El profesional ya tiene horas de box apartadas en ese horario',
  bloques_atencion_rango: 'El bloque debe terminar despues de empezar',
  bloques_atencion_profesional: 'Solo un profesional o practicante vigente aparta horas de box',
  bloques_atencion_box_activo: 'El box no existe o esta inactivo',
  bloques_atencion_dentro_de_horario_espacio: 'El bloque cae fuera del horario disponible del box',
  bloques_atencion_dentro_de_horario_centro: 'El bloque cae fuera del horario de atencion del centro',
  bloques_atencion_con_citas: 'El bloque tiene citas o reservas en curso: reprograme o cancele antes de liberarlo',
  horarios_espacio_bloques_fuera: 'El horario nuevo deja bloques apartados fuera: liberelos o muevalos primero',
  // Antes de 03b-4: reserva desde la cuenta del paciente.
  citas_portal_cuenta_restringida: 'Las horas de un menor las pide su adulto responsable desde su cuenta',
  citas_portal_tratante: 'No tienes un profesional tratante que agende por el portal: escribe al centro',
  // 03b-3.1: confirmacion por medio de pago
  configuracion_centro_medios_pago: 'Medios de pago: al menos uno; plazo de validacion entre 1 y 168 horas; porcentaje entre 1 y 100',
  configuracion_centro_transferencia_sin_cuenta: 'Para habilitar transferencia, registre primero la cuenta bancaria del centro',
  citas_medio_no_habilitado: 'Ese medio de pago no esta habilitado en el centro',
  citas_transferencia_sin_cuenta: 'No hay una cuenta registrada para transferir: elija otro medio de pago',
  citas_pago_coherente: 'Una cita pendiente de pago necesita su plazo de pago',
  solicitudes_hora_tomada: 'La hora ya no esta disponible: elija otra',
  transferencias_coherente: 'Transferencia invalida (comprobante PDF, PNG o JPEG; motivo de rechazo de 3 a 300 caracteres)',
  cobros_pasarela_coherente: 'Cobro en linea invalido',
  // 03b-3.3: morosidad y caja de la hora retenida
  citas_paciente_moroso: 'El paciente tiene sesiones anteriores con pago pendiente: regularice en el centro antes de agendar',
  excepciones_morosidad_coherente: 'Autorizar una cita con deuda exige un motivo (3 a 500 caracteres)',
  configuracion_centro_morosidad_valida: 'Plazo de pago del equipo entre 0 y 168 horas; dias de gracia entre 0 y 90',
  citas_caja_solo_presencial: 'La hora online se paga en linea o por transferencia, no en caja',
  pagos_caja_monto: 'El pago en caja debe cubrir lo exigido para confirmar sin superar el monto de la sesion',
  citas_liberacion_coherente: 'Liberar la hora exige un motivo (3 a 500 caracteres)',
  resoluciones_cita_justificada: 'La inasistencia justificada exige motivo',
};

/**
 * Mensajes propios de RAISE ... USING CONSTRAINT (Prisma no expone el campo
 * constraint de Postgres): se reconoce la restriccion por el texto que la
 * migracion escribio. Solo se usa para elegir el mensaje propio de arriba.
 */
const RESTRICCION_POR_TEXTO: [RegExp, string][] = [
  [/fuera de la disponibilidad/, 'citas_dentro_de_disponibilidad'],
  // 03b
  [/Solo un profesional o practicante vigente aparta/, 'bloques_atencion_profesional'],
  [/El box no existe o esta inactivo/, 'bloques_atencion_box_activo'],
  [/fuera del horario disponible del box/, 'bloques_atencion_dentro_de_horario_espacio'],
  [/El bloque cae fuera del horario de atencion del centro/, 'bloques_atencion_dentro_de_horario_centro'],
  [/El bloque tiene citas o reservas en curso/, 'bloques_atencion_con_citas'],
  [/Las horas de un menor las pide su adulto responsable/, 'citas_portal_cuenta_restringida'],
  [/No tienes un profesional tratante que agende/, 'citas_portal_tratante'],
  // 03b-3.1
  [/Ese medio de pago no esta habilitado/, 'citas_medio_no_habilitado'],
  [/No hay una cuenta registrada para transferir/, 'citas_transferencia_sin_cuenta'],
  [/registre primero la cuenta bancaria del centro/, 'configuracion_centro_transferencia_sin_cuenta'],
  // 03b-3.3
  [/sesiones anteriores con pago pendiente/, 'citas_paciente_moroso'],
  [/Autorizar con deuda exige motivo/, 'excepciones_morosidad_coherente'],
  [/La hora online se paga en linea o por transferencia/, 'citas_caja_solo_presencial'],
  [/El pago en caja debe cubrir lo exigido/, 'pagos_caja_monto'],
  [/Liberar exige motivo/, 'citas_liberacion_coherente'],
  [/La inasistencia justificada exige motivo/, 'resoluciones_cita_justificada'],
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
  // 03a-2
  [/especialidad que no tiene aprobada/, 'registro_plantilla_especialidad'],
  [/Use una plantilla publicada|misma version de plantilla/, 'registro_plantilla_valida'],
  [/Hilo general: sin paciente|Solo hilos generales/, 'hilos_internos_coherentes'],
  [/Resolucion: DISTINTO o MISMO_PACIENTE/, 'pacientes_duplicado_resolucion'],
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
  // 03a
  [/Combinacion de roles invalida/, 'roles_adicionales_combinacion'],
  [/Cuenta de paciente/, 'usuarios_paciente_edad_minima'],
  [/Cuenta de adulto responsable/, 'usuarios_responsable_de_menor'],
  [/no tiene correo/, 'tokens_correo_sin_destinatario'],
  [/version nueva de la politica|version aceptada no es la vigente/, 'aceptaciones_politica_version_vigente'],
  [/fuera del horario de atencion del centro/, 'citas_dentro_de_horario_centro'],
  [/fuera del horario de funcionamiento del box/, 'citas_dentro_de_horario_espacio'],
  [/no es el tratante ni tiene acceso clinico temporal/, 'citas_profesional_con_acceso'],
  [/solicitudes pendientes de verificar/, 'solicitudes_hora_limite'],
  [/La hora ya no esta disponible/, 'solicitudes_hora_disponible'],
  [/La hora ya paso/, 'solicitudes_hora_coherente'],
  [/no atiende online por el portal/, 'videollamada_sin_sala'],
  [/al menos una sesion realizada/, 'resenas_requiere_sesion'],
  [/acceso temporal es para otro PROFESIONAL/, 'accesos_clinicos_temporales_validos'],
  [/La sesion no es de este paciente/, 'evoluciones_cita_del_paciente'],
  [/Registre el RUT del paciente/, 'evoluciones_paciente_requiere_rut'],
  [/fecha de alta no puede ser futura/, 'altas_paciente_fecha'],
  [/Periodo invalido \(maximo un año\)/, 'reporte_cobros_periodo'],
  [/menor de 18: el solicitante se declara adulto responsable/, 'citas_menor_requiere_adulto_responsable'],
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
    const meta = error.meta ?? {};
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
