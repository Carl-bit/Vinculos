/**
 * Bloques de sesion a partir de los huecos libres de disponibilidad_publica()
 * (rangos continuos por modalidad). La API no expone la duracion de sesion por
 * profesional: se ofrecen bloques de DURACION_SESION_MIN a cada hora en punto.
 */
import type { components } from './api/esquema';

type Hueco = components['schemas']['Hueco'];
export type ModalidadAtencion = components['schemas']['ModalidadAtencion'];

// ponytail: duracion fija; usar la del profesional o del box cuando la API la publique.
export const DURACION_SESION_MIN = 50;
const HORA_MS = 3_600_000;

export interface Bloque {
  modalidad: ModalidadAtencion;
  inicio: Date;
  fin: Date;
}

/** Bloques a hora en punto que caben completos en cada hueco, desde `ahora`. */
export function bloquesDeSesion(huecos: Hueco[], ahora = new Date(), duracionMin = DURACION_SESION_MIN): Bloque[] {
  const duracion = duracionMin * 60_000;
  const bloques: Bloque[] = [];
  for (const h of huecos) {
    const fin = new Date(h.fin).getTime();
    // Chile tiene offsets de horas completas: la hora en punto UTC es hora en punto local.
    let t = Math.ceil(Math.max(new Date(h.inicio).getTime(), ahora.getTime()) / HORA_MS) * HORA_MS;
    for (; t + duracion <= fin; t += HORA_MS) bloques.push({ modalidad: h.modalidad, inicio: new Date(t), fin: new Date(t + duracion) });
  }
  return bloques.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

const diaClave = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' });
const horaLocal = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', hourCycle: 'h23' });

/** AAAA-MM-DD en Chile. */
export const dia = (d: Date) => diaClave.format(d);

/** Agrupa por dia de Chile, en orden. */
export function porDia(bloques: Bloque[]): Map<string, Bloque[]> {
  const mapa = new Map<string, Bloque[]>();
  for (const b of bloques) mapa.set(dia(b.inicio), [...(mapa.get(dia(b.inicio)) ?? []), b]);
  return mapa;
}

export const esManana = (b: Bloque) => Number(horaLocal.format(b.inicio)) < 13;

/** mm:ss que faltan hasta `fin` (0 si ya paso). */
export function restante(fin: Date, ahora: Date): { ms: number; texto: string } {
  const ms = Math.max(0, fin.getTime() - ahora.getTime());
  const s = Math.ceil(ms / 1000);
  return { ms, texto: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
}
