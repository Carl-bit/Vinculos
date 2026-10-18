'use client';

import { useId, type ReactNode } from 'react';

/** Interruptor si/no (role="switch") con etiqueta y descripcion. Verde = paciente, terracota = equipo. */
export function Interruptor({
  etiqueta,
  descripcion,
  activo,
  onChange,
  deshabilitado,
  tono = 'patient',
}: {
  etiqueta: ReactNode;
  descripcion?: ReactNode;
  activo: boolean;
  onChange: (v: boolean) => void;
  deshabilitado?: boolean;
  tono?: 'patient' | 'team';
}) {
  const id = useId();
  const encendido = tono === 'patient' ? 'bg-accent-2-700 border-accent-2-700' : 'bg-accent-700 border-accent-700';
  return (
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={id} className="cursor-pointer text-[14px] font-extrabold">
          {etiqueta}
        </label>
        {descripcion && (
          <span id={`${id}-desc`} className="text-[12.5px] leading-relaxed font-semibold text-neutral-700">
            {descripcion}
          </span>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={activo}
        aria-describedby={descripcion ? `${id}-desc` : undefined}
        disabled={deshabilitado}
        onClick={() => onChange(!activo)}
        className={`relative mt-0.5 h-7 w-12 flex-none cursor-pointer rounded-full border-[1.5px] transition-colors duration-200 ease-out disabled:cursor-not-allowed disabled:opacity-60 ${
          activo ? encendido : 'border-neutral-400 bg-neutral-200'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-1/2 left-[3px] size-5 -translate-y-1/2 rounded-full bg-neutral-100 shadow-sm transition-transform duration-200 ease-out ${
            activo ? 'translate-x-5' : ''
          }`}
        />
      </button>
    </div>
  );
}
