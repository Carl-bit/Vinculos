import Link from 'next/link';
import type { ReactNode } from 'react';

import { Icon } from '@/components/ui/Icon';
import { centroPublico } from '@/lib/api/servidor';

import { Marca, NOMBRE_CENTRO } from './Marca';

/**
 * Shell del sitio publico del centro (diseño "Landing"). Server component: el
 * nombre del centro y la navegacion salen de publico/centro (los modulos
 * inactivos no aparecen). Si la API no responde, queda la marca y el acceso.
 */
export async function LayoutPublico({ children }: { children: ReactNode }) {
  const centro = await centroPublico().catch(() => null);
  const modulos = centro?.modulos ?? [];
  const nombre = centro?.nombre_centro ?? NOMBRE_CENTRO;
  const nav = [
    modulos.includes('PAGINA_PUBLICA') && { href: '/equipo', etiqueta: 'Equipo' },
    centro && { href: '/#servicios', etiqueta: 'Servicios' },
    modulos.includes('MATCH') && { href: '/match', etiqueta: 'Match terapéutico' },
    modulos.includes('AGENDA') && { href: '/pedir-hora', etiqueta: 'Pedir una hora' },
  ].filter((x): x is { href: string; etiqueta: string } => !!x);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1180px] flex-col px-[clamp(20px,4vw,40px)]">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-2 py-[22px]">
        <Marca nombre={nombre} />
        <nav
          aria-label="Sitio del centro"
          className="order-3 -mx-2 flex w-full flex-wrap gap-x-1 text-[14.5px] font-bold md:order-none md:mx-0 md:ml-auto md:w-auto md:gap-[18px]"
        >
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="flex min-h-10 items-center rounded-full px-2 whitespace-nowrap text-text hover:text-accent-2-700">
              {n.etiqueta}
            </Link>
          ))}
        </nav>
        <Link
          href="/ingreso"
          className="ml-auto rounded-full border-[1.5px] border-neutral-400 px-5 py-2.5 text-sm font-extrabold whitespace-nowrap text-text transition-colors duration-200 hover:border-accent-500 hover:bg-accent-200 hover:text-text md:ml-0"
        >
          Iniciar sesión
        </Link>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="flex flex-wrap items-center gap-x-[22px] gap-y-2 py-[30px] text-[13px] font-semibold text-neutral-700">
        <span>
          © {new Date().getFullYear()} {nombre}
        </span>
        <Link href="/politicas/POLITICA_DATOS" className="text-neutral-700 hover:text-accent-2-800">
          Privacidad
        </Link>
        {centro?.instagram && (
          <a
            href={`https://instagram.com/${centro.instagram.replace(/^@/, '')}`}
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-neutral-700 hover:text-accent-2-800"
          >
            Instagram <Icon name="north_east" size={14} />
          </a>
        )}
        <span className="ml-auto flex items-center gap-[7px]">
          Plataforma <span className="font-black">Vínculos</span>
        </span>
      </footer>
    </div>
  );
}
