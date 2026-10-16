/**
 * Cliente de la API generado desde docs/api/openapi.json (npm run api:tipos).
 * Mismo origen: /api/* lo sirve el rewrite de Next en desarrollo y Traefik en
 * el silo. Agrega el access token y, ante un 401, renueva una vez y reintenta.
 */
import createClient, { type Middleware } from 'openapi-fetch';

import { accessToken, renovarSesion } from '../sesion';
import { ApiError } from './errores';
import type { paths } from './esquema';

const copias = new WeakMap<Request, Request>();

const autenticacion: Middleware = {
  onRequest({ request }) {
    const token = accessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    copias.set(request, request.clone());
    return request;
  },
  async onResponse({ request, response }) {
    const copia = copias.get(request);
    if (response.status !== 401 || !copia || !accessToken()) return response;
    const sesion = await renovarSesion();
    if (!sesion) return response;
    copia.headers.set('Authorization', `Bearer ${sesion.accessToken}`);
    return fetch(copia);
  },
};

export const api = createClient<paths>({ baseUrl: '' });
api.use(autenticacion);

/** Desenvuelve la respuesta de openapi-fetch: datos, o ApiError con el estado y el cuerpo. */
export async function datos<T>(promesa: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await promesa;
  if (!response.ok) throw new ApiError(response.status, (error ?? {}) as ConstructorParameters<typeof ApiError>[1]);
  return data as T;
}
