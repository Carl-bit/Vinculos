/**
 * Sesion del navegador. El access token vive solo en memoria (este modulo);
 * el refresh token, en una cookie httpOnly que maneja app/sesion/[accion]
 * (el JS del navegador nunca lo ve). Al recargar la pagina la sesion se
 * recupera con /sesion/refresh, con el mismo rol activo (lo guarda la sesion
 * del servidor, no el navegador: lo que esta en el navegador se puede
 * manipular y los permisos los decide la API con el token firmado).
 *
 * 03b: la sesion se cierra tras `inactividadMinutos` (30 por defecto) sin
 * actividad del usuario. La ultima actividad se comparte entre pestañas con
 * una marca de tiempo en localStorage (dato no clinico): una pestaña olvidada
 * no cierra la sesion mientras otra se usa. Salir en una pestaña cierra las
 * demas (evento storage).
 */
import { ApiError } from './api/errores';
import type { components } from './api/esquema';

type Tokens = components['schemas']['Tokens'];
export type DesafioTotp = components['schemas']['DesafioTotp'];
export type Rol = components['schemas']['Rol'];
export type SesionActiva = Omit<Tokens, 'refreshToken'>;

export type EstadoSesion = { tipo: 'desconocida' } | { tipo: 'anonima'; motivo?: 'inactividad' } | { tipo: 'activa'; sesion: SesionActiva };

let estado: EstadoSesion = { tipo: 'desconocida' };
const oyentes = new Set<() => void>();
let temporizador: ReturnType<typeof setTimeout> | undefined;
let vigia: ReturnType<typeof setInterval> | undefined;
let renovando: Promise<SesionActiva | null> | null = null;

/** Margen antes del vencimiento para renovar sin que una request alcance a fallar. */
const MARGEN_RENOVACION_S = 60;
/** Cada cuanto se revisa la inactividad. */
const REVISION_MS = 15_000;
const CLAVE_ACTIVIDAD = 'vinculos_actividad';
const CLAVE_SALIDA = 'vinculos_salida';
const EVENTOS_ACTIVIDAD = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

let ultimaActividadLocal = Date.now();

function leerAlmacen(clave: string): number {
  try {
    return Number(localStorage.getItem(clave) ?? 0);
  } catch {
    return 0;
  }
}

function escribirAlmacen(clave: string, valor: number): void {
  try {
    localStorage.setItem(clave, String(valor));
  } catch {
    // Almacen bloqueado (modo privado): la inactividad se mide solo en esta pestaña.
  }
}

/** Ultima actividad de cualquier pestaña del centro. */
export function ultimaActividad(): number {
  return Math.max(ultimaActividadLocal, leerAlmacen(CLAVE_ACTIVIDAD));
}

let ultimaEscritura = 0;
function registrarActividad(): void {
  ultimaActividadLocal = Date.now();
  // Sin escribir en cada tecla: basta una marca cada 5 segundos.
  if (ultimaActividadLocal - ultimaEscritura > 5_000) {
    ultimaEscritura = ultimaActividadLocal;
    escribirAlmacen(CLAVE_ACTIVIDAD, ultimaActividadLocal);
  }
}

function alSalirEnOtraPestana(e: StorageEvent): void {
  if (e.key === CLAVE_SALIDA && estado.tipo === 'activa') fijar({ tipo: 'anonima' });
}

function vigilar(activa: boolean): void {
  if (typeof window === 'undefined') return;
  if (activa && !vigia) {
    registrarActividad();
    EVENTOS_ACTIVIDAD.forEach((ev) => window.addEventListener(ev, registrarActividad, { passive: true }));
    window.addEventListener('storage', alSalirEnOtraPestana);
    vigia = setInterval(revisarInactividad, REVISION_MS);
  } else if (!activa && vigia) {
    EVENTOS_ACTIVIDAD.forEach((ev) => window.removeEventListener(ev, registrarActividad));
    window.removeEventListener('storage', alSalirEnOtraPestana);
    clearInterval(vigia);
    vigia = undefined;
  }
}

function inactiva(): boolean {
  return estado.tipo === 'activa' && Date.now() - ultimaActividad() >= estado.sesion.inactividadMinutos * 60_000;
}

function revisarInactividad(): void {
  if (inactiva()) void cerrarSesion('inactividad');
}

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
    // Sin actividad no se renueva: la sesion se cierra en vez de alargarse sola.
    temporizador = setTimeout(() => void (inactiva() ? cerrarSesion('inactividad') : renovarSesion()), segundos * 1000);
  }
  vigilar(nuevo.tipo === 'activa');
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
  if ('accessToken' in r) {
    registrarActividad();
    fijar({ tipo: 'activa', sesion: r });
  }
  return r;
}

export type DatosLogin = components['schemas']['LoginDto'];

export const iniciarSesion = (datos: DatosLogin) => entrar('login', datos);
export const verificarTotp = (desafio: string, codigo: string) => entrar('totp', { desafio, codigo });
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

/** Cierra la sesion (revoca el refresh en la API) y avisa a las demas pestañas. */
export async function cerrarSesion(motivo?: 'inactividad'): Promise<void> {
  try {
    await pedir('logout');
  } catch {
    // Igual se cierra localmente: el refresh vence solo en el servidor.
  } finally {
    escribirAlmacen(CLAVE_SALIDA, Date.now());
    fijar({ tipo: 'anonima', motivo });
  }
}
