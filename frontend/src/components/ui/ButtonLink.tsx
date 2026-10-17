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
}: LinkProps & { variant?: VarianteBoton; size?: TamanoBoton; icon?: Icono; className?: string; children: ReactNode }) {
  const texto =
    variant === 'primary' || variant === 'team' ? 'hover:text-neutral-100' : variant === 'outlinePatient' ? 'hover:text-accent-2-900' : 'hover:text-text';
  return (
    <Link className={`${clasesBoton(variant, size)} ${texto} ${className}`} {...props}>
      {icon && <Icon name={icon} size={size === 'lg' ? 19 : 18} />}
      {children}
    </Link>
  );
}
