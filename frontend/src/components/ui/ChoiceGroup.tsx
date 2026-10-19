'use client';

import { useId, type ReactNode } from 'react';

interface Opcion {
  value: string;
  label: string;
}

interface ChoiceGroupProps {
  legend: ReactNode;
  options: readonly Opcion[];
  /** radio: un valor; checkbox: varios. */
  type: 'radio' | 'checkbox';
  value: readonly string[];
  onChange: (value: string[]) => void;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}

/** Grupo de opciones (radio o casillas) con leyenda y error accesibles. */
export function ChoiceGroup({ legend, options, type, value, onChange, required, error, disabled }: ChoiceGroupProps) {
  const id = useId();
  const cambiar = (opcion: string, marcada: boolean) => {
    if (type === 'radio') onChange([opcion]);
    else onChange(marcada ? [...value, opcion] : value.filter((v) => v !== opcion));
  };
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-error` : undefined} aria-invalid={error ? true : undefined} disabled={disabled}>
      <legend className="mb-1.5 text-[12.5px] font-extrabold">
        {legend}
        {required && <span aria-hidden="true"> *</span>}
      </legend>
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-[9px] text-[13.5px] font-semibold text-neutral-800">
          <input
            type={type}
            name={id}
            value={o.value}
            checked={value.includes(o.value)}
            onChange={(e) => cambiar(o.value, e.target.checked)}
            required={type === 'radio' ? required : undefined}
            className="size-[17px] cursor-pointer accent-accent-2-600"
          />
          {o.label}
        </label>
      ))}
      {error && (
        <span id={`${id}-error`} role="alert" className="text-[12.5px] font-bold text-accent-700">
          {error}
        </span>
      )}
    </fieldset>
  );
}
