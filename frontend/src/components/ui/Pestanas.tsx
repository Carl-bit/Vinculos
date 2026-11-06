'use client';

import { useId, type KeyboardEvent } from 'react';

interface Pestana<T extends string> {
  valor: T;
  etiqueta: string;
  /** Contador de pendientes (se oculta en 0). */
  n?: number;
}

/**
 * 03c: agrupadas en una pastilla crema (Moderno A), 44 px.
 * Pestañas pildora del diseño ("Proximas / Pasadas / Todas" en Mi Cuenta):
 * la activa en accent-2 (paciente) o accent (equipo). Patron tablist con
 * flechas izquierda/derecha. El contenido lo rinde quien la usa, con
 * `panelId` como id del tabpanel.
 */
export function Pestanas<T extends string>({
  pestanas,
  valor,
  onChange,
  etiqueta,
  tono = 'patient',
  panelId,
  sinFondo = false,
}: {
  pestanas: readonly Pestana<T>[];
  valor: T;
  onChange: (v: T) => void;
  etiqueta: string;
  /** `moderno` = PillNav de Moderno A: activa en tinta, inactivas sin borde, 44 px. */
  tono?: 'patient' | 'team' | 'moderno';
  panelId?: string;
  /** Dentro de una barra que ya es pastilla (Equipo, muestrario): sin el grupo propio. */
  sinFondo?: boolean;
}) {
  const id = useId();
  const moderno = tono === 'moderno';
  const activa = moderno
    ? 'border-tinta bg-tinta text-lienzo'
    : tono === 'patient'
      ? 'border-accent-2-700 bg-accent-2-700 text-neutral-100'
      : 'border-accent-700 bg-accent-700 text-neutral-100';
  // 03c Moderno A: las inactivas sin borde dentro del grupo; la activa rellena con el color de la zona (marca del centro).
  const inactiva = 'border-transparent text-neutral-800 hover:bg-lienzo';
  const mover = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const siguiente = pestanas[(i + paso + pestanas.length) % pestanas.length]!;
    onChange(siguiente.valor);
    document.getElementById(`${id}-${siguiente.valor}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={etiqueta}
      className={`flex max-w-full flex-wrap gap-1 ${sinFondo ? '' : 'w-fit rounded-[22px] border border-borde bg-bg p-1 shadow-suave'}`}
    >
      {pestanas.map((p, i) => {
        const seleccionada = p.valor === valor;
        return (
          <button
            key={p.valor}
            id={`${id}-${p.valor}`}
            type="button"
            role="tab"
            aria-selected={seleccionada}
            aria-controls={panelId}
            tabIndex={seleccionada ? 0 : -1}
            onClick={() => onChange(p.valor)}
            onKeyDown={(e) => mover(e, i)}
            className={`min-h-11 px-4 text-[13px] ${seleccionada ? 'shadow-sm' : ''} cursor-pointer rounded-full border-[1.5px] py-2 font-extrabold whitespace-nowrap transition-colors duration-200 ease-out ${
              seleccionada ? activa : inactiva
            }`}
          >
            {p.etiqueta}
            {!!p.n && (
              <span className="ml-1.5 rounded-full border border-pendiente-700 bg-pendiente-100 px-[7px] py-px text-[11px] text-pendiente-900">
                {p.n}
                <span className="sr-only"> pendientes</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
