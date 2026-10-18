/**
 * Subida de archivos (multipart) con la sesion en memoria. Fuera del cliente
 * generado (openapi-fetch no arma multipart tipado): el 401 se renueva una vez
 * a mano, igual que en descargas.ts. Devuelve el JSON de la API o lanza
 * ApiError con el texto claro del estado (413, 422...).
 */
import { ApiError, type ErrorRespuesta } from './api/errores';
import { accessToken, renovarSesion } from './sesion';

export async function subirArchivo<T>(ruta: string, campo: string, archivo: File): Promise<T> {
  const pedir = () => {
    const cuerpo = new FormData();
    cuerpo.append(campo, archivo);
    return fetch(ruta, { method: 'POST', headers: { Authorization: `Bearer ${accessToken() ?? ''}` }, body: cuerpo, cache: 'no-store' });
  };
  let r = await pedir();
  if (r.status === 401 && (await renovarSesion())) r = await pedir();
  const json = (await r.json().catch(() => ({}))) as unknown;
  if (!r.ok) throw new ApiError(r.status, json as Partial<ErrorRespuesta>);
  return json as T;
}
