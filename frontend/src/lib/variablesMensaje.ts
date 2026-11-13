/**
 * Datos que el sistema completa en mensajes y documentos. Quien administra el
 * centro escribe {paciente}; la API y la BD guardan {{nombre_paciente}}. La
 * conversion vive solo aca: las plantillas de la BD no cambian.
 */
export interface DatoMensaje {
  simple: string;
  clave: string;
  descripcion: string;
}

const PACIENTE = { simple: 'paciente', clave: 'nombre_paciente', descripcion: 'nombre del paciente' };
const PROFESIONAL = { simple: 'profesional', clave: 'nombre_profesional', descripcion: 'nombre del profesional' };
const FECHA = { simple: 'fecha', clave: 'fecha', descripcion: 'día de la cita' };
const CENTRO = { simple: 'centro', clave: 'nombre_centro', descripcion: 'nombre del centro' };

export const DATOS_MENSAJE: readonly DatoMensaje[] = [
  PACIENTE,
  PROFESIONAL,
  FECHA,
  { simple: 'hora', clave: 'hora', descripcion: 'hora de la cita' },
  { simple: 'modalidad', clave: 'modalidad', descripcion: 'presencial u online' },
  CENTRO,
  { simple: 'enlace', clave: 'enlace', descripcion: 'enlace para entrar' },
];

export const DATOS_DOCUMENTO: readonly DatoMensaje[] = [
  PACIENTE,
  PROFESIONAL,
  { ...FECHA, descripcion: 'fecha de emisión' },
  CENTRO,
  { simple: 'contenido', clave: 'contenido', descripcion: 'lo que redacta el profesional' },
];

const TODOS = [...DATOS_MENSAJE, ...DATOS_DOCUMENTO];

/** {{nombre_paciente}} -> {paciente}. Una variable que no conoce queda igual. */
export function aDatosSimples(texto: string): string {
  return texto.replace(/\{\{\s*(\w+)\s*\}\}/g, (original, clave: string) => {
    const dato = TODOS.find((d) => d.clave === clave);
    return dato ? `{${dato.simple}}` : original;
  });
}

/** {paciente} -> {{nombre_paciente}}. Tolera mayusculas, espacios y llaves dobles. */
export function aVariables(texto: string, datos: readonly DatoMensaje[]): string {
  return texto.replace(/\{\{?\s*([^{}]+?)\s*\}?\}/g, (original, nombre: string) => {
    const dato = datos.find((d) => d.simple === nombre.toLowerCase());
    return dato ? `{{${dato.clave}}}` : original;
  });
}

/** Mensaje claro si queda una llave suelta o un dato que no existe; null si esta bien. */
export function datoInvalido(texto: string, datos: readonly DatoMensaje[]): string | null {
  const sobra = /\{[^{}]*\}?|\}/.exec(aVariables(texto, datos).replace(/\{\{\w+\}\}/g, ''));
  if (!sobra) return null;
  return `«${sobra[0]}» no es un dato que el sistema pueda completar. Puedes usar: ${datos.map((d) => `{${d.simple}}`).join(', ')}.`;
}
