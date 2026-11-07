'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Navegacion del sitio publico (diseño "Moderno"): pildoras con la seccion
 * actual marcada (aria-current). "Pedir una hora" queda activa en todo el
 * flujo de reserva y "Match" tambien en su resultado (subrutas).
 */
export function NavPublica({ enlaces }: { enlaces: { href: string; etiqueta: string }[] }) {
  const ruta = usePathname();
  return (
    <nav aria-label="Sitio del centro" className="order-3 -ml-3 flex w-full flex-wrap gap-0.5 md:order-none md:ml-auto md:w-auto">
      {enlaces.map((n) => {
        const actual = !n.href.includes('#') && (ruta === n.href || ruta.startsWith(`${n.href}/`));
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={actual ? 'page' : undefined}
            className={`pestana flex min-h-[42px] items-center rounded-full px-4 text-sm font-bold whitespace-nowrap text-tinta transition-colors duration-200 hover:bg-neutral-200 hover:text-tinta ${actual ? 'bg-neutral-200' : ''}`}
          >
            {n.etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
