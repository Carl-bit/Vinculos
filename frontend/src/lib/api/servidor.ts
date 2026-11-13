/**
 * Lecturas del sitio publico desde el servidor (SSR). Llama directo a la API
 * (API_URL, red interna del silo) sin sesion. Cada respuesta queda 60 s en el
 * Data Cache de Next: el rate limit publico es por IP y aqui todas las
 * llamadas salen del mismo servidor.
 */
import { headers } from 'next/headers';
import { connection } from 'next/server';
import createClient from 'openapi-fetch';
import { cache } from 'react';

import type { components, paths } from './esquema';

type Esquema = components['schemas'];
export type CentroPublico = Esquema['CentroPublico'];
export type PerfilPublico = Esquema['PerfilPublico'];
export type ResenaPublica = Esquema['ResenaPublica'];
export type CuestionarioPublico = Esquema['CuestionarioPublico'];
export type PoliticaPublica = Esquema['PoliticaPublica'];
export type TipoPolitica = paths['/api/publico/politicas/{tipo}']['get']['parameters']['path']['tipo'];

const REVALIDAR_S = 60;

const api = createClient<paths>({
  baseUrl: process.env.API_URL ?? 'http://localhost:3001',
  fetch: (request) => fetch(request, { next: { revalidate: REVALIDAR_S } }),
});

/**
 * Datos, o null si la API responde 403 (modulo inactivo) o 404. Otro error
 * se lanza y lo muestra app/(publico)/error.tsx.
 */
async function leer<T>(promesa: Promise<{ data?: T; response: Response }>): Promise<T | null> {
  await connection(); // Render por request: el build no necesita la API.
  const { data, response } = await promesa;
  if (response.status === 403 || response.status === 404) return null;
  if (!response.ok) throw new Error(`API ${response.status} en ${new URL(response.url).pathname}`);
  return data as T;
}

export const centroPublico = cache(() => leer(api.GET('/api/publico/centro')));

export const perfilesPublicos = cache(async () => (await leer(api.GET('/api/publico/profesionales', { params: { query: {} } }))) ?? []);

export const perfilPublico = cache(async (id: string) => (await perfilesPublicos()).find((p) => p.id === id) ?? null);

export const resenasPublicas = cache(
  async (id: string) => (await leer(api.GET('/api/publico/profesionales/{id}/resenas', { params: { path: { id } } }))) ?? [],
);

export const cuestionario = cache(() => leer(api.GET('/api/publico/cuestionario')));

/**
 * IP del visitante segun el proxy de entrada (Traefik la pone en
 * X-Forwarded-For y descarta la que mande el cliente; detras del tunel de
 * Cloudflare, Traefik debe confiar en cloudflared para conservarla).
 */
async function ipVisitante(): Promise<string | null> {
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip || null;
}

/**
 * Politicas sin Data Cache: la BD exige aceptar la version vigente; con 60 s
 * de cache el formulario podia enviar el id de una version ya reemplazada.
 * AUD-02: sin cache, cada lectura cuenta en el rate limit publico de la API.
 * Se reenvia la IP del visitante para que el limite sea por persona y no por
 * el servidor Next (que es una sola IP para todo el sitio). Las lecturas con
 * cache no la llevan: seria partir la cache por visitante.
 */
const apiSinCache = createClient<paths>({
  baseUrl: process.env.API_URL ?? 'http://localhost:3001',
  fetch: async (request) => {
    const ip = await ipVisitante();
    if (ip) request.headers.set('x-forwarded-for', ip);
    return fetch(request, { cache: 'no-store' });
  },
});

export const politica = cache((tipo: TipoPolitica) => leer(apiSinCache.GET('/api/publico/politicas/{tipo}', { params: { path: { tipo } } })));
