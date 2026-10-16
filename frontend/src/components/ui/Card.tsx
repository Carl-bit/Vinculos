import type { HTMLAttributes } from 'react';

/** Superficie base: fondo, borde divisor, radio grande y sombra media. */
export function Card({ className = '', ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-lg border border-divider bg-bg px-[22px] pt-5 pb-[22px] shadow-md ${className}`} {...props} />;
}
