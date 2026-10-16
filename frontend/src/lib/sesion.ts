/**
 * Sesion del navegador. El access token vive solo en memoria (este modulo);
 * el refresh token, en una cookie httpOnly que maneja app/sesion/[accion]
 * (el JS del navegador nunca lo ve). Al recargar la pagina la sesion se
 * recupera con /sesion/refresh.
 */
import { ApiError } from './api/errores';
import type { components } from './api/esquema';

type Tokens = components['schemas']['Tokens'];
export type DesafioTotp = components['schemas']['DesafioTotp'];
export type Rol = components['schemas']['Rol'];
export type SesionActiva = Omit<Tokens, 'refreshToken'>;

export type EstadoSesion = { tipo: 'desconocida' } | { tipo: 'anonima' } | { tipo: 'activa'; sesion: SesionActiva };

let estado: EstadoSesion = { tipo: 'desconocida' };
const oyentes = new Set<() => void>();
let temporizador: ReturnType<typeof setTimeout> | undefined;
let renovando: Promise<SesionActiva | null> | null = null;

/** Margen antes del vencimiento para renovar sin que una request alcance a fallar. */
const MARGEN_RENOVACION_S = 60;

export function estadoSesion(): EstadoSesion {
  return estado;
}

export function suscribirSesion(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

export function accessToken(): string | null {
  return estado.tipo === 'activa' ? estado.sesion.accessToken : null;
}

function fijar(nuevo: EstadoSesion): void {
  estado = nuevo;
  clearTimeout(temporizador);
  if (nuevo.tipo === 'activa') {
    const segundos = Math.max(nuevo.sesion.expiraEn - MARGEN_RENOVACION_S, 5);
    temporizador = setTimeout(() => void renovarSesion(), segundos * 1000);
  }
  oyentes.forEach((o) => o());
}

async function pedir<T>(accion: string, cuerpo: object = {}): Promise<T> {
  const respuesta = await fetch(`/sesion/${accion}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
    credentials: 'same-origin',
  });
  const datos = respuesta.status === 204 ? undefined : await respuesta.json().catch(() => undefined);
  if (!respuesta.ok) throw new ApiError(respuesta.status, datos ?? {});
  return datos as T;
}

/** Login, TOTP, enlace de acceso o activacion: abre la sesion o devuelve el desafio TOTP. */
async function entrar(accion: string, cuerpo: object): Promise<SesionActiva | DesafioTotp> {
  const r = await pedir<SesionActiva | DesafioTotp>(accion, cuerpo);
  if ('accessToken' in r) fijar({ tipo: 'activa', sesion: r });
  return r;
}

export type DatosLogin = components['schemas']['LoginDto'] & { recordar: boolean };

export const iniciarSesion = (datos: DatosLogin) => entrar('login', datos);
export const verificarTotp = (desafio: string, codigo: string, recordar: boolean) => entrar('totp', { desafio, codigo, recordar });
export const usarEnlaceAcceso = (token: string) => entrar('enlace-acceso', { token });
export const activarCuenta = (token: string, password: string) => entrar('activacion', { token, password });

/** Renueva con la cookie. Una sola request en vuelo aunque varias la pidan (401 en paralelo). */
export function renovarSesion(): Promise<SesionActiva | null> {
  renovando ??= pedir<SesionActiva>('refresh')
    .then((sesion) => {
      fijar({ tipo: 'activa', sesion });
      return sesion;
    })
    .catch((error: unknown) => {
      // Sin red o API caida: no se cierra la sesion por un error transitorio.
      if (error instanceof ApiError && (error.status === 401 || error.status === 400)) fijar({ tipo: 'anonima' });
      else if (estado.tipo === 'desconocida') fijar({ tipo: 'anonima' });
      return null;
    })
    .finally(() => {
      renovando = null;
    });
  return renovando;
}

/** Cambia el rol activo: token nuevo (la familia anterior queda revocada). */
export async function cambiarRol(rol: Rol): Promise<SesionActiva> {
  const sesion = await pedir<SesionActiva>('cambio-rol', { rol });
  fijar({ tipo: 'activa', sesion });
  return sesion;
}

export async function cerrarSesion(): Promise<void> {
  try {
    await pedir('logout');
  } finally {
    fijar({ tipo: 'anonima' });
  }
}
