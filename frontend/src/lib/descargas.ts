/**
 * Descarga de binarios de la API (PDF) con la sesion en memoria. Fuera del
 * cliente generado (openapi-fetch no maneja blobs): el 401 se renueva una vez
 * a mano, igual que el middleware del cliente.
 */
import { ApiError, type ErrorRespuesta } from './api/errores';
import { accessToken, renovarSesion } from './sesion';

export type ResultadoDescarga = 'listo' | 'vencido' | 'no-encontrado' | 'error';

/**
 * PDF generado al vuelo (vista previa de un documento): devuelve el blob para
 * mostrarlo en pantalla con un object URL; nunca se guarda. Error de la API ->
 * ApiError con el texto claro del estado.
 */
export async function pedirArchivo(ruta: string, cuerpo: unknown): Promise<Blob> {
  const pedir = () =>
    fetch(ruta, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken() ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
    });
  let r = await pedir();
  if (r.status === 401 && (await renovarSesion())) r = await pedir();
  if (!r.ok) throw new ApiError(r.status, (await r.json().catch(() => ({}))) as Partial<ErrorRespuesta>);
  return r.blob();
}

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
