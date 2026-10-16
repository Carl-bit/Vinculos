import type { components } from './esquema';

export type ErrorRespuesta = components['schemas']['ErrorRespuesta'];

/** Error de la API con el cuerpo del filtro global del backend. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly cuerpo: Partial<ErrorRespuesta> = {},
  ) {
    super(mensajeError(status, cuerpo));
    this.name = 'ApiError';
  }
}

const GENERICOS: Record<number, string> = {
  400: 'Revisa los datos ingresados.',
  401: 'Tu sesión terminó. Vuelve a ingresar.',
  403: 'No tienes permiso para hacer esto con el rol activo.',
  404: 'No encontramos lo que buscas, o no tienes acceso a verlo.',
  409: 'Alguien hizo un cambio antes que tú. Revisa las alternativas y vuelve a intentar.',
  413: 'El archivo o el contenido es demasiado grande.',
  422: 'La operación no cumple una regla del centro.',
  429: 'Demasiados intentos. Espera un minuto y vuelve a intentar.',
};

/**
 * Texto para el usuario. 409 y 422 traen el mensaje propio de la regla
 * (nunca el de Postgres); el resto usa un texto claro por estado.
 */
export function mensajeError(status: number, cuerpo: Partial<ErrorRespuesta> = {}): string {
  const propio = Array.isArray(cuerpo.mensaje) ? cuerpo.mensaje.join(' ') : cuerpo.mensaje;
  if ((status === 409 || status === 422 || status === 400) && propio) return propio;
  return GENERICOS[status] ?? 'No pudimos completar la operación. Intenta de nuevo en unos minutos.';
}
