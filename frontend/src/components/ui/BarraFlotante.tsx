import type { ReactNode } from 'react';

/**
 * Barra de herramientas flotante (diseño "Moderno A"): pastilla centrada, fija
 * arriba al hacer scroll. En teléfono se parte en varias líneas: ahí va con
 * radio de panel y sin quedar fija (taparía el contenido).
 */
export function BarraFlotante({ etiqueta, children, variante = 'organic' }: { etiqueta: string; children: ReactNode; variante?: 'organic' | 'moderno' }) {
  const piel =
    variante === 'moderno'
      ? 'rounded-panel border-borde translucida text-tinta shadow-flotante xl:rounded-full'
      : 'rounded-[28px] border-divider bg-bg shadow-lg';
  return (
    <div
      role="toolbar"
      aria-label={etiqueta}
      className={`z-20 mx-auto md:sticky md:top-3 flex w-fit max-w-full flex-wrap items-center gap-2 border py-2 pr-2 pl-[18px] ${piel}`}
    >
      {children}
    </div>
  );
}

/** Separador vertical entre grupos de la barra. */
export const SeparadorBarra = () => <span aria-hidden className="mx-1 hidden h-6 w-px bg-divider sm:block" />;
