import type { ButtonHTMLAttributes } from 'react';

import type { Icono } from '@/lib/iconos';

import { Icon } from './Icon';

/**
 * Boton pildora del diseño. primary = accion del paciente/publico (accent-2),
 * team = accion del equipo (accent), secondary = borde neutro, ghost = sin borde.
 */
const VARIANTES = {
  primary: 'bg-accent-2-700 text-neutral-100 shadow-sm hover:bg-accent-2-800 hover:shadow-md',
  team: 'bg-accent-700 text-neutral-100 shadow-sm hover:bg-accent-800 hover:shadow-md',
  secondary: 'border-[1.5px] border-neutral-400 bg-bg text-text hover:bg-accent-200 hover:border-accent-500',
  /** Borde verde sobre superficies accent-2 (bloques de llamado a la accion). */
  outlinePatient: 'border-[1.5px] border-accent-2-700 text-accent-2-900 hover:bg-accent-2-100',
  ghost: 'bg-transparent text-text hover:bg-accent-200',
} as const;

const TAMANOS = {
  md: 'px-5 py-[11px] text-[13.5px] gap-2',
  lg: 'px-7 py-4 text-[15px] gap-2.5',
} as const;

export type VarianteBoton = keyof typeof VARIANTES;
export type TamanoBoton = keyof typeof TAMANOS;

/** Clases del boton, compartidas con ButtonLink (enlaces con forma de boton). */
export const clasesBoton = (variant: VarianteBoton = 'primary', size: TamanoBoton = 'md') =>
  `inline-flex cursor-pointer items-center justify-center rounded-full font-body font-extrabold transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out active:scale-[0.98] ${VARIANTES[variant]} ${TAMANOS[size]}`;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: VarianteBoton;
  size?: TamanoBoton;
  icon?: Icono;
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...resto
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${clasesBoton(variant, size)} disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100 ${className}`}
      {...resto}
    >
      {loading ? <Icon name="progress_activity" className="animate-spin" /> : icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
