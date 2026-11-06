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

/**
 * Fondo de lienzo punteado (Mi perfil, Mi cuenta, Equipo). Lo pinta el <main>
 * del panel entero cuando la pagina marca `data-lienzo`: cubre todo el modulo
 * (no se ajusta al contenido) y deja fuera la barra lateral.
 */
export const FONDO_LIENZO =
  'has-[[data-lienzo]]:bg-neutral-200 has-[[data-lienzo]]:[background-image:radial-gradient(var(--color-neutral-400)_1px,transparent_1px)] has-[[data-lienzo]]:[background-size:18px_18px]';
