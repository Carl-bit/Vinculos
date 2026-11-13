'use client';

import { useId } from 'react';

/** Escala de 1 a 10 con radios nativos (flechas del teclado incluidas). */
export function EscalaDiez({ etiqueta, valor, onChange, disabled }: { etiqueta: string; valor?: number; onChange: (v: number) => void; disabled?: boolean }) {
  const nombre = useId();
  return (
    <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-1.5">
      {Array.from({ length: 10 }, (_v, i) => i + 1).map((n) => (
        <label key={n} className="cursor-pointer">
          <input type="radio" name={nombre} className="peer sr-only" checked={valor === n} disabled={disabled} onChange={() => onChange(n)} />
          <span className="grid size-10 place-items-center rounded-[10px] border border-divider bg-neutral-100 text-[14px] font-extrabold peer-checked:border-accent-700 peer-checked:bg-accent-700 peer-checked:text-neutral-100 peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
            {n}
          </span>
        </label>
      ))}
    </div>
  );
}
