import type { ReactNode } from 'react';

/**
 * Etiqueta pildora con borde (box, rol, estado). Con `tono` es la pildora de
 * estado del diseño (mayusculas, 11 px): verde = vigente/confirmado,
 * terracota = requiere atencion, neutra = terminado.
 */
const TONOS = {
  positivo: 'border-accent-2-500 bg-accent-2-200 text-accent-2-900',
  atencion: 'border-accent-500 bg-accent-200 text-accent-900',
  neutro: 'border-neutral-500 bg-neutral-200 text-neutral-800',
} as const;

export type TonoBadge = keyof typeof TONOS;

export function Badge({ children, tono, className = '' }: { children: ReactNode; tono?: TonoBadge; className?: string }) {
  if (tono) {
    return (
      <span
        className={`inline-flex flex-none items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-extrabold tracking-[0.06em] whitespace-nowrap uppercase ${TONOS[tono]} ${className}`}
      >
        {children}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-divider px-[11px] py-1 text-xs font-extrabold text-neutral-700 ${className}`}>
      {children}
    </span>
  );
}
