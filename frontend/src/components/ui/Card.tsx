import type { HTMLAttributes } from 'react';

/**
 * Superficie base. `organic` = la de siempre (radio grande, sombra media).
 * Moderno A (03c): `crema` = tarjeta crema con borde suave sobre la trama y
 * `translucida` = crema al 92 % con blur (inspector, barras flotantes).
 * Decision del usuario (2026-11-05): todas las tarjetas en crema, no papel.
 */
const VARIANTES = {
  organic: 'rounded-lg border border-divider bg-bg shadow-suave',
  crema: 'rounded-panel border border-borde bg-bg text-tinta shadow-suave',
  translucida: 'rounded-panel border border-borde translucida text-tinta shadow-flotante',
} as const;

export function Card({ className = '', variante = 'organic', ...props }: HTMLAttributes<HTMLElement> & { variante?: keyof typeof VARIANTES }) {
  return <section className={`${VARIANTES[variante]} px-[22px] pt-5 pb-[22px] ${className}`} {...props} />;
}
