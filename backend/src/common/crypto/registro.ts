/**
 * Registro unico de campos cifrados. Toda columna bytea cifrada de la BD esta
 * aqui (y solo aqui): la extension de Prisma (02) cifra/descifra segun esta
 * lista, y el test de "sin texto plano" la recorre. AAD = tabla:columna:id.
 * Campos `*_hmac` no van aqui: son indices ciegos (Llavero.hmacRut).
 */
import type { CategoriaLlave } from './cifrado';

export interface CampoCifrado {
  modelo: string;
  campo: string;
  tabla: string;
  columna: string;
  categoria: Exclude<CategoriaLlave, 'HMAC'>;
  /** Columna de la fila usada como id en el AAD. */
  id: string;
}

export const CAMPOS_CIFRADOS: readonly CampoCifrado[] = [
  { modelo: 'Usuario', campo: 'telefono', tabla: 'usuarios', columna: 'telefono', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'Paciente', campo: 'rut', tabla: 'pacientes', columna: 'rut', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'Paciente', campo: 'telefono', tabla: 'pacientes', columna: 'telefono', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'AdultoResponsable', campo: 'rut', tabla: 'adultos_responsables', columna: 'rut', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'AdultoResponsable', campo: 'telefono', tabla: 'adultos_responsables', columna: 'telefono', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'Evolucion', campo: 'notas', tabla: 'evoluciones', columna: 'notas', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Evolucion', campo: 'autorNombre', tabla: 'evoluciones', columna: 'autor_nombre', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'Evolucion', campo: 'autorRut', tabla: 'evoluciones', columna: 'autor_rut', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'Evolucion', campo: 'autorRegistro', tabla: 'evoluciones', columna: 'autor_registro', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'SupervisionComentario', campo: 'texto', tabla: 'supervision_comentarios', columna: 'texto', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Derivacion', campo: 'motivo', tabla: 'derivaciones', columna: 'motivo', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Derivacion', campo: 'detalle', tabla: 'derivaciones', columna: 'detalle', categoria: 'CLINICO', id: 'id' },
  // citas conserva DEFAULT de id: el enlace se genera con la cita ya creada (id conocido).
  { modelo: 'Cita', campo: 'enlaceOnline', tabla: 'citas', columna: 'enlace_online', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Boleta', campo: 'emisorNombre', tabla: 'boletas', columna: 'emisor_nombre', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'Boleta', campo: 'emisorRut', tabla: 'boletas', columna: 'emisor_rut', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'ProfesionalDatosPrivados', campo: 'rut', tabla: 'profesional_datos_privados', columna: 'rut', categoria: 'IDENTIFICACION', id: 'usuario_id' },
  { modelo: 'ProfesionalDatosPrivados', campo: 'banco', tabla: 'profesional_datos_privados', columna: 'banco', categoria: 'FINANCIERO', id: 'usuario_id' },
  {
    modelo: 'ProfesionalDatosPrivados',
    campo: 'tipoCuenta',
    tabla: 'profesional_datos_privados',
    columna: 'tipo_cuenta',
    categoria: 'FINANCIERO',
    id: 'usuario_id',
  },
  {
    modelo: 'ProfesionalDatosPrivados',
    campo: 'numeroCuenta',
    tabla: 'profesional_datos_privados',
    columna: 'numero_cuenta',
    categoria: 'FINANCIERO',
    id: 'usuario_id',
  },
  { modelo: 'ProfesionalDatosPrivados', campo: 'titular', tabla: 'profesional_datos_privados', columna: 'titular', categoria: 'FINANCIERO', id: 'usuario_id' },
  // 02g: portal del paciente (texto libre del paciente: puede traer datos de salud).
  { modelo: 'MensajePaciente', campo: 'contenido', tabla: 'mensajes_paciente', columna: 'contenido', categoria: 'CLINICO', id: 'id' },
  { modelo: 'SolicitudEpicrisis', campo: 'motivo', tabla: 'solicitudes_epicrisis', columna: 'motivo', categoria: 'CLINICO', id: 'id' },
  // 02h: documentos clinicos (texto desde 02i; enlace con token) y sala de videollamada propia.
  { modelo: 'DocumentoClinico', campo: 'contenido', tabla: 'documentos_clinicos', columna: 'contenido', categoria: 'CLINICO', id: 'id' },
  { modelo: 'EnvioDocumento', campo: 'enlace', tabla: 'envios_documento', columna: 'enlace', categoria: 'CLINICO', id: 'id' },
  { modelo: 'SalaVideollamada', campo: 'enlace', tabla: 'salas_videollamada', columna: 'enlace', categoria: 'IDENTIFICACION', id: 'usuario_id' },
  // 02i: mensaje armado (bandeja y correo), enlace del recordatorio (token) y adjuntos externos de la ficha.
  { modelo: 'Notificacion', campo: 'asunto', tabla: 'notificaciones', columna: 'asunto', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Notificacion', campo: 'cuerpo', tabla: 'notificaciones', columna: 'cuerpo', categoria: 'CLINICO', id: 'id' },
  { modelo: 'RecordatorioCita', campo: 'enlace', tabla: 'recordatorios_cita', columna: 'enlace', categoria: 'CLINICO', id: 'id' },
  { modelo: 'AdjuntoFicha', campo: 'contenido', tabla: 'adjuntos_ficha', columna: 'contenido', categoria: 'CLINICO', id: 'id' },
  // 03a: segundo factor, contacto de emergencia, solicitud de hora sin cuenta (contacto y respuestas del match),
  // reseñas (texto y feedback privado), alta y borradores de evolucion.
  { modelo: 'Usuario', campo: 'totpSecreto', tabla: 'usuarios', columna: 'totp_secreto', categoria: 'IDENTIFICACION', id: 'id' },
  {
    modelo: 'Paciente',
    campo: 'contactoEmergencia',
    tabla: 'pacientes',
    columna: 'contacto_emergencia',
    categoria: 'IDENTIFICACION',
    id: 'id',
  },
  { modelo: 'SolicitudHora', campo: 'telefono', tabla: 'solicitudes_hora', columna: 'telefono', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'SolicitudHora', campo: 'rut', tabla: 'solicitudes_hora', columna: 'rut', categoria: 'IDENTIFICACION', id: 'id' },
  {
    modelo: 'SolicitudHora',
    campo: 'adultoTelefono',
    tabla: 'solicitudes_hora',
    columna: 'adulto_telefono',
    categoria: 'IDENTIFICACION',
    id: 'id',
  },
  { modelo: 'SolicitudHora', campo: 'respuestas', tabla: 'solicitudes_hora', columna: 'respuestas', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Resena', campo: 'texto', tabla: 'resenas', columna: 'texto', categoria: 'CLINICO', id: 'id' },
  { modelo: 'Resena', campo: 'feedbackPrivado', tabla: 'resenas', columna: 'feedback_privado', categoria: 'CLINICO', id: 'id' },
  { modelo: 'AltaPaciente', campo: 'motivo', tabla: 'altas_paciente', columna: 'motivo', categoria: 'CLINICO', id: 'id' },
  { modelo: 'BorradorEvolucion', campo: 'contenido', tabla: 'borradores_evolucion', columna: 'contenido', categoria: 'CLINICO', id: 'id' },
  // 03a-2: valores de plantillas clinicas (un JSON por registro), mensajeria interna y correos de cuenta por reintentar.
  { modelo: 'Evolucion', campo: 'valores', tabla: 'evoluciones', columna: 'valores', categoria: 'CLINICO', id: 'id' },
  { modelo: 'BorradorEvolucion', campo: 'valores', tabla: 'borradores_evolucion', columna: 'valores', categoria: 'CLINICO', id: 'id' },
  { modelo: 'IngresoFicha', campo: 'valores', tabla: 'ingresos_ficha', columna: 'valores', categoria: 'CLINICO', id: 'id' },
  { modelo: 'HiloInterno', campo: 'asunto', tabla: 'hilos_internos', columna: 'asunto', categoria: 'CLINICO', id: 'id' },
  { modelo: 'MensajeInterno', campo: 'contenido', tabla: 'mensajes_internos', columna: 'contenido', categoria: 'CLINICO', id: 'id' },
  { modelo: 'CorreoCuentaPendiente', campo: 'email', tabla: 'correos_cuenta_pendientes', columna: 'email', categoria: 'IDENTIFICACION', id: 'id' },
  { modelo: 'CorreoCuentaPendiente', campo: 'cuerpo', tabla: 'correos_cuenta_pendientes', columna: 'cuerpo', categoria: 'IDENTIFICACION', id: 'id' },
  // 03b: lista de espera publica (sin cuenta).
  { modelo: 'ListaEsperaPublica', campo: 'telefono', tabla: 'lista_espera_publica', columna: 'telefono', categoria: 'IDENTIFICACION', id: 'id' },
];

/**
 * Columnas bytea que NO se cifran por diseño: imagenes publicas (foto de
 * perfil y logo, 03a), servidas sin autenticacion. Los tests de "sin texto
 * plano" y de registro = BD las excluyen.
 */
export const BYTEA_PUBLICOS = ['imagenes_publicas.contenido'] as const;

export function campoCifrado(modelo: string, campo: string): CampoCifrado | undefined {
  return CAMPOS_CIFRADOS.find((c) => c.modelo === modelo && c.campo === campo);
}
