'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/** Control de texto del diseño: pildora (input/select) o caja redondeada (textarea). */
const CONTROL =
  'w-full font-body text-[15px] text-text bg-bg border-[1.5px] border-neutral-400 px-[18px] py-3.5 placeholder:text-neutral-700 focus-visible:border-accent-500 aria-[invalid=true]:border-accent-700 disabled:opacity-60';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Accion junto a la etiqueta (p. ej. "¿La olvidaste?"). */
  aside?: ReactNode;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }) => ReactNode;
}

/** Etiqueta, ayuda y error accesibles alrededor de un control. */
export function Field({ label, hint, error, required, aside, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="flex items-baseline justify-between gap-3 text-[12.5px] font-extrabold">
        <label htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
        {aside}
      </span>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {hint && (
        <span id={`${id}-ayuda`} className="text-[12.5px] font-semibold text-neutral-700">
          {hint}
        </span>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="text-[12.5px] font-bold text-accent-700">
          {error}
        </span>
      )}
    </div>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL} rounded-full ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL} min-h-28 rounded-lg ${className}`} {...props} />;
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL} rounded-full ${className}`} {...props} />;
}
