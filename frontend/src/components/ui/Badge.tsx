import type { ReactNode } from 'react';

/** Etiqueta pildora con borde (box, rol, estado). */
export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-divider px-[11px] py-1 text-xs font-extrabold text-neutral-700 ${className}`}>
      {children}
    </span>
  );
}
