'use client';

import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { ALTO_HORA_MINIMO, ESTADOS_VISUALES, carriles, minutosChile, posicion, type EstadoVisual, type HoraElegida } from '@/lib/grillaAgenda';
import type { CitaVista } from '@/lib/panel';

/**
 * Grilla de tiempo semanal de Agenda y Espacios, compartida con la agenda
 * rapida de un profesional (seguimiento del equipo en Fichas y Pacientes):
 * misma grilla, mismas tarjetas y colores por modalidad.
 */

export const horaCorta = new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export const contarCitas = (n: number) => (n === 1 ? '1 cita' : `${n} citas`);
const resumenDia = (p: number, o: number) => `${p} ${p === 1 ? 'presencial' : 'presenciales'} · ${o} online`;

/** Evento de una columna: una sesion (encima) o un bloque de fondo. */
export type EventoGrilla = { tipo: 'cita'; cita: CitaVista; inicio: string; fin: string } | { tipo: 'fondo'; inicio: string; fin: string };

export interface ColumnaGrilla<E extends EventoGrilla> {
  clave: string;
  titulo: string;
  /** Dia (AAAA-MM-DD) de la columna: para la linea de la hora actual. */
  dia: string;
  eventos: E[];
}

/**
 * Colores de la sesion por modalidad (design-reference "Opcion A semana
 * unificada"): presencial terracota, online azul, pago pendiente punteado.
 */
export const pendienteDePago = (e: EstadoVisual | null) => e === 'pendiente_pago' || e === 'retenida';
export const claseSesion = (c: Pick<CitaVista, 'modalidad'>, e: EstadoVisual | null) =>
  pendienteDePago(e)
    ? 'border-2 border-dashed border-pendiente-700 bg-pendiente-100 text-pendiente-900'
    : c.modalidad === 'ONLINE'
      ? 'border border-online-600 bg-online-100 text-online-900'
      : 'border border-presencial-600 bg-presencial-200 text-presencial-900';

/**
 * Grilla de tiempo: una columna por dia con encabezado fijo y resumen. Va de
 * desdeHora a las 24:00 y estira las horas al alto disponible (minimo
 * ALTO_HORA_MINIMO por hora; bajo eso, scroll interno). Debajo de los eventos,
 * las horas vacias a futuro (`huecos`, opcional) se eligen con el mouse para
 * agendar online; con teclado se agenda desde "Agendar sesion" (evita decenas
 * de paradas de tabulacion).
 */
