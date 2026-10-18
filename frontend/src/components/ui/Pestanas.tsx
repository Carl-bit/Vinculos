'use client';

import { useId, type KeyboardEvent } from 'react';

interface Pestana<T extends string> {
  valor: T;
  etiqueta: string;
}

/**
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
}: {
  pestanas: readonly Pestana<T>[];
  valor: T;
  onChange: (v: T) => void;
  etiqueta: string;
  tono?: 'patient' | 'team';
  panelId?: string;
}) {
  const id = useId();
  const activa = tono === 'patient' ? 'border-accent-2-700 bg-accent-2-700 text-neutral-100' : 'border-accent-700 bg-accent-700 text-neutral-100';
  const mover = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const siguiente = pestanas[(i + paso + pestanas.length) % pestanas.length]!;
    onChange(siguiente.valor);
    document.getElementById(`${id}-${siguiente.valor}`)?.focus();
  };
  return (
    <div role="tablist" aria-label={etiqueta} className="flex flex-wrap gap-2">
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
            className={`min-h-10 cursor-pointer rounded-full border-[1.5px] px-[17px] py-2 text-[12.5px] font-extrabold whitespace-nowrap transition-colors duration-200 ease-out ${
              seleccionada ? activa : 'border-neutral-400 bg-bg text-neutral-700 hover:border-accent-500'
            }`}
          >
            {p.etiqueta}
          </button>
        );
      })}
    </div>
  );
}
