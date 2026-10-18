/**
 * Descarga de binarios de la API (PDF) con la sesion en memoria. Fuera del
 * cliente generado (openapi-fetch no maneja blobs): el 401 se renueva una vez
 * a mano, igual que el middleware del cliente.
 */
import { accessToken, renovarSesion } from './sesion';

export type ResultadoDescarga = 'listo' | 'vencido' | 'no-encontrado' | 'error';

export async function descargarArchivo(ruta: string, nombrePorDefecto: string): Promise<ResultadoDescarga> {
  const pedir = () => fetch(ruta, { headers: { Authorization: `Bearer ${accessToken() ?? ''}` }, cache: 'no-store' });
  try {
    let r = await pedir();
    if (r.status === 401 && (await renovarSesion())) r = await pedir();
    if (r.status === 410) return 'vencido';
    if (r.status === 404 || r.status === 400) return 'no-encontrado';
    if (!r.ok) return 'error';
    const nombre = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(r.headers.get('Content-Disposition') ?? '')?.[1];
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre ? decodeURIComponent(nombre) : nombrePorDefecto;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return 'listo';
  } catch {
    return 'error';
  }
}
