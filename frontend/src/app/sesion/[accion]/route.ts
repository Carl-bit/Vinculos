/**
 * Puente de sesion (mismo origen del front, fuera de /api para que Traefik
 * lo mande a Next y no al backend). La API entrega el refresh token en el
 * cuerpo; aca se guarda en una cookie httpOnly y al navegador solo le llega
 * el access token. Para el resto de las rutas el navegador habla directo
 * con /api.
 */
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

const API = process.env.API_URL ?? 'http://localhost:3001';
const COOKIE = 'vinculos_refresh';
const RUTA_COOKIE = '/sesion';

interface Accion {
  ruta: string;
  /** Campos del cuerpo del navegador que pasan a la API (whitelist del DTO). */
  campos: readonly string[];
  /** Agrega el refresh token de la cookie al cuerpo. */
  conCookie?: boolean;
}

const ACCIONES: Record<string, Accion> = {
  login: { ruta: '/api/auth/login', campos: ['email', 'rut', 'password', 'rol'] },
  totp: { ruta: '/api/auth/totp', campos: ['desafio', 'codigo'] },
  'segundo-factor': { ruta: '/api/auth/segundo-factor', campos: ['desafio', 'codigo'] },
  'enlace-acceso': { ruta: '/api/auth/enlace-acceso/confirmacion', campos: ['token'] },
  activacion: { ruta: '/api/auth/activacion', campos: ['token', 'password'] },
  refresh: { ruta: '/api/auth/refresh', campos: [], conCookie: true },
  'cambio-rol': { ruta: '/api/auth/cambio-rol', campos: ['rol'], conCookie: true },
  logout: { ruta: '/api/auth/logout', campos: [], conCookie: true },
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ accion: string }> }) {
  const { accion: nombre } = await params;
  const accion = ACCIONES[nombre];
  if (!accion) return NextResponse.json({ statusCode: 404, error: 'NOT_FOUND', mensaje: 'Accion desconocida' }, { status: 404 });

  const almacen = await cookies();
  const entrada = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const cuerpo: Record<string, unknown> = Object.fromEntries(accion.campos.filter((c) => c in entrada).map((c) => [c, entrada[c]]));
  if (accion.conCookie) {
    const refresh = almacen.get(COOKIE)?.value;
    if (!refresh) return NextResponse.json({ statusCode: 401, error: 'UNAUTHORIZED', mensaje: 'Sin sesion' }, { status: 401 });
    cuerpo.refreshToken = refresh;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // El rate limit de login es por IP: la API confia en X-Forwarded-For desde loopback/red interna.
  const ip = request.headers.get('x-forwarded-for');
  if (ip) headers['X-Forwarded-For'] = ip;

  const respuesta = await fetch(`${API}${accion.ruta}`, { method: 'POST', headers, body: JSON.stringify(cuerpo), cache: 'no-store' });
  const datos = respuesta.status === 204 ? null : ((await respuesta.json().catch(() => null)) as Record<string, unknown> | null);

  if (nombre === 'logout' || (accion.conCookie && respuesta.status === 401)) {
    almacen.delete({ name: COOKIE, path: RUTA_COOKIE });
  }
  if (!respuesta.ok || !datos)
    return new NextResponse(datos ? JSON.stringify(datos) : null, { status: respuesta.status, headers: { 'Content-Type': 'application/json' } });

  const { refreshToken, ...resto } = datos;
  if (typeof refreshToken === 'string') {
    // 03b: la cookie dura lo mismo que el refresh en la API (minutos sin actividad) y se renueva con cada rotacion.
    const minutos = typeof datos.inactividadMinutos === 'number' ? datos.inactividadMinutos : 30;
    almacen.set(COOKIE, refreshToken, {
      httpOnly: true,
      // 03b-4.1: Secure solo con HTTPS (en el silo Traefik termina TLS y avisa con X-Forwarded-Proto); en localhost sin HTTPS la cookie igual viaja.
      secure: (request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '')) === 'https',
      sameSite: 'strict',
      path: RUTA_COOKIE,
      maxAge: minutos * 60,
    });
  }
  return NextResponse.json(resto, { status: respuesta.status });
}
