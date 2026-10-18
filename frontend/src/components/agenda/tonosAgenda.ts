import type { CitaVista } from '@/lib/panel';

/** Tonos del diseño para distinguir profesionales o boxes (se repiten en ciclo). */
export const TONOS = [
  {
    borde: 'border-l-accent-2-700',
    texto: 'text-accent-2-800',
    muestra: 'border-accent-2-700 bg-accent-2-200',
    barra: 'bg-accent-2-700',
    fondo: 'border-accent-2-500 bg-accent-2-200 text-accent-2-800',
  },
  {
    borde: 'border-l-accent-700',
    texto: 'text-accent-800',
    muestra: 'border-accent-700 bg-accent-200',
    barra: 'bg-accent-700',
    fondo: 'border-accent-500 bg-accent-200 text-accent-800',
  },
  {
    borde: 'border-l-accent-2-800',
    texto: 'text-accent-2-800',
    muestra: 'border-accent-2-800 bg-accent-2-100',
    barra: 'bg-accent-2-800',
    fondo: 'border-accent-2-500 bg-accent-2-100 text-accent-2-800',
  },
  {
    borde: 'border-l-neutral-700',
    texto: 'text-neutral-800',
    muestra: 'border-neutral-700 bg-neutral-200',
    barra: 'bg-neutral-700',
    fondo: 'border-neutral-500 bg-neutral-200 text-neutral-800',
  },
] as const;

export type Tono = (typeof TONOS)[number];

/** Tono estable segun la posicion del id en la lista (directorio o espacios). */
export const tonoDe = (orden: string[], id: string): Tono => TONOS[Math.max(0, orden.indexOf(id)) % TONOS.length]!;

export const NOMBRE_ESTADO_CITA: Record<CitaVista['estado'], string> = {
  CONFIRMADA: 'Confirmada',
  SOLICITADA: 'Por confirmar',
  POR_REPROGRAMAR: 'Por reprogramar',
  CANCELADA: 'Cancelada',
};

export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

/** "09:00" desde minutos desde medianoche. */
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Minutos desde medianoche desde "HH:MM". */
export const minutos = (texto: string) => {
  const [h, m] = texto.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
