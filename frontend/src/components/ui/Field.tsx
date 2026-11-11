'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

/** Control de texto del diseño: pildora (input/select) o caja redondeada (textarea). */
const CONTROL =
  'control w-full font-body text-[15px] text-text bg-bg border-[1.5px] border-neutral-400 px-[18px] py-3.5 placeholder:text-neutral-700 focus-visible:border-accent-500 data-[cambiado=true]:border-arcilla data-[cambiado=true]:bg-papel aria-[invalid=true]:border-accent-700 disabled:opacity-60';

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  /** Accion junto a la etiqueta (p. ej. "¿La olvidaste?"). */
  aside?: ReactNode;
  /** Moderno A: el valor difiere de lo guardado (borde arcilla y "Modificado" en la etiqueta, no solo color). */
  cambiado?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean; 'data-cambiado'?: boolean }) => ReactNode;
}

/** Etiqueta, ayuda y error accesibles alrededor de un control. */
export function Field({ label, hint, error, required, aside, cambiado, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint && `${id}-ayuda`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex flex-col gap-[7px]">
      <span className="flex items-baseline justify-between gap-3 text-[12.5px] font-extrabold">
        <label htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
          {cambiado && <span className="ml-2 text-[11px] font-extrabold tracking-[0.06em] text-arcilla uppercase">Modificado</span>}
        </label>
        {aside}
      </span>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required, 'data-cambiado': cambiado || undefined })}
      {hint && (
        <span id={`${id}-ayuda`} className="text-[12.5px] font-semibold text-neutral-800">
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

/**
 * `enterEnvia` (mensajes, punto 14): Enter envia el formulario y Shift+Enter
 * hace salto de linea. Respeta la composicion de acentos (IME) en curso.
 */
export function Textarea({ className = '', enterEnvia = false, onKeyDown, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { enterEnvia?: boolean }) {
  return (
    <textarea
      className={`${CONTROL} min-h-28 rounded-lg ${className}`}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (enterEnvia && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
      }}
      {...props}
    />
  );
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL} rounded-full ${className}`} {...props} />;
}