export function GrillaTiempo<E extends EventoGrilla>({
  columnas,
  hoy,
  ahora,
  desdeHora,
  huecos,
  onHueco,
  render,
  altoHora = ALTO_HORA_MINIMO,
}: {
  columnas: ColumnaGrilla<E>[];
  hoy: string;
  ahora: number;
  desdeHora: number;
  huecos?: (dia: string) => HoraElegida[];
  onHueco?: (h: HoraElegida) => void;
  render: (e: E) => ReactNode;
  /** Alto minimo de una hora (px); bajo eso, scroll interno. */
  altoHora?: number;
}) {
  const horas = Array.from({ length: 24 - desdeHora }, (_, i) => desdeHora + i);
  const pct = (h: number) => `${((h - desdeHora) / horas.length) * 100}%`;
  const plantilla = { gridTemplateColumns: `56px repeat(${columnas.length}, minmax(140px, 1fr))` };
  const minutoAhora = minutosChile(new Date(ahora));
  const citasDe = (eventos: E[]) => eventos.flatMap((e: EventoGrilla) => (e.tipo === 'cita' ? [e.cita] : []));
  return (
    <section aria-label="Calendario" className="flex min-h-0 flex-1 flex-col overflow-auto rounded-[var(--radius-lg)] border border-divider bg-bg shadow-md">
      <div className="sticky top-0 z-[4] grid flex-none border-b border-divider bg-neutral-200" style={plantilla}>
        <span className="sticky left-0 bg-neutral-200" aria-hidden />
        {columnas.map((c) => {
          const citas = citasDe(c.eventos);
          const online = citas.filter((x) => x.modalidad === 'ONLINE').length;
          return (
            <span key={c.clave} className={`flex min-w-0 flex-col border-l border-divider px-2.5 py-1.5 ${c.dia === hoy ? 'bg-accent-200' : ''}`}>
              <span className={`truncate text-[13px] font-black first-letter:uppercase ${c.dia === hoy ? 'text-accent-800' : ''}`}>
                {c.titulo}
                {c.dia === hoy && <span className="sr-only"> (hoy)</span>}
              </span>
              <span className="truncate text-[11px] font-bold text-neutral-700 tabular-nums">
                <span className="sr-only">{contarCitas(citas.length)}: </span>
                {resumenDia(citas.length - online, online)}
              </span>
            </span>
          );
        })}
      </div>
      <div className="relative grid flex-[1_0_auto]" style={{ ...plantilla, minHeight: horas.length * altoHora }}>
        <div className="sticky left-0 z-[3] bg-bg">
          {horas.map((h) => (
            <span
              key={h}
              className="absolute right-2 text-[11px] font-extrabold text-neutral-700 tabular-nums"
              style={{ top: pct(h), transform: h === desdeHora ? 'translateY(2px)' : 'translateY(-50%)' }}
            >
              {`${String(h).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        {columnas.map((c) => {
          // El fondo va con sus carriles; las sesiones encima, con los suyos.
          const lugar = new Map<E, { carril: number; total: number }>([
            ...carriles(c.eventos.filter((e) => e.tipo !== 'cita')),
            ...carriles(c.eventos.filter((e) => e.tipo === 'cita')),
          ]);
          return (
            <div key={c.clave} className="relative border-l border-divider">
              {horas.map((h) => (
                <span key={h} aria-hidden className="absolute inset-x-0 border-t border-divider/70" style={{ top: pct(h) }} />
              ))}
              {huecos?.(c.dia).map((h) => {
                const p = posicion(h.inicio.toISOString(), h.fin.toISOString(), desdeHora);
                const texto = horaCorta.format(h.inicio);
                return (
                  <button
                    key={h.inicio.getTime()}
                    type="button"
                    tabIndex={-1}
                    onClick={() => onHueco?.(h)}
                    aria-label={`Agendar sesión online a las ${texto}`}
                    className="absolute inset-x-[2px] cursor-pointer overflow-hidden rounded-[10px] border-2 border-dashed border-transparent px-1.5 py-1 text-left text-[11px] leading-tight font-bold text-online-900 opacity-0 transition-opacity duration-150 hover:border-online-600 hover:bg-online-100/70 hover:opacity-100 motion-reduce:transition-none"
                    style={{ top: `${p.top}%`, height: `${p.alto}%`, minHeight: 22 }}
                  >
                    <span className="tabular-nums">{texto}</span> Agendar online
                  </button>
                );
              })}
              {c.dia === hoy && minutoAhora >= desdeHora * 60 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 z-[3] border-t-2 border-accent-700"
                  style={{ top: `${((minutoAhora - desdeHora * 60) / (horas.length * 60)) * 100}%` }}
                >
                  <span className="absolute -top-[5px] -left-[5px] size-2 rounded-full bg-accent-700" />
                </span>
              )}
              {c.eventos.map((e, i) => {
                const p = posicion(e.inicio, e.fin, desdeHora);
                if (p.alto <= 0) return null;
                const l = lugar.get(e) ?? { carril: 0, total: 1 };
                const base: EventoGrilla = e;
                return (
                  <div
                    key={base.tipo === 'cita' ? base.cita.id : `f-${i}-${e.inicio}`}
                    className={`absolute px-[2px] ${e.tipo === 'cita' ? 'z-[2]' : 'z-0'}`}
                    style={{ top: `${p.top}%`, height: `${p.alto}%`, minHeight: 22, left: `${(l.carril / l.total) * 100}%`, width: `${100 / l.total}%` }}
                  >
                    {render(e)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Etiqueta "SIN EVOL." / "PAGO" del diseño (texto, no solo color). */
export function Marca({ children, tono }: { children: ReactNode; tono: 'oscuro' | 'pago' }) {
  return (
    <span
      className={`flex-none rounded-full px-1.5 py-px text-[9.5px] whitespace-nowrap leading-tight font-extrabold tracking-[0.02em] ${
        tono === 'pago' ? 'bg-pendiente-900 text-neutral-100' : 'bg-text text-neutral-100'
      }`}
    >
      {children}
    </span>
  );
}

/** Tarjeta compacta: hora, paciente, profesional (multi), modalidad y box, con su estado (simbolo o marca). */
export function TarjetaCita({
  cita,
  paciente,
  profesional,
  box,
  estado,
  encima = false,
  onElegir,
}: {
  cita: CitaVista;
  paciente: string;
  profesional?: string;
  box: string | null;
  estado: EstadoVisual | null;
  /** Hay un box elegido: la tarjeta va sobre su fondo y se eleva con sombra. */
  encima?: boolean;
  onElegir: (c: CitaVista) => void;
}) {
  const e = estado ? ESTADOS_VISUALES[estado] : null;
  const marca = estado === 'sin_evolucion' ? 'SIN EVOL.' : pendienteDePago(estado) ? (estado === 'retenida' ? 'RETENIDA' : 'PAGO') : null;
  const simbolo = e && !marca && estado !== 'confirmada' ? e : null;
  const lugar = cita.modalidad === 'ONLINE' ? 'Online' : (box ?? 'Presencial');
  return (
    <button
      type="button"
      onClick={() => onElegir(cita)}
      aria-label={`${horaCorta.format(new Date(cita.inicio))} ${paciente}${profesional ? `, ${profesional}` : ''}, ${lugar}${e ? `, ${e.texto}` : ''}`}
      className={`flex h-full w-full min-w-0 cursor-pointer flex-col gap-px overflow-hidden rounded-[10px] px-1.5 py-1 text-left leading-tight transition-shadow duration-200 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent-700 motion-reduce:transition-none ${claseSesion(cita, estado)} ${
        encima ? 'shadow-md' : 'shadow-sm'
      }`}
    >
      <span className="flex min-w-0 items-center gap-1 text-[12px] font-black">
        {simbolo && <Icon name={simbolo.icono} size={14} className="flex-none" />}
        <span className="flex-none tabular-nums">{horaCorta.format(new Date(cita.inicio))}</span>
        <span className="truncate">{paciente}</span>
      </span>
      <span className="flex min-w-0 items-center gap-1 text-[11px] font-bold">
        <Icon name={cita.modalidad === 'ONLINE' ? 'videocam' : 'meeting_room'} size={13} className="flex-none" />
        <span className="truncate">{profesional ? `${profesional} · ${lugar}` : lugar}</span>
        {marca && (
          <span className="ml-auto">
            <Marca tono={marca === 'SIN EVOL.' ? 'oscuro' : 'pago'}>{marca}</Marca>
          </span>
        )}
      </span>
    </button>
  );
}
