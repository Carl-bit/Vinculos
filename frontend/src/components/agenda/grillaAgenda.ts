import type { Icono } from '@/lib/iconos';
import type { CitaVista } from '@/lib/panel';

/** Hora de inicio de la grilla si el centro no tiene horario (la grilla corre hasta las 24:00). */
export const HORA_INICIO = 8;
/** Alto minimo de una hora (px): bajo eso la grilla hace scroll interno en vez de apretar las tarjetas. */
export const ALTO_HORA_MINIMO = 30;

/** Primera hora visible: la apertura mas temprana del horario del centro (configurable), o las 08:00. */
export function horaInicioCentro(horario: { inicioMin: number }[] | undefined): number {
  return horario?.length ? Math.min(...horario.map((h) => Math.floor(h.inicioMin / 60))) : HORA_INICIO;
}
const horaMin = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Minutos desde la medianoche de Chile. */
export function minutosChile(iso: string | Date): number {
  const [h, m] = horaMin.format(new Date(iso)).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Top y alto (% del rango desdeHora-24:00) segun la hora de inicio y la
 * duracion: la grilla estira las horas al alto de la ventana. Lo que empieza
 * antes de desdeHora se recorta al borde.
 */
export function posicion(inicio: string, fin: string, desdeHora = HORA_INICIO): { top: number; alto: number } {
  const rango = (24 - desdeHora) * 60;
  const crudo = minutosChile(inicio) - desdeHora * 60;
  const duracion = Math.max(0, (new Date(fin).getTime() - new Date(inicio).getTime()) / 60_000);
  const desde = Math.min(rango, Math.max(0, crudo));
  const hasta = Math.min(rango, Math.max(0, crudo + duracion));
  return { top: (desde / rango) * 100, alto: ((hasta - desde) / rango) * 100 };
}
/**
 * Carriles para eventos que se pisan en una columna: cada evento recibe su
 * carril y el total del grupo que se solapa (ancho = 1 / total).
 */
export function carriles<T extends { inicio: string; fin: string }>(eventos: T[]): Map<T, { carril: number; total: number }> {
  const orden = [...eventos].sort((a, b) => a.inicio.localeCompare(b.inicio) || b.fin.localeCompare(a.fin));
  const salida = new Map<T, { carril: number; total: number }>();
  let grupo: T[] = [];
  let finGrupo = '';
  const cerrar = () => {
    const fines: string[] = [];
    const asignado = grupo.map((e) => {
      let c = fines.findIndex((f) => f <= e.inicio);
      if (c === -1) c = fines.push(e.fin) - 1;
      else fines[c] = e.fin;
      return [e, c] as const;
    });
    for (const [e, c] of asignado) salida.set(e, { carril: c, total: fines.length });
    grupo = [];
  };
  for (const e of orden) {
    if (grupo.length && e.inicio >= finGrupo) cerrar();
    grupo.push(e);
    finGrupo = grupo.length === 1 || e.fin > finGrupo ? e.fin : finGrupo;
  }
  if (grupo.length) cerrar();
  return salida;
}

export type EstadoVisual = 'confirmada' | 'pendiente_pago' | 'retenida' | 'atendida' | 'sin_evolucion' | 'no_asistio' | 'por_reprogramar' | 'realizada';

/** Simbolo y texto de cada estado (el color nunca va solo, 1.3 del correctivo). */
export const ESTADOS_VISUALES: Record<EstadoVisual, { icono: Icono; texto: string }> = {
  confirmada: { icono: 'check_circle', texto: 'Confirmada' },
  pendiente_pago: { icono: 'payments', texto: 'Pendiente de pago' },
  retenida: { icono: 'hourglass_top', texto: 'Hora retenida' },
  atendida: { icono: 'task_alt', texto: 'Atendida' },
  sin_evolucion: { icono: 'edit_note', texto: 'Sin evolución' },
  no_asistio: { icono: 'event_busy', texto: 'No asistió' },
  por_reprogramar: { icono: 'event_repeat', texto: 'Por reprogramar' },
  realizada: { icono: 'task_alt', texto: 'Realizada' },
};

/**
 * Estado que se dibuja. `conEvolucion`: undefined si el rol no puede saberlo
 * (ADMIN/GESTION: es clinico) y la sesion pasada queda "Realizada".
 */
export function estadoVisual(c: Pick<CitaVista, 'estado' | 'fin'>, o: { ahora: number; conEvolucion?: boolean; inasistencia?: boolean }): EstadoVisual | null {
  if (c.estado === 'CANCELADA' || c.estado === 'LIBERADA') return null;
  if (c.estado === 'POR_REPROGRAMAR') return 'por_reprogramar';
  if (c.estado === 'PENDIENTE_PAGO' || c.estado === 'SOLICITADA') return 'pendiente_pago';
  if (c.estado === 'RETENIDA') return 'retenida';
  if (new Date(c.fin).getTime() > o.ahora) return 'confirmada';
  if (o.inasistencia) return 'no_asistio';
  if (o.conEvolucion === undefined) return 'realizada';
  return o.conEvolucion ? 'atendida' : 'sin_evolucion';
}
