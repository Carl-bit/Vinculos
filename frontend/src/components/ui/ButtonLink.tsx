import Link, { type LinkProps } from 'next/link';
import type { ReactNode } from 'react';

import type { Icono } from '@/lib/iconos';

import { clasesBoton, type TamanoBoton, type VarianteBoton } from './Button';
import { Icon } from './Icon';

/** Enlace con forma de boton (mismas variantes que Button). Los hover mantienen el color del texto. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  children,
  ...props
}: LinkProps & {
  variant?: VarianteBoton;
  size?: TamanoBoton;
  icon?: Icono;
  className?: string;
  children: ReactNode;
  /** Sitio publico desde el panel (punto 30): '_blank'. */
  target?: string;
  rel?: string;
}) {
  const texto = {
    primary: 'hover:text-neutral-100',
    team: 'hover:text-neutral-100',
    contornoOscuro: 'hover:text-neutral-100',
    outlinePatient: 'hover:text-accent-2-900',
    sobreOscuro: 'hover:text-accent-900',
    secondary: 'hover:text-text',
    ghost: 'hover:text-text',
  }[variant];
  return (
    <Link className={`${clasesBoton(variant, size)} ${texto} ${className}`} {...props}>
      {icon && <Icon name={icon} size={size === 'lg' ? 19 : 18} />}
      {children}
    </Link>
  );
}
