import type { ReactNode } from 'react';

/** Barra de herramientas flotante (diseño "Moderno A"): pastilla centrada, fija arriba al hacer scroll. */
export function BarraFlotante({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label={etiqueta}
      className="sticky top-3 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-2 rounded-[28px] border border-divider bg-bg py-2 pr-2 pl-[18px] shadow-lg"
    >
      {children}
    </div>
  );
}

/** Separador vertical entre grupos de la barra. */
export const SeparadorBarra = () => <span aria-hidden className="mx-1 hidden h-6 w-px bg-divider sm:block" />;

/** Fondo de lienzo punteado de Mi perfil y Mi cuenta. */
export const LIENZO = 'rounded-lg bg-neutral-200 [background-image:radial-gradient(var(--color-neutral-400)_1px,transparent_1px)] [background-size:18px_18px]';
