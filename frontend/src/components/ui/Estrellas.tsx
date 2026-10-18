'use client';

import { useId } from 'react';

import { Icon } from './Icon';

/**
 * Calificacion de 1 a 5. Con `onChange` es un grupo de radios (teclado con
 * flechas, como cualquier radio); sin el, solo muestra el valor.
 */
export function Estrellas({
  valor,
  onChange,
  etiqueta = 'Calificación',
  error,
}: {
  valor: number;
  onChange?: (v: number) => void;
  etiqueta?: string;
  error?: string;
}) {
  const id = useId();
  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5 text-accent-600" role="img" aria-label={`${valor} de 5`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Icon key={n} name={n <= valor ? 'star' : 'star_border'} size={18} />
        ))}
      </span>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1.5 text-[12.5px] font-extrabold">
        {etiqueta}
        <span aria-hidden="true"> *</span>
      </legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer rounded-full p-1 text-accent-600 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-accent">
            <input type="radio" name={id} value={n} checked={valor === n} onChange={() => onChange(n)} className="sr-only" />
            <Icon name={n <= valor ? 'star' : 'star_border'} size={30} />
            <span className="sr-only">{n === 1 ? '1 estrella' : `${n} estrellas`}</span>
          </label>
        ))}
      </div>
      {error && (
        <span id={`${id}-error`} role="alert" className="text-[12.5px] font-bold text-accent-700">
          {error}
        </span>
      )}
    </fieldset>
  );
}
